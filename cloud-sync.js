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


/* Refined typography and finish for the public catalogue hero only. */
(function stylePublicCatalogueHero(){
  if (window.__kandyPublicHeroColourV2) return;
  window.__kandyPublicHeroColourV2 = true;
  function apply(){
    if (document.getElementById('kandy-public-hero-colour-style')) return;
    const heading = Array.from(document.querySelectorAll('h1,h2')).find(el =>
      /REFLECT\s+YOUR\s+DREAM\.?/i.test((el.textContent || '').trim())
    );
    if (!heading) return;
    let hero = heading.parentElement;
    while (hero && hero !== document.body) {
      const txt = (hero.innerText || '').replace(/\s+/g,' ');
      if (/Explore our tile collections/i.test(txt) && /035\s*222\s*3333/.test(txt) && /071\s*3?\s*222\s*888/.test(txt)) break;
      hero = hero.parentElement;
    }
    if (!hero || hero === document.body) return;
    hero.classList.add('kandy-public-colour-hero');
    const style = document.createElement('style');
    style.id = 'kandy-public-hero-colour-style';
    style.textContent = `
      .kandy-public-colour-hero h1{
        font-family:Arial,Helvetica,sans-serif!important;
        font-weight:900!important;
        letter-spacing:-.045em!important;
        line-height:1.04!important;
        filter:drop-shadow(0 5px 13px rgba(12,8,35,.24));
      }
      .kandy-public-colour-hero p{
        line-height:1.72!important;
        text-shadow:0 1px 8px rgba(10,8,30,.22);
      }
      .kandy-public-colour-hero a[href^="tel:"],
      .kandy-public-colour-hero a[href*="wa.me"],
      .kandy-public-colour-hero a[href*="whatsapp"]{
        font-weight:800!important;
        letter-spacing:.01em!important;
        border:1px solid rgba(255,255,255,.24)!important;
        box-shadow:0 7px 18px rgba(0,0,0,.20),inset 0 1px 0 rgba(255,255,255,.22)!important;
        transition:filter .2s ease,box-shadow .2s ease!important;
      }
      .kandy-public-colour-hero a[href^="tel:"]:hover,
      .kandy-public-colour-hero a[href*="wa.me"]:hover,
      .kandy-public-colour-hero a[href*="whatsapp"]:hover{
        filter:brightness(1.08)!important;
        box-shadow:0 10px 24px rgba(0,0,0,.26)!important;
      }
      .kandy-public-colour-hero button,
      .kandy-public-colour-hero a:not([href^="tel:"]):not([href*="wa.me"]):not([href*="whatsapp"]){
        transition:filter .18s ease,background-color .18s ease!important;
      }
      .kandy-public-colour-hero button:hover,
      .kandy-public-colour-hero a:not([href^="tel:"]):not([href*="wa.me"]):not([href*="whatsapp"]):hover{
        filter:brightness(1.16)!important;
      }
    `;
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  const observer = new MutationObserver(() => apply());
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();


/* Public catalogue hero: small style refinement and requested tile-count label. */
(function refinePublicCatalogueHero(){
  if (window.__kandyPublicHeroRefineV2) return;
  window.__kandyPublicHeroRefineV2 = true;
  function apply(){
    const heading = Array.from(document.querySelectorAll('h1,h2')).find(el =>
      /REFLECT\s+YOUR\s+DREAM\.?/i.test((el.textContent || '').trim())
    );
    if (!heading) return;
    let hero = heading.parentElement;
    while (hero && hero !== document.body) {
      const txt = (hero.innerText || '').replace(/\s+/g,' ');
      if (/Explore our tile collections/i.test(txt) &&
          /035\s*222\s*3333/.test(txt) &&
          /071\s*3?\s*222\s*888/.test(txt)) break;
      hero = hero.parentElement;
    }
    if (!hero || hero === document.body) return;
    hero.classList.add('kandy-public-colour-hero');

    // Update only the tile-count wording inside this public hero.
    const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (/\b157\s+tile\s+designs\b/i.test(node.nodeValue || '')) {
        node.nodeValue = node.nodeValue.replace(/\b157\s+tile\s+designs\b/i, '167 tile designs');
      }
    }

    if (document.getElementById('kandy-public-hero-refine-style')) return;
    const style = document.createElement('style');
    style.id = 'kandy-public-hero-refine-style';
    style.textContent = `
      .kandy-public-colour-hero{
        position:relative!important;isolation:isolate!important;overflow:hidden!important;
        background:
          linear-gradient(132deg,transparent 0 57%,rgba(221,180,83,.10) 57.2%,transparent 57.7%),
          linear-gradient(42deg,transparent 0 72%,rgba(231,194,105,.18) 72.2%,transparent 72.7%),
          radial-gradient(ellipse at 86% 48%,rgba(173,133,48,.18),transparent 38%),
          linear-gradient(112deg,#050505 0%,#101010 58%,#050505 100%)!important;
        border:1px solid rgba(211,174,91,.42)!important;border-radius:0!important;
        box-shadow:0 18px 42px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,224,153,.16)!important;
      }
      .kandy-public-colour-hero:before,.kandy-public-colour-hero:after{
        content:"";position:absolute;z-index:-1;pointer-events:none;height:2px;
        background:linear-gradient(90deg,transparent,#f7dc8b,#b78b35,transparent);
        filter:drop-shadow(0 0 7px rgba(245,205,105,.75));
      }
      .kandy-public-colour-hero:before{left:0;right:34%;top:0;transform:skewY(-2deg)}
      .kandy-public-colour-hero:after{left:0;right:28%;bottom:0;transform:skewY(2deg)}
      .kandy-public-colour-hero h1{
        background:linear-gradient(100deg,#fff8df 0%,#f5d77e 48%,#fff1c2 100%);
        -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
        text-shadow:0 0 18px rgba(229,190,91,.18)!important;
      }
      .kandy-public-colour-hero a[href^="tel:"],.kandy-public-colour-hero a[href*="wa.me"],.kandy-public-colour-hero a[href*="whatsapp"]{
        background:linear-gradient(135deg,#171717,#292316)!important;border:1px solid #b9964d!important;color:#fff4cf!important;
      }
      .kandy-public-colour-hero a[href^="tel:"] svg,.kandy-public-colour-hero a[href*="wa.me"] svg,.kandy-public-colour-hero a[href*="whatsapp"] svg{color:#e6c36d!important}
      .kandy-public-colour-hero a[href^="tel:"],
      .kandy-public-colour-hero a[href*="wa.me"],
      .kandy-public-colour-hero a[href*="whatsapp"]{border-radius:14px!important}
      @media(max-width:640px){.kandy-public-colour-hero{border-radius:20px!important}}
    `;
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  const observer = new MutationObserver(() => apply());
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
})();


/* Continuous black-and-gold background for public intro and tile-cover only. */
(function stylePublicIntroAndCoverSection(){
 if(window.__kandyPublicIntroCoverGoldV2)return;
 window.__kandyPublicIntroCoverGoldV2=true;
 const norm=v=>(v||'').replace(/\s+/g,' ').trim().toLowerCase();
 function findText(test){
  return Array.from(document.querySelectorAll('body *')).filter(e=>e.children.length===0&&test(norm(e.textContent))).sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length)[0]||null;
 }
 function common(a,b){
  if(!a||!b)return null;
  const p=new Set();for(let n=a;n;n=n.parentElement)p.add(n);
  for(let n=b;n;n=n.parentElement)if(p.has(n))return n;
  return null;
 }
 function apply(){
  if(document.getElementById('kandy-public-intro-cover-gold-style'))return;
  const tests=[
   t=>t.includes('search by tile number or product code'),
   t=>t.includes('035 222 3333'),
   t=>t.includes('071 3 222 888')||t.includes('071 222 888'),
   t=>t.includes('160 tile designs')||t.includes('167 tile designs'),
   t=>t.includes('rambukkana'),
   t=>t.includes('mawanella'),
   t=>t.includes('tile collection cover')
  ];
  const anchors=tests.map(findText).filter(Boolean);
  if(anchors.length<5)return;
  let section=anchors[0];
  for(let j=1;j<anchors.length;j++)section=common(section,anchors[j]);
  if(!section||section===document.body||section===document.documentElement)return;
  let box=section;
  for(let n=section;n&&n!==document.body;n=n.parentElement){
   const r=n.getBoundingClientRect(),t=norm(n.innerText);
   if(r.width>=Math.min(window.innerWidth*.82,560)&&r.height>=220&&r.height<=1600&&
      t.includes('search by tile number or product code')&&t.includes('rambukkana')&&t.includes('mawanella')){box=n;break;}
  }
  box.classList.add('kandy-public-intro-cover-gold');
  anchors.slice(0,6).forEach(a=>{
   let n=a;
   for(let d=0;n&&n!==box&&d<5;d++,n=n.parentElement){
    const r=n.getBoundingClientRect();
    if(r.width>90&&r.width<box.getBoundingClientRect().width*.92&&r.height>18&&r.height<260){
     n.classList.add('kandy-public-intro-info-flat');break;
    }
   }
  });
  const st=document.createElement('style');st.id='kandy-public-intro-cover-gold-style';
  st.textContent='\
.kandy-public-intro-cover-gold{position:relative!important;isolation:isolate!important;overflow:hidden!important;box-sizing:border-box!important;background:radial-gradient(ellipse at 84% 32%,rgba(190,148,62,.20),transparent 38%),radial-gradient(ellipse at 12% 88%,rgba(150,111,42,.13),transparent 42%),linear-gradient(135deg,transparent 0 56%,rgba(224,188,105,.10) 56.2%,transparent 56.8%),linear-gradient(42deg,transparent 0 74%,rgba(224,188,105,.12) 74.2%,transparent 74.8%),linear-gradient(115deg,#030303 0%,#11100d 52%,#050505 100%)!important;border:1px solid rgba(211,174,91,.48)!important;border-radius:24px!important;box-shadow:0 18px 44px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,224,153,.14)!important}\
.kandy-public-intro-cover-gold:before,.kandy-public-intro-cover-gold:after{content:"";position:absolute;left:0;right:0;height:2px;pointer-events:none;z-index:0;background:linear-gradient(90deg,transparent 2%,#9c762e 22%,#f4d98d 50%,#9c762e 78%,transparent 98%);box-shadow:0 0 12px rgba(229,190,91,.42)}\
.kandy-public-intro-cover-gold:before{top:0}.kandy-public-intro-cover-gold:after{bottom:0}\
.kandy-public-intro-cover-gold>*{position:relative;z-index:1}\
.kandy-public-intro-cover-gold .kandy-public-intro-info-flat{background:transparent!important;background-color:transparent!important;border-color:transparent!important;box-shadow:none!important;outline:0!important}\
.kandy-public-intro-cover-gold .kandy-public-intro-info-flat:before,.kandy-public-intro-cover-gold .kandy-public-intro-info-flat:after{display:none!important}\
@media(max-width:640px){.kandy-public-intro-cover-gold{border-radius:18px!important}}';
  document.head.appendChild(st);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 const ob=new MutationObserver(()=>apply());ob.observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('resize',apply,{passive:true});
})();


/* Subtle premium polish for the public banner only. */
(function polishPublicBannerOnly(){
 if(window.__kandyPublicBannerPolishV1)return;
 window.__kandyPublicBannerPolishV1=true;
 function apply(){
  if(document.getElementById('kandy-public-banner-polish-style'))return;
  const st=document.createElement('style');
  st.id='kandy-public-banner-polish-style';
  st.textContent=`
   .kandy-public-intro-cover-gold{
    padding:clamp(18px,3vw,34px)!important;
    background:
     radial-gradient(ellipse at 50% -12%,rgba(245,211,132,.16),transparent 48%),
     radial-gradient(ellipse at 88% 72%,rgba(176,132,47,.17),transparent 34%),
     linear-gradient(135deg,rgba(255,255,255,.025),transparent 34%,rgba(226,187,99,.055) 70%,transparent),
     linear-gradient(115deg,#030303 0%,#12110e 52%,#050505 100%)!important;
    border:1px solid rgba(229,194,116,.66)!important;
    box-shadow:0 20px 48px rgba(0,0,0,.38),0 0 24px rgba(193,151,65,.12),inset 0 1px 0 rgba(255,239,196,.22),inset 0 -1px 0 rgba(178,133,48,.24)!important;
   }
   .kandy-public-intro-cover-gold h1,
   .kandy-public-intro-cover-gold h2,
   .kandy-public-intro-cover-gold h3{
    color:#f4d98d!important;
    text-shadow:0 2px 14px rgba(230,190,94,.22)!important;
    letter-spacing:.025em!important;
   }
   .kandy-public-intro-cover-gold p,
   .kandy-public-intro-cover-gold small,
   .kandy-public-intro-cover-gold span{
    text-shadow:0 1px 8px rgba(0,0,0,.24);
   }
   .kandy-public-intro-cover-gold a[href^="tel:"],
   .kandy-public-intro-cover-gold a[href*="wa.me"],
   .kandy-public-intro-cover-gold a[href*="whatsapp"]{
    border:1px solid rgba(235,199,117,.78)!important;
    background:linear-gradient(135deg,#201b10,#090909)!important;
    color:#ffe9b2!important;
    box-shadow:0 5px 16px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,239,196,.16)!important;
   }
   .kandy-public-intro-cover-gold img{
    border-color:rgba(221,184,101,.42)!important;
    box-shadow:0 10px 26px rgba(0,0,0,.32)!important;
   }
  `;
  document.head.appendChild(st);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 const ob=new MutationObserver(()=>apply());ob.observe(document.documentElement,{childList:true,subtree:true});
})();


/* Complete visual redesign of the public banner only. */
(function redesignPublicBannerOnly(){
 if(window.__kandyPublicBannerFullRedesignV1)return;
 window.__kandyPublicBannerFullRedesignV1=true;
 function apply(){
  if(document.getElementById('kandy-public-banner-full-redesign-style'))return;
  const st=document.createElement('style');
  st.id='kandy-public-banner-full-redesign-style';
  st.textContent=`
   .kandy-public-colour-hero,
   .kandy-public-intro-cover-gold{
    position:relative!important;isolation:isolate!important;overflow:hidden!important;
    background:
     radial-gradient(ellipse at 82% 18%,rgba(218,178,91,.20),transparent 30%),
     radial-gradient(ellipse at 10% 100%,rgba(141,102,35,.15),transparent 38%),
     linear-gradient(115deg,transparent 0 48%,rgba(241,210,143,.07) 48.2%,transparent 48.7%),
     linear-gradient(155deg,#050505 0%,#17150f 48%,#070707 100%)!important;
    border:1px solid rgba(221,184,101,.72)!important;
    border-radius:22px!important;
    box-shadow:0 24px 55px rgba(0,0,0,.42),0 0 30px rgba(203,163,79,.13),inset 0 1px 0 rgba(255,240,199,.24),inset 0 -1px 0 rgba(180,135,53,.28)!important;
   }
   .kandy-public-colour-hero:before,
   .kandy-public-intro-cover-gold:before{
    content:"";position:absolute;inset:8px;border:1px solid rgba(223,187,108,.24);
    border-radius:15px;pointer-events:none;z-index:0;
   }
   .kandy-public-colour-hero:after,
   .kandy-public-intro-cover-gold:after{
    content:"";position:absolute;left:7%;right:7%;top:0;height:2px;pointer-events:none;z-index:0;
    background:linear-gradient(90deg,transparent,#9e762e 18%,#fff0b9 50%,#9e762e 82%,transparent);
    box-shadow:0 0 16px rgba(245,211,132,.58);
   }
   .kandy-public-colour-hero>*,
   .kandy-public-intro-cover-gold>*{position:relative;z-index:1}
   .kandy-public-colour-hero h1,
   .kandy-public-intro-cover-gold h1{
    color:#fff0bd!important;
    background:linear-gradient(100deg,#fff9e8 0%,#e8c66e 42%,#fff0bd 72%,#bd9140 100%);
    -webkit-background-clip:text!important;background-clip:text!important;
    -webkit-text-fill-color:transparent!important;
    letter-spacing:.045em!important;
    text-shadow:0 5px 25px rgba(218,177,83,.18)!important;
   }
   .kandy-public-colour-hero h2,.kandy-public-colour-hero h3,
   .kandy-public-intro-cover-gold h2,.kandy-public-intro-cover-gold h3{
    color:#e9ca83!important;letter-spacing:.025em!important;
   }
   .kandy-public-colour-hero p,.kandy-public-intro-cover-gold p{
    color:rgba(255,249,232,.88)!important;
   }
   .kandy-public-colour-hero a[href^="tel:"],
   .kandy-public-colour-hero a[href*="wa.me"],
   .kandy-public-colour-hero a[href*="whatsapp"],
   .kandy-public-intro-cover-gold a[href^="tel:"],
   .kandy-public-intro-cover-gold a[href*="wa.me"],
   .kandy-public-intro-cover-gold a[href*="whatsapp"]{
    background:linear-gradient(135deg,#e9cb82 0%,#b68a3b 52%,#f6e2a8 100%)!important;
    color:#17120a!important;border:1px solid #f8e7b5!important;
    border-radius:999px!important;font-weight:800!important;
    box-shadow:0 8px 20px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.52)!important;
   }
   .kandy-public-colour-hero img,.kandy-public-intro-cover-gold img{
    border:1px solid rgba(231,198,126,.62)!important;
    border-radius:14px!important;
    box-shadow:0 14px 32px rgba(0,0,0,.42),0 0 0 4px rgba(216,177,91,.07)!important;
   }
   .kandy-public-intro-cover-gold .kandy-public-intro-info-flat{
    background:transparent!important;border-color:transparent!important;box-shadow:none!important;
   }
   @media(max-width:640px){
    .kandy-public-colour-hero,.kandy-public-intro-cover-gold{border-radius:16px!important}
    .kandy-public-colour-hero:before,.kandy-public-intro-cover-gold:before{inset:5px;border-radius:11px}
   }
  `;
  document.head.appendChild(st);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 const observer=new MutationObserver(()=>apply());
 observer.observe(document.documentElement,{childList:true,subtree:true});
})();


/* Responsive full hero-banner redesign: desktop and mobile. */
(function responsiveFullHeroBannerRedesign(){
 if(window.__kandyResponsiveHeroRedesignV1)return;
 window.__kandyResponsiveHeroRedesignV1=true;
 function apply(){
  if(document.getElementById('kandy-responsive-hero-redesign-style'))return;
  const st=document.createElement('style');
  st.id='kandy-responsive-hero-redesign-style';
  st.textContent=`
   .kandy-public-colour-hero{
    --kandy-gold:#e7c77d;
    position:relative!important;isolation:isolate!important;overflow:hidden!important;
    display:flex!important;flex-direction:column!important;justify-content:center!important;
    gap:clamp(14px,2.2vw,26px)!important;
    box-sizing:border-box!important;
    width:100%!important;max-width:100%!important;
    min-height:clamp(360px,40vw,540px)!important;
    padding:clamp(34px,5.2vw,76px) clamp(22px,6vw,88px)!important;
    margin:clamp(16px,3vw,34px) auto!important;
    border:1px solid rgba(231,199,125,.66)!important;
    border-radius:clamp(18px,2.5vw,30px)!important;
    background:
     radial-gradient(ellipse at 82% 20%,rgba(231,199,125,.22),transparent 30%),
     radial-gradient(ellipse at 12% 90%,rgba(166,120,43,.17),transparent 36%),
     linear-gradient(115deg,transparent 0 46%,rgba(255,231,175,.055) 46.2%,transparent 46.8%),
     linear-gradient(135deg,#030405 0%,#15130f 48%,#080808 100%)!important;
    box-shadow:0 24px 60px rgba(0,0,0,.42),0 0 34px rgba(204,164,78,.12),inset 0 1px 0 rgba(255,241,205,.22)!important;
   }
   .kandy-public-colour-hero:before{
    content:"";position:absolute;inset:10px;border:1px solid rgba(231,199,125,.22);
    border-radius:calc(clamp(18px,2.5vw,30px) - 7px);pointer-events:none;z-index:0;
   }
   .kandy-public-colour-hero:after{
    content:"";position:absolute;left:8%;right:8%;top:0;height:2px;pointer-events:none;z-index:0;
    background:linear-gradient(90deg,transparent,#a77e36 18%,#fff0bd 50%,#a77e36 82%,transparent);
    box-shadow:0 0 18px rgba(245,211,132,.62);
   }
   .kandy-public-colour-hero>*{position:relative;z-index:1;max-width:100%}
   .kandy-public-colour-hero h1{
    margin:0!important;font-size:clamp(2.15rem,5.2vw,5rem)!important;
    line-height:1.04!important;font-weight:900!important;letter-spacing:.045em!important;
    color:#f4d98d!important;
    background:linear-gradient(100deg,#fff9e8 0%,#e7c36b 42%,#fff0bd 72%,#bd9140 100%);
    -webkit-background-clip:text!important;background-clip:text!important;
    -webkit-text-fill-color:transparent!important;
    text-shadow:0 6px 28px rgba(218,177,83,.18)!important;
   }
   .kandy-public-colour-hero p{
    max-width:760px!important;font-size:clamp(.98rem,1.35vw,1.18rem)!important;
    line-height:1.75!important;color:rgba(255,249,232,.88)!important;
   }
   .kandy-public-colour-hero a[href^="tel:"],
   .kandy-public-colour-hero a[href*="wa.me"],
   .kandy-public-colour-hero a[href*="whatsapp"]{
    display:inline-flex!important;align-items:center!important;justify-content:center!important;
    gap:9px!important;min-height:46px!important;padding:11px 21px!important;
    border-radius:999px!important;border:1px solid #f4dfa9!important;
    background:linear-gradient(135deg,#f0d796 0%,#bd9144 52%,#f8e8b9 100%)!important;
    color:#171109!important;font-weight:850!important;letter-spacing:.01em!important;
    box-shadow:0 9px 22px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.55)!important;
    transition:transform .2s ease,filter .2s ease,box-shadow .2s ease!important;
   }
   .kandy-public-colour-hero a[href^="tel:"]:hover,
   .kandy-public-colour-hero a[href*="wa.me"]:hover,
   .kandy-public-colour-hero a[href*="whatsapp"]:hover{
    transform:translateY(-2px)!important;filter:brightness(1.07)!important;
    box-shadow:0 13px 26px rgba(0,0,0,.4)!important;
   }
   .kandy-public-colour-hero img{
    max-width:100%!important;height:auto!important;object-fit:cover!important;
    border:1px solid rgba(231,199,125,.62)!important;border-radius:16px!important;
    box-shadow:0 16px 34px rgba(0,0,0,.4),0 0 0 5px rgba(216,177,91,.07)!important;
   }
   .kandy-public-colour-hero button{
    border-radius:999px!important;transition:transform .2s ease,filter .2s ease!important;
   }
   @media(max-width:768px){
    .kandy-public-colour-hero{
     min-height:unset!important;gap:13px!important;
     padding:32px 20px!important;margin:12px auto!important;
     border-radius:19px!important;
    }
    .kandy-public-colour-hero:before{inset:6px;border-radius:13px}
    .kandy-public-colour-hero h1{font-size:clamp(2rem,9vw,3.15rem)!important;line-height:1.08!important;letter-spacing:.025em!important}
    .kandy-public-colour-hero p{font-size:1rem!important;line-height:1.65!important}
    .kandy-public-colour-hero a[href^="tel:"],
    .kandy-public-colour-hero a[href*="wa.me"],
    .kandy-public-colour-hero a[href*="whatsapp"]{
     min-height:44px!important;padding:10px 16px!important;font-size:.92rem!important;
    }
   }
   @media(max-width:420px){
    .kandy-public-colour-hero{padding:27px 15px!important;border-radius:16px!important}
    .kandy-public-colour-hero h1{font-size:clamp(1.8rem,9.5vw,2.45rem)!important}
    .kandy-public-colour-hero a[href^="tel:"],
    .kandy-public-colour-hero a[href*="wa.me"],
    .kandy-public-colour-hero a[href*="whatsapp"]{width:100%!important;box-sizing:border-box!important}
   }
   @media(prefers-reduced-motion:reduce){
    .kandy-public-colour-hero *{transition:none!important}
   }
  `;
  document.head.appendChild(st);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 const observer=new MutationObserver(()=>apply());
 observer.observe(document.documentElement,{childList:true,subtree:true});
})();


/* Medium-fit unified black and gold banner background; remove red/green panels. */
(function fitUnifiedMediumBlackGoldBanner(){
 if(window.__kandyUnifiedMediumBannerV1)return;
 window.__kandyUnifiedMediumBannerV1=true;
 function apply(){
  if(document.getElementById('kandy-unified-medium-banner-style'))return;
  const st=document.createElement('style');
  st.id='kandy-unified-medium-banner-style';
  st.textContent=`
   .kandy-public-colour-hero,
   .kandy-public-intro-cover-gold{
    width:100%!important;max-width:100%!important;box-sizing:border-box!important;
    min-height:clamp(300px,34vw,410px)!important;
    padding:clamp(24px,3.4vw,42px)!important;
    margin:14px auto!important;
    display:flex!important;flex-direction:column!important;justify-content:center!important;
    gap:clamp(10px,1.5vw,18px)!important;
    overflow:hidden!important;
    background:
     radial-gradient(ellipse at 82% 16%,rgba(224,185,99,.18),transparent 34%),
     radial-gradient(ellipse at 12% 88%,rgba(178,135,55,.13),transparent 38%),
     linear-gradient(135deg,rgba(235,199,119,.055),transparent 42%,rgba(235,199,119,.045)),
     linear-gradient(115deg,#030303 0%,#17140e 52%,#050505 100%)!important;
    border:1px solid rgba(224,188,105,.72)!important;
    border-radius:20px!important;
    box-shadow:0 18px 42px rgba(0,0,0,.38),0 0 22px rgba(190,148,62,.12),inset 0 1px 0 rgba(255,239,196,.18)!important;
   }
   /* Remove coloured mini-panels so the new background runs continuously. */
   .kandy-public-colour-hero>*:not(img),
   .kandy-public-intro-cover-gold>*:not(img){
    background-color:transparent!important;
   }
   .kandy-public-colour-hero h1,
   .kandy-public-colour-hero h2,
   .kandy-public-colour-hero h3,
   .kandy-public-intro-cover-gold h1,
   .kandy-public-intro-cover-gold h2,
   .kandy-public-intro-cover-gold h3{
    display:inline-block!important;width:fit-content!important;max-width:100%!important;
    box-sizing:border-box!important;padding:9px 15px!important;margin:0 0 8px!important;
    color:#f5dda0!important;
    background:linear-gradient(110deg,rgba(4,4,4,.96),rgba(38,30,16,.94),rgba(5,5,5,.96))!important;
    border:1px solid rgba(221,184,101,.38)!important;border-radius:10px!important;
    box-shadow:inset 0 1px 0 rgba(255,239,196,.12),0 6px 16px rgba(0,0,0,.24)!important;
    -webkit-text-fill-color:#f5dda0!important;
    text-shadow:0 2px 12px rgba(225,187,99,.18)!important;
   }
   .kandy-public-colour-hero p,
   .kandy-public-intro-cover-gold p{
    display:block!important;max-width:850px!important;box-sizing:border-box!important;
    padding:9px 13px!important;margin:4px 0!important;
    color:#f5f0e4!important;
    background:linear-gradient(110deg,rgba(5,5,5,.82),rgba(34,27,15,.82),rgba(5,5,5,.82))!important;
    border-left:2px solid #c9a45b!important;border-radius:7px!important;
   }
   .kandy-public-colour-hero a[href^="tel:"],
   .kandy-public-colour-hero a[href*="wa.me"],
   .kandy-public-colour-hero a[href*="whatsapp"],
   .kandy-public-intro-cover-gold a[href^="tel:"],
   .kandy-public-intro-cover-gold a[href*="wa.me"],
   .kandy-public-intro-cover-gold a[href*="whatsapp"]{
    background:linear-gradient(135deg,#e8cb86,#a98038 54%,#f4e2b0)!important;
    color:#171109!important;border:1px solid #f2dfa9!important;
   }
   .kandy-public-colour-hero img,
   .kandy-public-intro-cover-gold img{
    background:linear-gradient(135deg,#080808,#211a0d,#080808)!important;
    border:1px solid rgba(224,188,105,.68)!important;
    box-shadow:0 12px 28px rgba(0,0,0,.38),0 0 0 3px rgba(207,165,79,.08)!important;
   }
   @media(max-width:768px){
    .kandy-public-colour-hero,.kandy-public-intro-cover-gold{
     min-height:260px!important;padding:22px 16px!important;margin:10px auto!important;
     gap:10px!important;border-radius:16px!important;
    }
    .kandy-public-colour-hero h1,.kandy-public-colour-hero h2,
    .kandy-public-intro-cover-gold h1,.kandy-public-intro-cover-gold h2{
     padding:8px 11px!important;font-size:clamp(1.45rem,7vw,2.5rem)!important;
    }
    .kandy-public-colour-hero p,.kandy-public-intro-cover-gold p{
     padding:8px 10px!important;font-size:.94rem!important;line-height:1.55!important;
    }
   }
   @media(max-width:420px){
    .kandy-public-colour-hero,.kandy-public-intro-cover-gold{
     min-height:unset!important;padding:18px 12px!important;
    }
   }
  `;
  document.head.appendChild(st);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 const observer=new MutationObserver(()=>apply());
 observer.observe(document.documentElement,{childList:true,subtree:true});
})();


/* Show a black admin icon above the Admin label in the public navigation only. */
(function addPublicAdminLabelIcon(){
 if(window.__kandyPublicAdminIconV2)return;
 window.__kandyPublicAdminIconV2=true;
 function apply(){
  const controls=Array.from(document.querySelectorAll('a,button,[role="button"]'));
  controls.forEach(control=>{
   if((control.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase()!=='admin')return;
   if(control.querySelector('.kandy-admin-nav-icon'))return;
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
   svg.setAttribute('viewBox','0 0 24 24');
   svg.setAttribute('width','21');svg.setAttribute('height','21');
   svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
   svg.classList.add('kandy-admin-nav-icon');
   svg.innerHTML='<path d="M12 3 20 6v5.2c0 5-3.4 8.4-8 10.8-4.6-2.4-8-5.8-8-10.8V6l8-3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 16c.6-2 1.8-3 3.5-3s2.9 1 3.5 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
   const wrap=document.createElement('span');
   wrap.className='kandy-admin-icon-wrap';
   wrap.setAttribute('aria-hidden','true');
   wrap.appendChild(svg);
   control.insertBefore(wrap,control.firstChild);
   control.classList.add('kandy-admin-icon-added');
  });
  if(!document.getElementById('kandy-admin-nav-icon-style')){
   const style=document.createElement('style');
   style.id='kandy-admin-nav-icon-style';
   style.textContent='.kandy-admin-icon-added{display:inline-flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important}.kandy-admin-icon-wrap{display:flex!important;align-items:center!important;justify-content:center!important;color:#000!important;flex:0 0 auto!important}.kandy-admin-nav-icon{display:block!important;filter:none!important}';
   document.head.appendChild(style);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 const observer=new MutationObserver(()=>apply());
 observer.observe(document.documentElement,{childList:true,subtree:true});
})();


/* Premium bathroom and tile showroom theme: public banner only. */
(function premiumBathroomShowroomBannerOnly(){
 if(window.__kandyPremiumShowroomBannerV1)return;
 window.__kandyPremiumShowroomBannerV1=true;
 function apply(){
  if(document.getElementById('kandy-premium-showroom-banner-style'))return;
  const st=document.createElement('style');
  st.id='kandy-premium-showroom-banner-style';
  st.textContent=`
   .kandy-public-colour-hero{
    position:relative!important;isolation:isolate!important;overflow:hidden!important;
    color:#292821!important;
    background:
     linear-gradient(90deg,rgba(255,253,247,.97),rgba(245,239,226,.93) 54%,rgba(231,222,203,.92)),
     repeating-linear-gradient(0deg,transparent 0 79px,rgba(91,82,65,.07) 80px 81px),
     repeating-linear-gradient(90deg,transparent 0 79px,rgba(91,82,65,.07) 80px 81px)!important;
    border:1px solid #b9a982!important;border-radius:22px!important;
    box-shadow:0 20px 48px rgba(37,32,22,.16),inset 0 1px 0 #fff!important;
   }
   .kandy-public-colour-hero:before{
    content:"";position:absolute;inset:9px;z-index:0;pointer-events:none;
    border:1px solid rgba(151,128,79,.35);border-radius:15px;
    background:
     linear-gradient(135deg,transparent 0 48%,rgba(255,255,255,.25) 49%,transparent 51%),
     repeating-linear-gradient(0deg,transparent 0 119px,rgba(128,113,82,.045) 120px 121px),
     repeating-linear-gradient(90deg,transparent 0 119px,rgba(128,113,82,.045) 120px 121px);
   }
   .kandy-public-colour-hero:after{
    content:"";position:absolute;left:8%;right:8%;top:0;height:3px;z-index:0;
    background:linear-gradient(90deg,transparent,#a68a52 18%,#e7d8b2 50%,#a68a52 82%,transparent);
   }
   .kandy-public-colour-hero>*{position:relative!important;z-index:1!important}
   .kandy-public-colour-hero h1{
    color:#28271f!important;-webkit-text-fill-color:#28271f!important;
    background:none!important;text-shadow:none!important;
    font-weight:900!important;letter-spacing:.035em!important;
   }
   .kandy-public-colour-hero h2,.kandy-public-colour-hero h3{
    color:#76623c!important;-webkit-text-fill-color:#76623c!important;
    background:rgba(255,255,255,.58)!important;border:1px solid rgba(166,138,82,.25)!important;
    border-radius:9px!important;
   }
   .kandy-public-colour-hero p{color:#514c40!important}
   .kandy-public-colour-hero img{
    border:5px solid rgba(255,255,255,.8)!important;
    outline:1px solid #b9a982!important;border-radius:14px!important;
    box-shadow:0 15px 30px rgba(43,37,25,.2)!important;
   }
   .kandy-public-colour-hero a[href^="tel:"],
   .kandy-public-colour-hero a[href*="wa.me"],
   .kandy-public-colour-hero a[href*="whatsapp"]{
    background:linear-gradient(135deg,#37362e,#171713)!important;
    color:#fff!important;border:1px solid #b9a982!important;
    box-shadow:0 8px 18px rgba(36,32,23,.22)!important;
   }
   @media(max-width:768px){
    .kandy-public-colour-hero{border-radius:17px!important}
    .kandy-public-colour-hero:before{inset:6px;border-radius:12px}
   }
  `;
  document.head.appendChild(st);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* Final requested banner palette: black + gold + red only. */
(function finalBlackGoldRedBannerOnly(){
 if(window.__kandyBlackGoldRedBannerV1)return;
 window.__kandyBlackGoldRedBannerV1=true;
 function apply(){
  if(document.getElementById('kandy-black-gold-red-banner-style'))return;
  const st=document.createElement('style');st.id='kandy-black-gold-red-banner-style';
  st.textContent=`
   .kandy-public-colour-hero{
    color:#fff4df!important;
    background:radial-gradient(ellipse at 82% 18%,rgba(190,24,42,.24),transparent 32%),radial-gradient(ellipse at 12% 88%,rgba(220,177,82,.17),transparent 36%),linear-gradient(125deg,rgba(190,24,42,.10),transparent 42%,rgba(218,174,75,.08)),linear-gradient(135deg,#050505 0%,#17120e 52%,#080808 100%)!important;
    border:1px solid rgba(221,181,91,.82)!important;
    box-shadow:0 20px 48px rgba(0,0,0,.42),0 0 25px rgba(191,25,43,.12),inset 0 1px 0 rgba(255,235,184,.18)!important;
   }
   .kandy-public-colour-hero:before{border:1px solid rgba(221,181,91,.28)!important;background:linear-gradient(135deg,transparent 0 47%,rgba(193,25,43,.09) 48%,transparent 51%)!important}
   .kandy-public-colour-hero:after{background:linear-gradient(90deg,transparent,#a77c31 16%,#f5dfa4 42%,#c21f35 58%,#e8c56f 82%,transparent)!important;box-shadow:0 0 17px rgba(225,182,83,.42)!important}
   .kandy-public-colour-hero h1{color:#f3d78f!important;background:linear-gradient(100deg,#fff2c9 0%,#e4bd65 48%,#fff0bd 72%,#c51e35 100%)!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent!important;text-shadow:0 5px 24px rgba(218,177,83,.16)!important}
   .kandy-public-colour-hero h2,.kandy-public-colour-hero h3{color:#f0d28b!important;-webkit-text-fill-color:#f0d28b!important;background:linear-gradient(110deg,rgba(5,5,5,.96),rgba(42,23,19,.95),rgba(8,8,8,.96))!important;border:1px solid rgba(197,30,53,.52)!important;box-shadow:inset 0 1px 0 rgba(255,225,169,.12),0 6px 16px rgba(0,0,0,.28)!important}
   .kandy-public-colour-hero p{color:rgba(255,245,225,.9)!important}
   .kandy-public-colour-hero img{background:#090909!important;border:2px solid rgba(220,179,88,.78)!important;outline:1px solid rgba(190,25,43,.48)!important;border-radius:14px!important;box-shadow:0 15px 32px rgba(0,0,0,.46),0 0 0 4px rgba(198,28,48,.08)!important}
   .kandy-public-colour-hero a[href^="tel:"],.kandy-public-colour-hero a[href*="wa.me"],.kandy-public-colour-hero a[href*="whatsapp"]{background:linear-gradient(130deg,#f0d58f 0%,#bd913e 48%,#c51e35 100%)!important;color:#120d08!important;border:1px solid #f3dfa9!important;box-shadow:0 9px 22px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.38)!important}
  `;
  document.head.appendChild(st);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* Remove banner outline and blend its immediate grey/red surround into the same theme. */
(function blendBannerIntoSurroundingBackground(){
 if(window.__kandyBannerBlendNoOutlineV1)return;
 window.__kandyBannerBlendNoOutlineV1=true;
 function apply(){
  const hero=document.querySelector('.kandy-public-colour-hero');
  if(!hero)return;
  const parent=hero.parentElement;
  if(parent)parent.classList.add('kandy-banner-blended-surround');
  if(!document.getElementById('kandy-banner-blended-surround-style')){
   const st=document.createElement('style');st.id='kandy-banner-blended-surround-style';
   st.textContent=`
    .kandy-public-colour-hero{
     border:0!important;outline:0!important;
     box-shadow:none!important;
    }
    .kandy-public-colour-hero:before{
     border:0!important;outline:0!important;box-shadow:none!important;
    }
    .kandy-banner-blended-surround{
     background:linear-gradient(135deg,#050505 0%,#17120e 52%,#080808 100%)!important;
     border:0!important;outline:0!important;box-shadow:none!important;
    }
   `;
   document.head.appendChild(st);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* Ensure the banner's black background itself carries visible gold and red accents. */
(function strengthenBlackGoldRedBannerBackground(){
 if(window.__kandyStrongBlackGoldRedBgV1)return;
 window.__kandyStrongBlackGoldRedBgV1=true;
 function apply(){
  const hero=document.querySelector('.kandy-public-colour-hero');
  if(!hero)return;
  const parent=hero.parentElement;
  if(parent)parent.classList.add('kandy-banner-blended-surround');
  if(!document.getElementById('kandy-strong-black-gold-red-bg-style')){
   const st=document.createElement('style');st.id='kandy-strong-black-gold-red-bg-style';
   st.textContent=`
    .kandy-public-colour-hero,
    .kandy-banner-blended-surround{
     background:
      radial-gradient(ellipse at 8% 18%,rgba(190,25,43,.28),transparent 28%),
      radial-gradient(ellipse at 88% 78%,rgba(220,178,83,.24),transparent 32%),
      linear-gradient(125deg,rgba(196,27,47,.10) 0%,transparent 38%,rgba(218,177,82,.12) 72%,transparent 100%),
      linear-gradient(135deg,#030303 0%,#11100d 48%,#050505 100%)!important;
     background-color:#050505!important;
    }
    .kandy-public-colour-hero{
     border:0!important;outline:0!important;
     box-shadow:none!important;
    }
    .kandy-public-colour-hero:before{
     border:0!important;outline:0!important;
     background:linear-gradient(135deg,transparent 0 42%,rgba(201,30,49,.12) 50%,transparent 58%)!important;
    }
    .kandy-public-colour-hero:after{
     background:linear-gradient(90deg,transparent,#a77c31 16%,#f5dfa4 42%,#c21f35 58%,#e8c56f 82%,transparent)!important;
    }
   `;
   document.head.appendChild(st);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* Make banner and its surrounding banner area exactly one seamless background. */
(function oneSeamlessBannerBackground(){
 if(window.__kandyOneSeamlessBannerBgV1)return;
 window.__kandyOneSeamlessBannerBgV1=true;
 function apply(){
  const hero=document.querySelector('.kandy-public-colour-hero');
  if(!hero)return;
  const targets=[hero,hero.parentElement];
  if(hero.parentElement && hero.parentElement.parentElement)targets.push(hero.parentElement.parentElement);
  targets.filter(Boolean).forEach(el=>el.classList.add('kandy-one-seamless-banner-bg'));
  if(!document.getElementById('kandy-one-seamless-banner-bg-style')){
   const st=document.createElement('style');st.id='kandy-one-seamless-banner-bg-style';
   st.textContent=`
    .kandy-one-seamless-banner-bg{
     background:
      radial-gradient(ellipse at 8% 18%,rgba(190,25,43,.28),transparent 28%),
      radial-gradient(ellipse at 88% 78%,rgba(220,178,83,.24),transparent 32%),
      linear-gradient(125deg,rgba(196,27,47,.10) 0%,transparent 38%,rgba(218,177,82,.12) 72%,transparent 100%),
      linear-gradient(135deg,#030303 0%,#11100d 48%,#050505 100%)!important;
     background-color:#050505!important;
     border:0!important;outline:0!important;box-shadow:none!important;
    }
    .kandy-public-colour-hero,
    .kandy-public-colour-hero:before,
    .kandy-public-colour-hero:after{
     border:0!important;outline:0!important;box-shadow:none!important;
    }
   `;
   document.head.appendChild(st);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* Apply the supplied black-marble and gold design to the public banner only. */
(function suppliedBlackMarbleGoldBanner(){
 if(window.__kandySuppliedBlackMarbleGoldBannerV1)return;
 window.__kandySuppliedBlackMarbleGoldBannerV1=true;
 function apply(){
  const hero=document.querySelector('.kandy-public-colour-hero');
  if(!hero)return;
  if(!document.getElementById('kandy-supplied-black-marble-gold-style')){
   const st=document.createElement('style');st.id='kandy-supplied-black-marble-gold-style';
   st.textContent=`
    .kandy-public-colour-hero{
     position:relative!important;isolation:isolate!important;overflow:hidden!important;
     padding:28px 22px 24px!important;
     color:#fff!important;
     background:
      radial-gradient(circle at 85% 20%,rgba(212,175,55,.25),transparent 40%),
      radial-gradient(circle at 10% 90%,rgba(255,255,255,.08),transparent 40%),
      linear-gradient(135deg,#0a0a0a 0%,#1a1a1a 45%,#000 100%)!important;
     border:1.5px solid #d4af37!important;
     border-radius:0 0 22px 22px!important;
     box-shadow:none!important;
    }
    .kandy-public-colour-hero:before{
     content:""!important;position:absolute!important;inset:0!important;z-index:0!important;
     height:auto!important;left:0!important;right:0!important;top:0!important;bottom:0!important;
     transform:none!important;pointer-events:none!important;
     background:repeating-linear-gradient(115deg,transparent 0 80px,rgba(255,255,255,.03) 80px 81px)!important;
     border:0!important;filter:none!important;
    }
    .kandy-public-colour-hero:after{display:none!important}
    .kandy-public-colour-hero>*{position:relative;z-index:1}
    .kandy-public-colour-hero small{
     color:#d4af37!important;letter-spacing:2px!important;font-size:11px!important;font-weight:700!important;
    }
    .kandy-public-colour-hero h1{
     font-size:clamp(30px,7vw,38px)!important;line-height:1.05!important;margin:10px 0 8px!important;
     letter-spacing:0!important;font-weight:900!important;
     background:linear-gradient(90deg,#fff3a3,#d4af37,#fff,#c9a227)!important;
     -webkit-background-clip:text!important;background-clip:text!important;
     -webkit-text-fill-color:transparent!important;
     filter:none!important;text-shadow:none!important;
    }
    .kandy-public-colour-hero p{
     color:#ddd!important;font-size:14px!important;line-height:1.5!important;
     max-width:320px!important;text-shadow:none!important;
    }
    .kandy-public-colour-hero a[href^="tel:"],
    .kandy-public-colour-hero a[href*="wa.me"],
    .kandy-public-colour-hero a[href*="whatsapp"]{
     display:inline-flex!important;align-items:center!important;gap:6px!important;
     border:0!important;border-radius:999px!important;padding:11px 16px!important;
     font-size:13px!important;font-weight:700!important;letter-spacing:0!important;
     box-shadow:none!important;text-decoration:none!important;
    }
    .kandy-public-colour-hero a[href^="tel:"]{background:#00c853!important;color:#fff!important}
    .kandy-public-colour-hero a[href*="wa.me"],
    .kandy-public-colour-hero a[href*="whatsapp"]{background:#fff!important;color:#111!important}
    .kandy-public-colour-hero .tags,
    .kandy-public-colour-hero .hero-tags,
    .kandy-public-colour-hero [class*="tag-list"]{
     display:flex!important;gap:8px!important;margin-top:16px!important;flex-wrap:wrap!important;
    }
    .kandy-public-colour-hero .tag,
    .kandy-public-colour-hero [class*="hero-tag"]{
     background:rgba(255,255,255,.12)!important;
     border:1px solid rgba(255,255,255,.25)!important;
     padding:6px 11px!important;border-radius:999px!important;
     font-size:11px!important;color:#fff!important;backdrop-filter:blur(5px)!important;
    }
    .kandy-public-colour-hero .tag b,
    .kandy-public-colour-hero [class*="hero-tag"] b{color:#ffd700!important}
    @media(max-width:600px){
     .kandy-public-colour-hero{padding:24px 17px 21px!important}
     .kandy-public-colour-hero h1{font-size:clamp(29px,9vw,36px)!important}
    }
   `;
   document.head.appendChild(st);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* Latest user-approved banner-only design: black/gold marble with bathroom photo. */
(function latestBlackGoldBathroomBannerOnly(){
 if(window.__kandyLatestBlackGoldBathroomBannerV1)return;
 window.__kandyLatestBlackGoldBathroomBannerV1=true;
 function apply(){
  const hero=document.querySelector('.kandy-public-colour-hero');
  if(!hero)return;
  if(!document.getElementById('kandy-latest-black-gold-bathroom-banner-style')){
   const st=document.createElement('style');st.id='kandy-latest-black-gold-bathroom-banner-style';
   st.textContent=`
    .kandy-public-colour-hero{
     position:relative!important;isolation:isolate!important;overflow:hidden!important;
     min-height:220px!important;padding:26px 20px 22px!important;
     color:#fff!important;border:0!important;border-radius:0 0 16px 16px!important;
     box-shadow:none!important;
     background:
      linear-gradient(90deg,#000 0%,rgba(0,0,0,.97) 36%,rgba(0,0,0,.72) 57%,rgba(0,0,0,.18) 100%),
      radial-gradient(circle at 75% 20%,rgba(212,175,55,.45),transparent 45%),
      radial-gradient(circle at 65% 90%,rgba(212,175,55,.35),transparent 40%),
      radial-gradient(circle at 90% 60%,rgba(255,255,255,.06),transparent 40%),
      linear-gradient(135deg,#000 0%,#111 40%,#1a1505 70%,#000 100%)!important;
     background-color:#000!important;
    }
    .kandy-public-colour-hero:before{
     content:""!important;position:absolute!important;inset:0!important;
     z-index:0!important;pointer-events:none!important;height:auto!important;
     left:0!important;right:0!important;top:0!important;bottom:0!important;
     transform:none!important;filter:none!important;border:0!important;
     background:
      radial-gradient(ellipse 300px 120px at 70% 30%,transparent 60%,rgba(212,175,55,.35) 61%,transparent 62%),
      radial-gradient(ellipse 400px 160px at 75% 70%,transparent 60%,rgba(255,215,0,.25) 61%,transparent 62%),
      radial-gradient(ellipse 250px 100px at 60% 50%,transparent 60%,rgba(212,175,55,.2) 61%,transparent 62%)!important;
    }
    .kandy-public-colour-hero:after{
     content:""!important;display:block!important;position:absolute!important;
     z-index:0!important;pointer-events:none!important;
     top:0!important;right:0!important;bottom:0!important;left:auto!important;
     width:44%!important;height:auto!important;transform:none!important;
     background:
      linear-gradient(90deg,#000 0%,rgba(0,0,0,.35) 38%,transparent 72%),
      url("https://images.unsplash.com/photo-1620626011761-996317b8d101?w=800&q=80") center/cover no-repeat!important;
     opacity:.9!important;filter:none!important;box-shadow:none!important;border:0!important;
    }
    .kandy-public-colour-hero>*{position:relative;z-index:2}
    .kandy-public-colour-hero h1{
     font-family:Georgia,serif!important;font-size:clamp(28px,6vw,36px)!important;
     line-height:1.05!important;margin:8px 0 10px!important;font-weight:700!important;
     letter-spacing:0!important;
     background:linear-gradient(90deg,#f9e79f,#d4af37,#fff2a8,#b7950b)!important;
     -webkit-background-clip:text!important;background-clip:text!important;
     -webkit-text-fill-color:transparent!important;filter:none!important;text-shadow:none!important;
    }
    .kandy-public-colour-hero small{
     color:#d4af37!important;letter-spacing:2.5px!important;font-size:10px!important;font-weight:700!important;
    }
    .kandy-public-colour-hero p{
     font-size:12.5px!important;line-height:1.55!important;color:#e5e5e5!important;
     max-width:62%!important;text-shadow:none!important;
    }
    .kandy-public-colour-hero a[href^="tel:"],
    .kandy-public-colour-hero a[href*="wa.me"],
    .kandy-public-colour-hero a[href*="whatsapp"]{
     display:inline-flex!important;align-items:center!important;gap:6px!important;
     text-decoration:none!important;padding:10px 14px!important;border-radius:999px!important;
     font-size:12px!important;font-weight:700!important;letter-spacing:0!important;
     border:0!important;box-shadow:none!important;
    }
    .kandy-public-colour-hero a[href^="tel:"]{background:#fff!important;color:#111!important}
    .kandy-public-colour-hero a[href*="wa.me"],
    .kandy-public-colour-hero a[href*="whatsapp"]{background:#00c853!important;color:#fff!important}
    .kandy-public-colour-hero .tag,
    .kandy-public-colour-hero [class*="tag"]{
     background:rgba(255,255,255,.12)!important;
     border:1px solid rgba(255,255,255,.25)!important;
     backdrop-filter:blur(6px)!important;
     padding:6px 10px!important;border-radius:999px!important;font-size:11px!important;
    }
    .kandy-public-colour-hero .tag.green,
    .kandy-public-colour-hero [class*="tag"].green{
     background:rgba(0,200,83,.35)!important;border-color:rgba(0,200,83,.6)!important;
    }
    @media(max-width:480px){
     .kandy-public-colour-hero{padding:24px 16px 20px!important}
     .kandy-public-colour-hero:after{width:38%!important;opacity:.7!important}
     .kandy-public-colour-hero p{max-width:68%!important}
     .kandy-public-colour-hero h1{font-size:28px!important}
    }
   `;
   document.head.appendChild(st);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* User request: keep the supplied black/gold bathroom banner, remove tile/product image from inside banner only. */
(function removeTileImageFromPublicBannerOnly(){
 if(window.__kandyRemoveTileImageFromPublicBannerV1)return;
 window.__kandyRemoveTileImageFromPublicBannerV1=true;
 function apply(){
  const hero=document.querySelector('.kandy-public-colour-hero');
  if(!hero)return;
  if(!document.getElementById('kandy-remove-tile-image-banner-only-style')){
   const st=document.createElement('style');
   st.id='kandy-remove-tile-image-banner-only-style';
   st.textContent=`
    .kandy-public-colour-hero img,
    .kandy-public-colour-hero picture,
    .kandy-public-colour-hero .tile-image,
    .kandy-public-colour-hero [class*="tile-image"],
    .kandy-public-colour-hero [class*="product-image"]{
     display:none!important;
    }
    .kandy-public-colour-hero{
     background-color:#000!important;
    }
    .kandy-public-colour-hero:after{
     display:block!important;
     width:46%!important;
    }
    .kandy-public-colour-hero p{
     max-width:60%!important;
    }
    @media(max-width:480px){
     .kandy-public-colour-hero:after{width:44%!important}
     .kandy-public-colour-hero p{max-width:62%!important}
    }
   `;
   document.head.appendChild(st);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
})();


/* Customer catalogue navigation: Category -> Folders -> Items.
   Admin screens, catalogue records, images and Supabase data are untouched. */
(function kandyCustomerCategoryFolderFlowOnly(){
 if(window.__kandyCustomerCategoryFolderFlowV1)return;
 window.__kandyCustomerCategoryFolderFlowV1=true;
 const originalView=window.view;
 if(typeof originalView!=='function')return;
 let stage='categories';
 let nav=null;
 const $id=id=>document.getElementById(id);
 function makeButton(label,cls,handler){
  const b=document.createElement('button');
  b.type='button';b.className=cls;b.textContent=label;b.addEventListener('click',handler);
  return b;
 }
 function ensureNav(){
  if(nav&&nav.isConnected)return nav;
  const foldersBox=$id('folders');
  if(!foldersBox)return null;
  nav=document.createElement('div');
  nav.id='kandy-customer-category-nav';
  nav.style.cssText='display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:0 0 16px';
  foldersBox.parentNode.insertBefore(nav,foldersBox);
  return nav;
 }
 function setVisible(id,visible){
  const el=$id(id);if(el)el.style.display=visible?'':'none';
 }
 function renderFlow(){
  const foldersBox=$id('folders');
  const toolbar=document.querySelector('main .toolbar');
  const grid=$id('grid');
  const empty=$id('empty');
  const bar=ensureNav();
  if(!foldersBox||!bar)return;
  bar.replaceChildren();
  if(stage==='categories'){
   bar.appendChild(makeButton('Tiles','kandy-category-card',()=>{
    stage='folders';renderFlow();
   }));
   foldersBox.style.display='none';
   if(toolbar)toolbar.style.display='none';
   if(grid)grid.style.display='none';
   if(empty)empty.style.display='none';
   return;
  }
  if(stage==='folders'){
   bar.appendChild(makeButton('‹ Categories','kandy-category-back',()=>{
    stage='categories';renderFlow();
   }));
   const heading=document.createElement('strong');
   heading.textContent='Tiles';
   heading.style.cssText='align-self:center;padding:9px 12px;color:#252525';
   bar.appendChild(heading);
   foldersBox.replaceChildren();
   const allCount=Array.isArray(tiles)?tiles.length:0;
   foldersBox.appendChild(makeButton('All Tile Folder ('+allCount+')','folder',()=>{
    active='All Collections';stage='items';originalView();renderFlow();
   }));
   (Array.isArray(folders)?folders:[]).forEach(folder=>{
    const count=Array.isArray(tiles)?tiles.filter(t=>t.folder===folder).length:0;
    foldersBox.appendChild(makeButton(folder+' ('+count+')','folder',()=>{
     active=folder;stage='items';originalView();renderFlow();
    }));
   });
   foldersBox.style.display='flex';
   if(toolbar)toolbar.style.display='none';
   if(grid)grid.style.display='none';
   if(empty)empty.style.display='none';
   return;
  }
  bar.appendChild(makeButton('‹ Categories','kandy-category-back',()=>{
   stage='categories';active='All Collections';originalView();renderFlow();
  }));
  bar.appendChild(makeButton('‹ All folders','kandy-category-back',()=>{
   stage='folders';originalView();renderFlow();
  }));
  const heading=document.createElement('strong');
  heading.textContent=active==='All Collections'?'All Tile Items':String(active);
  heading.style.cssText='align-self:center;padding:9px 12px;color:#252525';
  bar.appendChild(heading);
  foldersBox.style.display='none';
  if(toolbar)toolbar.style.display='';
  if(grid)grid.style.display='';
  if(empty)empty.style.display='';
  const title=$id('collection-title');
  if(title)title.textContent=active==='All Collections'?'All Tile Items':String(active);
 }
 const css=document.createElement('style');
 css.id='kandy-customer-category-folder-flow-style';
 css.textContent=`
  #kandy-customer-category-nav .kandy-category-card{
   min-width:150px;padding:16px 22px;border:1px solid #c11224;border-radius:14px;
   background:#c11224;color:#fff;font-weight:850;font-size:17px;text-align:left;
   box-shadow:0 5px 16px rgba(193,18,36,.14)
  }
  #kandy-customer-category-nav .kandy-category-back{
   padding:10px 14px;border:1px solid #ddd;border-radius:11px;background:#fff;
   color:#252525;font-weight:750
  }
  #folders .folder{display:inline-flex;align-items:center;justify-content:center}
 `;
 document.head.appendChild(css);
 window.view=function(){originalView();renderFlow();};
 if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',renderFlow,{once:true});
 }else renderFlow();
})();
