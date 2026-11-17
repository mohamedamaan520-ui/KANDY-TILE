/* KANDY TILE cloud sync — Supabase JS v2 */
(() => {
  'use strict';
  const URL = 'https://dthepmehttlimzwgvotk.supabase.co';
  const KEY = 'sb_publishable_8SHCyJX1eetAhZvMOR9dFg_lEltHI15';
  const ADMIN_EMAILS = ['mohamedamaan520@gmail.com', 'chamalthilak01@gmail.com'];
  const BUCKET = 'catalog-photos';
  const client = window.supabase.createClient(URL, KEY);
  let isCloudAdmin = false, syncBusy = false, syncAgain = false, realtime = null;
  const $ = id => document.getElementById(id);
  const msg = value => { const el = $('login-message'); if (el) el.textContent = value; };
  const friendly = e => e?.message || String(e || 'Unknown error');
  const adminPanel = $('login-panel');
  if (adminPanel) {
    const form = $('login-form');
    form.innerHTML = '<input type="email" id="cloud-email" autocomplete="username" placeholder="Admin email" required><input type="password" id="password" autocomplete="current-password" placeholder="Password (minimum 8 characters)" minlength="8" required><button class="primary" id="cloud-login" type="submit">Sign in</button><button type="button" id="cloud-signup">Create account</button>';
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent = 'Admin access is restricted to approved administrator email addresses.';
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
      if (!ADMIN_EMAILS.includes(email)) return msg('This email is not approved as a KANDY TILE administrator.');
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
      if (!ADMIN_EMAILS.includes(email)) return msg('Only approved administrator emails can create an account.');
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
    window.dispatchEvent(new Event('kandy-category-admin-ready'));
    if (typeof view === 'function') view();
    subscribeRealtime();
  }

  async function loadCloudCatalogue() {
    const [tileResult, folderResult] = await Promise.all([
      client.from('catalog_tiles').select('*').order('sort_order'),
      client.from('catalog_folders').select('*').order('sort_order')
    ]);
    if (tileResult.error) throw tileResult.error;
    if (folderResult.error) throw folderResult.error;
    const rows = tileResult.data || [];
    if (!rows.length) return false;
    tiles = rows.map(row => {
      const { data } = client.storage.from(BUCKET).getPublicUrl(row.image_path);
      return {
        id: row.id, folder: row.folder, number: row.tile_number,
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
      if (folderRows.length) {
        const { error } = await client.from('catalog_folders').upsert(folderRows, { onConflict: 'name' });
        if (error) throw error;
      }
      const tileRows = tiles.map((tile, i) => ({
        id: tile.id, folder: tile.folder, tile_number: tile.number,
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
    if (isCloudAdmin) {
      // Cloud Admin edits are persisted to Supabase only. Do not write the
      // large photo catalogue into localStorage, which can exceed browser quota.
      msg('Saving changes securely to the cloud...');
      syncCloudCatalogue();
      return true;
    }
    return originalSave();
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


// KANDY TILE Admin brand mark — dashboard only; public catalogue remains unchanged.
(function addKandyAdminLogo() {
  if (window.__kandyAdminLogoV1) return;
  window.__kandyAdminLogoV1 = true;

  const css = document.createElement('style');
  css.id = 'kandy-admin-logo-style';
  css.textContent = `
    #dashboard .kandy-admin-brand {
      display:flex;align-items:center;gap:13px;margin:0 0 18px;padding:14px 18px;
      border:1px solid rgba(232,205,139,.48);border-radius:18px;
      background:linear-gradient(115deg,rgba(7,27,43,.92),rgba(14,67,87,.82));
      box-shadow:0 12px 30px rgba(0,10,28,.24),inset 0 1px 0 rgba(255,255,255,.16);
      color:#fff;max-width:100%;
    }
    #dashboard .kandy-admin-brand-mark {
      width:52px;height:52px;flex:0 0 52px;display:grid;place-items:center;
      border-radius:15px;border:1px solid rgba(239,211,146,.72);
      background:linear-gradient(145deg,rgba(245,214,147,.24),rgba(255,255,255,.06));
      box-shadow:inset 0 1px 5px rgba(255,255,255,.2),0 5px 16px rgba(0,0,0,.18);
    }
    #dashboard .kandy-admin-brand-mark svg{width:36px;height:36px;display:block}
    #dashboard .kandy-admin-brand-copy{min-width:0}
    #dashboard .kandy-admin-brand-name{font-weight:900;letter-spacing:2px;font-size:17px;line-height:1.2;color:#f6d99e}
    #dashboard .kandy-admin-brand-sub{font-size:12px;letter-spacing:.7px;color:#e8f5fa;margin-top:4px}
    #dashboard .kandy-admin-brand-tag{font-size:10px;letter-spacing:1.5px;color:#d6bb82;margin-top:5px}
    @media(max-width:520px){
      #dashboard .kandy-admin-brand{padding:11px 13px;gap:10px}
      #dashboard .kandy-admin-brand-mark{width:44px;height:44px;flex-basis:44px}
      #dashboard .kandy-admin-brand-name{font-size:15px}
    }
  `;
  document.head.appendChild(css);

  function insertLogo() {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard || dashboard.classList.contains('hide') || dashboard.querySelector('.kandy-admin-brand')) return;
    const brand = document.createElement('div');
    brand.className = 'kandy-admin-brand';
    brand.innerHTML = `
      <span class="kandy-admin-brand-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 21.5 24 7l17 14.5v18H7v-18Z" stroke="#F2D49A" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="m16 22 8-7 8 7v17H16V22Z" stroke="#F2D49A" stroke-width="2" stroke-linejoin="round"/>
          <path d="M20 39V27h8v12M5 22l19-16 19 16" stroke="#FFF3D6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="m19 11 5-5 5 5" stroke="#F2D49A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="kandy-admin-brand-copy">
        <span class="kandy-admin-brand-name">KANDY TILE</span>
        <span class="kandy-admin-brand-sub">Catalogue Admin</span>
        <span class="kandy-admin-brand-tag">REFLECT YOUR DREAM</span>
      </span>`;
    const firstPanel = dashboard.querySelector('.admin-panel');
    if (firstPanel) dashboard.insertBefore(brand, firstPanel);
    else dashboard.prepend(brand);
  }

  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;
  new MutationObserver(insertLogo).observe(dashboard, { attributes:true, childList:true, subtree:false, attributeFilter:['class'] });
  insertLogo();
  setTimeout(insertLogo, 250);
})(); 


// Public catalogue colour + water-click effects only.
// Automatically disabled whenever the Admin Login or Dashboard is visible.
(function kandyPublicWaterTheme() {
  if (window.__kandyPublicWaterThemeV1) return;
  window.__kandyPublicWaterThemeV1 = true;

  const style = document.createElement('style');
  style.id = 'kandy-public-water-theme-style';
  style.textContent = `
    body.kandy-public-water-theme {
      color: #edfaff !important;
      background:
        radial-gradient(ellipse at 12% 8%, rgba(39,177,214,.20), transparent 36%),
        radial-gradient(ellipse at 88% 84%, rgba(22,104,164,.22), transparent 40%),
        linear-gradient(135deg, #071522 0%, #0b2638 52%, #081725 100%) fixed !important;
      background-attachment: fixed !important;
    }
    body.kandy-public-water-theme h1,
    body.kandy-public-water-theme h2,
    body.kandy-public-water-theme h3,
    body.kandy-public-water-theme p,
    body.kandy-public-water-theme label {
      color: #edfaff;
    }
    body.kandy-public-water-theme main,
    body.kandy-public-water-theme .container,
    body.kandy-public-water-theme #catalogue,
    body.kandy-public-water-theme #catalog,
    body.kandy-public-water-theme .catalogue {
      background-color: transparent !important;
    }
    body.kandy-public-water-theme input,
    body.kandy-public-water-theme select,
    body.kandy-public-water-theme textarea {
      color: #f3fcff !important;
      background: rgba(4,25,40,.78) !important;
      border: 1px solid rgba(119,220,244,.38) !important;
    }
    body.kandy-public-water-theme input::placeholder,
    body.kandy-public-water-theme textarea::placeholder {
      color: rgba(222,245,252,.62) !important;
    }
    body.kandy-public-water-theme button {
      transition: filter .18s ease, box-shadow .18s ease;
    }
    body.kandy-public-water-theme button:hover {
      filter: brightness(1.13);
      box-shadow: 0 5px 18px rgba(35,190,225,.18);
    }
    .kandy-public-water-ripple {
      position: fixed; z-index: 99999; width: 24px; height: 24px;
      left: 0; top: 0; pointer-events: none; border-radius: 50%;
      transform: translate(-50%,-50%) scale(.15);
      border: 1px solid rgba(222,250,255,.92);
      background: radial-gradient(circle, rgba(255,255,255,.32), rgba(104,220,247,.14) 48%, transparent 72%);
      box-shadow: 0 0 12px rgba(120,225,255,.42), inset 0 0 8px rgba(255,255,255,.55);
      animation: kandyPublicRipple .82s cubic-bezier(.12,.58,.28,1) forwards;
    }
    .kandy-public-water-ripple:before,
    .kandy-public-water-ripple:after {
      content: ""; position: absolute; inset: -10px; border-radius: 50%;
      border: 1px solid rgba(207,246,255,.68);
      animation: kandyPublicRippleRing .82s ease-out forwards;
    }
    .kandy-public-water-ripple:after {
      inset: -20px; border-color: rgba(92,204,237,.42); animation-delay: .06s;
    }
    @keyframes kandyPublicRipple {
      0% { opacity: .95; transform: translate(-50%,-50%) scale(.15); }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(4.2); }
    }
    @keyframes kandyPublicRippleRing {
      0% { opacity: .82; transform: scale(.2); }
      100% { opacity: 0; transform: scale(1.7); }
    }
    @media (prefers-reduced-motion: reduce) {
      .kandy-public-water-ripple,
      .kandy-public-water-ripple:before,
      .kandy-public-water-ripple:after { animation-duration: .01ms; }
    }
  `;
  document.head.appendChild(style);

  const visible = el => {
    if (!el || el.classList.contains('hide')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  function refreshMode() {
    const login = document.getElementById('login-panel');
    const dashboard = document.getElementById('dashboard');
    const adminMode = visible(login) || visible(dashboard);
    document.body.classList.toggle('kandy-public-water-theme', !adminMode);
  }

  refreshMode();
  const observer = new MutationObserver(refreshMode);
  observer.observe(document.body, { subtree:true, childList:true, attributes:true, attributeFilter:['class','style','hidden'] });

  document.addEventListener('pointerdown', event => {
    if (!document.body.classList.contains('kandy-public-water-theme')) return;
    if (event.target && event.target.closest && event.target.closest('#login-panel, #dashboard')) return;
    const ripple = document.createElement('span');
    ripple.className = 'kandy-public-water-ripple';
    ripple.style.left = event.clientX + 'px';
    ripple.style.top = event.clientY + 'px';
    document.body.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once:true });
  }, { passive:true });
})();


// KANDY TILE public sharing: folder catalogue PDF and individual tile photo sharing.
(function kandyCatalogueSharing() {
  if (window.__kandyCatalogueSharingV1) return;
  window.__kandyCatalogueSharingV1 = true;

  const style = document.createElement('style');
  style.id = 'kandy-catalogue-sharing-style';
  style.textContent = `
    #kandy-share-catalogue {
      position:fixed;left:16px;bottom:18px;z-index:9990;
      border:1px solid rgba(170,235,250,.65);border-radius:999px;
      padding:12px 18px;color:#f3fcff;font-weight:700;
      background:linear-gradient(135deg,#087f9f,#124f78);
      box-shadow:0 8px 26px rgba(0,20,38,.3);cursor:pointer;
    }
    #kandy-share-tile {
      position:fixed;right:16px;bottom:18px;z-index:9991;
      border:1px solid rgba(170,235,250,.65);border-radius:999px;
      padding:12px 18px;color:#f3fcff;font-weight:700;
      background:linear-gradient(135deg,#087f9f,#124f78);
      box-shadow:0 8px 26px rgba(0,20,38,.3);cursor:pointer;display:none;
    }
    #kandy-share-modal {
      position:fixed;inset:0;z-index:100000;background:rgba(2,12,23,.76);
      display:none;align-items:center;justify-content:center;padding:16px;
      -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
    }
    #kandy-share-modal .ks-card {
      width:min(440px,100%);max-height:88vh;overflow:auto;padding:22px;
      border:1px solid rgba(169,231,247,.42);border-radius:20px;
      color:#eafaff;background:linear-gradient(145deg,#102f43,#071b2c);
      box-shadow:0 22px 70px rgba(0,0,0,.45);
    }
    #kandy-share-modal h2 {margin:0 0 8px;color:#f4fcff}
    #kandy-tile-format-modal {
      position:fixed;inset:0;z-index:100001;background:rgba(2,12,23,.78);
      display:none;align-items:center;justify-content:center;padding:16px;
      -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
    }
    #kandy-tile-format-modal .ks-card {
      width:min(380px,100%);padding:22px;border:1px solid rgba(169,231,247,.42);
      border-radius:20px;color:#eafaff;background:linear-gradient(145deg,#102f43,#071b2c);
      box-shadow:0 22px 70px rgba(0,0,0,.45);
    }
    #kandy-tile-format-modal h2 {margin:0 0 8px;color:#f4fcff}
    #kandy-tile-format-modal p {color:#c4e1eb}
    #kandy-tile-format-modal button {
      box-sizing:border-box;width:100%;padding:13px;margin-top:10px;border-radius:11px;
      border:1px solid rgba(170,235,250,.38);color:#f2fbff;background:#12364b;font-size:15px;
    }
    #kandy-tile-format-modal button.primary {background:linear-gradient(135deg,#0799b5,#176ba2);font-weight:700}

    #kandy-share-modal p {color:#c4e1eb}
    #kandy-share-modal select,#kandy-share-modal button {
      box-sizing:border-box;width:100%;padding:12px;margin-top:10px;
      border-radius:11px;border:1px solid rgba(170,235,250,.38);
      color:#f2fbff;background:#12364b;font-size:15px;
    }
    #kandy-share-modal button.primary {background:linear-gradient(135deg,#0799b5,#176ba2);font-weight:700}
    #kandy-share-modal button:disabled {opacity:.55}
    #kandy-share-modal .ks-close {background:rgba(255,255,255,.08)}
    #kandy-share-status {font-size:13px;min-height:18px;margin-top:10px}
    @media(max-width:520px) {
      #kandy-share-catalogue,#kandy-share-tile {padding:11px 13px;font-size:13px;bottom:12px}
      #kandy-share-catalogue {left:10px} #kandy-share-tile {right:10px}
    }
  `;
  document.head.appendChild(style);

  const catalogueBtn = document.createElement('button');
  catalogueBtn.id = 'kandy-share-catalogue';
  catalogueBtn.type = 'button';
  catalogueBtn.textContent = '⇧ Share Folder PDF';
  const tileBtn = document.createElement('button');
  tileBtn.id = 'kandy-share-tile';
  tileBtn.type = 'button';
  tileBtn.textContent = '⇧ Share This Tile';
  document.body.append(catalogueBtn, tileBtn);

  const modal = document.createElement('div');
  modal.id = 'kandy-share-modal';
  modal.innerHTML = `
    <div class="ks-card" role="dialog" aria-modal="true" aria-labelledby="ks-title">
      <h2 id="ks-title">Share Tile Folder as PDF</h2>
      <p>Choose a tile folder. All photos and available item details in that folder will be combined into one PDF for your customer. PDF only.</p>
      <select id="ks-folder" aria-label="Choose catalogue folder"></select>
      <button id="ks-create" class="primary" type="button">Create PDF & Share</button>
      <p id="kandy-share-status" aria-live="polite"></p>
      <button id="ks-close" class="ks-close" type="button">Close</button>
    </div>`;
  document.body.appendChild(modal);

  const tileFormatModal = document.createElement('div');
  tileFormatModal.id = 'kandy-tile-format-modal';
  tileFormatModal.innerHTML = `
    <div class="ks-card" role="dialog" aria-modal="true" aria-labelledby="kst-title">
      <h2 id="kst-title">Share This Tile</h2>
      <p>Choose the file format to share on WhatsApp or another app.</p>
      <button id="kst-jpg" class="primary" type="button">Share as JPG Photo</button>
      <button id="kst-pdf" type="button">Share as PDF</button>
      <button id="kst-close" type="button">Close</button>
      <p id="kst-status" aria-live="polite"></p>
    </div>`;
  document.body.appendChild(tileFormatModal);

  const status = text => { const el = document.getElementById('kandy-share-status'); if (el) el.textContent = text || ''; };
  const adminVisible = () => {
    const login = document.getElementById('login-panel');
    const dashboard = document.getElementById('dashboard');
    const shown = el => el && !el.classList.contains('hide') && getComputedStyle(el).display !== 'none';
    return shown(login) || shown(dashboard);
  };
  function publicMode() {
    const active = !adminVisible();
    catalogueBtn.style.display = active ? 'block' : 'none';
    if (!active) { tileBtn.style.display = 'none'; modal.style.display = 'none'; tileFormatModal.style.display = 'none'; }
  }
  new MutationObserver(publicMode).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
  publicMode();

  function getTiles() {
    return Array.isArray(tiles) ? tiles : [];
  }
  function getFolders() {
    const names = Array.isArray(folders) ? folders : [];
    return names.length ? names : [...new Set(getTiles().map(t => t.folder).filter(Boolean))];
  }
  function showModal() {
    const select = document.getElementById('ks-folder');
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = '__ALL__'; all.textContent = 'All Tile Folders (one PDF)';
    select.appendChild(all);
    getFolders().forEach(name => {
      const option = document.createElement('option');
      option.value = name; option.textContent = name;
      select.appendChild(option);
    });
    status('');
    modal.style.display = 'flex';
  }
  catalogueBtn.addEventListener('click', showModal);
  document.getElementById('ks-close').addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  let selectedTile = null;
  function sameImage(a,b) {
    if (!a || !b) return false;
    return a === b || a.split('?')[0] === b.split('?')[0] || a.endsWith(b) || b.endsWith(a);
  }
  document.addEventListener('click', event => {
    if (adminVisible() || !event.target) return;
    const target = event.target.nodeType === 1 ? event.target : event.target.parentElement;
    if (!target) return;
    // Gallery cards sometimes receive the click instead of the nested IMG.
    const img = target.closest('img') || (target.querySelector && target.querySelector('img'));
    if (!img || img.tagName !== 'IMG') return;
    if ((img.naturalWidth || img.width || 0) < 70 && (img.naturalHeight || img.height || 0) < 70) return;
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
    if (!src) return;
    const match = getTiles().find(t => sameImage(t.image,src) || sameImage(t.image,img.src) || sameImage(t.image,img.getAttribute('src')));
    if (match) {
      selectedTile = match;
    } else {
      const card = img.closest('article, .tile-card, .product-card, .tile-item, .gallery-item, [data-tile], [class*="tile"]') || img.parentElement;
      const nearbyText = card ? (card.innerText || card.textContent || '') : '';
      const numberMatch = nearbyText.match(/(?:tile\\s*(?:no|number)?|no\\.?)[\\s:#-]*([a-z0-9-]+)/i) || (img.alt || '').match(/([a-z0-9-]+)/i);
      const codeMatch = nearbyText.match(/(?:product\\s*code|code)[\\s:#-]*([a-z0-9-]+)/i);
      const folderMatch = nearbyText.match(/(?:collection|folder)[\\s:#-]*([^\\n|]+)/i);
      selectedTile = {
        image: src,
        number: numberMatch ? numberMatch[1] : (img.alt || 'Tile'),
        code: codeMatch ? codeMatch[1] : '',
        folder: folderMatch ? folderMatch[1].trim() : ''
      };
    }
    tileBtn.style.display = 'block';
    tileBtn.textContent = '⇧ Share This Tile';
  }, true);

  function tileDetails(tile) {
    return [
      tile.number ? 'Tile Number: ' + tile.number : '',
      tile.code ? 'Product Code: ' + tile.code : '',
      tile.folder ? 'Collection: ' + tile.folder : ''
    ].filter(Boolean).join(' | ');
  }
  async function imageFile(url, name) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Photo could not be loaded');
    const blob = await response.blob();
    const type = blob.type || 'image/jpeg';
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return new File([blob], name + '.' + ext, {type});
  }
  function showTileFormatOptions() {
    if (!selectedTile) return;
    document.getElementById('kst-status').textContent = '';
    tileFormatModal.style.display = 'flex';
  }
  async function shareTileAs(format) {
    if (!selectedTile) return;
    const tile = selectedTile;
    const details = 'KANDY TILE\\n' + tileDetails(tile);
    const baseName = 'KANDY-TILE-' + (tile.number || tile.code || 'Product');
    const jpgButton = document.getElementById('kst-jpg');
    const pdfButton = document.getElementById('kst-pdf');
    jpgButton.disabled = pdfButton.disabled = true;
    document.getElementById('kst-status').textContent = 'Preparing ' + format.toUpperCase() + '...';
    try {
      let file;
      if (format === 'jpg') {
        const data = await imageData(tile.image);
        const response = await fetch(data);
        const blob = await response.blob();
        file = new File([blob],baseName+'.jpg',{type:'image/jpeg'});
      } else {
        await loadPdfLibrary();
        const {jsPDF} = window.jspdf;
        const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
        pdf.setFillColor(7,31,48); pdf.rect(0,0,210,297,'F');
        pdf.setTextColor(235,249,255); pdf.setFontSize(23); pdf.text('KANDY TILE',14,22);
        pdf.setFontSize(12); pdf.setTextColor(174,216,230); pdf.text('REFLECT YOUR DREAM',14,31);
        const data = await imageData(tile.image);
        pdf.addImage(data,'JPEG',14,45,182,150,undefined,'FAST');
        pdf.setTextColor(238,250,255); pdf.setFontSize(13);
        const lines = tileDetails(tile).split(' | ');
        lines.forEach((line,i) => pdf.text(line,14,215+i*11));
        pdf.setTextColor(174,216,230); pdf.setFontSize(10);
        pdf.text('KANDY TILE Catalogue',14,270);
        file = new File([pdf.output('blob')],baseName+'.pdf',{type:'application/pdf'});
      }
      if (navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))) {
        await navigator.share({title:'KANDY TILE - '+(tile.number || 'Product'),text:details,files:[file]});
        document.getElementById('kst-status').textContent = 'Share completed.';
      } else {
        const objectUrl = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = objectUrl; link.download = file.name; link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl),1500);
        document.getElementById('kst-status').textContent = file.name+' downloaded. Attach it in WhatsApp.';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') document.getElementById('kst-status').textContent = 'Sharing cancelled.';
      else {
        document.getElementById('kst-status').textContent = 'Could not prepare the file. Please try again.';
        console.error('KANDY TILE tile share:',err);
      }
    } finally { jpgButton.disabled = pdfButton.disabled = false; }
  }
  tileBtn.addEventListener('click', showTileFormatOptions);
  document.getElementById('kst-jpg').addEventListener('click',() => shareTileAs('jpg'));
  document.getElementById('kst-pdf').addEventListener('click',() => shareTileAs('pdf'));
  document.getElementById('kst-close').addEventListener('click',() => tileFormatModal.style.display='none');
  tileFormatModal.addEventListener('click',e => { if(e.target===tileFormatModal) tileFormatModal.style.display='none'; });


  function loadPdfLibrary() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (window.__kandyPdfLoading) return window.__kandyPdfLoading;
    window.__kandyPdfLoading = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('PDF library could not be loaded. Check your internet connection.'));
      document.head.appendChild(script);
    });
    return window.__kandyPdfLoading;
  }
  async function imageData(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Image download failed');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image,0,0);
      return canvas.toDataURL('image/jpeg',0.9);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  async function createCataloguePdf() {
    const chosen = document.getElementById('ks-folder').value;
    const items = getTiles().filter(t => chosen === '__ALL__' || t.folder === chosen);
    if (!items.length) { status('No products found in this folder.'); return; }
    const button = document.getElementById('ks-create');
    button.disabled = true;
    try {
      status('Preparing PDF. Please wait...');
      await loadPdfLibrary();
      const {jsPDF} = window.jspdf;
      const pdf = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
      const heading = chosen === '__ALL__' ? 'All Collections' : chosen;
      pdf.setFillColor(7,31,48); pdf.rect(0,0,210,297,'F');
      pdf.setTextColor(235,249,255); pdf.setFontSize(22); pdf.text('KANDY TILE',14,20);
      pdf.setFontSize(15); pdf.text(heading,14,30);
      pdf.setFontSize(9); pdf.setTextColor(174,216,230);
      pdf.text('REFLECT YOUR STYLE  |  ' + items.length + ' Products',14,37);
      let y = 47;
      for (let i=0;i<items.length;i++) {
        if (y > 245) {
          pdf.addPage(); pdf.setFillColor(7,31,48); pdf.rect(0,0,210,297,'F');
          y = 18;
        }
        const item = items[i];
        pdf.setDrawColor(65,139,163); pdf.roundedRect(12,y,186,106,3,3,'S');
        try {
          const data = await imageData(item.image);
          const format = data.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          const props = pdf.getImageProperties(data);
          const maxW = 82, maxH = 76;
          const scale = Math.min(maxW / props.width, maxH / props.height);
          const imgW = props.width * scale, imgH = props.height * scale;
          pdf.addImage(data,format,17+(maxW-imgW)/2,y+6+(maxH-imgH)/2,imgW,imgH,undefined,'FAST');
        } catch (e) {
          pdf.setTextColor(180,210,220); pdf.setFontSize(10);
          pdf.text('Product photo unavailable',20,y+42);
        }
        pdf.setTextColor(238,250,255); pdf.setFontSize(13);
        pdf.text('Product ' + (i+1),108,y+18);
        pdf.setFontSize(10); pdf.setTextColor(184,224,236);
        const lines = [
          item.number ? 'Tile Number: ' + item.number : '',
          item.code ? 'Product Code: ' + item.code : '',
          item.folder ? 'Folder: ' + item.folder : ''
        ].filter(Boolean);
        let detailY = y+32;
        lines.forEach(line => {
          const wrapped = pdf.splitTextToSize(line,80);
          pdf.text(wrapped,108,detailY);
          detailY += wrapped.length * 5 + 3;
        });
        y += 113;
      }
      const safe = heading.replace(/[^a-z0-9-_]+/gi,'-');
      const fileName = 'KANDY-TILE-' + safe + '.pdf';
      const blob = pdf.output('blob');
      const file = new File([blob],fileName,{type:'application/pdf'});
      if (navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))) {
        status('Opening share options...');
        await navigator.share({title:'KANDY TILE Catalogue - '+heading,text:'KANDY TILE product catalogue',files:[file]});
        status('PDF shared successfully.');
      } else {
        pdf.save(fileName);
        status('PDF created and downloaded. You can now share the PDF file.');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') status('Sharing cancelled.');
      else { status(err.message || 'PDF creation failed.'); console.error('KANDY TILE PDF:',err); }
    } finally { button.disabled = false; }
  }
  document.getElementById('ks-create').addEventListener('click',createCataloguePdf);
})();


// KANDY TILE collection cover slideshow — robust image targeting + 3-second rotation.
(function kandyTopPhotoSlideshowV2() {
  if (window.__kandyTopPhotoSlideshowV2) return;
  window.__kandyTopPhotoSlideshowV2 = true;

  const STORAGE_BASE = 'https://dthepmehttlimzwgvotk.supabase.co/storage/v1/object/public/catalog-photos/';
  const SUPABASE_URL = 'https://dthepmehttlimzwgvotk.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8SHCyJX1eetAhZvMOR9dFg_lEltHI15';
  let photos = [], current = -1, target = null, timer = null, loading = false;

  const style = document.createElement('style');
  style.textContent = '.kandy-cover-slideshow{transition:opacity .35s ease!important}.kandy-cover-slideshow.kandy-cover-changing{opacity:.08!important}';
  document.head.appendChild(style);

  function photoUrl(path) {
    return STORAGE_BASE + String(path || '').split('/').map(encodeURIComponent).join('/');
  }

  async function loadPhotos() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch(SUPABASE_URL + '/rest/v1/catalog_tiles?select=image_path,tile_number,product_code&order=sort_order.asc', {
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
      });
      if (response.ok) {
        const rows = await response.json();
        photos = rows.filter(row => row.image_path).map(row => ({
          src: photoUrl(row.image_path),
          label: [row.tile_number, row.product_code].filter(Boolean).join(' - ')
        }));
      }
    } catch (e) {
      console.warn('KANDY TILE slideshow could not load cloud photos:', e);
    } finally {
      loading = false;
    }
    if (photos.length < 2 && typeof tiles !== 'undefined' && Array.isArray(tiles)) {
      photos = tiles.filter(t => t && typeof t.image === 'string' && t.image)
        .map(t => ({src:t.image,label:[t.number,t.code].filter(Boolean).join(' - ')}));
    }
  }

  function isAdminView() {
    const dashboard = document.getElementById('dashboard');
    return !!(dashboard && !dashboard.classList.contains('hide') && getComputedStyle(dashboard).display !== 'none');
  }

  function findCover() {
    // Prefer the exact collection-cover image the user identified.
    const all = [...document.querySelectorAll('img')];
    let found = all.find(img => (img.currentSrc || img.src || '').includes('/tiles/GLOSS-0.webp'));
    if (!found) found = all.find(img => (img.alt || '').toLowerCase().includes('tile collection cover'));
    if (!found) {
      const candidates = all.filter(img => {
        const r=img.getBoundingClientRect(), cs=getComputedStyle(img);
        return r.top >= -80 && r.top < 750 && r.width >= 250 && r.height >= 110 &&
          img.complete && img.naturalWidth && cs.display !== 'none' && cs.visibility !== 'hidden' &&
          !img.closest('#dashboard,#login-panel,#kandy-share-modal,#kandy-tile-format-modal');
      });
      candidates.sort((a,b) => {
        const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
        return ar.top-br.top || br.width*br.height-ar.width*ar.height;
      });
      found=candidates[0] || null;
    }
    if (found) return {el:found, type:'img'};
    // Also support a CSS-background cover image.
    const backgrounds=[...document.querySelectorAll('body *')].filter(el => {
      const bg=getComputedStyle(el).backgroundImage;
      const r=el.getBoundingClientRect();
      return bg.includes('GLOSS-0.webp') && r.width>=250 && r.height>=110;
    });
    if (backgrounds[0]) return {el:backgrounds[0],type:'background'};
    return null;
  }

  function currentSrc() {
    if (!target) return '';
    return target.type==='img' ? (target.el.currentSrc || target.el.src || '') : getComputedStyle(target.el).backgroundImage;
  }

  function paint(item) {
    if (!target || !target.el.isConnected) return;
    const el=target.el;
    el.classList.add('kandy-cover-slideshow','kandy-cover-changing');
    setTimeout(() => {
      if (!target || !el.isConnected) return;
      if (target.type==='img') {
        el.src=item.src;
        el.removeAttribute('srcset');
        el.alt=item.label || 'KANDY TILE collection';
      } else {
        el.style.backgroundImage='url("' + item.src + '")';
      }
      const reveal=()=>el.classList.remove('kandy-cover-changing');
      if (target.type==='img') {
        el.addEventListener('load',reveal,{once:true});
        el.addEventListener('error',reveal,{once:true});
      }
      setTimeout(reveal,800);
    },180);
  }

  async function start() {
    if (isAdminView()) { if(timer) clearInterval(timer); timer=null; return; }
    if (photos.length < 2) await loadPhotos();
    if (photos.length < 2) return;
    if (!target || !target.el.isConnected) {
      target=findCover();
      if (!target) return;
      const src=currentSrc();
      current=photos.findIndex(p => src.includes(p.src) || p.src.includes('GLOSS-0.webp'));
      if (current < 0) current=0;
    }
    if (timer) return;
    timer=setInterval(() => {
      if (!target || !target.el.isConnected || isAdminView()) {
        clearInterval(timer); timer=null; target=null; return;
      }
      current=(current+1)%photos.length;
      paint(photos[current]);
    },3000);
  }

  const boot=()=>{ start(); };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
  setInterval(()=>{ if(!timer) boot(); },1200);
  new MutationObserver(()=>{if(!timer) boot();}).observe(document.body,{childList:true,subtree:true});
})();
 
// KANDY TILE installable app branding (favicon + home-screen/desktop shortcut icon)
(function kandyTileAppBranding(){
  function addLink(rel, href, extra){
    let el = document.querySelector('link[rel="' + rel + '"]');
    if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
    el.href = href;
    if (extra) Object.keys(extra).forEach(k => el.setAttribute(k, extra[k]));
  }
  function apply(){
    addLink('manifest', './manifest.json');
    addLink('icon', './kandy-tile-icon.svg', {type:'image/svg+xml'});
    addLink('apple-touch-icon', './kandy-tile-icon.svg');
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta=document.createElement('meta'); meta.name='theme-color'; document.head.appendChild(meta); }
    meta.content='#153c4a';
  }
  if (document.head) apply();
  else document.addEventListener('DOMContentLoaded', apply, {once:true});
})();

/* KANDY TILE: additive Category > Folder > Item feature. Existing admin tools and catalogue records stay intact. */
(function(){
 if(window.__kandyCategoryFeatureV1)return; window.__kandyCategoryFeatureV1=true;
 var URL='https://dthepmehttlimzwgvotk.supabase.co', KEY='sb_publishable_8SHCyJX1eetAhZvMOR9dFg_lEltHI15';
 var db=window.supabase.createClient(URL,KEY), cats=[], folderRows=[], items=[], panel=null, modal=null, level='categories', chosenCat='', chosenFolder='';
 function shown(n){if(!n||n.classList.contains('hide'))return false;var s=getComputedStyle(n);return s.display!=='none'&&s.visibility!=='hidden';}
 function admin(){return shown(document.getElementById('dashboard'))||shown(document.getElementById('login-panel'));}
 function node(tag,cls,txt){var n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;}
 function status(txt,bad){var n=document.getElementById('kcat-status');if(n){n.textContent=txt;n.style.color=bad?'#ffb5b5':'#a9edc5';}}
 async function load(){
  var q=await Promise.all([db.from('catalog_categories').select('collection,name,sort_order').order('sort_order'),db.from('catalog_folders').select('name,sort_order').order('sort_order'),db.from('catalog_tiles').select('id,folder,tile_number,product_code,image_path,sort_order').order('sort_order')]);
  q.forEach(function(x){if(x.error)throw x.error;});
  var map=new Map();(q[0].data||[]).forEach(function(r){if(!map.has(r.collection))map.set(r.collection,[]);if(r.name)map.get(r.collection).push(r.name);});
  cats=Array.from(map.keys()).map(function(name){return{name:name,folders:map.get(name)};});
  cats.sort(function(a,b){return a.name==='Tiles'?-1:b.name==='Tiles'?1:a.name.localeCompare(b.name);});
  folderRows=q[1].data||[];
  items=(q[2].data||[]).map(function(r){return{id:r.id,folder:r.folder,number:r.tile_number,code:r.product_code,image:db.storage.from('catalog-photos').getPublicUrl(r.image_path).data.publicUrl};});
 }
 async function seedMappings(){
  var q=await Promise.all([db.from('catalog_categories').select('collection,name'),db.from('catalog_folders').select('name,sort_order')]);
  q.forEach(function(x){if(x.error)throw x.error;});
  var used=new Set((q[0].data||[]).filter(function(x){return x.name;}).map(function(x){return x.name;}));
  var missing=(q[1].data||[]).filter(function(x){return !used.has(x.name);}).map(function(x){return{collection:'Tiles',name:x.name,sort_order:x.sort_order};});
  if(missing.length){var u=await db.from('catalog_categories').upsert(missing,{onConflict:'collection,name'});if(u.error)throw u.error;}
  if(!(q[0].data||[]).some(function(x){return x.collection==='Tiles';})){var z=await db.from('catalog_categories').insert({collection:'Tiles',name:'',sort_order:0});if(z.error&&z.error.code!=='23505')throw z.error;}
 }
 function createAdmin(){
  var dash=document.getElementById('dashboard');var host=dash&&(dash.querySelector('.admin-panel')||dash);if(!host||document.getElementById('kandy-category-admin'))return;
  panel=node('section','admin-panel');panel.id='kandy-category-admin';panel.style.cssText='margin-top:18px;padding:18px;border:1px solid rgba(180,225,240,.3);border-radius:16px';
  var h=node('h2',null,'Manage Categories');panel.appendChild(h);
  panel.appendChild(node('p','notice','New option only: Category → Folder → Items. Your existing catalogue folders are automatically placed under Tiles.'));
  var form=node('form');form.id='kcat-add';form.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:12px 0';
  var input=node('input');input.id='kcat-new';input.placeholder='New category name (e.g. Commode)';input.required=true;input.maxLength=60;input.style.flex='1';
  var add=node('button',null,'＋ Add Category');add.type='submit';add.className='primary';form.append(input,add);panel.appendChild(form);
  panel.appendChild(node('div',null,''));var st=node('div');st.id='kcat-status';st.style.minHeight='22px';panel.appendChild(st);
  var list=node('div');list.id='kcat-list';panel.appendChild(list);host.appendChild(panel);
  form.addEventListener('submit',async function(e){e.preventDefault();var name=input.value.trim();if(!name)return;try{await load();if(cats.some(function(c){return c.name.toLowerCase()===name.toLowerCase();}))throw Error('Category already exists.');var r=await db.from('catalog_categories').insert({collection:name,name:'',sort_order:9999});if(r.error)throw r.error;input.value='';status('Category added. Assign folders below.');await drawAdmin();}catch(err){status(err.message||String(err),true);}});
  drawAdmin().catch(function(e){status(e.message||String(e),true);});
 }
 async function drawAdmin(){
  await seedMappings();await load();var list=document.getElementById('kcat-list');if(!list)return;list.innerHTML='';
  cats.forEach(function(c){
   var card=node('div');card.style.cssText='padding:13px;margin:12px 0;border:1px solid rgba(170,225,240,.3);border-radius:13px';
   var top=node('div');top.style.cssText='display:flex;gap:7px;flex-wrap:wrap';
   var name=node('input');name.value=c.name;name.maxLength=60;name.style.flex='1';name.setAttribute('aria-label','Category name');
   var rename=node('button',null,'Save Name');rename.type='button';
   var del=node('button',null,'Delete');del.type='button';if(c.name==='Tiles'){del.disabled=true;del.title='Default category cannot be deleted';}
   top.append(name,rename,del);card.append(top);
   card.appendChild(node('p','notice','Choose the folders that belong inside '+c.name+'.'));
   var choices=node('div');choices.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px';
   folderRows.forEach(function(f){var label=node('label');label.style.cssText='display:flex;align-items:center;gap:7px;padding:7px;background:rgba(255,255,255,.07);border-radius:8px';var cb=node('input');cb.type='checkbox';cb.value=f.name;cb.checked=c.folders.indexOf(f.name)>=0;label.append(cb,document.createTextNode(f.name));choices.appendChild(label);});
   card.appendChild(choices);var save=node('button','primary','Save Folder Assignment');save.type='button';save.style.marginTop='10px';card.appendChild(save);list.appendChild(card);
   rename.addEventListener('click',async function(){var next=name.value.trim();if(!next||next===c.name)return;try{if(cats.some(function(x){return x.name.toLowerCase()===next.toLowerCase();}))throw Error('Category already exists.');var rows=c.folders.length?c.folders.map(function(f,i){return{collection:next,name:f,sort_order:i};}):[{collection:next,name:'',sort_order:0}];var u=await db.from('catalog_categories').upsert(rows,{onConflict:'collection,name'});if(u.error)throw u.error;var d=await db.from('catalog_categories').delete().eq('collection',c.name);if(d.error)throw d.error;status('Category name updated.');await drawAdmin();}catch(e){status(e.message||String(e),true);}});
   del.addEventListener('click',async function(){if(c.name==='Tiles')return;if(!confirm('Delete '+c.name+'? Its folders and products will be moved to Tiles. Photos and items will not be deleted.'))return;try{if(c.folders.length){var u=await db.from('catalog_categories').upsert(c.folders.map(function(f,i){return{collection:'Tiles',name:f,sort_order:i};}),{onConflict:'collection,name'});if(u.error)throw u.error;}var d=await db.from('catalog_categories').delete().eq('collection',c.name);if(d.error)throw d.error;status('Category deleted. Its folders remain under Tiles.');await drawAdmin();}catch(e){status(e.message||String(e),true);}});
   save.addEventListener('click',async function(){var selected=Array.from(choices.querySelectorAll('input:checked')).map(function(x){return x.value;});try{if(selected.length){var mv=await db.from('catalog_categories').delete().in('name',selected);if(mv.error)throw mv.error;}var cl=await db.from('catalog_categories').delete().eq('collection',c.name);if(cl.error)throw cl.error;var rows=selected.length?selected.map(function(f,i){return{collection:c.name,name:f,sort_order:i};}):[{collection:c.name,name:'',sort_order:0}];var u=await db.from('catalog_categories').upsert(rows,{onConflict:'collection,name'});if(u.error)throw u.error;status('Folder assignment saved.');await drawAdmin();}catch(e){status(e.message||String(e),true);}});
  });
 }
 function createPublic(){
  if(document.getElementById('kandy-category-open')||admin())return;
  var css=node('style');css.textContent=
   '#kandy-category-open{position:fixed;z-index:9988;left:50%;bottom:76px;transform:translateX(-50%);padding:12px 20px;border:1px solid #9bdcec;border-radius:30px;color:white;font-weight:800;background:linear-gradient(135deg,#087f9f,#124f78);box-shadow:0 8px 24px #001b2b88;white-space:nowrap}'+
   '#kandy-category-modal{display:none;position:fixed;inset:0;z-index:100010;overflow:auto;padding:18px;background:#061522f5;color:#f1fbff}'+
   '#kandy-category-modal .kc-head{position:sticky;top:-18px;background:#061522;padding:12px 0;display:flex;justify-content:space-between;align-items:center;gap:8px;z-index:2}'+
   '#kandy-category-modal .kc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-top:18px}'+
   '#kandy-category-modal .kc-card{border:1px solid #9bdcec55;border-radius:15px;overflow:hidden;background:#102f43;cursor:pointer}'+
   '#kandy-category-modal .kc-card img{width:100%;height:145px;object-fit:cover;display:block}'+
   '#kandy-category-modal .kc-card div{padding:11px}#kandy-category-modal button{padding:10px 14px;border-radius:10px;color:white;background:#12445d;border:1px solid #9bdcec66}'+
   '#kandy-category-modal .kc-empty{padding:22px;text-align:center;color:#bdd9e4}'+
   '#kandy-category-modal .kc-large{position:fixed;inset:0;z-index:4;background:#000e;display:none;align-items:center;justify-content:center;padding:16px}'+
   '#kandy-category-modal .kc-large img{max-width:96vw;max-height:85vh;object-fit:contain}'+
   '@media(max-width:560px){#kandy-category-modal .kc-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}#kandy-category-modal .kc-card img{height:110px}}';
  document.head.appendChild(css);
  var btn=node('button',null,'Browse by Category');btn.id='kandy-category-open';document.body.appendChild(btn);
  var box=node('div');box.id='kandy-category-modal';box.innerHTML='<div class="kc-head"><h2 id="kc-title">Categories</h2><div><button id="kc-back" style="display:none">← Back</button> <button id="kc-close">Close ✕</button></div></div><div id="kc-body"></div><div class="kc-large" id="kc-large"><button id="kc-large-close" style="position:absolute;right:18px;top:18px">Close</button><img id="kc-large-img" alt="Product"></div>';document.body.appendChild(box);modal=box;
  function card(title,sub,image,click,large){var c=node('div','kc-card');if(image){var im=node('img');im.src=image;im.alt=title;im.loading='lazy';if(large)im.addEventListener('click',function(e){e.stopPropagation();document.getElementById('kc-large-img').src=image;document.getElementById('kc-large').style.display='flex';});c.appendChild(im);}var d=node('div');d.appendChild(node('strong',null,title));if(sub)d.appendChild(node('p',null,sub));c.appendChild(d);if(click)c.addEventListener('click',click);return c;}
  function renderCategories(){level='categories';chosenCat='';chosenFolder='';document.getElementById('kc-title').textContent='Browse Categories';document.getElementById('kc-back').style.display='none';var body=document.getElementById('kc-body');body.innerHTML='';var grid=node('div','kc-grid');cats.forEach(function(c){var p=items.find(function(x){return c.folders.indexOf(x.folder)>=0;});grid.appendChild(card(c.name,c.folders.length+' folders',p&&p.image,function(){renderFolders(c.name);}));});body.appendChild(grid);if(!cats.length)body.appendChild(node('p','kc-empty','No categories available.'));}
  function renderFolders(name){level='folders';chosenCat=name;chosenFolder='';document.getElementById('kc-title').textContent=name+' — Folders';document.getElementById('kc-back').style.display='inline-block';var body=document.getElementById('kc-body');body.innerHTML='';var grid=node('div','kc-grid');var c=cats.find(function(x){return x.name===name;});(c?c.folders:[]).forEach(function(f){var list=items.filter(function(x){return x.folder===f;});grid.appendChild(card(f,list.length+' items',list[0]&&list[0].image,function(){renderItems(f);}));});body.appendChild(grid);if(!grid.children.length)body.appendChild(node('p','kc-empty','No folders in this category yet.'));}
  function renderItems(folder){level='items';chosenFolder=folder;document.getElementById('kc-title').textContent=folder+' — Items';document.getElementById('kc-back').style.display='inline-block';var body=document.getElementById('kc-body');body.innerHTML='';var grid=node('div','kc-grid');items.filter(function(x){return x.folder===folder;}).forEach(function(p){grid.appendChild(card(p.number||'Product',p.code?'Product Code: '+p.code:'',p.image,null,true));});body.appendChild(grid);if(!grid.children.length)body.appendChild(node('p','kc-empty','No items in this folder.'));}
  btn.addEventListener('click',async function(){btn.disabled=true;try{await load();renderCategories();box.style.display='block';}catch(e){alert('Could not load categories: '+(e.message||e));}finally{btn.disabled=false;}});
  document.getElementById('kc-close').addEventListener('click',function(){box.style.display='none';});
  document.getElementById('kc-back').addEventListener('click',function(){if(level==='items')renderFolders(chosenCat);else renderCategories();});
  document.getElementById('kc-large-close').addEventListener('click',function(){document.getElementById('kc-large').style.display='none';});
 }
 function refresh(){if(shown(document.getElementById('dashboard')))createAdmin();else if(!admin())createPublic();else{var p=document.getElementById('kandy-category-admin');if(p)p.remove();panel=null;var b=document.getElementById('kandy-category-open');if(b)b.remove();}}
 window.addEventListener('kandy-category-admin-ready',createAdmin);
 new MutationObserver(refresh).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});refresh();
})();


/* KANDY TILE tagline wording update */
(() => {
  const replaceTagline = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (textNode.nodeValue && textNode.nodeValue.includes('REFLECT YOUR DREAM')) {
        textNode.nodeValue = textNode.nodeValue.replaceAll('REFLECT YOUR DREAM', 'REFLECT YOUR STYLE');
      }
    }
  };
  if (document.body) {
    replaceTagline();
    new MutationObserver(replaceTagline).observe(document.body, { childList: true, subtree: true, characterData: true });
  } else {
    document.addEventListener('DOMContentLoaded', replaceTagline, { once: true });
  }
})();


/* KANDY TILE logo: return to the catalogue home page when clicked. */
(function kandyTileLogoHomeLink(){
  if (window.__kandyTileLogoHomeLinkV1) return;
  window.__kandyTileLogoHomeLinkV1 = true;
  const isKandyLogo = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const label = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('alt') || '',
      el.textContent || ''
    ].join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
    const marker = ((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')).toLowerCase();
    const imageLogo = el.tagName === 'IMG' && /KANDY\s*TILE/.test(label);
    const namedLogo = /logo|brand/.test(marker) && /KANDY\s*TILE/.test(label);
    const adminLogo = el.classList.contains('kandy-admin-brand');
    return imageLogo || namedLogo || adminLogo;
  };
  document.addEventListener('click', function(event){
    let el = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    let logo = null;
    for (let i = 0; el && i < 7; i++, el = el.parentElement) {
      if (isKandyLogo(el)) { logo = el; break; }
    }
    if (!logo) return;
    event.preventDefault();
    event.stopPropagation();
    window.location.href = new URL('./', window.location.href).href;
  }, true);
  const style = document.createElement('style');
  style.textContent = '.kandy-admin-brand,[class*="logo"],[class*="brand"]{cursor:pointer}';
  document.head.appendChild(style);
})();


/* Reliable visible folder-to-PDF share control (independent of the older share modal). */
(function kandyFolderPdfShareV2(){
  if(window.__kandyFolderPdfShareV2) return;
  window.__kandyFolderPdfShareV2 = true;
  const SUPA_URL = 'https://dthepmehttlimzwgvotk.supabase.co';
  const SUPA_KEY = 'sb_publishable_8SHCyJX1eetAhZvMOR9dFg_lEltHI15';
  const css = document.createElement('style');
  css.textContent = `
    #kandy-folder-pdf-v2{position:fixed!important;right:16px!important;bottom:24px!important;z-index:2147483646!important;padding:13px 18px!important;border:1px solid #b7e7f1!important;border-radius:999px!important;background:linear-gradient(135deg,#087f9f,#124f78)!important;color:#fff!important;font-weight:800!important;box-shadow:0 8px 28px #001a2b66!important;cursor:pointer!important}
    #kandy-folder-pdf-dialog{position:fixed;inset:0;z-index:2147483001;background:#061522dd;display:none;align-items:center;justify-content:center;padding:16px}
    #kandy-folder-pdf-dialog .kfp-card{width:min(440px,100%);max-height:85vh;overflow:auto;padding:22px;border:1px solid #8ccbdc;border-radius:18px;background:#102f43;color:#effaff;box-shadow:0 20px 60px #0009}
    #kandy-folder-pdf-dialog h2{margin:0 0 8px}#kandy-folder-pdf-dialog p{color:#c8e4ec}
    #kandy-folder-pdf-dialog select,#kandy-folder-pdf-dialog button{box-sizing:border-box;width:100%;padding:13px;margin-top:10px;border-radius:10px;border:1px solid #6b9eaf;background:#12364b;color:white;font-size:15px}
    #kandy-folder-pdf-dialog button.primary{background:#087f9f;font-weight:800}
  `;
  document.head.appendChild(css);
  const btn=document.createElement('button');
  btn.id='kandy-folder-pdf-v2';btn.type='button';btn.textContent='⇧ Export PDF';
  const dialog=document.createElement('div');
  dialog.id='kandy-folder-pdf-dialog';
  dialog.innerHTML='<div class="kfp-card" role="dialog" aria-modal="true"><h2>Share Tile Folder PDF</h2><p>Select a folder. All tile photos and available item details will be included in one PDF.</p><select id="kfp-folder"><option value="">Loading folders...</option></select><button class="primary" id="kfp-share" type="button">Create PDF & Share</button><p id="kfp-status" aria-live="polite"></p><button id="kfp-close" type="button">Close</button></div>';
  document.body.append(btn,dialog);
  btn.style.display='block';
  const status=t=>{const e=document.getElementById('kfp-status');if(e)e.textContent=t||'';};
  const adminOn=()=>{const a=document.getElementById('dashboard');if(!a)return false;const st=getComputedStyle(a);return !a.classList.contains('hide')&&st.display!=='none'&&st.visibility!=='hidden'&&a.getBoundingClientRect().width>0&&a.getBoundingClientRect().height>0;};
  function visibility(){const isAdmin=adminOn();btn.style.display=isAdmin?'none':'block';if(isAdmin)dialog.style.display='none';}
  new MutationObserver(visibility).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
  visibility();
  async function rows(){
    const url=SUPA_URL+'/rest/v1/catalog_tiles?select=folder,tile_number,product_code,image_path&order=sort_order.asc';
    const res=await fetch(url,{headers:{apikey:SUPA_KEY,Authorization:'Bearer '+SUPA_KEY}});
    if(!res.ok)throw new Error('Catalogue could not be loaded ('+res.status+').');
    return await res.json();
  }
  async function loadFolders(){
    status('Loading folders...');
    const data=await rows();
    const names=[...new Set(data.map(x=>x.folder).filter(Boolean))];
    const select=document.getElementById('kfp-folder');
    select.innerHTML='';
    names.forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;select.appendChild(o);});
    if(!names.length)throw new Error('No tile folders found.');
    status(names.length+' folders ready.');
  }
  btn.addEventListener('click',async()=>{dialog.style.display='flex';try{await loadFolders();}catch(e){status(e.message);}});
  document.getElementById('kfp-close').addEventListener('click',()=>dialog.style.display='none');
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.style.display='none';});
  function loadPdf(){
    if(window.jspdf&&window.jspdf.jsPDF)return Promise.resolve();
    if(window.__kandyFolderPdfLoader)return window.__kandyFolderPdfLoader;
    window.__kandyFolderPdfLoader=(async()=>{
      const sources=[
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js',
        'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js'
      ];
      let lastError;
      for(const src of sources){
        try{
          await new Promise((resolve,reject)=>{
            const sc=document.createElement('script');
            sc.src=src;sc.async=true;
            sc.onload=()=>window.jspdf&&window.jspdf.jsPDF?resolve():reject(new Error('PDF script loaded but jsPDF was not available.'));
            sc.onerror=()=>reject(new Error('Could not load '+src));
            document.head.appendChild(sc);
          });
          return;
        }catch(err){lastError=err;}
      }
      window.__kandyFolderPdfLoader=null;
      throw new Error('PDF library could not load. Please check internet connection and try again. '+(lastError?.message||''));
    })();
    return window.__kandyFolderPdfLoader;
  }
  async function photoData(path){
    const url=SUPA_URL+'/storage/v1/object/public/catalog-photos/'+String(path).split('/').map(encodeURIComponent).join('/');
    const res=await fetch(url);if(!res.ok)throw new Error('Photo download failed: '+path);
    const blob=await res.blob(),object=URL.createObjectURL(blob);
    try{const img=new Image();img.src=object;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL('image/jpeg',0.9);}finally{URL.revokeObjectURL(object);}
  }
  const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  document.getElementById('kfp-share').addEventListener('click',async()=>{
    const folder=document.getElementById('kfp-folder').value;
    if(!folder){status('Please select a folder.');return;}
    const button=document.getElementById('kfp-share');button.disabled=true;
    const printWindow=window.open('about:blank','_blank');
    if(!printWindow){status('Please allow pop-ups for this website and try again.');button.disabled=false;return;}
    try{
      status('Loading tile details...');const all=await rows();const items=all.filter(x=>x.folder===folder);
      if(!items.length)throw new Error('No tile items found in this folder.');
      let pages='';
      for(let i=0;i<items.length;i++){
        const item=items[i];status('Preparing page '+(i+1)+' of '+items.length+'...');
        let photo='';
        if(item.image_path){const data=await photoData(item.image_path);photo='<img class="photo" src="'+data+'" alt="Tile photo">';}
        const details=[item.tile_number?'Tile Number: '+item.tile_number:'',item.product_code?'Product Code: '+item.product_code:'','Folder: '+folder].filter(Boolean);
        pages+='<section class="page"><header><h1>KANDY TILE</h1><h2>'+escHtml(folder)+'</h2><p>REFLECT YOUR STYLE | '+(i+1)+' / '+items.length+'</p></header>'+photo+'<div class="details">'+details.map(x=>'<p>'+escHtml(x)+'</p>').join('')+'</div></section>';
      }
      const html='<!doctype html><html><head><meta charset="utf-8"><title>KANDY TILE - '+escHtml(folder)+'</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#102f43}.page{height:297mm;width:210mm;padding:14mm;page-break-after:always;break-after:page;position:relative}.page:last-child{page-break-after:auto;break-after:auto}header{border-bottom:2px solid #087f9f;padding-bottom:5mm}h1{font-size:25pt;margin:0 0 3mm;color:#075b78}h2{font-size:16pt;margin:0 0 2mm}header p{font-size:10pt;color:#456;margin:0}.photo{display:block;max-width:100%;width:auto;height:auto;max-height:190mm;object-fit:contain;margin:8mm auto}.details{position:absolute;bottom:18mm;left:14mm;right:14mm;font-size:12pt;border-top:1px solid #abc;padding-top:4mm}.details p{margin:2mm 0}@page{size:A4;margin:0}@media screen{body{background:#ddd}.page{margin:10mm auto;background:white;box-shadow:0 2px 10px #999}}@media print{.page{margin:0;box-shadow:none}}</style></head><body>'+pages+'<script>window.onload=()=>{setTimeout(()=>window.print(),700)};<\/script></body></html>';
      printWindow.document.open();printWindow.document.write(html);printWindow.document.close();
      status('Print window opened. Choose Save as PDF to create your PDF.');
    }catch(e){printWindow.close();status(e.message||'Export failed.');console.error('KANDY folder PDF:',e);}
    finally{button.disabled=false;}
  });;
})();


/* Center tagline directly below the KANDY TILE logo; do not alter header control layout. */
(function kandyLogoCenteredTagline(){
  if (window.__kandyLogoCenteredTaglineV3) return;
  window.__kandyLogoCenteredTaglineV3 = true;
  const STYLE_ID = 'kandy-logo-tagline-center-style';
  function installStyle(){
    let style=document.getElementById(STYLE_ID);
    if(!style){style=document.createElement('style');style.id=STYLE_ID;document.head.appendChild(style);}
    style.textContent = '.kandy-logo-tagline-anchor{position:relative!important;display:inline-block!important}.kandy-logo-tagline-anchor:after{content:"REFLECT YOUR STYLE.";position:absolute;top:100%;left:50%;transform:translateX(-50%);display:block;margin-top:2px;white-space:nowrap;text-align:center;font-size:clamp(9px,1.15vw,12px);line-height:1.2;font-weight:700;letter-spacing:.12em;color:inherit;pointer-events:none}';
  }
  function arrange(){
    installStyle();
    const candidates=Array.from(document.querySelectorAll('img,a,div,span,h1,h2,[class*="logo"],[class*="brand"]'));
    const logo=candidates.find(el=>{
      if(!el.getClientRects().length || el.closest('.kandy-admin-brand')) return false;
      const alt=[el.getAttribute('alt')||'',el.getAttribute('title')||'',el.getAttribute('aria-label')||''].join(' ').toUpperCase();
      const ownText=(el.childElementCount===0 ? (el.textContent||'').trim().replace(/\s+/g,' ') : '').toUpperCase();
      const marker=((el.id||'')+' '+(typeof el.className==='string'?el.className:'')).toLowerCase();
      return (el.tagName==='IMG' && /KANDY\s*TILE/.test(alt)) ||
        (/logo|brand/.test(marker) && (/KANDY\s*TILE/.test(alt) || /^KANDY\s*TILE\.?$/.test(ownText))) ||
        /^KANDY\s*TILE\.?$/.test(ownText);
    });
    if(!logo) return;
    const anchor=logo.closest('a')||logo;
    anchor.classList.add('kandy-logo-tagline-anchor');
  }
  arrange();
  new MutationObserver(arrange).observe(document.body,{childList:true,subtree:true});
})();


// KANDY TILE fixed appearance: customer view white, Admin view dark.
// Lightweight observers avoid watching every catalogue mutation.
(function setKandyFixedPageAppearance() {
  if (window.__kandyFixedAppearanceReady) return;
  window.__kandyFixedAppearanceReady = true;

  const style = document.createElement('style');
  style.id = 'kandy-fixed-appearance-style';
  style.textContent = `
    body:not(.kandy-admin-area) {
      background: #ffffff !important;
      background-color: #ffffff !important;
    }
    body.kandy-admin-area {
      background: #111827 !important;
      background-color: #111827 !important;
      color: #f3f4f6;
    }
    body.kandy-admin-area #login-panel,
    body.kandy-admin-area #dashboard,
    body.kandy-admin-area #dashboard .admin-panel,
    body.kandy-admin-area #dashboard .panel,
    body.kandy-admin-area #dashboard .card,
    body.kandy-admin-area #dashboard .stat-card,
    body.kandy-admin-area #dashboard .section,
    body.kandy-admin-area #dashboard .modal-content,
    body.kandy-admin-area #dashboard table,
    body.kandy-admin-area #dashboard tr {
      background-color: #1f2937 !important;
      border-color: #475569 !important;
      color: #f3f4f6;
    }
    body.kandy-admin-area #login-panel input,
    body.kandy-admin-area #dashboard input:not([type="checkbox"]),
    body.kandy-admin-area #dashboard select,
    body.kandy-admin-area #dashboard textarea {
      background: #111827 !important;
      border-color: #64748b !important;
      color: #f9fafb !important;
    }
    body.kandy-admin-area #dashboard button:not(.primary):not(.danger) {
      background-color: #334155;
      border-color: #64748b;
      color: #f9fafb;
    }
  `;
  document.head.appendChild(style);

  let panelObserver = null;
  function updateArea() {
    const login = document.getElementById('login-panel');
    const dashboard = document.getElementById('dashboard');
    const visible = el => {
      if (!el || el.hidden || el.classList.contains('hide')) return false;
      const css = getComputedStyle(el);
      return css.display !== 'none' && css.visibility !== 'hidden';
    };
    const adminPage = visible(login) || visible(dashboard);
    document.body.classList.toggle('kandy-admin-area', adminPage);
    document.body.classList.remove('kandy-theme-dark');
    const oldSwitch = document.getElementById('kandy-theme-switch');
    if (oldSwitch) oldSwitch.remove();

    if (panelObserver) panelObserver.disconnect();
    panelObserver = new MutationObserver(updateArea);
    [login, dashboard].filter(Boolean).forEach(el => {
      panelObserver.observe(el, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    });
  }

  updateArea();

  // Only detect insertion/removal of the two Admin panels; ignore catalogue updates.
  const structureObserver = new MutationObserver(records => {
    let relevant = false;
    for (const record of records) {
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (node.nodeType !== 1) continue;
        if (node.id === 'login-panel' || node.id === 'dashboard' ||
            node.querySelector?.('#login-panel, #dashboard')) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) updateArea();
  });
  structureObserver.observe(document.body, { childList: true, subtree: true });
})();
