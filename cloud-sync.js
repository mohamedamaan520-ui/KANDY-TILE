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
    form.innerHTML = '<input type="text" id="cloud-email" autocomplete="username" placeholder="Username" required><input type="password" id="password" autocomplete="current-password" placeholder="Password" minlength="6" required><button class="primary" id="cloud-login" type="submit">Sign in</button>';
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent = 'Sign in with your username and password. Main Admin (amaan) and staff accounts created by Main Admin are allowed.';
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
      const loginName = $('cloud-email').value.trim().toLowerCase();
      const password = $('password').value;
      if (!loginName) return msg('Enter your username.');
      const email = loginName.includes('@')
        ? loginName
        : (['amaan', 'mohamedamaan520'].includes(loginName) ? ADMIN_EMAIL : loginName + '@kandytile.invalid');
      $('cloud-login').disabled = true;
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await activateAdmin(data.session);
      } catch (err) { msg(friendly(err)); }
      finally { if ($('cloud-login')) $('cloud-login').disabled = false; }
    };
  }

  async function staffAdminRequest(body) {
    const { data, error } = await client.functions.invoke('catalog-staff-admin', { body });
    if (error) {
      let detail = error.message || 'Staff request failed.';
      try {
        const response = error.context;
        if (response && typeof response.clone === 'function') {
          const payload = await response.clone().json();
          detail = payload?.error || payload?.message || detail;
        }
      } catch (_) {}
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function showStaffManager() {
    const dashboard = $('dashboard');
    if (!dashboard || $('catalog-staff-manager')) return;
    const panel = document.createElement('section');
    panel.id = 'catalog-staff-manager';
    panel.className = 'admin-panel';
    panel.style.marginTop = '16px';
    panel.innerHTML = `
      <h3>Main Admin — Staff Login Accounts</h3>
      <p class="notice">Only Main Admin can create or remove staff usernames and passwords.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">
        <input id="staff-new-username" type="text" autocomplete="off" maxlength="32" placeholder="New username (3–32 characters)">
        <input id="staff-new-password" type="password" autocomplete="new-password" minlength="6" maxlength="72" placeholder="Password (minimum 6 characters)">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button type="button" class="primary" id="staff-create-btn">Create Staff Login</button>
        <button type="button" id="staff-refresh-btn">Refresh Users</button>
      </div>
      <p id="staff-manager-message" class="notice" aria-live="polite"></p>
      <div id="staff-user-list" style="display:grid;gap:8px;margin-top:10px"></div>`;
    const firstPanel = dashboard.querySelector('.admin-panel');
    if (firstPanel) firstPanel.insertAdjacentElement('afterend', panel);
    else dashboard.prepend(panel);

    const message = text => { const el = $('staff-manager-message'); if (el) el.textContent = text; };
    const loadUsers = async () => {
      try {
        const result = await staffAdminRequest({ action: 'list' });
        const list = $('staff-user-list');
        list.replaceChildren();
        (result.users || []).forEach(user => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid rgba(140,190,210,.35);border-radius:10px;flex-wrap:wrap';
          const label = document.createElement('strong');
          label.textContent = user.username;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = 'Delete';
          remove.addEventListener('click', async () => {
            if (!confirm('Delete staff login "' + user.username + '"? This will disable that account.')) return;
            remove.disabled = true;
            try { await staffAdminRequest({ action: 'delete', user_id: user.user_id }); message('Staff account deleted.'); await loadUsers(); }
            catch (err) { message(friendly(err)); remove.disabled = false; }
          });
          row.append(label, remove);
          list.append(row);
        });
        if (!(result.users || []).length) list.textContent = 'No staff accounts created yet.';
      } catch (err) { message('Could not load staff accounts: ' + friendly(err)); }
    };
    $('staff-create-btn').addEventListener('click', async () => {
      const username = $('staff-new-username').value.trim();
      const password = $('staff-new-password').value;
      if (!username || !password) return message('Enter both username and password.');
      const button = $('staff-create-btn');
      button.disabled = true;
      try {
        await staffAdminRequest({ action: 'create', username, password });
        $('staff-new-username').value = '';
        $('staff-new-password').value = '';
        message('Staff login created. Share the username and password privately with that staff member.');
        await loadUsers();
      } catch (err) { message(friendly(err)); }
      finally { button.disabled = false; }
    });
    $('staff-refresh-btn').addEventListener('click', loadUsers);
    await loadUsers();
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
    if ((session.user?.email || '').toLowerCase() === ADMIN_EMAIL) {
      showStaffManager().catch(err => console.error('Staff manager:', err));
    }
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

  // Preserve the uploaded file's original bytes, dimensions, format and quality.
  // Re-encoding through canvas would damage quality and can remove GIF animation
  // or change SVG/AVIF content. Use a lossless optimizer only in a later upgrade.
  function imageExtension(blob) {
    const types = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'image/avif': 'avif',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
      'image/x-icon': 'ico',
      'image/heic': 'heic',
      'image/heif': 'heif'
    };
    return types[(blob.type || '').toLowerCase()] || 'img';
  }

  async function uploadTileImage(tile) {
    if (!tile.image || !tile.image.startsWith('data:')) {
      if (tile.cloudPath) return tile.cloudPath;
      throw new Error('Image data missing for tile ' + tile.number);
    }

    const blob = await dataUrlBlob(tile.image);
    if (!blob.type || !blob.type.startsWith('image/')) {
      throw new Error('Please choose a valid image file. This image format was not recognised by your browser.');
    }

    const path = 'tiles/' +
      tile.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.' +
      imageExtension(blob);

    const { error } = await client.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type,
      upsert: true,
      cacheControl: '3600'
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
    // Cloud admins save directly to Supabase. Avoid writing the same large
    // catalogue into browser localStorage, which can exceed the browser quota.
    if (isCloudAdmin) {
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


/* Image upload picker: allow browser-supported image formats. */
(function(){
  if(window.__kandyImagePickerFormatFix)return;
  window.__kandyImagePickerFormatFix=true;
  function fix(){
    document.querySelectorAll('input[type="file"][accept]').forEach(function(input){
      var a=(input.getAttribute('accept')||'').toLowerCase();
      if(a.indexOf('image')!==-1 || /\.jpe?g|\.png|\.webp|\.gif|\.bmp/.test(a)) input.setAttribute('accept','image/*');
    });
  }
  fix();
  new MutationObserver(fix).observe(document.documentElement,{childList:true,subtree:true});
})();


/* KANDY TILE logo click: return to the public home page (viewer + admin). */
(function addKandyLogoHomeLink(){
  if (window.__kandyLogoHomeLinkV2) return;
  window.__kandyLogoHomeLinkV2 = true;
  const selectors = [
    '.kandy-admin-brand', '.kandy-logo', '.site-logo', '.brand-logo',
    '#logo', '#site-logo', '[data-home-logo]', 'header .logo', 'nav .logo',
    'header [class*="brand" i]', 'header [class*="logo" i]',
    'nav [class*="brand" i]', 'nav [class*="logo" i]',
    'header img', 'header svg', 'nav img[alt*="kandy" i]',
    'a[aria-label*="logo" i]', 'img[alt*="logo" i]',
    'img[alt*="kandy" i]', 'img[src*="logo" i]'
  ];
  const selector = selectors.join(',');
  const style = document.createElement('style');
  style.textContent = selector + '{cursor:pointer}' +
    selector + ':focus-visible{outline:3px solid #d8b56d;outline-offset:4px}';
  document.head.appendChild(style);
  function goHome(event) {
    const logo = event.target && event.target.closest ? event.target.closest(selector) : null;
    if (!logo) return;
    // Do not hijack unrelated images/icons inside navigation controls.
    if (logo.closest('button,[role="button"]') && !logo.matches('img,svg')) return;
    event.preventDefault();
    event.stopPropagation();
    const home = new URL('./', window.location.href);
    window.location.assign(home.href);
  }
  document.addEventListener('click', goHome, true);
})();


/* KANDY TILE installable app (PWA) — works on supported phones and PCs. */
(function kandyTileInstallableApp(){
  if (window.__kandyTilePwaV1) return;
  window.__kandyTilePwaV1 = true;

  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = new URL('./manifest.json', window.location.href).href;
  document.head.appendChild(manifest);

  const theme = document.createElement('meta');
  theme.name = 'theme-color';
  theme.content = '#153c4a';
  document.head.appendChild(theme);

  const apple = document.createElement('meta');
  apple.name = 'apple-mobile-web-app-capable';
  apple.content = 'yes';
  document.head.appendChild(apple);

  const appleTitle = document.createElement('meta');
  appleTitle.name = 'apple-mobile-web-app-title';
  appleTitle.content = 'KANDY TILE';
  document.head.appendChild(appleTitle);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function(){
      navigator.serviceWorker.register(new URL('./service-worker.js', window.location.href), {scope:'./'})
        .catch(function(error){ console.warn('KANDY TILE app setup:', error); });
    }, {once:true});
  }

  let installPrompt = null;
  let installButton = null;
  function makeInstallButton(){
    if (installButton || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;
    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.id = 'kandy-install-app';
    installButton.innerHTML = '<img src="./kandy-tile-icon.svg" alt="" style="width:23px;height:23px;border-radius:6px"> <span>Install KANDY TILE</span>';
    installButton.style.cssText = 'position:fixed;left:18px;right:auto;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:9px;padding:11px 15px;border:1px solid #d8b56d;border-radius:999px;background:linear-gradient(135deg,#153c4a,#071c29);color:#fff;font:700 13px Arial,sans-serif;box-shadow:0 6px 22px #00182455;cursor:pointer';
    installButton.addEventListener('click', async function(){
      if (installPrompt) {
        installPrompt.prompt();
        try { await installPrompt.userChoice; } catch (_) {}
        installPrompt = null;
        installButton.remove();
        installButton = null;
      } else {
        alert('To install KANDY TILE:\n\nAndroid: Open browser menu (⋮) and choose Install app / Add to Home screen.\niPhone: Tap Share and choose Add to Home Screen.\nWindows PC: Click the Install icon in the browser address bar, or open the browser menu and choose Apps → Install this site as an app.');
      }
    });
    document.body.appendChild(installButton);
  }
  window.addEventListener('beforeinstallprompt', function(event){
    event.preventDefault();
    installPrompt = event;
    makeInstallButton();
  });
  window.addEventListener('appinstalled', function(){
    if (installButton) installButton.remove();
    installButton = null;
    installPrompt = null;
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', makeInstallButton, {once:true});
  else makeInstallButton();
})();



/* KANDY TILE PDF export — select complete folders or individual product designs. */
(function kandyTilePdfExport(){
  if (window.__kandyTilePdfExportV1) return;
  window.__kandyTilePdfExportV1 = true;

  const css = document.createElement('style');
  css.id = 'kandy-export-style';
  css.textContent = `
    #kandy-export-open{position:fixed;right:18px;bottom:20px;z-index:2147482000;display:flex;align-items:center;gap:9px;padding:12px 18px;border:1px solid #d7b66f;border-radius:999px;background:linear-gradient(135deg,#173e4b,#071d2b);color:#fff;font:800 13px Arial,sans-serif;letter-spacing:1px;box-shadow:0 8px 26px #061b2c55;cursor:pointer}
    #kandy-export-open svg{width:19px;height:19px}
    #kandy-export-open:hover{transform:translateY(-2px);box-shadow:0 12px 30px #061b2c77}
    #kandy-export-overlay{position:fixed;inset:0;z-index:2147482500;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(2,14,24,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
    #kandy-export-overlay.open{display:flex}
    #kandy-export-dialog{width:min(920px,100%);max-height:min(92vh,900px);overflow:hidden;display:flex;flex-direction:column;background:#f8fafb;color:#142b37;border:1px solid #d7b66f;border-radius:20px;box-shadow:0 25px 80px #0008}
    #kandy-export-dialog *{box-sizing:border-box}
    .kexp-head{padding:17px 20px;background:linear-gradient(120deg,#123846,#071d2b);color:white;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .kexp-head h2{margin:0;font-size:19px;letter-spacing:1px}.kexp-head p{margin:5px 0 0;color:#d9e7eb;font-size:12px}
    .kexp-close{border:0;background:#ffffff20;color:white;border-radius:10px;width:38px;height:38px;font-size:24px;cursor:pointer}
    .kexp-toolbar{padding:13px 17px;display:flex;flex-wrap:wrap;gap:9px;align-items:center;border-bottom:1px solid #dce5e9}
    .kexp-search{flex:1;min-width:160px;padding:10px 12px;border:1px solid #cbd7dc;border-radius:10px;font-size:14px}
    .kexp-action{padding:9px 12px;border:1px solid #bdcbd1;border-radius:10px;background:white;color:#173746;font-weight:700;cursor:pointer}
    .kexp-count{margin-left:auto;font-size:12px;font-weight:700;color:#315565}
    .kexp-body{padding:15px 17px;overflow:auto;min-height:180px}
    .kexp-section-title{margin:0 0 10px;font-size:13px;color:#315565;text-transform:uppercase;letter-spacing:1px}
    .kexp-folders{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:17px}
    .kexp-folder{display:flex;align-items:center;gap:7px;padding:7px 9px;background:#eaf1f4;border:1px solid #d5e0e5;border-radius:10px;font-size:13px}
    .kexp-folder input,.kexp-card input{accent-color:#176c82;width:17px;height:17px}
    .kexp-folder-filter{border:0;background:transparent;color:#173746;font:700 13px Arial,sans-serif;cursor:pointer;padding:3px;text-align:left}
    .kexp-folder-filter.active{color:#087e9b;text-decoration:underline;text-underline-offset:3px}
    .kexp-all-folders{padding:9px 11px;border:1px solid #d5e0e5;border-radius:10px;background:#fff;color:#173746;font-weight:700;cursor:pointer}
    .kexp-all-folders.active{background:#d8edf2;border-color:#19788b}
    .kexp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(142px,1fr));gap:11px}
    .kexp-card{position:relative;min-width:0;border:1px solid #d9e2e6;border-radius:12px;background:white;overflow:hidden;cursor:pointer}
    .kexp-card.selected{border:2px solid #19788b;box-shadow:0 0 0 2px #19788b20}
    .kexp-card img{display:block;width:100%;height:112px;object-fit:cover;background:#edf2f4}
    .kexp-card-info{padding:8px 9px;display:flex;gap:7px;align-items:flex-start;font-size:12px;line-height:1.35}
    .kexp-card-info span{overflow-wrap:anywhere}
    .kexp-empty{padding:28px;text-align:center;color:#607680}
    .kexp-footer{padding:13px 17px;border-top:1px solid #dce5e9;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff}
    .kexp-footer small{color:#5d727c}.kexp-export{padding:12px 18px;border:0;border-radius:11px;background:linear-gradient(135deg,#176d82,#123c4b);color:#fff;font-weight:800;cursor:pointer}
    .kexp-export:disabled{opacity:.55;cursor:wait}
    @media(max-width:560px){#kandy-export-open{right:12px;bottom:13px;padding:11px 14px}.kexp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.kexp-head{padding:14px}.kexp-body{padding:12px}.kexp-footer{align-items:flex-start;flex-direction:column}.kexp-export{width:100%}}
  `;
  document.head.appendChild(css);

  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v3h14v-3"/></svg>';
  const open = document.createElement('button');
  open.type = 'button'; open.id = 'kandy-export-open'; open.innerHTML = icon + '<span>EXPORT</span>';
  open.setAttribute('aria-label','Export selected tile designs to PDF');
  document.body.appendChild(open);

  const overlay = document.createElement('div');
  overlay.id = 'kandy-export-overlay';
  overlay.innerHTML = `
    <section id="kandy-export-dialog" role="dialog" aria-modal="true" aria-labelledby="kexp-title">
      <header class="kexp-head"><div><h2 id="kexp-title">KANDY TILE — EXPORT</h2><p>Select complete folders or individual tile designs for your PDF.</p></div><button type="button" class="kexp-close" aria-label="Close">×</button></header>
      <div class="kexp-toolbar"><input class="kexp-search" type="search" placeholder="Search folder, tile number or code…" aria-label="Search tile designs"><button type="button" class="kexp-action" data-kexp="all">Select all</button><button type="button" class="kexp-action" data-kexp="clear">Clear</button><span class="kexp-count">0 selected</span></div>
      <div class="kexp-body"><h3 class="kexp-section-title">Select folders</h3><div class="kexp-folders"></div><h3 class="kexp-section-title">Select individual designs</h3><div class="kexp-grid"></div></div>
      <footer class="kexp-footer"><small>Each selected design will be placed on its own PDF page.</small><button type="button" class="kexp-export" data-kexp="download">CREATE PDF &amp; DOWNLOAD</button></footer>
    </section>`;
  document.body.appendChild(overlay);

  const $ = selector => overlay.querySelector(selector);
  const selected = new Set();
  let filteredTiles = [];
  let activeFolder = null;
  let busy = false;

  function allTiles(){ return (typeof tiles !== 'undefined' && Array.isArray(tiles)) ? tiles.filter(t => t && t.image) : []; }
  function allFolders(){ return (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders : [...new Set(allTiles().map(t => t.folder).filter(Boolean))]; }
  function safeText(value){ return String(value == null ? '' : value); }
  function tileKey(tile){ return String(tile.id || tile.image); }
  function visibleViewer(){
    const dashboard=document.getElementById('dashboard');
    const admin=document.getElementById('admin');
    return !(admin && !admin.classList.contains('hide'));
  }
  function updateVisibility(){ open.style.display=visibleViewer()?'flex':'none'; }
  function updateCount(){ $('.kexp-count').textContent=selected.size+' selected'; }
  function render(){
    const q=$('.kexp-search').value.trim().toLowerCase();
    const list=allTiles();
    filteredTiles=list.filter(t=>(activeFolder===null || safeText(t.folder)===activeFolder) && (safeText(t.folder)+' '+safeText(t.number)+' '+safeText(t.code)).toLowerCase().includes(q));
    const folderBox=$('.kexp-folders');
    folderBox.innerHTML='';
    const allButton=document.createElement('button');
    allButton.type='button';allButton.className='kexp-all-folders'+(activeFolder===null?' active':'');
    allButton.textContent='All folders';
    allButton.addEventListener('click',()=>{activeFolder=null;render();});
    folderBox.append(allButton);
    allFolders().forEach((folder)=>{
      const members=list.filter(t=>safeText(t.folder)===safeText(folder));
      if(q && !members.some(t=>(safeText(t.folder)+' '+safeText(t.number)+' '+safeText(t.code)).toLowerCase().includes(q)) && !safeText(folder).toLowerCase().includes(q)) return;
      const checked=members.length>0 && members.every(t=>selected.has(tileKey(t)));
      const wrap=document.createElement('div');wrap.className='kexp-folder';
      const input=document.createElement('input');input.type='checkbox';input.checked=checked;input.dataset.folder=String(folder);input.setAttribute('aria-label','Select all designs in '+safeText(folder));
      const filter=document.createElement('button');filter.type='button';filter.className='kexp-folder-filter'+(activeFolder===safeText(folder)?' active':'');filter.textContent=safeText(folder)+' ('+members.length+')';filter.dataset.filterFolder=String(folder);
      wrap.append(input,filter);folderBox.append(wrap);
    });
    const grid=$('.kexp-grid');grid.innerHTML='';
    if(!filteredTiles.length){grid.innerHTML='<div class="kexp-empty">No tile designs found.</div>';updateCount();return;}
    filteredTiles.forEach(tile=>{
      const key=tileKey(tile);const card=document.createElement('label');card.className='kexp-card'+(selected.has(key)?' selected':'');
      const img=document.createElement('img');img.loading='lazy';img.src=tile.image;img.alt='Tile '+safeText(tile.number);img.referrerPolicy='no-referrer';
      const info=document.createElement('div');info.className='kexp-card-info';
      const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(key);input.dataset.tile=key;
      const caption=document.createElement('span');caption.textContent=[tile.folder,tile.number?'#'+tile.number:'',tile.code].filter(Boolean).join(' · ')||'Tile design';
      info.append(input,caption);card.append(img,info);grid.append(card);
    });
    updateCount();
  }

  function close(){overlay.classList.remove('open');}
  open.addEventListener('click',()=>{selected.clear();activeFolder=null;$('.kexp-search').value='';render();overlay.classList.add('open');});
  overlay.querySelector('.kexp-close').addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay.classList.contains('open'))close();});
  $('.kexp-search').addEventListener('input',render);
  overlay.addEventListener('click',e=>{
    const filter=e.target.closest('[data-filter-folder]');
    if(filter){activeFolder=filter.dataset.filterFolder;render();}
  });
  overlay.addEventListener('change',e=>{
    const input=e.target;
    if(input.matches('input[data-folder]')){
      const folder=input.dataset.folder;
      allTiles().filter(t=>safeText(t.folder)===folder).forEach(t=>input.checked?selected.add(tileKey(t)):selected.delete(tileKey(t)));
      render();
    }else if(input.matches('input[data-tile]')){
      input.checked?selected.add(input.dataset.tile):selected.delete(input.dataset.tile);
      render();
    }
  });
  overlay.addEventListener('click',e=>{
    const action=e.target.closest('[data-kexp]')?.dataset.kexp;
    if(action==='all'){allTiles().forEach(t=>selected.add(tileKey(t)));render();}
    if(action==='clear'){selected.clear();render();}
    if(action==='download')createPdf(false);
  });

  function loadJsPdf(){
    if(window.jspdf?.jsPDF)return Promise.resolve(window.jspdf.jsPDF);
    if(window.__kandyJsPdfLoading)return window.__kandyJsPdfLoading;
    window.__kandyJsPdfLoading=(async()=>{
      const sources=[
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
        'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js'
      ];
      let lastError=null;
      for(const src of sources){
        try{
          await new Promise((resolve,reject)=>{
            const script=document.createElement('script');
            const timer=setTimeout(()=>{script.remove();reject(new Error('PDF library loading timed out.'));},15000);
            script.src=src;
            script.onload=()=>{clearTimeout(timer);window.jspdf?.jsPDF?resolve():reject(new Error('PDF library did not initialise.'));};
            script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Could not load '+new URL(src).hostname));};
            document.head.appendChild(script);
          });
          if(window.jspdf?.jsPDF)return window.jspdf.jsPDF;
        }catch(error){lastError=error;console.warn('KANDY TILE PDF CDN fallback:',src,error);}
      }
      throw new Error('PDF library could not load from the available sources. Please check your internet connection or allow cdn.jsdelivr.net / unpkg.com / cdnjs.cloudflare.com. '+(lastError?.message||''));
    })().catch(error=>{window.__kandyJsPdfLoading=null;throw error;});
    return window.__kandyJsPdfLoading;
  }
  async function imageToPng(url){
    const response=await fetch(url,{mode:'cors',cache:'default'});
    if(!response.ok)throw new Error('A tile image could not be downloaded ('+response.status+').');
    const blob=await response.blob();
    const objectUrl=URL.createObjectURL(blob);
    try{
      const img=new Image();img.decoding='async';img.src=objectUrl;
      if(img.decode)await img.decode();else await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;});
      const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
      if(!w||!h)throw new Error('An image has invalid dimensions.');
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{alpha:true});ctx.drawImage(img,0,0,w,h);
      return {data:canvas.toDataURL('image/png'),width:w,height:h};
    }finally{URL.revokeObjectURL(objectUrl);}
  }
  async function createPdf(shareAfter){
    if(busy)return;
    const chosen=allTiles().filter(t=>selected.has(tileKey(t)));
    if(!chosen.length){alert('Please select at least one folder or tile design.');return;}
    busy=true;const button=$('.kexp-export');button.disabled=true;button.textContent='PREPARING PDF…';
    try{
      const JsPDF=await loadJsPdf();
      let doc=null;
      for(let i=0;i<chosen.length;i++){
        const tile=chosen[i];const image=await imageToPng(tile.image);
        const landscape=image.width>image.height;
        const pageW=landscape?842:595,pageH=landscape?595:842;
        if(!doc)doc=new JsPDF({orientation:landscape?'landscape':'portrait',unit:'pt',format:'a4',compress:true});
        else doc.addPage('a4',landscape?'landscape':'portrait');
        const margin=26,header=46,footer=25;
        const maxW=pageW-margin*2,maxH=pageH-header-footer-margin;
        const scale=Math.min(maxW/image.width,maxH/image.height);
        const drawW=image.width*scale,drawH=image.height*scale;
        const x=(pageW-drawW)/2,y=header+(maxH-drawH)/2;
        doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(20,55,68);
        const label=['KANDY TILE',tile.folder,tile.number?'#'+tile.number:'',tile.code].filter(Boolean).join('  |  ');
        doc.text(label.slice(0,110),margin,28,{maxWidth:pageW-margin*2});
        doc.addImage(image.data,'PNG',x,y,drawW,drawH,undefined,'FAST');
        doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(110,125,132);
        doc.text((i+1)+' / '+chosen.length,pageW-margin,pageH-13,{align:'right'});
      }
      const blob=doc.output('blob');
      const file=new File([blob],'KANDY-TILE-Export-'+new Date().toISOString().slice(0,10)+'.pdf',{type:'application/pdf'});
      if(shareAfter && navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:'KANDY TILE Designs',text:'Selected KANDY TILE designs'});
      }else{
        const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
        if(shareAfter)alert('PDF downloaded. You can now share it from your Downloads folder.');
      }
    }catch(error){console.error('KANDY TILE PDF export:',error);alert('PDF export failed: '+(error.message||error));}
    finally{busy=false;button.disabled=false;button.textContent='CREATE PDF & DOWNLOAD';}
  }

  const shareButton=document.createElement('button');
  shareButton.type='button';shareButton.className='kexp-action';shareButton.textContent='Share PDF';
  shareButton.addEventListener('click',()=>createPdf(true));
  $('.kexp-footer').insertBefore(shareButton,$('.kexp-export'));
  const observer=new MutationObserver(updateVisibility);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  updateVisibility();
})();


/* Colourful premium styling for the public catalogue hero only. */
(function stylePublicCatalogueHero(){
  if (window.__kandyPublicHeroColourV1) return;
  window.__kandyPublicHeroColourV1 = true;
  function apply(){
    if (document.getElementById('kandy-public-hero-colour-style')) return;
    const headings = Array.from(document.querySelectorAll('h1,h2')).filter(el =>
      /REFLECT\\s+YOUR\\s+DREAM\\.?/i.test((el.textContent || '').trim())
    );
    const heading = headings[0];
    if (!heading) return;
    let hero = heading.parentElement;
    while (hero && hero !== document.body) {
      const txt = (hero.innerText || '').replace(/\\s+/g,' ');
      if (/Explore our tile collections/i.test(txt) && /035\\s*222\\s*3333/.test(txt) && /071\\s*3?\\s*222\\s*888/.test(txt)) break;
      hero = hero.parentElement;
    }
    if (!hero || hero === document.body) return;
    hero.classList.add('kandy-public-colour-hero');
    const style = document.createElement('style');
    style.id = 'kandy-public-hero-colour-style';
    style.textContent = `
      .kandy-public-colour-hero{
        position:relative!important;isolation:isolate!important;overflow:hidden!important;
        border:1px solid rgba(255,255,255,.16)!important;
        border-radius:26px!important;
        background:
          radial-gradient(ellipse at 7% 8%,rgba(255,70,130,.62),transparent 38%),
          radial-gradient(ellipse at 92% 4%,rgba(255,177,66,.48),transparent 34%),
          radial-gradient(ellipse at 82% 92%,rgba(0,224,190,.48),transparent 40%),
          radial-gradient(ellipse at 35% 100%,rgba(104,91,255,.48),transparent 42%),
          radial-gradient(ellipse at 52% 28%,rgba(255,255,255,.13),transparent 48%),
          linear-gradient(118deg,#251044 0%,#52205d 28%,#153f69 62%,#075b60 100%)!important;
        box-shadow:0 18px 55px rgba(14,18,50,.28),inset 0 1px 0 rgba(255,255,255,.18)!important;
      }
      .kandy-public-colour-hero:before{
        content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
        background:linear-gradient(115deg,transparent 12%,rgba(255,255,255,.07) 48%,transparent 78%);
      }
      .kandy-public-colour-hero h1{
        color:#fff!important;
        background:linear-gradient(95deg,#fff 0%,#ffe08a 30%,#ff8fbd 62%,#8fe9ff 100%);
        -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
        text-shadow:0 8px 30px rgba(255,125,180,.12)!important;
        letter-spacing:-.035em!important;
      }
      .kandy-public-colour-hero a[href^="tel:"],
      .kandy-public-colour-hero a[href*="wa.me"],
      .kandy-public-colour-hero a[href*="whatsapp"]{
        border-radius:13px!important;box-shadow:0 7px 18px rgba(0,0,0,.18)!important;
        transition:transform .2s ease,box-shadow .2s ease!important;
      }
      .kandy-public-colour-hero a[href^="tel:"]:hover,
      .kandy-public-colour-hero a[href*="wa.me"]:hover,
      .kandy-public-colour-hero a[href*="whatsapp"]:hover{
        transform:translateY(-2px)!important;box-shadow:0 11px 24px rgba(0,0,0,.25)!important;
      }
      .kandy-public-colour-hero img{
        filter:drop-shadow(0 12px 18px rgba(0,0,0,.28));
      }
      @media(max-width:640px){
        .kandy-public-colour-hero{border-radius:18px!important}
      }
    `;
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  const observer = new MutationObserver(() => apply());
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
