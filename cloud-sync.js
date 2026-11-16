/* KANDY TILE cloud sync — Supabase JS v2 */
(() => {
  'use strict';
  const URL = 'https://dthepmehttlimzwgvotk.supabase.co';
  const KEY = 'sb_publishable_8SHCyJX1eetAhZvMOR9dFg_lEltHI15';
  const ADMIN_EMAIL = 'mohamedamaan520@gmail.com';
  const BUCKET = 'catalog-photos';
  const client = window.supabase.createClient(URL, KEY);
  let isCloudAdmin = false, syncBusy = false, syncAgain = false, realtime = null;
  let catalogCategories = [];
  const $ = id => document.getElementById(id);
  const msg = value => { const el = $('login-message'); if (el) el.textContent = value; };
  const friendly = e => e?.message || String(e || 'Unknown error');
  const adminPanel = $('login-panel');
  if (adminPanel) {
    const form = $('login-form');
    form.innerHTML = '<input type="email" id="cloud-email" autocomplete="username" placeholder="Admin email" required><input type="password" id="password" autocomplete="current-password" placeholder="Password (minimum 8 characters)" minlength="8" required><button class="primary" id="cloud-login" type="submit">Sign in</button><button type="button" id="cloud-signup">Create account</button>';
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent = 'Admin access is restricted to the approved email address. Mobile/SMS login will be added later.';
    adminPanel.appendChild(note);
    const seed = document.createElement('button');
    seed.id = 'cloud-seed';
    seed.className = 'primary';
    seed.type = 'button';
    seed.textContent = 'Upload Existing 87 Designs to Cloud';
    seed.style.marginTop = '12px';
    seed.style.display = 'none';
    $('dashboard').querySelector('.admin-panel').appendChild(seed);
    seed.addEventListener('click', seedExisting);
    $('login-form').onsubmit = async e => {
      e.preventDefault();
      const email = $('cloud-email').value.trim().toLowerCase();
      const password = $('password').value;
      if (email !== ADMIN_EMAIL) return msg('This email is not approved as the KANDY TILE administrator.');
      $('cloud-login').disabled = true;
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await activateAdmin(data.session);
      } catch (err) { msg(friendly(err)); }
      finally { if ($('cloud-login')) $('cloud-login').disabled = false; }
    };
    $('cloud-signup').onclick = async () => {
      const email = $('cloud-email').value.trim().toLowerCase();
      const password = $('password').value;
      if (email !== ADMIN_EMAIL) return msg('Only the approved admin email can create an account.');
      if (password.length < 8) return msg('Password must contain at least 8 characters.');
      $('cloud-signup').disabled = true;
      try {
        const { data, error } = await client.auth.signUp({
          email, password,
          options: { emailRedirectTo: location.origin + location.pathname }
        });
        if (error) throw error;
        if (data.session) await activateAdmin(data.session);
        else msg('Account created. Check your email and confirm the sign-up link, then return here and sign in.');
      } catch (err) { msg(friendly(err)); }
      finally { $('cloud-signup').disabled = false; }
    };
  }

  async function activateAdmin(session) {
    if (!session) { msg('Please sign in with your approved admin email.'); return; }
    const { data, error } = await client.rpc('is_catalog_admin');
    if (error) throw error;
    if (data !== true) {
      await client.auth.signOut();
      isCloudAdmin = false;
      msg('This account is not on the KANDY TILE admin allowlist.');
      return;
    }
    isCloudAdmin = true;
    adminUnlocked = true;
    $('password').value = '';
    $('login-panel').classList.add('hide');
    $('dashboard').classList.remove('hide');
    const notice = $('dashboard').querySelector('.admin-panel .notice');
    if (notice) notice.textContent = 'Cloud connected. Changes are shared across phones and computers after saving.';
    msg('Signed in successfully.');
    const cloudHasCatalogue = await loadCloudCatalogue();
    $('cloud-seed').style.display = cloudHasCatalogue ? 'none' : 'inline-block';
    if (typeof renderAdmin === 'function') renderAdmin();
    if (typeof view === 'function') view();
    subscribeRealtime();
  }

  async function loadCloudCatalogue() {
    const [tileResult, folderResult, categoryResult] = await Promise.all([
      client.from('catalog_tiles').select('*').order('sort_order'),
      client.from('catalog_folders').select('*').order('sort_order'),
      client.from('catalog_categories').select('*').order('sort_order')
    ]);
    if (tileResult.error) throw tileResult.error;
    if (folderResult.error) throw folderResult.error;
    if (categoryResult.error) throw categoryResult.error;
    catalogCategories = categoryResult.data || [];
    const rows = tileResult.data || [];
    if (!rows.length) return false;
    tiles = rows.map(row => {
      const { data } = client.storage.from(BUCKET).getPublicUrl(row.image_path);
      return {
        id: row.id, folder: row.folder, category: row.category || 'Tiles', number: row.tile_number,
        code: row.product_code, image: data.publicUrl, cloudPath: row.image_path
      };
    });
    folders = (folderResult.data || []).map(row => row.name);
    active = folders.includes(active) || active === 'All Collections' ? active : 'All Collections';
    if (typeof renderAdmin === 'function' && isCloudAdmin) renderAdmin();
    if (typeof view === 'function') view();
    return true;
  }

  async function dataUrlBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return await response.blob();
  }
  function extension(blob) {
    return blob.type === 'image/png' ? 'png' : blob.type === 'image/gif' ? 'gif' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
  }
  async function uploadTileImage(tile) {
    if (!tile.image || !tile.image.startsWith('data:')) {
      if (tile.cloudPath) return tile.cloudPath;
      throw new Error('Image data missing for tile ' + tile.number);
    }
    const blob = await dataUrlBlob(tile.image);
    const path = 'tiles/' + tile.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + extension(blob);
    const { error } = await client.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/webp', upsert: true, cacheControl: '3600'
    });
    if (error) throw error;
    tile.cloudPath = path;
    const { data } = client.storage.from(BUCKET).getPublicUrl(path);
    tile.image = data.publicUrl;
    return path;
  }

  async function syncCloudCatalogue() {
    if (!isCloudAdmin) return;
    if (syncBusy) { syncAgain = true; return; }
    syncBusy = true;
    try {
      const paths = new Map();
      for (const tile of tiles) paths.set(tile.id, await uploadTileImage(tile));
      const folderRows = folders.map((name, i) => ({ name, sort_order: i }));
      const categoryRows = catalogCategories.map((item, i) => ({ collection: item.collection, name: item.name, sort_order: i }));
      if (categoryRows.length) {
        const { error } = await client.from('catalog_categories').upsert(categoryRows, { onConflict: 'collection,name' });
        if (error) throw error;
      }
      if (folderRows.length) {
        const { error } = await client.from('catalog_folders').upsert(folderRows, { onConflict: 'name' });
        if (error) throw error;
      }
      const tileRows = tiles.map((tile, i) => ({
        id: tile.id, folder: tile.folder, category: tile.category || 'Tiles', tile_number: tile.number,
        product_code: tile.code, image_path: paths.get(tile.id), sort_order: i
      }));
      if (tileRows.length) {
        const { error } = await client.from('catalog_tiles').upsert(tileRows, { onConflict: 'id' });
        if (error) throw error;
      }
      const { data: oldTiles, error: readError } = await client.from('catalog_tiles').select('id');
      if (readError) throw readError;
      const keep = new Set(tiles.map(t => t.id));
      const stale = (oldTiles || []).map(x => x.id).filter(id => !keep.has(id));
      if (stale.length) {
        const { error } = await client.from('catalog_tiles').delete().in('id', stale);
        if (error) throw error;
      }
      const { data: oldCategories, error: categoryReadError } = await client.from('catalog_categories').select('collection,name');
      if (categoryReadError) throw categoryReadError;
      const keepCategories = new Set(catalogCategories.map(x => x.collection + '::' + x.name));
      const staleCategories = (oldCategories || []).filter(x => !keepCategories.has(x.collection + '::' + x.name));
      for (const item of staleCategories) {
        const { error } = await client.from('catalog_categories').delete().eq('collection', item.collection).eq('name', item.name);
        if (error) throw error;
      }
      const { data: oldFolders, error: folderReadError } = await client.from('catalog_folders').select('name');
      if (folderReadError) throw folderReadError;
      const keepFolders = new Set(folders);
      const staleFolders = (oldFolders || []).map(x => x.name).filter(n => !keepFolders.has(n));
      if (staleFolders.length) {
        const { error } = await client.from('catalog_folders').delete().in('name', staleFolders);
        if (error) throw error;
      }
      msg('Cloud sync successful. All devices will receive the latest catalogue.');
      return true;
    } catch (err) {
      console.error('KANDY TILE cloud sync failed:', err);
      msg('Cloud sync failed: ' + friendly(err) + '. Your current browser copy is still saved locally.');
      return false;
    } finally {
      syncBusy = false;
      if (syncAgain) { syncAgain = false; syncCloudCatalogue(); }
    }
  }

  async function seedExisting() {
    if (!isCloudAdmin || !Array.isArray(tiles) || !tiles.length) return;
    if (!confirm('Upload the current ' + tiles.length + ' tile designs and photos to Supabase? This only runs when the cloud catalogue is empty.')) return;
    $('cloud-seed').disabled = true;
    msg('Uploading original tile photos. Please keep this page open...');
    try {
      const { count, error } = await client.from('catalog_tiles').select('id', { count: 'exact', head: true });
      if (error) throw error;
      if (count > 0) throw new Error('Cloud catalogue is no longer empty. Seed cancelled to protect existing data.');
      tiles = tiles.map(t => ({ ...t }));
      folders = [...folders];
      const uploaded = await syncCloudCatalogue();
      if (!uploaded) throw new Error('The cloud upload did not finish. Please check the message above and try again.');
      await loadCloudCatalogue();
      $('cloud-seed').style.display = 'none';
      msg('Your current catalogue (' + tiles.length + ' designs) is now available from the cloud.');
    } catch (err) { msg('Initial upload stopped: ' + friendly(err)); }
    finally { $('cloud-seed').disabled = false; }
  }

  const originalSave = save;
  save = function() {
    const ok = originalSave();
    if (isCloudAdmin) { syncCloudCatalogue(); return true; }
    return ok;
  };

  $('logout').onclick = async () => {
    await client.auth.signOut();
    isCloudAdmin = false;
    adminUnlocked = false;
    if (realtime) { client.removeChannel(realtime); realtime = null; }
    $('dashboard').classList.add('hide');
    $('login-panel').classList.remove('hide');
    msg('Signed out.');
  };

  function subscribeRealtime() {
    if (realtime) client.removeChannel(realtime);
    realtime = client.channel('kandy-tile-catalogue-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_tiles' }, () => {
        if (!isCloudAdmin) loadCloudCatalogue().catch(console.error);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_folders' }, () => {
        if (!isCloudAdmin) loadCloudCatalogue().catch(console.error);
      })
      .subscribe();
  }

  client.auth.onAuthStateChange((_event, session) => {
    if (session && !isCloudAdmin) setTimeout(() => activateAdmin(session).catch(e => msg(friendly(e))), 0);
  });
  client.auth.getSession().then(({ data }) => {
    if (data.session) activateAdmin(data.session).catch(e => msg(friendly(e)));
  });
  // Public visitors receive live catalogue changes from other devices.
  subscribeRealtime();
  // Public visitors always read the shared cloud catalogue when it has been seeded.
  loadCloudCatalogue().catch(err => console.warn('Cloud catalogue not loaded; showing built-in catalogue:', err));

  // Water-glass styling is intentionally scoped to the Admin Login panel.
  (function applyWaterGlassLogin() {
    const panel = document.getElementById('login-panel');
    if (!panel || document.getElementById('water-glass-login-style')) return;
    document.body.classList.add('water-glass-login-active');
    const style = document.createElement('style');
    style.id = 'water-glass-login-style';
    style.textContent = `
      body.water-glass-login-active {
        background:
          radial-gradient(ellipse at 15% 15%, rgba(105,225,255,.35), transparent 38%),
          radial-gradient(ellipse at 85% 80%, rgba(25,126,210,.30), transparent 42%),
          linear-gradient(135deg,#061b32 0%,#0a4262 48%,#06182e 100%) !important;
        background-attachment: fixed !important;
      }
      body.water-glass-login-active #login-panel {
        position:relative; isolation:isolate; overflow:hidden;
        background:linear-gradient(135deg,rgba(255,255,255,.24),rgba(190,240,255,.08)) !important;
        border:1px solid rgba(226,250,255,.48) !important;
        border-radius:28px !important;
        box-shadow:0 24px 70px rgba(0,10,30,.42),inset 0 1px 1px rgba(255,255,255,.65),inset 0 -1px 1px rgba(255,255,255,.12) !important;
        -webkit-backdrop-filter:blur(24px) saturate(165%);
        backdrop-filter:blur(24px) saturate(165%);
      }
      body.water-glass-login-active #login-panel:after {
        content:""; position:absolute; inset:0; z-index:-1; pointer-events:none;
        background:linear-gradient(118deg,rgba(255,255,255,.25),transparent 34%,transparent 68%,rgba(130,226,255,.13));
        border-radius:inherit;
      }
      body.water-glass-login-active #login-panel > :not(.water-bubble) { position:relative; z-index:2; }
      body.water-glass-login-active #login-panel input {
        color:#f5fcff !important; background:rgba(4,34,57,.34) !important;
        border:1px solid rgba(225,249,255,.38) !important; border-radius:13px !important;
        box-shadow:inset 0 2px 8px rgba(0,12,28,.18),0 1px 0 rgba(255,255,255,.12) !important;
        outline:none;
      }
      body.water-glass-login-active #login-panel input::placeholder { color:rgba(240,251,255,.72) !important; }
      body.water-glass-login-active #login-panel button {
        border:1px solid rgba(232,251,255,.5) !important; border-radius:14px !important;
        box-shadow:0 8px 20px rgba(0,18,40,.24),inset 0 1px 0 rgba(255,255,255,.4) !important;
        transition:transform .2s ease,filter .2s ease,box-shadow .2s ease;
      }
      body.water-glass-login-active #login-panel button:hover {
        transform:translateY(-2px); filter:brightness(1.12);
        box-shadow:0 12px 26px rgba(0,18,40,.32),inset 0 1px 0 rgba(255,255,255,.5) !important;
      }
      body.water-glass-login-active #login-panel .notice,
      body.water-glass-login-active #login-message { color:#e7f8ff !important; }
      .water-bubble { position:absolute; z-index:0 !important; pointer-events:none; border-radius:50%;
        border:1px solid rgba(231,250,255,.58);
        background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.72),rgba(164,231,255,.18) 34%,rgba(45,157,218,.08) 68%,rgba(255,255,255,.22));
        box-shadow:inset -7px -9px 18px rgba(13,95,148,.18),inset 4px 5px 12px rgba(255,255,255,.4),0 8px 24px rgba(0,20,50,.16);
        animation:waterBubbleFloat 8s ease-in-out infinite;
      }
      .water-bubble:nth-of-type(1){width:68px;height:68px;left:7%;top:12%;animation-delay:-2s}
      .water-bubble:nth-of-type(2){width:26px;height:26px;right:13%;top:18%;animation-delay:-5s}
      .water-bubble:nth-of-type(3){width:44px;height:44px;right:7%;bottom:14%;animation-delay:-1s}
      .water-bubble:nth-of-type(4){width:19px;height:19px;left:19%;bottom:12%;animation-delay:-4s}
      .water-bubble:nth-of-type(5){width:13px;height:13px;left:50%;top:7%;animation-delay:-3s}
      @keyframes waterBubbleFloat { 0%,100%{transform:translate3d(0,0,0)} 50%{transform:translate3d(9px,-16px,0)} }
      @media(prefers-reduced-motion:reduce){.water-bubble{animation:none} body.water-glass-login-active #login-panel button{transition:none}}
      @media(max-width:600px){body.water-glass-login-active #login-panel{border-radius:22px !important;margin:14px !important}}
    `;
    document.head.appendChild(style);
    for (let i = 0; i < 5; i++) {
      const bubble = document.createElement('span');
      bubble.className = 'water-bubble';
      bubble.setAttribute('aria-hidden', 'true');
      panel.prepend(bubble);
    }
    const observer = new MutationObserver(() => {
      const loginVisible = !panel.classList.contains('hide');
      document.body.classList.toggle('water-glass-login-active', loginVisible);
    });
    observer.observe(panel, { attributes:true, attributeFilter:['class'] });
  })();

})();

// Water-touch ripple: a soft liquid ring appears wherever the Admin Login panel is clicked/tapped.
(function addWaterTouchRipple() {
  if (window.__kandyWaterTouchRipple) return;
  window.__kandyWaterTouchRipple = true;

  const css = document.createElement('style');
  css.id = 'kandy-water-touch-ripple-style';
  css.textContent = `
    #login-panel { position:relative; overflow:hidden; }
    .water-touch-ripple {
      position:absolute; z-index:8; width:22px; height:22px;
      border-radius:50%; pointer-events:none; transform:translate(-50%,-50%) scale(.15);
      background:radial-gradient(circle,rgba(255,255,255,.34) 0 12%,rgba(133,226,255,.22) 35%,rgba(91,205,246,.08) 62%,transparent 72%);
      border:1px solid rgba(236,252,255,.88);
      box-shadow:0 0 9px rgba(175,239,255,.55),inset 0 0 8px rgba(255,255,255,.72);
      animation:waterTouchExpand .85s cubic-bezier(.12,.58,.28,1) forwards;
    }
    .water-touch-ripple:before,.water-touch-ripple:after {
      content:"";position:absolute;inset:-9px;border:1px solid rgba(223,249,255,.72);
      border-radius:50%;animation:waterTouchRing .85s ease-out forwards;
    }
    .water-touch-ripple:after { inset:-18px; border-color:rgba(111,216,250,.48); animation-delay:.07s; }
    .water-touch-drop {
      position:absolute;width:5px;height:5px;border-radius:50%;
      background:radial-gradient(circle at 30% 25%,#fff,rgba(122,220,255,.62));
      box-shadow:0 0 7px rgba(190,242,255,.8);pointer-events:none;
      animation:waterTouchDrop .65s ease-out forwards;
    }
    @keyframes waterTouchExpand { 0%{opacity:.95;transform:translate(-50%,-50%) scale(.15)} 65%{opacity:.65} 100%{opacity:0;transform:translate(-50%,-50%) scale(4.4)} }
    @keyframes waterTouchRing { 0%{transform:scale(.25);opacity:.85} 100%{transform:scale(1.8);opacity:0} }
    @keyframes waterTouchDrop { 0%{opacity:.95;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.15)} }
    @media(prefers-reduced-motion:reduce){.water-touch-ripple,.water-touch-ripple:before,.water-touch-ripple:after,.water-touch-drop{animation-duration:.01ms}}
  `;
  document.head.appendChild(css);

  document.addEventListener('pointerdown', function(event) {
    const panel = event.target && event.target.closest && event.target.closest('#login-panel');
    if (!panel || panel.classList.contains('hide')) return;
    const rect = panel.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ripple = document.createElement('span');
    ripple.className = 'water-touch-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    panel.appendChild(ripple);

    const directions = [[-17,-13],[16,-12],[-13,17],[18,13]];
    directions.forEach(([dx,dy], index) => {
      const drop = document.createElement('i');
      drop.className = 'water-touch-drop';
      drop.style.left = (x - 2 + (index % 2) * 4) + 'px';
      drop.style.top = (y - 2 + Math.floor(index / 2) * 4) + 'px';
      drop.style.setProperty('--dx', dx + 'px');
      drop.style.setProperty('--dy', dy + 'px');
      panel.appendChild(drop);
      drop.addEventListener('animationend', () => drop.remove(), { once:true });
    });
    ripple.addEventListener('animationend', () => ripple.remove(), { once:true });
  }, { passive:true });
})();


// KANDY TILE Admin Dashboard refresh: product wording, folder open shortcuts and liquid-glass UI.
(function enhanceKandyAdminDashboard() {
  if (window.__kandyAdminDashboardV2) return;
  window.__kandyAdminDashboardV2 = true;

  const css = document.createElement('style');
  css.id = 'kandy-admin-dashboard-v2-style';
  css.textContent = `
    body.kandy-admin-water {
      background:
        radial-gradient(ellipse at 12% 8%,rgba(91,213,255,.24),transparent 34%),
        radial-gradient(ellipse at 88% 88%,rgba(25,116,191,.22),transparent 38%),
        linear-gradient(135deg,#061b32,#0b3d5b 52%,#07182c) fixed !important;
      background-attachment:fixed !important;
    }
    body.kandy-admin-water #dashboard { color:#f2fbff; }
    body.kandy-admin-water #dashboard .admin-panel {
      position:relative; isolation:isolate; overflow:hidden;
      background:linear-gradient(135deg,rgba(255,255,255,.19),rgba(191,238,255,.075)) !important;
      border:1px solid rgba(224,249,255,.30) !important;
      border-radius:22px !important;
      box-shadow:0 16px 42px rgba(0,10,28,.27),inset 0 1px 0 rgba(255,255,255,.28) !important;
      -webkit-backdrop-filter:blur(20px) saturate(155%);
      backdrop-filter:blur(20px) saturate(155%);
    }
    body.kandy-admin-water #dashboard .admin-panel h2,
    body.kandy-admin-water #dashboard .admin-panel h3,
    body.kandy-admin-water #dashboard .admin-panel strong { color:#f4fcff !important; }
    body.kandy-admin-water #dashboard .notice { color:rgba(234,249,255,.78) !important; }
    body.kandy-admin-water #dashboard input,
    body.kandy-admin-water #dashboard select {
      color:#f5fcff !important;background:rgba(2,28,49,.43) !important;
      border:1px solid rgba(221,247,255,.32) !important;border-radius:12px !important;
    }
    body.kandy-admin-water #dashboard select option { color:#102334;background:#fff; }
    body.kandy-admin-water #dashboard input::placeholder { color:rgba(235,249,255,.65) !important; }
    body.kandy-admin-water #dashboard button {
      color:#f5fcff;background:rgba(222,247,255,.13);
      border:1px solid rgba(228,250,255,.34);border-radius:12px;
      box-shadow:0 5px 16px rgba(0,10,30,.18),inset 0 1px 0 rgba(255,255,255,.18);
      transition:transform .2s ease,background .2s ease,box-shadow .2s ease;
    }
    body.kandy-admin-water #dashboard button:hover {
      transform:translateY(-2px);background:rgba(183,235,255,.24);
      box-shadow:0 9px 22px rgba(0,10,30,.28),inset 0 1px 0 rgba(255,255,255,.3);
    }
    body.kandy-admin-water #dashboard button.primary {
      background:linear-gradient(135deg,#16a8d4,#1769a5) !important;
      border-color:rgba(226,250,255,.55) !important;
    }
    body.kandy-admin-water #folder-manager .admin-row {
      padding:10px 12px;margin:8px 0;border:1px solid rgba(220,247,255,.18);
      border-radius:15px;background:rgba(3,31,52,.22);gap:9px;
    }
    body.kandy-admin-water #folder-manager .admin-row strong { flex:1; }
    body.kandy-admin-water #admin-list .admin-item {
      background:rgba(2,29,50,.34) !important;border:1px solid rgba(222,247,255,.22) !important;
      border-radius:17px !important;padding:12px !important;
      box-shadow:0 8px 24px rgba(0,10,28,.18) !important;
    }
    body.kandy-admin-water #admin-list .admin-item img {
      border-radius:12px !important;border:1px solid rgba(232,250,255,.25);
    }
    body.kandy-admin-water #dashboard button.kandy-open-folder {
      background:linear-gradient(135deg,rgba(34,185,218,.42),rgba(34,112,177,.34));
    }
    @media(max-width:700px) {
      body.kandy-admin-water #dashboard .admin-panel { padding:15px !important;border-radius:18px !important; }
      body.kandy-admin-water #folder-manager .admin-row { flex-wrap:wrap; }
      body.kandy-admin-water #folder-manager .admin-row strong { flex-basis:100%; }
      body.kandy-admin-water #admin-list .admin-item { min-width:0; }
    }
    @media(prefers-reduced-motion:reduce) {
      body.kandy-admin-water #dashboard button { transition:none; }
    }
  `;
  document.head.appendChild(css);

  function refreshAdminDesign() {
    const dashboard = document.getElementById('dashboard');
    const admin = document.getElementById('admin');
    const active = dashboard && !dashboard.classList.contains('hide') && admin && !admin.classList.contains('hide');
    document.body.classList.toggle('kandy-admin-water', !!active);
    if (!dashboard) return;

    dashboard.querySelectorAll('h3').forEach(h => {
      const value = h.textContent.trim().toLowerCase();
      if (value.startsWith('manage tile photos')) h.childNodes[0].textContent = 'Manage Products ';
      if (value === 'add tile photo') h.textContent = 'Add Product Photo & Information';
    });

    const editorTitle = document.getElementById('editor-title');
    const saveButton = document.getElementById('save-tile');
    if (editorTitle && editorTitle.textContent.toLowerCase().includes('tile photo')) {
      editorTitle.textContent = editorTitle.textContent.toLowerCase().includes('edit')
        ? 'Edit Product Information' : 'Add Product Photo & Information';
    }
    if (saveButton && saveButton.textContent.trim() === 'Add tile') saveButton.textContent = 'Add Product';
    const folderSelect = document.getElementById('edit-folder');
    if (folderSelect) folderSelect.setAttribute('aria-label','Product folder');
    const numberInput = document.getElementById('edit-number');
    if (numberInput) numberInput.placeholder = 'Product number';
    const codeInput = document.getElementById('edit-code');
    if (codeInput) codeInput.placeholder = 'Item code';
    const photoInput = document.getElementById('edit-photo');
    if (photoInput) photoInput.setAttribute('aria-label','Product image');

    const manager = document.getElementById('folder-manager');
    if (manager) manager.querySelectorAll('.admin-row').forEach(row => {
      if (row.querySelector('.kandy-open-folder')) return;
      const label = row.querySelector('strong');
      if (!label) return;
      const folderName = label.textContent.replace(/\\s*\\(\\d+\\)\\s*$/,'').trim();
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'kandy-open-folder';
      open.textContent = 'Open products';
      open.addEventListener('click', () => {
        const filter = document.getElementById('admin-filter');
        if (filter) {
          filter.value = folderName;
          filter.dispatchEvent(new Event('change',{bubbles:true}));
        }
        const list = document.getElementById('admin-list');
        if (list) list.scrollIntoView({behavior:'smooth',block:'start'});
      });
      row.append(open);
    });
  }

  const target = document.getElementById('dashboard') || document.body;
  const observer = new MutationObserver(() => refreshAdminDesign());
  observer.observe(target,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('click', event => {
    if (event.target && event.target.closest && event.target.closest('#dashboard')) {
      setTimeout(refreshAdminDesign,0);
    }
  });
  refreshAdminDesign();
  setTimeout(refreshAdminDesign,300);
})();


// KANDY TILE nested Collection -> Category -> Products navigation and category manager.
(function kandyNestedCatalogue(){
  if(window.__kandyNestedCatalogueV1)return;
  window.__kandyNestedCatalogueV1=true;
  const $=id=>document.getElementById(id);
  let chosenCategory='';
  const style=document.createElement('style');
  style.textContent=`
    .kandy-category-bar{display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 22px}
    .kandy-category-chip{border:1px solid #d6e8f1;background:#fff;color:#16415a;border-radius:14px;padding:13px 18px;font-weight:800;box-shadow:0 5px 18px #06304a12}
    .kandy-category-chip.active{background:linear-gradient(135deg,#087fa9,#155b91);color:#fff}
    .kandy-category-chip small{display:block;font-weight:500;opacity:.78;margin-top:4px}
    .kandy-category-admin{border:1px solid rgba(222,247,255,.22);border-radius:16px;padding:15px;margin:12px 0;background:rgba(3,31,52,.2)}
    .kandy-category-admin .admin-row{align-items:center}
    .kandy-category-admin strong{flex:1}
  `;
  document.head.appendChild(style);
  function ensureCategories(){
    if(!Array.isArray(catalogCategories))catalogCategories=[];
    folders.forEach(collection=>{
      if(!catalogCategories.some(x=>x.collection===collection))catalogCategories.push({collection,name:'Tiles',sort_order:0});
    });
    tiles.forEach(t=>{if(!t.category)t.category='Tiles'});
  }
  function categoryList(collection){return catalogCategories.filter(x=>x.collection===collection).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));}
  function renderCategoryManager(){
    const dash=$('dashboard');if(!dash||dash.classList.contains('hide'))return;
    let panel=$('kandy-category-manager');
    if(!panel){
      panel=document.createElement('section');panel.id='kandy-category-manager';panel.className='admin-panel';
      const folderPanel=$('folder-manager')?.closest('.admin-panel');
      if(folderPanel)folderPanel.after(panel);else dash.prepend(panel);
    }
    panel.innerHTML='<h3>Manage Product Categories</h3><p class="notice">Create categories inside each collection, such as Tiles, Washbasins and other products.</p><div class="admin-row"><select id="kandy-category-collection" aria-label="Collection"></select><input id="kandy-new-category" placeholder="New category name"><button class="primary" id="kandy-add-category" type="button">Add Category</button></div><div id="kandy-category-rows"></div>';
    const collection=$('kandy-category-collection');
    collection.innerHTML=folders.map(f=>'<option value="'+String(f).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">'+f+'</option>').join('');
    const rows=$('kandy-category-rows');
    function list(){
      rows.replaceChildren();
      categoryList(collection.value).forEach(cat=>{
        const row=document.createElement('div');row.className='admin-row kandy-category-admin';
        const label=document.createElement('strong');label.textContent=cat.name+' ('+tiles.filter(t=>t.folder===cat.collection&&t.category===cat.name).length+' products)';
        const rename=document.createElement('button');rename.type='button';rename.textContent='Rename';
        rename.onclick=()=>{const next=prompt('Rename category:',cat.name)?.trim();if(!next||next===cat.name)return;if(categoryList(cat.collection).some(x=>x.name===next))return alert('Category already exists.');const old=cat.name;cat.name=next;tiles.forEach(t=>{if(t.folder===cat.collection&&t.category===old)t.category=next});chosenCategory=next;save();renderCategoryManager();view();};
        const del=document.createElement('button');del.type='button';del.textContent='Delete';
        del.onclick=()=>{if(tiles.some(t=>t.folder===cat.collection&&t.category===cat.name))return alert('Move or delete the products in this category first.');if(!confirm('Delete category '+cat.name+'?'))return;catalogCategories=catalogCategories.filter(x=>!(x.collection===cat.collection&&x.name===cat.name));if(chosenCategory===cat.name)chosenCategory='';save();renderCategoryManager();view();};
        row.append(label,rename,del);rows.append(row);
      });
    }
    collection.onchange=list;
    $('kandy-add-category').onclick=()=>{const name=$('kandy-new-category').value.trim();if(!name)return alert('Enter a category name.');if(categoryList(collection.value).some(x=>x.name.toLowerCase()===name.toLowerCase()))return alert('Category already exists.');catalogCategories.push({collection:collection.value,name,sort_order:categoryList(collection.value).length});$('kandy-new-category').value='';save();list();view();};
    list();
  }
  function addCategoryField(){
    const form=$('tile-form');if(!form||$('edit-category'))return;
    const row=document.createElement('div');row.className='admin-row';
    const select=document.createElement('select');select.id='edit-category';select.required=true;select.setAttribute('aria-label','Product category');
    const hint=document.createElement('span');hint.className='notice';hint.textContent='Choose the category inside the selected collection.';
    row.append(select,hint);const folder=$('edit-folder')?.closest('.admin-row');
    if(folder)folder.after(row);else form.prepend(row);
    function fill(preferred){const cats=categoryList($('edit-folder').value);select.innerHTML=cats.map(c=>'<option value="'+c.name.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">'+c.name+'</option>').join('');if(preferred&&cats.some(c=>c.name===preferred))select.value=preferred;}
    $('edit-folder').addEventListener('change',()=>fill('Tiles'));
    fill('Tiles');
    // Capture before the original submit handler saves the product.
    if(!form.__kandyCategorySubmit){
      form.__kandyCategorySubmit=true;
      form.addEventListener('submit',()=>{
        const item=tiles.find(t=>t.id===editing);
        if(item)item.category=select.value;
        window.__kandyChosenCategory=select.value||'Tiles';
      },true);
    }
    const editButtons=$('admin-list');
    if(editButtons&&!editButtons.__categoryHook){
      editButtons.__categoryHook=true;
      new MutationObserver(()=>{editButtons.querySelectorAll('.admin-item button').forEach(btn=>{if(btn.textContent==='Edit'&&!btn.__catHook){btn.__catHook=true;btn.addEventListener('click',()=>{const card=btn.closest('.admin-item');const text=card?.querySelector('div')?.textContent||'';const product=tiles.find(t=>text.includes(t.number)&&text.includes(t.code));setTimeout(()=>{if(product)fill(product.category||'Tiles');},0);});}})}).observe(editButtons,{childList:true,subtree:true});
    }
    void oldSubmit;
  }
  const oldRenderAdmin=renderAdmin;
  renderAdmin=function(){ensureCategories();oldRenderAdmin();renderCategoryManager();addCategoryField();};
  const oldSave=save;
  save=function(){ensureCategories();return oldSave();};
  const oldView=view;
  view=function(){
    ensureCategories();
    oldView();
    const folderBar=$('folders');if(!folderBar)return;
    let bar=$('kandy-public-categories');
    if(!bar){bar=document.createElement('div');bar.id='kandy-public-categories';bar.className='kandy-category-bar';folderBar.after(bar);}
    bar.replaceChildren();
    if(active==='All Collections'){
      bar.replaceChildren();
      $('grid').classList.add('hidden');
      $('count').textContent='Select a collection to view product categories';
      $('empty').classList.add('hide');
      return;
    }
    const cats=categoryList(active);
    if(!cats.length){$('grid').classList.add('hidden');$('count').textContent='No categories yet. Please add a category in Admin.';return;}
    const all=document.createElement('button');all.className='kandy-category-chip'+(!chosenCategory?' active':'');all.innerHTML='All categories<small>'+tiles.filter(t=>t.folder===active).length+' products</small>';all.onclick=()=>{chosenCategory='';view();};bar.append(all);
    cats.forEach(cat=>{
      const b=document.createElement('button');b.className='kandy-category-chip'+(chosenCategory===cat.name?' active':'');
      b.innerHTML=cat.name+'<small>'+tiles.filter(t=>t.folder===active&&t.category===cat.name).length+' products</small>';
      b.onclick=()=>{chosenCategory=cat.name;view();};bar.append(b);
    });
    if(chosenCategory){
      const keep=tiles;tiles=keep.filter(t=>t.folder===active&&t.category===chosenCategory);oldView();tiles=keep;
    }else{
      $('grid').classList.add('hidden');
      $('count').textContent='Choose a category to view products';
      $('empty').classList.add('hide');
    }
  };
  ensureCategories();
  if(!tiles.__kandyCategoryPushHook){
    const originalPush=tiles.push.bind(tiles);
    tiles.push=(...items)=>originalPush(...items.map(item=>item.category?item:{...item,category:window.__kandyChosenCategory||'Tiles'}));
    Object.defineProperty(tiles,'__kandyCategoryPushHook',{value:true});
  }
  if(typeof renderAdmin==='function')setTimeout(()=>{if(adminUnlocked)renderAdmin();},250);
  setTimeout(()=>view(),350);
})();
