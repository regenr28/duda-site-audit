/* Duda Site Auditor — front-end app (vanilla JS, no build step) */
(function () {
  'use strict';
  const A = window.DudaAudit;
  const SITE_STATUSES = ['Not started', 'In progress', 'Complete with query', 'Complete', 'On hold'];
  const FSTATUS = [
    { v: 'open', label: 'Open' }, { v: 'clarification', label: 'For clarification' }, { v: 'done', label: 'Done' },
    { v: 'hold', label: 'On hold' }, { v: 'false', label: 'False alarm' },
  ];
  const FLABEL = Object.fromEntries(FSTATUS.map((s) => [s.v, s.label]));
  const SCAN_CONCURRENCY_SITES = 2;
  const OWNER = 'regencia.reymark28@gmail.com'; // sees all feature suggestions (keep in sync with SUGGESTIONS_OWNER)
  const SUG = [{ v: 'new', label: 'New' }, { v: 'ongoing', label: 'On going' }, { v: 'done', label: 'Done' }, { v: 'nope', label: 'Nope' }];
  const SUGL = Object.fromEntries(SUG.map((x) => [x.v, x.label]));

  const state = {
    config: {}, me: null, users: [], sites: [], current: null,
    scanning: {}, queue: [], running: 0, skipAI: {}, aiAbort: {},
    filters: { q: '', status: '', assignee: '' },
    ff: { q: '', sev: '', cat: '', dev: '', st: 'active', who: '', loc: '' },
    notifs: { items: [], unread: 0 }, presence: {}, commentScope: 'general', gfilter: '', sfilter: 'open', auth: { mode: 'login', email: '', remember: true },
  };

  // ---------- utils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z]+/g, '-');
  const fmtDate = (d) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const ago = (d) => {
    if (!d) return ''; const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return fmtDate(d);
  };
  const fmtFull = (d) => d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const user = (email) => state.users.find((u) => u.email === email);
  const nameOf = (email, fallback) => (user(email) || {}).name || fallback || email || 'Unassigned';
  const activeUsers = () => state.users.filter((u) => u.status === 'active');

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast(label || 'Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(label || 'Copied'); }
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}) }));
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (r.status === 401 && !path.startsWith('/api/auth')) { state.me = null; renderAuth(); throw new Error('Please sign in'); }
    if (r.status === 403 && data && data.pending) { state.auth.mode = 'pending'; state.me = null; renderAuth(); throw new Error(data.error); }
    if (!r.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${r.status}`), { status: r.status, data });
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const store = (body) => post('/api/store', body);

  // ---------- Modal / lightbox ----------
  let modalOpts = null;
  function modal(html, opts = {}) {
    modalOpts = opts;
    $('#modalRoot').innerHTML = `<div class="modal-back"><div class="modal ${opts.wide ? 'wide' : ''} ${opts.full ? 'full' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    const back = $('.modal-back');
    back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
    $$('[data-close]', back).forEach((b) => (b.onclick = closeModal));
    const f = back.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; modalOpts = null; }
  function lightbox(src) { modal(`<div class="lightbox"><img src="${esc(src)}" alt="Attached image"><div class="lb-actions"><a class="btn sm" href="${esc(src)}" target="_blank" rel="noopener">Open full size ↗</a><button class="btn sm" data-close>Close</button></div></div>`, { wide: true }); }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modalOpts) return closeModal();
    if ($('.notif-panel')) return $('.notif-panel').remove();
    if (route().item) location.hash = `#/site/${route().id}`;
  });

  function avatar(email, size) {
    const u = user(email);
    if (!u && !email) return '';
    const name = u ? u.name : email;
    return `<span class="av" style="background:${esc(u ? u.color : '#6b7280')};${size ? `width:${size}px;height:${size}px;font-size:${Math.round(size / 2.3)}px` : ''}" title="${esc(name)}">${esc(initials(name))}</span>`;
  }
  function userOptions(selected, emptyLabel) {
    return `<option value="">${esc(emptyLabel || 'Unassigned')}</option>` + activeUsers().map((u) => `<option value="${esc(u.email)}" ${u.email === selected ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  }

  // =====================================================================
  // AUTH
  // =====================================================================
  function renderAuth() {
    document.body.classList.add('auth-mode');
    const a = state.auth; const cfg = state.config;
    const google = cfg.googleClientId && ['login', 'signup'].includes(a.mode) ? `<div id="gbtn" class="gbtn"></div><div class="or"><span>or</span></div>` : '';
    const remember = `<label class="check-row"><input type="checkbox" id="auRemember" ${a.remember ? 'checked' : ''}> Remember me for 30 days</label>`;
    let body = '';
    if (a.mode === 'login') body = `<h1>Sign in</h1><p class="muted">Welcome back to Duda Site Auditor.</p>${google}
      <form id="auForm" class="auth-form">
        <label class="field">Email<input type="email" id="auEmail" autocomplete="email" required value="${esc(a.email)}" autofocus></label>
        <label class="field">Password<input type="password" id="auPass" autocomplete="current-password" required></label>
        <div class="row-between">${remember}<a href="#" data-mode="forgot">Forgot password?</a></div>
        <button class="btn primary block" type="submit">Sign in</button>
      </form><p class="switch">New here? <a href="#" data-mode="signup">Create an account</a></p>`;
    else if (a.mode === 'signup') body = `<h1>Create account</h1><p class="muted">${cfg.emailEnabled ? "We'll email you a code to verify your address." : 'An admin approves new accounts.'}</p>${google}
      <form id="auForm" class="auth-form">
        <label class="field">Full name<input type="text" id="auName" autocomplete="name" required autofocus></label>
        <label class="field">Email<input type="email" id="auEmail" autocomplete="email" required value="${esc(a.email)}"></label>
        <label class="field">Password <span class="faint small">(8+ characters)</span><input type="password" id="auPass" autocomplete="new-password" minlength="8" required></label>
        ${remember}
        <button class="btn primary block" type="submit">Create account</button>
      </form><p class="switch">Already have an account? <a href="#" data-mode="login">Sign in</a></p>`;
    else if (a.mode === 'verify' || a.mode === 'reset') body = `<h1>${a.mode === 'verify' ? 'Check your email' : 'Set a new password'}</h1>
      <p class="muted">Enter the 6-digit code we sent to <b>${esc(a.email)}</b>.</p>
      <form id="auForm" class="auth-form">
        <label class="field">Verification code<input type="text" id="auCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus class="code-input"></label>
        ${a.mode === 'reset' ? '<label class="field">New password <span class="faint small">(8+ characters)</span><input type="password" id="auPass" autocomplete="new-password" minlength="8" required></label>' : ''}
        <button class="btn primary block" type="submit">${a.mode === 'verify' ? 'Verify & continue' : 'Update password & sign in'}</button>
      </form><p class="switch">Didn't get it? Check spam, or <a href="#" id="auResend">send a new code</a> · <a href="#" data-mode="login">Back</a></p>`;
    else if (a.mode === 'forgot') body = `<h1>Forgot password</h1><p class="muted">We'll email you a code to reset it.</p>
      <form id="auForm" class="auth-form">
        <label class="field">Email<input type="email" id="auEmail" autocomplete="email" required value="${esc(a.email)}" autofocus></label>
        <button class="btn primary block" type="submit">Send code</button>
      </form><p class="switch"><a href="#" data-mode="login">Back to sign in</a></p>`;
    else if (a.mode === 'pending') body = `<h1>Account created</h1><div><span class="badge fs-clarification" style="font-size:13px;padding:4px 12px">Status: Admin for Approval</span></div><p class="muted">The admins have been notified. You can sign in as soon as one of them approves your account.</p>
      <button class="btn block" data-mode="login">Back to sign in</button>`;
    $('#view').innerHTML = `<div class="auth-wrap"><div class="panel auth-card">
      <div class="brand auth-brand"><span class="logo"><svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M9 16.5l4.5 4.5L23 11" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Duda Site Auditor</div>
      ${body}<div id="auMsg" class="au-msg" role="alert"></div></div></div>`;
    $$('[data-mode]').forEach((l) => (l.onclick = (e) => { e.preventDefault(); a.email = ($('#auEmail') || {}).value || a.email; a.mode = l.dataset.mode; renderAuth(); }));
    const msg = (t, ok) => { const m = $('#auMsg'); m.textContent = t || ''; m.className = 'au-msg ' + (ok ? 'ok' : 'bad'); };
    const rem = () => ($('#auRemember') ? $('#auRemember').checked : a.remember);
    const done = async (r) => {
      if (r.user) { state.me = r.user; document.body.classList.remove('auth-mode'); await boot2(); return; }
      if (r.pending) { a.mode = 'pending'; renderAuth(); return; }
    };
    const form = $('#auForm');
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; msg('');
      a.remember = rem();
      try {
        if (a.mode === 'login') { a.email = $('#auEmail').value; await done(await post('/api/auth', { op: 'login', email: a.email, password: $('#auPass').value, remember: a.remember })); }
        else if (a.mode === 'signup') {
          a.email = $('#auEmail').value;
          const r = await post('/api/auth', { op: 'signup', name: $('#auName').value, email: a.email, password: $('#auPass').value, remember: a.remember });
          if (r.needCode) { a.mode = 'verify'; renderAuth(); msg(r.message, true); } else await done(r);
        } else if (a.mode === 'verify') await done(await post('/api/auth', { op: 'verify', email: a.email, code: $('#auCode').value, remember: a.remember }));
        else if (a.mode === 'forgot') { a.email = $('#auEmail').value; const r = await post('/api/auth', { op: 'forgot', email: a.email }); a.mode = 'reset'; renderAuth(); msg(r.message, true); }
        else if (a.mode === 'reset') await done(await post('/api/auth', { op: 'reset', email: a.email, code: $('#auCode').value, password: $('#auPass').value, remember: true }));
      } catch (err) { msg(err.message); if (err.data && err.data.pending) { a.mode = 'pending'; renderAuth(); } }
      if (document.body.contains(btn)) btn.disabled = false;
    };
    const rs = $('#auResend');
    if (rs) rs.onclick = async (e) => { e.preventDefault(); try { const r = await post('/api/auth', { op: 'resend', email: a.email, kind: a.mode === 'reset' ? 'reset' : 'verify' }); msg(r.message, true); } catch (err) { msg(err.message); } };
    if ($('#gbtn')) mountGoogle(async (credential) => {
      msg('');
      try { await done(await post('/api/auth', { op: 'google', credential, remember: rem() })); }
      catch (err) { if (err.data && err.data.pending) { a.mode = 'pending'; renderAuth(); } else msg(err.message); }
    });
  }
  function mountGoogle(cb) {
    const go = () => {
      window.google.accounts.id.initialize({ client_id: state.config.googleClientId, callback: (r) => cb(r.credential), ux_mode: 'popup' });
      window.google.accounts.id.renderButton($('#gbtn'), { theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'filled_black' : 'outline', size: 'large', text: state.auth.mode === 'signup' ? 'signup_with' : 'signin_with', width: 320 });
    };
    if (window.google && window.google.accounts) return go();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = go; document.head.appendChild(s);
  }
  async function logout() { try { await post('/api/auth', { op: 'logout' }); } catch (e) { /* ignore */ } state.me = null; state.auth.mode = 'login'; renderAuth(); }

  // =====================================================================
  // DATA
  // =====================================================================
  async function loadUsers() { const r = await api('/api/users'); state.users = r.users; state.me = r.me; }
  async function loadSites() { const r = await api('/api/store?op=list'); state.sites = r.sites || []; }
  async function loadNotifs() { try { state.notifs = await api('/api/store?op=notifs'); renderBell(); } catch (e) { /* ignore */ } }
  async function loadSite(id) { state.current = await api('/api/store?op=site&id=' + encodeURIComponent(id)); return state.current; }
  function upsertSummary(sum) { if (!sum) return; const i = state.sites.findIndex((s) => s.id === sum.id); if (i >= 0) state.sites[i] = sum; else state.sites.push(sum); }

  // =====================================================================
  // TOP BAR
  // =====================================================================
  function renderTop() {
    const isOwner = state.me.email === OWNER;
    $('.topnav').innerHTML = `<a href="#/" data-nav="sites">Websites</a>
      ${state.me.role === 'admin' ? '<a href="#/activity" data-nav="activity">Activity</a>' : ''}
      <a href="#/suggestions" data-nav="suggestions">${isOwner ? 'Suggestions' : 'My suggestions'}</a>
      <a href="#/ai" data-nav="ai">AI Status</a>
      <a href="#/about" data-nav="about">About</a>`;
    $('#topRight').innerHTML = `
      <div class="presence" id="presence" title="Who's online"></div>
      <button class="btn ghost ai-chip" id="btnAi" type="button" hidden></button>
      <button class="btn ghost" id="btnSuggest" type="button" title="Suggest a feature">💡 <span class="hide-sm">Suggest a feature</span></button>
      <button class="btn ghost bell" id="btnBell" title="Notifications" aria-label="Notifications">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="bell-count" id="bellCount" hidden></span></button>
      <button class="btn ghost" id="btnMembers" type="button">Members${state.me.role === 'admin' && state.users.some((u) => u.status === 'pending') ? ` <span class="badge fs-clarification">${state.users.filter((u) => u.status === 'pending').length} for approval</span>` : ''}</button>
      <button class="btn primary" id="btnAdd" type="button">+ Add website</button>
      <button class="btn ghost me-btn" id="btnMe" title="${esc(state.me.email)}">${avatar(state.me.email, 26)}</button>`;
    $('#btnAdd').onclick = openAdd;
    $('#btnMembers').onclick = openMembers;
    $('#btnBell').onclick = toggleNotifs;
    $('#btnMe').onclick = openMe;
    $('#btnSuggest').onclick = openSuggest;
    $('#btnAi').onclick = () => { location.hash = '#/ai'; }; renderAiChip();
    $('#presence').onclick = togglePresence;
    renderBell(); renderPresence(); markNav();
  }
  function markNav() {
    const r = route();
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (r.name === 'site' ? 'sites' : r.name)));
  }
  function renderBell() {
    const c = $('#bellCount'); if (!c) return;
    c.hidden = !state.notifs.unread; c.textContent = state.notifs.unread > 9 ? '9+' : state.notifs.unread;
  }
  const NOTIF_TEXT = { mention: 'mentioned you', reply: 'replied to you', assign: 'assigned you', signup: 'created an account (Admin for Approval)', suggestion: 'sent a feature suggestion', 'suggestion-status': 'updated your suggestion', 'suggestion-comment': 'commented on a suggestion' };
  function notifLink(n) {
    if (n.kind === 'signup') return '#/?members=1';
    if (/^suggestion/.test(n.kind)) return '#/suggestions';
    return `#/site/${n.siteId}${n.findingNum ? '/item/' + n.findingNum : '/comments'}`;
  }
  function toggleNotifs() {
    const ex = $('.notif-panel'); if (ex) return ex.remove();
    const p = document.createElement('div'); p.className = 'notif-panel panel';
    p.innerHTML = `<div class="np-head"><b>Notifications</b></div>` + (state.notifs.items.length ? state.notifs.items.map((n) => `
      <a class="np-item" href="${esc(notifLink(n))}">${avatar(n.by, 26)}
        <div><div><b>${esc(n.byName)}</b> ${esc(NOTIF_TEXT[n.kind] || 'notified you')}${n.siteName ? ' · ' + esc(n.siteName) : ''}${n.findingNum ? ' #' + n.findingNum : ''}</div>
        <div class="small muted np-text">${esc(n.text || '')}</div><div class="small faint">${esc(fmtFull(n.at))}</div></div></a>`).join('') : '<div class="empty small">No notifications yet.</div>');
    document.body.appendChild(p);
    p.addEventListener('click', (e) => { if (e.target.closest('a')) p.remove(); });
    setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!p.contains(e.target) && !e.target.closest('#btnBell')) { p.remove(); document.removeEventListener('mousedown', h); } }), 0);
    if (state.notifs.unread) { store({ op: 'readNotifs' }).catch(() => {}); state.notifs.unread = 0; renderBell(); }
  }

  // ---------- Presence (who has the app open) ----------
  // Green = app open and used within the last hour. Grey = app open but idle for 1 hour or more. Offline = app closed.
  let lastActive = Date.now(), lastPulse = 0, serverSkew = 0;
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastActive = Date.now(); if (Date.now() - lastPulse > 60000) pulse(); } });
  async function pulse() {
    if (!state.me) return;
    lastPulse = Date.now();
    try {
      const r = await post('/api/pulse', { lastActive: new Date(lastActive).toISOString() });
      serverSkew = Date.parse(r.serverTime) - Date.now();
      state.presence = r.presence || {};
      const hadUnread = state.notifs.unread;
      state.notifs = r.notifs || state.notifs;
      renderBell(); renderPresence();
      if (state.notifs.unread > hadUnread && state.me.role === 'admin' && state.notifs.items.some((n) => n.kind === 'signup')) { loadUsers().then(renderTop).catch(() => {}); }
    } catch (e) { /* ignore */ }
  }
  function presenceOf(email) {
    if (email === state.me.email) return { st: document.hidden && Date.now() - lastActive > 3600000 ? 'idle' : 'active', active: new Date(lastActive).toISOString() };
    const p = (state.presence || {})[email];
    if (!p || !p.seen) return { st: 'offline' };
    const nowS = Date.now() + serverSkew;
    if (nowS - Date.parse(p.seen) > 4 * 60000) return { st: 'offline', seen: p.seen };
    if (nowS - Date.parse(p.active || p.seen) >= 3600000) return { st: 'idle', active: p.active };
    return { st: 'active', active: p.active };
  }
  function presenceText(pr) {
    if (pr.st === 'active') return 'Active now';
    if (pr.st === 'idle') return 'Idle · last active ' + ago(pr.active);
    return pr.seen ? 'Offline · last seen ' + fmtFull(pr.seen) : 'Offline';
  }
  const pdot = (email) => `<span class="pdot ${presenceOf(email).st}"></span>`;
  function renderPresence() {
    const el = $('#presence'); if (!el) return;
    const online = activeUsers().map((u) => ({ u, pr: presenceOf(u.email) })).filter((x) => x.pr.st !== 'offline')
      .sort((a, b) => (a.pr.st === 'active' ? 0 : 1) - (b.pr.st === 'active' ? 0 : 1));
    const nActive = online.filter((x) => x.pr.st === 'active').length;
    el.innerHTML = `<span class="pstack">${online.slice(0, 5).map((x) => `<span class="pav">${avatar(x.u.email, 26)}<span class="pdot ${x.pr.st}"></span></span>`).join('')}</span>
      ${online.length > 5 ? `<span class="small muted">+${online.length - 5}</span>` : ''}<span class="small muted hide-sm">${nActive} active</span>`;
    const panel = $('.presence-panel'); if (panel) fillPresencePanel(panel);
  }
  function fillPresencePanel(p) {
    const order = { active: 0, idle: 1, offline: 2 };
    const rows = activeUsers().map((u) => ({ u, pr: presenceOf(u.email) })).sort((a, b) => order[a.pr.st] - order[b.pr.st] || a.u.name.localeCompare(b.u.name));
    p.innerHTML = `<div class="np-head"><b>Team status</b> <span class="small faint">green = active · grey = idle 1h+</span></div>` + rows.map((x) => `
      <div class="np-item"><span class="pav">${avatar(x.u.email, 28)}<span class="pdot ${x.pr.st}"></span></span>
        <div><div><b>${esc(x.u.name)}</b>${x.u.email === state.me.email ? ' <span class="badge subtle">You</span>' : ''} <span class="badge subtle">${esc(x.u.role)}</span></div>
        <div class="small ${x.pr.st === 'active' ? 'pt-active' : 'muted'}">${esc(presenceText(x.pr))}</div></div></div>`).join('');
  }
  function togglePresence() {
    const ex = $('.presence-panel'); if (ex) return ex.remove();
    const p = document.createElement('div'); p.className = 'notif-panel presence-panel panel';
    fillPresencePanel(p); document.body.appendChild(p);
    setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!p.contains(e.target) && !e.target.closest('#presence')) { p.remove(); document.removeEventListener('mousedown', h); } }), 0);
  }
  function openMe() {
    modal(`<header><h2>Your account</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body"><div class="member-row" style="border:0">${avatar(state.me.email, 36)}<div><b>${esc(state.me.name)}</b><div class="small muted">${esc(state.me.email)} · ${esc(state.me.role)}</div></div></div>
      <label class="field">Display name<input type="text" id="meName" value="${esc(state.me.name)}"></label></div>
      <footer><button class="btn danger" id="meOut">Sign out</button><span class="spacer"></span><button class="btn primary" id="meSave">Save</button></footer>`);
    $('#meOut').onclick = () => { closeModal(); logout(); };
    $('#meSave').onclick = async () => { try { const r = await post('/api/users', { op: 'profile', name: $('#meName').value }); state.me = r.user; await loadUsers(); closeModal(); render(); toast('Saved'); } catch (e) { toast(e.message); } };
  }

  // =====================================================================
  // MEMBERS (user accounts)
  // =====================================================================
  function openMembers() {
    const isAdmin = state.me.role === 'admin';
    const draw = () => {
      const pending = state.users.filter((u) => u.status === 'pending');
      const active = activeUsers();
      $('#memList').innerHTML = (isAdmin && pending.length ? `<h3>Admin for Approval (${pending.length})</h3>` + pending.map((u) => `
        <div class="member-row">${avatar(u.email, 30)}<div class="grow"><b>${esc(u.name)}</b> <span class="badge fs-clarification">Admin for Approval</span><div class="small muted">${esc(u.email)} · signed up ${esc(fmtFull(u.createdAt))}${u.google ? ' · Google' : ''}</div></div>
        <button class="btn sm primary" data-approve="${esc(u.email)}">Approve</button><button class="btn sm danger" data-remove="${esc(u.email)}">Reject</button></div>`).join('') + '<h3 style="margin-top:14px">Members</h3>' : '') +
        active.map((u) => `<div class="member-row"><span class="pav">${avatar(u.email, 30)}${pdot(u.email)}</span><div class="grow"><b>${esc(u.name)}</b>${u.email === state.me.email ? ' <span class="badge subtle">You</span>' : ''} <span class="badge ${u.role === 'admin' ? 'st-in-progress' : 'subtle'}">${u.role === 'admin' ? 'Admin' : 'Member'}</span>
          <div class="small muted">${esc(u.email)} · ${state.sites.filter((s) => s.assignee === u.email).length} sites · ${esc(presenceText(presenceOf(u.email)))}</div></div>
          ${isAdmin ? `<select data-role="${esc(u.email)}" class="sm-select"><option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select>
          ${u.email !== state.me.email ? `<button class="btn sm ghost" data-reset="${esc(u.email)}" title="Create a temporary password">Reset password</button><button class="btn sm ghost danger" data-remove="${esc(u.email)}" title="Remove">✕</button>` : ''}` : `<span class="badge subtle">${esc(u.role)}</span>`}</div>`).join('');
      const act = (sel, fn) => $$(sel, $('#memList')).forEach((b) => (b.onclick = b.onchange = null, b.tagName === 'SELECT' ? (b.onchange = () => fn(b)) : (b.onclick = () => fn(b))));
      act('[data-approve]', async (b) => { await post('/api/users', { op: 'approve', email: b.dataset.approve }); await loadUsers(); draw(); renderTop(); toast('Approved'); });
      act('[data-remove]', async (b) => { if (!confirm('Remove this account?')) return; await post('/api/users', { op: 'remove', email: b.dataset.remove }); await loadUsers(); draw(); renderTop(); });
      act('[data-role]', async (b) => { try { await post('/api/users', { op: 'role', email: b.dataset.role, role: b.value }); await loadUsers(); toast('Role updated'); } catch (e) { toast(e.message); await loadUsers(); } draw(); });
      act('[data-reset]', async (b) => {
        if (!confirm('Create a temporary password for this member? Their current password stops working.')) return;
        const r = await post('/api/users', { op: 'resetPassword', email: b.dataset.reset });
        prompt('Temporary password — send it to them privately. They can change it later with "Forgot password".', r.tempPassword);
      });
    };
    modal(`<header><h2>Team members</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body"><p class="small muted" style="margin:0">Everyone who registers (admins and members) is listed here automatically. New accounts show as <b>Admin for Approval</b> until ${isAdmin ? 'you approve them' : 'an admin approves them'}.</p><div id="memList"></div></div>
      <footer><button class="btn" data-close>Done</button></footer>`);
    draw();
    loadUsers().then(draw).catch(() => {});
  }

  // =====================================================================
  // ADD WEBSITE + SCANNING
  // =====================================================================
  function parseLink(input) {
    try {
      const u = new URL(input.trim());
      const m = u.pathname.match(/\/(?:site|preview|editor\/direct|editor)\/([A-Za-z0-9_-]{4,})/);
      return { host: u.hostname, siteId: m ? m[1] : '' };
    } catch (e) { return { host: '', siteId: '' }; }
  }
  function openAdd() {
    modal(`<header><h2>Add website(s)</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <label class="field">Duda editor link(s), one per line
          <textarea id="addLinks" rows="5" autofocus placeholder="https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home"></textarea></label>
        <label class="field">Assign to<select id="addWho">${userOptions(state.me.email, 'Unassigned')}</select></label>
        <p class="small muted" style="margin:0">Each site is scanned on Desktop, Tablet and Mobile and compared to its Duda Business Info. Keep this tab open while scans run (${SCAN_CONCURRENCY_SITES} at a time).</p>
      </div>
      <footer><button class="btn" data-close>Cancel</button><button class="btn primary" id="addGo">Add &amp; start audit</button></footer>`);
    const addBody = $('.modal .body');
    // Warn about duplicates while typing
    const dupHint = document.createElement('div'); dupHint.id = 'addDup'; addBody.insertBefore(dupHint, addBody.children[1]);
    const findExisting = (siteId) => state.sites.find((x) => x.siteId === siteId);
    const showDups = () => {
      const ids = [...new Set($('#addLinks').value.split(/\s+/).map((l) => parseLink(l).siteId).filter(Boolean))];
      const d = ids.map(findExisting).filter(Boolean);
      dupHint.innerHTML = d.length ? `<div class="note unk">${d.map((x) => `<div><b>Already exists:</b> ${esc(x.businessName || x.siteId)} <span class="faint mono">${esc(x.siteId)}</span> · <a href="#/site/${esc(x.id)}" data-open-existing>Open existing audit</a></div>`).join('')}<div class="small faint">These are skipped. Use <b>Rescan</b> on the existing audit instead.</div></div>` : '';
      $$('[data-open-existing]', dupHint).forEach((a) => (a.onclick = () => closeModal()));
    };
    $('#addLinks').addEventListener('input', showDups);
    $('#addGo').onclick = async () => {
      const lines = $('#addLinks').value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return toast('Paste at least one editor link');
      $('#addGo').disabled = true;
      let added = 0, bad = 0; const dups = []; const seen = new Set();
      for (const link of lines) {
        const p = parseLink(link);
        if (!p.siteId) { bad++; continue; }
        if (seen.has(p.siteId)) continue; seen.add(p.siteId);
        const ex = findExisting(p.siteId);
        if (ex) { dups.push(ex); continue; }
        try { const sum = await store({ op: 'create', siteId: p.siteId, host: p.host, editorUrl: link, assignee: $('#addWho').value }); upsertSummary(sum); enqueue(sum.id); added++; }
        catch (e) {
          if (e.status === 409) { await loadSites().catch(() => {}); dups.push(findExisting(p.siteId) || { id: e.data && e.data.id, siteId: p.siteId }); }
          else { bad++; toast(e.message); }
        }
      }
      render();
      if (!dups.length) { closeModal(); toast(`${added} added${bad ? ` · ${bad} invalid` : ''}`); return; }
      // Keep the dialog open to show which ones already exist, with a way to open them
      $('.modal').innerHTML = `<header><h2>${added ? `${added} added · ` : ''}${dups.length} already exist${dups.length > 1 ? '' : 's'}</h2><button class="btn ghost" data-close>✕</button></header>
        <div class="body"><table class="grid"><thead><tr><th>Website</th><th>Status</th><th>Last scan</th><th></th></tr></thead><tbody>
        ${dups.map((x) => `<tr><td><b>${esc(x.businessName || x.siteId)}</b><div class="faint mono small">${esc(x.siteId)}</div></td><td>${esc(x.status || '')}</td><td class="small">${x.scan && x.scan.finishedAt ? esc(fmtDate(x.scan.finishedAt)) : '—'}</td>
          <td><a class="btn sm primary" href="#/site/${esc(x.id)}" data-open-existing>Open existing audit</a></td></tr>`).join('')}
        </tbody></table>${bad ? `<p class="small muted">${bad} link(s) weren't valid Duda editor links.</p>` : ''}</div>
        <footer><button class="btn" data-close>Close</button></footer>`;
      $$('[data-close]', $('.modal')).forEach((b) => (b.onclick = closeModal));
      $$('[data-open-existing]', $('.modal')).forEach((a) => (a.onclick = () => closeModal()));
    };
  }
  function enqueue(id) {
    if (!state.queue.includes(id) && !state.scanning[id]) state.queue.push(id);
    state.scanning[id] = state.scanning[id] || { done: 0, total: 0, message: 'Queued', queued: true };
    pump();
  }
  function pump() {
    while (state.running < SCAN_CONCURRENCY_SITES && state.queue.length) {
      const id = state.queue.shift();
      state.running++;
      scanSite(id).catch((e) => console.error(e)).finally(() => { state.running--; delete state.scanning[id]; render(); pump(); });
    }
  }
  window.addEventListener('beforeunload', (e) => { if (state.running || state.queue.length) { e.preventDefault(); e.returnValue = ''; } });

  async function scanSite(id) {
    const site = await api('/api/store?op=site&id=' + encodeURIComponent(id));
    const t0 = Date.now();
    delete state.skipAI[id];
    const startedAt = new Date().toISOString();
    state.scanning[id] = { done: 0, total: 0, message: 'Reading Business Info…' };
    upsertSummary(await store({ op: 'scanState', id, scan: { state: 'scanning', startedAt, error: '' } })); render();
    const log = [];
    try {
      let meta = null;
      try { meta = await api('/api/site?editor=' + encodeURIComponent(site.editorUrl)); } catch (e) { log.push('Duda API call failed: ' + e.message); }
      const host = (meta && meta.host) || site.host;
      if (meta) (meta.errors || []).forEach((x) => log.push(x));
      let truth = meta ? A.buildTruth({ site: meta.site, content: meta.content }) : null;
      if (truth && truth.source === 'none') truth = null;
      const pagesMeta = {};
      ((meta && meta.pages) || []).forEach((p) => { pagesMeta[A.normalizePath(p.path)] = p; });
      const res = await A.runScan({
        siteId: site.siteId, host, truth, pagesMeta, seedPaths: Object.keys(pagesMeta), concurrency: 4,
        fetchPage: async (path, device) => {
          const q = new URLSearchParams({ host, site: site.siteId, path, device });
          for (let attempt = 0; attempt < 3; attempt++) {
            try { const r = await api('/api/fetch?' + q); if (r.status || attempt === 2) return r; } catch (e) { if (attempt === 2) return { status: 0, html: '', error: e.message }; }
            await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
          }
        },
        checkUrls: (urls) => post('/api/check', { urls }),
        onProgress: (p) => { state.scanning[id] = p; renderProgress(id); },
      });
      log.push(...res.log);
      // Pages whose "AI check pending" item was checked by hand: the AI skips them, and the item stays as Done
      const manual = (site.findings || []).filter((f) => /^AI_PENDING/.test(f.code) && (f.status === 'done' || f.status === 'false'));
      res.aiSkip = new Set(manual.map((f) => pendKey(f)));
      const aiAlt = await aiAltCheck(res, id, log);
      const aiText = await aiTextCheck(res, id, log, aiAlt && aiAlt.paused);
      let aiSummary = null;
      if (aiAlt || aiText) {
        const used = [...new Set([].concat((aiAlt && aiAlt.used) || [], (aiText && aiText.used) || []))];
        const paused = (aiText && aiText.paused) || (aiAlt && aiAlt.paused) || null;
        aiSummary = Object.assign({}, aiAlt || { checked: 0, cached: 0, flagged: 0, softened: 0 }, { text: aiText, aliases: used.join(', '), paused });
        const pend = [].concat(pendingFindings('alt', (aiAlt && aiAlt.pending) || [], paused), pendingFindings('text', (aiText && aiText.pending) || [], paused));
        aiSummary.pendingItems = pend.length;
        res.findings.push(...pend);
      }
      manual.forEach((f) => { if (!res.findings.some((x) => x.id === f.id)) res.findings.push(stripState(f)); });
      res.counts = { critical: 0, warning: 0, info: 0 }; res.findings.forEach((f) => { res.counts[f.severity]++; });
      const profiles = await checkProfiles(res.truth);
      const sum = await store({ op: 'saveScan', id, result: {
        host, businessName: res.truth.businessName || site.businessName, truth: res.truth, profiles, findings: res.findings, pages: res.pages,
        scan: { state: 'complete', startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, pages: res.pages.length, externalLinks: res.externalLinks, images: res.images, counts: res.counts, log, by: state.me.email, ai: aiSummary },
      } });
      upsertSummary(sum);
      toast(`Scan complete: ${sum.businessName || site.siteId} · ${res.counts.critical} critical`);
    } catch (e) {
      console.error(e);
      try { upsertSummary(await store({ op: 'scanState', id, scan: { state: 'failed', error: String(e.message || e), finishedAt: new Date().toISOString(), log } })); } catch (x) { /* ignore */ }
      toast('Scan failed: ' + (e.message || e));
    }
    if (state.current && state.current.id === id) await loadSite(id);
  }
  // ---------- AI alt-text judgement ----------
  const AI_LABEL = { describes_image: 'Describes the photo (OK)', this_business: 'Refers to this business (OK)', other_business: 'Names another business', wrong_location: "Location doesn't match", placeholder: 'Placeholder / stock text', unclear: 'Unclear', partner_logo: 'Brand / partner logo (OK)', name_variant: 'Business name written differently' };
  async function aiAltCheck(res, id, log) {
    if (!state.ai || !state.ai.enabled || !(res.alts || []).length) return null;
    const t = res.truth || {};
    const compact = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const business = aiBusiness(res);
    const skip = res.aiSkip || new Set();
    const items = res.alts.map((a, i) => ({ i, alt: a.alt, file: a.file, src: a.src || '', location: a.location, isLogo: !!a.isLogo, brandLogo: !!a.brandLogo, logoRow: a.logoRow || 0 }))
      .filter((x) => compact(x.alt) !== compact(t.businessName) && x.alt.length >= 2 && !skip.has('alt|' + ((res.alts[x.i].pages || [])[0] || '/')));
    let pending = [];
    const verdicts = new Array(res.alts.length);
    let done = 0, cached = 0, errors = 0, waits = 0, paused = null; const used = new Set(); const slow = {};
    for (let k = 0; k < items.length; k += 50) {
      state.scanning[id] = Object.assign({}, state.scanning[id], { message: `✨ AI checking alt text ${Math.min(k + 50, items.length)}/${items.length}` }); renderProgress(id);
      try {
        if (state.skipAI[id]) { paused = { retryAt: aiResumeAt() || srvNow(), next: '', skipped: true }; pending = pending.concat(items.slice(k).map((x) => res.alts[x.i])); break; }
        const r = await aiPost(id, { op: 'alt', business, items: items.slice(k, k + 50) });
        aiUpdate(r); if (r.alias) used.add(r.alias);
        (r.results || []).forEach((v) => { verdicts[v.i] = v; done++; if (v.cached) cached++; });
      } catch (e) {
        if (state.skipAI[id]) { k -= 50; continue; }
        if (e.status === 504) { if (!slow[k]) { slow[k] = 1; k -= 50; continue; } pending.push(...items.slice(k, k + 50).map((x) => res.alts[x.i])); log.push('AI alt-text check: no answer in time for one batch, kept as pending'); continue; }
        const w = await aiWait(e, id, waits++);
        if (w === 'retry') { k -= 50; continue; }
        if (w && w.paused) { paused = w.paused; pending = pending.concat(items.slice(k).map((x) => res.alts[x.i])); break; }
        errors++; log.push('AI alt-text check: ' + e.message); if (e.status === 429 || e.status === 400) break;
      }
    }
    res.findings = A.applyAltVerdicts(res.findings, res.alts, verdicts, t);
    res.counts = { critical: 0, warning: 0, info: 0 }; res.findings.forEach((f) => { res.counts[f.severity]++; });
    const flagged = res.findings.filter((f) => f.ai && /^AI_/.test(f.code)).length;
    const softened = res.findings.filter((f) => f.ai && f.code === 'ALT_LOGO_NAME' && f.severity !== 'critical').length;
    return { checked: done, cached, flagged, softened, errors, total: items.length, used: [...used], paused, pending };
  }
  function aiBusiness(res) {
    const t = res.truth || {};
    const addr = (t.addresses || [])[0] || {};
    return {
      name: t.businessName, names: t.names || [], street: addr.street || '', city: addr.city || '', region: addr.region || '', zip: addr.zip || '',
      areaPages: (res.pages || []).map((p) => p.path).filter((p) => p !== '/').slice(0, 60),
      foreignNames: [...new Set(res.findings.filter((f) => f.foreignName).map((f) => f.foreignName))],
    };
  }
  /** AI reads the page text (service pages first, then blog posts) looking for another business's name, a wrong city, or a misspelled business name. */
  async function aiTextCheck(res, id, log, pausedAlready) {
    if (!state.ai || !state.ai.enabled || !(res.texts || []).length) return null;
    const skip = res.aiSkip || new Set();
    const todoTexts = res.texts.filter((b) => !skip.has('text|' + ((b.pages || [])[0] || '/')));
    if (pausedAlready) return { blocks: 0, of: res.texts.length, truncated: false, cached: 0, flagged: 0, errors: 0, used: [], paused: pausedAlready, pending: (() => { let n = 0; return todoTexts.filter((b) => (n += Math.min(1500, b.text.length)) <= 120000); })() };
    const MAX_CHARS = 120000, BATCH_CHARS = 9000, BATCH_ITEMS = 45;
    const business = aiBusiness(res);
    const blocks = []; let total = 0;
    res.texts.forEach((b, i) => { if (skip.has('text|' + ((b.pages || [])[0] || '/'))) return; if (total < MAX_CHARS) { blocks.push({ i, text: b.text.slice(0, 1500), location: b.location, page: b.pages[0] }); total += Math.min(1500, b.text.length); } });
    const batches = []; let cur = [], size = 0;
    blocks.forEach((b) => { if (cur.length && (size + b.text.length > BATCH_CHARS || cur.length >= BATCH_ITEMS)) { batches.push(cur); cur = []; size = 0; } cur.push(b); size += b.text.length; });
    if (cur.length) batches.push(cur);
    const issues = []; let cached = 0, errors = 0, sent = 0, waits = 0, paused = null, pending = []; const used = new Set(); const slow = {};
    for (let k = 0; k < batches.length; k++) {
      state.scanning[id] = Object.assign({}, state.scanning[id], { message: `✨ AI reading page text ${k + 1}/${batches.length}` }); renderProgress(id);
      try {
        if (state.skipAI[id]) { paused = { retryAt: aiResumeAt() || srvNow(), next: '', skipped: true }; pending = pending.concat([].concat(...batches.slice(k)).map((x) => res.texts[x.i])); break; }
        const r = await aiPost(id, { op: 'text', business, items: batches[k] });
        aiUpdate(r); if (r.alias) used.add(r.alias);
        issues.push(...(r.results || [])); cached += r.cachedCount || 0; sent += batches[k].length;
      } catch (e) {
        if (state.skipAI[id]) { k--; continue; }
        if (e.status === 504) { if (!slow[k]) { slow[k] = 1; k--; continue; } pending.push(...batches[k].map((x) => res.texts[x.i])); log.push('AI page-text check: no answer in time for one batch, kept as pending'); continue; }
        const w = await aiWait(e, id, waits++);
        if (w === 'retry') { k--; continue; }
        if (w && w.paused) { paused = w.paused; pending = pending.concat([].concat(...batches.slice(k)).map((x) => res.texts[x.i])); break; }
        errors++; log.push('AI page-text check: ' + e.message);
        if (e.status === 429 || e.status === 400) break;
      }
    }
    const before = res.findings.length;
    res.findings = A.applyTextIssues(res.findings, res.texts, issues, res.truth);
    return { blocks: sent, of: res.texts.length, truncated: blocks.length < res.texts.length, cached, flagged: res.findings.length - before, errors, used: [...used], paused, pending };
  }
  // ---------- AI models: status, countdowns, waiting ----------
  const srvNow = () => Date.now() + (state.aiSkew || 0);
  function fmtLeft(ms) {
    if (ms <= 0) return 'now';
    const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
  }
  const countdown = (until) => `<span class="cd" data-until="${Number(until) || 0}">${fmtLeft(until - srvNow())}</span>`;
  setInterval(() => {
    $$('[data-until]').forEach((el) => { const left = Number(el.dataset.until) - srvNow(); el.textContent = left > 0 ? fmtLeft(left) : 'available now'; el.classList.toggle('cd-done', left <= 0); });
  }, 1000);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-ai-status]')) { e.preventDefault(); location.hash = '#/ai'; } });
  let aiPageTimer = null;
  function aiUpdate(r) {
    if (!r || !r.providers || !state.ai) return;
    state.ai.providers = r.providers;
    if (r.now) state.aiSkew = r.now - Date.now();
    renderAiChip();
    if (route().name === 'ai' && !aiPageTimer) { aiPageTimer = setTimeout(() => { aiPageTimer = null; if (route().name === 'ai') renderAiPage(); }, 300); }
  }
  /** POST to the AI with a time limit, so a slow or stuck request never freezes the scan. "Skip AI" aborts it. */
  async function aiPost(id, body) {
    const ctl = new AbortController();
    state.aiAbort[id] = ctl;
    const t = setTimeout(() => ctl.abort(), 125000);
    try { return await api('/api/ai', { method: 'POST', body: JSON.stringify(body), signal: ctl.signal }); }
    catch (e) { if (e.name === 'AbortError') throw Object.assign(new Error(state.skipAI[id] ? 'Skipped' : 'The AI took too long to answer'), { status: state.skipAI[id] ? 499 : 504 }); throw e; }
    finally { clearTimeout(t); if (state.aiAbort[id] === ctl) delete state.aiAbort[id]; }
  }
  function skipAI(id) { state.skipAI[id] = true; const c = state.aiAbort[id]; if (c) c.abort(); toast('Skipping the AI check. Unchecked pages become "AI check pending" items.'); }

  /** All models busy? Wait with a live countdown when it's short, otherwise pause the AI check for this scan. */
  async function aiWait(e, id, waits) {
    if (!(e && e.status === 429 && e.data && e.data.allBusy)) return null;
    aiUpdate(e.data);
    const next = (e.data.providers || []).filter((p) => p.until).sort((a, b) => a.until - b.until)[0];
    const left = (e.data.retryAt || 0) - srvNow();
    if (left > 3 * 60000 || waits > 8) return { paused: { retryAt: e.data.retryAt, next: next ? next.label : '' } };
    const end = Date.now() + Math.max(1500, left + 1500);
    while (Date.now() < end) {
      state.scanning[id] = Object.assign({}, state.scanning[id], { message: `✨ All AI models busy. ${next ? next.label + ' is' : 'One is'} free again in ${fmtLeft(end - Date.now())}` });
      renderProgress(id);
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    return 'retry';
  }
  const AI_STATE = {
    ready: ['Ready', 'good'], cooling: ['Resting (per-minute limit)', 'unk'], limit: ['Daily limit reached', 'bad'],
    credits: ['Out of credits', 'bad'], error: ['Problem', 'bad'],
  };
  function renderAiChip() {
    const b = $('#btnAi'); if (!b) return;
    const list = (state.ai && state.ai.providers) || [];
    b.hidden = !(state.ai && state.ai.enabled);
    const ready = list.filter((p) => p.ready || !(p.until > srvNow())).length;
    b.innerHTML = `<span class="ai-dot ${ready ? 'good' : 'unk'}"></span> ✨ <span class="hide-sm">AI ${ready}/${list.length}</span>`;
    b.title = ready ? `${ready} of ${list.length} AI models ready` : 'All AI models are resting. Click to see when they come back.';
  }



  // ---------- "AI check pending" audit items (created when every AI model ran out mid-scan) ----------
  const pendKey = (f) => (f.code === 'AI_PENDING_ALT' ? 'alt|' : 'text|') + (f.path || '/');
  function stripState(f) { const c = Object.assign({}, f); ['status', 'assignee', 'num', 'comments', 'statusBy', 'statusAt', 'done'].forEach((k) => delete c[k]); return c; }
  function pendingFindings(kind, list, paused) {
    if (!list || !list.length) return [];
    const byPage = new Map();
    list.forEach((x) => { const pg = (x.pages || [])[0] || '/'; if (!byPage.has(pg)) byPage.set(pg, []); byPage.get(pg).push(x); });
    const out = [];
    byPage.forEach((arr, pg) => {
      const first = arr[0];
      const union = (k) => [...new Set([].concat(...arr.map((x) => x[k] || [])))];
      const items = arr.slice(0, 80).map((x) => kind === 'alt'
        ? { alt: x.alt, file: x.file || '', src: x.src || '', location: x.location, isLogo: !!x.isLogo, brandLogo: !!x.brandLogo, logoRow: x.logoRow || 0, selector: x.selector, pages: x.pages, devices: x.devices, visibleOn: x.visibleOn, hiddenOn: x.hiddenOn }
        : { text: String(x.text).slice(0, 1500), selector: x.selector, location: x.location, pages: x.pages, devices: x.devices, visibleOn: x.visibleOn, hiddenOn: x.hiddenOn });
      const f = {
        code: kind === 'alt' ? 'AI_PENDING_ALT' : 'AI_PENDING_TEXT', severity: 'warning', category: 'AI check pending',
        message: kind === 'alt' ? `Image alt text not AI-checked yet (${items.length} image${items.length > 1 ? 's' : ''})` : `Page copy not AI-checked yet (${items.length} text block${items.length > 1 ? 's' : ''})`,
        found: kind === 'alt' ? items.map((x) => `"${x.alt}"`).slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '') : '"' + items[0].text.slice(0, 140) + (items[0].text.length > 140 ? '…' : '') + '"',
        expected: kind === 'alt' ? 'Alt text describes the image or names this business, with no other business or wrong city' : 'Only this business name and its own city / service areas',
        path: pg, pages: [pg], devices: union('devices'), visibleOn: union('visibleOn'), hiddenOn: [],
        selector: first.selector, location: kind === 'alt' ? 'Images' : 'Page copy', snippet: '',
        aiPending: { kind, items, since: new Date().toISOString(), retryAt: paused ? paused.retryAt : 0 },
      };
      f.id = A.hash([f.code, pg].join('|'));
      out.push(f);
    });
    return out;
  }
  /** When will the AI be back? 0 = a model is ready now, null = no AI set up. */
  function aiResumeAt(fallback) {
    const list = (state.ai && state.ai.providers) || [];
    if (!list.length) return fallback || null;
    const now = srvNow();
    if (list.some((p) => p.ready || !(p.until > now))) return 0;
    return Math.min(...list.map((p) => p.until));
  }
  const fmtWhen = (t) => new Date(t - (state.aiSkew || 0)).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function aiPendingHtml(f, full) {
    if (!f.aiPending) return '';
    if (f.status === 'done' || f.status === 'false') return `<div class="ai-pend ok">✓ Checked manually. The AI will skip this.</div>`;
    const at = aiResumeAt(f.aiPending.retryAt);
    if (at === 0) return `<div class="ai-pend ready">✨ AI credits available again. This resumes automatically while someone has the app open.${full ? ' <button class="btn sm primary" id="drAiNow">Run AI check now</button>' : ''}</div>`;
    return `<a class="ai-pend wait" href="#/ai" data-stop>⏳ No more AI credits · will resume after <b>${esc(at ? fmtWhen(at) : 'the next reset')}</b>${at ? ` <span class="faint">(in ${countdown(at)})</span>` : ''}</a>
      ${full ? '<div class="small muted" style="margin-top:6px">You can check this by hand now: read the text below, then mark this item <b>Done</b>. The AI will not recheck it.</div>' : ''}`;
  }
  function aiPendingList(f) {
    if (!f.aiPending) return '';
    const items = f.aiPending.items || [];
    return `<div class="k" style="margin-top:14px">${f.aiPending.kind === 'alt' ? 'Images to check' : 'Text to check'} (${items.length})</div>
      <ol class="pend-list">${items.map((x, k) => `<li>${f.aiPending.kind === 'alt' ? `<b>${esc(x.alt)}</b> <span class="faint small">${esc(x.file || '')}</span>` : esc(x.text.length > 400 ? x.text.slice(0, 400) + '…' : x.text)}
        <div class="small"><span class="faint">${esc(x.location || '')}</span> · <button class="linkbtn" data-pshow="${k}">👁 Show on page</button></div></li>`).join('')}</ol>`;
  }

  // ---------- Resume the AI check for "AI check pending" items once a model is back ----------
  let aiResumeBusy = false;
  async function aiResume(siteId, manual) {
    if (aiResumeBusy) { if (manual) toast('An AI check is already running'); return; }
    aiResumeBusy = true;
    try {
      const lock = await store({ op: 'aiLock', id: siteId });
      if (!lock.ok) { if (manual) toast('Someone else is already resuming this AI check'); return; }
      const s = await api('/api/store?op=site&id=' + encodeURIComponent(siteId));
      const open = (s.findings || []).filter((f) => /^AI_PENDING/.test(f.code) && f.status !== 'done' && f.status !== 'false');
      if (!open.length) { await store({ op: 'aiUnlock', id: siteId }); return; }
      const rest = (s.findings || []).filter((f) => !open.includes(f)).map(stripState);
      const alts = [].concat(...open.filter((f) => f.code === 'AI_PENDING_ALT').map((f) => f.aiPending.items || []));
      const texts = [].concat(...open.filter((f) => f.code === 'AI_PENDING_TEXT').map((f) => f.aiPending.items || []));
      const res = { truth: s.truth || {}, pages: s.pages || [], findings: rest, alts, texts };
      delete state.skipAI[siteId];
      state.scanning[siteId] = { done: 0, total: 0, message: '✨ Resuming AI check…', ai: true }; renderProgress(siteId);
      const log = [];
      const before = rest.length;
      const aiAlt = alts.length ? await aiAltCheck(res, siteId, log) : null;
      const aiText = texts.length ? await aiTextCheck(res, siteId, log, aiAlt && aiAlt.paused) : null;
      const paused = (aiText && aiText.paused) || (aiAlt && aiAlt.paused) || null;
      const pend = [].concat(pendingFindings('alt', (aiAlt && aiAlt.pending) || [], paused), pendingFindings('text', (aiText && aiText.pending) || [], paused));
      res.findings.push(...pend);
      const counts = { critical: 0, warning: 0, info: 0 }; res.findings.forEach((f) => { counts[f.severity]++; });
      const used = [...new Set([].concat((aiAlt && aiAlt.used) || [], (aiText && aiText.used) || []))];
      const scan = Object.assign({}, s.scan || {}, { counts });
      scan.ai = Object.assign({}, scan.ai || {}, { paused, pendingItems: pend.length, resumedAt: new Date().toISOString(), resumedBy: state.me.email,
        aliases: [...new Set([].concat(String((scan.ai || {}).aliases || '').split(', ').filter(Boolean), used))].join(', ') });
      delete scan.ai.provider; delete scan.ai.model;
      const checked = ((aiAlt && aiAlt.checked) || 0) + ((aiText && aiText.blocks) || 0);
      const sum = await store({ op: 'saveScan', mode: 'aiResume', id: siteId, result: { findings: res.findings, scan }, aiLog: { checked, flagged: res.findings.length - before - pend.length, stillPending: pend.length } });
      upsertSummary(sum);
      if (checked || manual) toast(`✨ AI check resumed for ${s.businessName || s.siteId}: ${checked} checked${pend.length ? `, ${pend.length} item(s) still waiting` : ''}`);
      if (state.current && state.current.id === siteId) { await loadSite(siteId); renderSite(); }
    } catch (e) {
      console.error(e); try { await store({ op: 'aiUnlock', id: siteId }); } catch (x) { /* ignore */ }
      if (manual) toast('AI check failed: ' + e.message);
    } finally { aiResumeBusy = false; delete state.scanning[siteId]; if (route().name === 'sites') renderSites(); if (route().name === 'ai') renderAiPage(); }
  }
  async function aiResumeTick() {
    if (!state.me || !state.ai || !state.ai.enabled || aiResumeBusy || state.running || state.queue.length) return;
    const waiting = (state.sites || []).filter((x) => x.counts && x.counts.aiPending > 0 && !state.scanning[x.id]);
    if (!waiting.length) return;
    try { const r = await api('/api/ai'); aiUpdate(r); } catch (e) { return; }
    if (aiResumeAt() !== 0) return;
    await aiResume(waiting[0].id, false);
  }
  setInterval(aiResumeTick, 60000);
  setTimeout(aiResumeTick, 8000);

  // ---------- AI Status page ----------
  function renderAiPage() {
    const list = (state.ai && state.ai.providers) || [];
    const now = srvNow();
    const free = list.filter((p) => p.free);
    const leftOf = (p) => { const parked = !p.ready && p.until > now && (p.state === 'limit' || p.state === 'credits' || p.state === 'error'); return parked ? 0 : p.limit ? Math.max(0, p.limit - p.used) : null; };
    const broken = list.length && list.every((p) => !p.ready && p.until > now && p.state === 'error');
    const total = free.reduce((a, p) => a + (p.limit || 0), 0);
    const used = free.reduce((a, p) => a + (p.limit ? Math.min(p.used, p.limit) : 0), 0);
    const left = free.reduce((a, p) => a + (leftOf(p) || 0), 0);
    const at = aiResumeAt();
    const waiting = (state.sites || []).filter((x) => x.counts && x.counts.aiPending > 0);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    $('#view').innerHTML = `<div class="page-head"><h1>✨ AI Status</h1><div class="row-between"><button class="btn" id="aiTest" title="Sends one tiny request to each model (uses 1 credit each)">Test all models</button><button class="btn" id="aiRefresh">Refresh</button></div></div>
      ${!state.ai || !state.ai.enabled ? `<div class="panel panel-pad"><p>AI checks aren't set up yet.${state.ai && state.ai.owner ? ' Add the AI keys in Vercel (see the README), then redeploy.' : ' Ask the app owner to turn them on.'}</p></div>` : `
      <div class="ai-stats">
        <div class="panel panel-pad stat"><div class="k">Free credits per day</div><div class="big">${total || '—'}</div><div class="small faint">requests, all free models</div></div>
        <div class="panel panel-pad stat"><div class="k">Used today</div><div class="big">${used}</div><div class="meter"><span style="width:${pct(used, total)}%"></span></div></div>
        <div class="panel panel-pad stat"><div class="k">Left today</div><div class="big ${left ? 'ok' : 'bad'}">${left}</div><div class="small faint">${pct(left, total)}% of today's free credits</div></div>
        <div class="panel panel-pad stat"><div class="k">AI right now</div><div class="big ${at === 0 ? 'ok' : 'bad'}">${at === 0 ? 'Available' : broken ? 'Needs attention' : 'Paused'}</div><div class="small faint">${at === 0 ? 'At least one model can answer' : broken ? 'Every model has a setup problem (see below). Click <b>Test all models</b> to retry now.' : at ? `Back in ${countdown(at)} · ${esc(fmtWhen(at))}` : ''}</div></div>
      </div>
      <div class="ai-cards">${list.map((p, k) => {
        const parked = !p.ready && p.until > now;
        const [lbl, cls] = parked ? (AI_STATE[p.state] || [p.state, 'unk']) : ['Ready', 'good'];
        const l = leftOf(p);
        return `<div class="panel panel-pad ai-card">
          <div class="row-between"><div><span class="faint small">#${k + 1}</span> <b>${esc(p.label)}</b> ${p.free ? '<span class="badge scan-complete">Free</span>' : '<span class="badge">Paid</span>'}</div><span class="small"><span class="ai-dot ${cls}"></span> ${esc(lbl)}</span></div>
          <div class="small faint" style="margin:2px 0 10px">${p.realLabel ? `<span class="mono" title="Only you (the app owner) can see this">${esc(p.realLabel)} · ${esc(p.model)}</span>${p.auto ? ` <span class="badge subtle" title="${esc(p.configured)} was retired, so the app picked the current model automatically">auto-selected</span>` : ''}` : 'AI model'}</div>
          <div class="row-between small"><span>Used today <b>${p.used}</b>${p.limit ? ` of ${p.limit}` : ''}</span><span>${l === null ? 'No daily cap' : `<b>${l}</b> left`}</span></div>
          ${p.limit ? `<div class="meter"><span style="width:${pct(Math.min(p.used, p.limit), p.limit)}%" class="${l === 0 ? 'full' : ''}"></span></div>` : ''}
          ${parked ? `<div class="note ${cls === 'bad' ? 'bad' : 'unk'}" style="margin-top:10px">${p.state === 'error' ? 'Retrying automatically' : 'Back'} in <b>${countdown(p.until)}</b> · ${esc(fmtWhen(p.until))}${p.note ? `<div class="small faint">${esc(p.note)}</div>` : ''}${p.state === 'error' ? `<div style="margin-top:6px"><button class="btn sm" data-aitest="${esc(p.id)}">Try again now</button></div>` : ''}</div>` : ''}
          <div class="small muted" style="margin-top:8px">Daily reset in ${countdown(p.resetsAt)} · ${esc(fmtWhen(p.resetsAt))}</div></div>`;
      }).join('')}</div>
      <div class="panel panel-pad" style="margin-top:16px"><h2>Waiting for AI credits (${waiting.length})</h2>
        ${waiting.length ? `<table class="grid"><thead><tr><th>Website</th><th>Items waiting</th><th>Resumes</th><th></th></tr></thead><tbody>${waiting.map((x) => `<tr>
          <td><a href="#/site/${esc(x.id)}">${esc(x.businessName || x.siteId)}</a></td>
          <td>${x.counts.aiPending} item(s) · ${x.counts.aiPendingBlocks} text blocks / images</td>
          <td>${state.scanning[x.id] ? '<span class="badge sev-info">Resuming now…</span>' : at === 0 ? 'Automatically, within a minute' : at ? `after ${esc(fmtWhen(at))} <span class="faint">(${countdown(at)})</span>` : '—'}</td>
          <td>${at === 0 && !state.scanning[x.id] ? `<button class="btn sm" data-resume="${esc(x.id)}">Run now</button>` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<p class="muted small">Nothing is waiting. When every model runs out during a scan, the unchecked pages show up here and resume automatically.</p>'}
      </div>
      <p class="small muted" style="margin-top:12px">Credits are counted as requests. One request checks up to about 45 text blocks or 50 image alt texts. Models are tried top to bottom (<code>AI_ORDER</code> in Vercel); when one runs out, the next one answers. Results are cached for 60 days, so rescans don't use credits. Audit items marked <b>Done</b> by hand are never sent to the AI.</p>`}`;
    const rf = $('#aiRefresh'); if (rf) rf.onclick = async () => { try { const r = await api('/api/ai'); aiUpdate(r); renderAiPage(); } catch (e) { toast(e.message); } };
    $$('[data-resume]').forEach((b) => (b.onclick = () => aiResume(b.dataset.resume, true)));
    const runTest = async (btn, id) => {
      btn.disabled = true; const t = btn.textContent; btn.textContent = 'Testing…';
      try {
        const r = await post('/api/ai', { op: 'test', id });
        aiUpdate(r); renderAiPage();
        toast((r.tested || []).map((x) => `${x.alias || 'AI'}: ${x.ok ? 'working' + (x.model ? ' (' + x.model + ')' : '') : 'still failing'}`).join(' · ') || 'Nothing to test');
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = t; }
    };
    const tb = $('#aiTest'); if (tb) tb.onclick = () => runTest(tb);
    $$('[data-aitest]').forEach((b) => (b.onclick = () => runTest(b, b.dataset.aitest)));
  }

  function aiNote(f, full) {
    if (!f.ai) return '';
    const ok = ['describes_image', 'this_business', 'partner_logo'].includes(f.ai.verdict);
    return `<div class="ai-note ${ok ? 'ok' : 'bad'}"><span class="badge ai-badge">✨ AI</span> <b>${esc(AI_LABEL[f.ai.verdict] || f.ai.verdict)}</b>${f.ai.reason ? ' · ' + esc(f.ai.reason) : ''} <span class="faint">(${Math.round((f.ai.confidence || 0) * 100)}% sure)</span>
      ${full && f.ai.suggestion ? `<div class="ai-sugg">${/^AI_TEXT/.test(f.code) ? 'Suggested wording' : 'Suggested alt text'}: <b>${esc(f.ai.suggestion)}</b> <button class="btn sm ghost" data-copy="${esc(f.ai.suggestion)}">Copy</button></div>` : ''}</div>`;
  }

  async function checkProfiles(truth) {
    const urls = [];
    const add = (net, u) => { if (u && !urls.some((x) => x.url === u)) urls.push({ net, url: u }); };
    const links = truth.socialLinks || {};
    (links.facebook || truth.socials.facebook || []).forEach((h) => add('Facebook', A.socialUrl('facebook', h)));
    (links.google_my_business || []).forEach((h) => add('Google Business', A.socialUrl('google_my_business', h)));
    if (!urls.length) return { checked: false, items: [], note: 'No Facebook or Google Business profile in Business Info.' };
    let out = [];
    try { out = await post('/api/social', { urls: urls.map((u) => u.url) }); } catch (e) { return { checked: false, items: [], note: 'Profile check failed: ' + e.message }; }
    const items = out.map((r, i) => {
      const net = urls[i].net;
      if (!r.ok) {
        // Google Maps links carry the place name in the URL, so the name can still be compared without reading the page
        const place = net === 'Google Business' ? A.placeNameFromUrl(urls[i].url) : '';
        if (place && truth.businessName) {
          const same = A.matchesBusiness(place, truth);
          return { net, url: urls[i].url, title: place, result: same ? 'match' : 'mismatch', text: same
            ? `Google Business listing "${place}" (from the link) matches the business name. Phone and email could not be read automatically, so compare those by hand.`
            : `Google Business link points to "${place}", but Business Info says "${truth.businessName}". Check it's the right listing.` };
        }
        return { net, url: urls[i].url, result: 'unverified', text: `Could not read the ${net} page automatically (${r.error || 'login wall / blocked'}). Open it and compare name, phone and email manually.` };
      }
      const issues = [];
      if (r.title && truth.businessName && !A.matchesBusiness(r.title, truth)) issues.push(`Name on ${net} is "${r.title}" (Business Info: "${truth.businessName}")`);
      (r.phones || []).forEach((p) => { if (truth.phones.length && !truth.phones.includes(p.slice(-10))) issues.push(`${net} shows phone ${A.fmtPhone(p)} (Business Info: ${truth.phones.map(A.fmtPhone).join(', ')})`); });
      (r.emails || []).forEach((em) => { if (truth.emails.length && !truth.emails.includes(em)) issues.push(`${net} shows email ${em} (Business Info: ${truth.emails.join(', ')})`); });
      return { net, url: urls[i].url, title: r.title, result: issues.length ? 'mismatch' : 'match', text: issues.length ? issues.join(' · ') : `${net} profile "${r.title}" matches the business name.` };
    });
    return { checked: true, items };
  }

  // =====================================================================
  // ROUTING
  // =====================================================================
  function route() {
    const h = location.hash.replace(/^#/, '') || '/';
    const parts = h.split('/').filter(Boolean);
    if (parts[0] === 'site' && parts[1]) return { name: 'site', id: decodeURIComponent(parts[1]), tab: parts[2] === 'comments' ? 'comments' : parts[2] === 'activity' ? 'activity' : 'findings', item: parts[2] === 'item' ? Number(parts[3]) : null };
    if (parts[0] === 'guide' || parts[0] === 'about') return { name: 'about' };
    if (parts[0] === 'activity') return { name: 'activity' };
    if (parts[0] === 'ai') return { name: 'ai' };
    if (parts[0] === 'suggestions') return { name: 'suggestions' };
    return { name: 'sites' };
  }
  let lastSiteId = null;
  async function render() {
    if (!state.me) return renderAuth();
    const r = route();
    markNav();
    if (r.name === 'site') {
      if (!state.current || state.current.id !== r.id || lastSiteId !== r.id) {
        $('#view').innerHTML = '<div class="empty">Loading…</div>';
        try { await loadSite(r.id); } catch (e) { state.current = null; }
        lastSiteId = r.id;
      }
      return renderSite();
    }
    lastSiteId = null; state.current = null; closeDrawer(true);
    if (r.name === 'about') return renderAbout();
    if (r.name === 'activity') return renderGlobalActivity();
    if (r.name === 'ai') { renderAiPage(); api('/api/ai').then((x) => { state.ai = Object.assign(state.ai || {}, x); aiUpdate(x); }).catch(() => {}); return; }
    if (r.name === 'suggestions') return renderSuggestions();
    if (/members=1/.test(location.hash)) { history.replaceState(null, '', '#/'); setTimeout(openMembers, 50); }
    return renderSites();
  }

  // =====================================================================
  // WEBSITES LIST
  // =====================================================================
  function scanBadge(s) {
    const live = state.scanning[s.id];
    if (live) {
      if (live.queued) return `<span class="badge scan-queued">Queued</span>`;
      const pct = live.total ? Math.round((live.done / live.total) * 100) : 3;
      if (live.message !== live._m) { live._m = live.message; live.since = Date.now(); }
      return `<span class="badge scan-scanning" id="pb-${esc(s.id)}">${live.ai && !live.total ? 'AI check' : `Scanning ${live.total ? `${live.done}/${live.total}` : '…'}`}</span><div class="progress"><i id="pg-${esc(s.id)}" style="width:${pct}%"></i></div><div class="small faint" id="pm-${esc(s.id)}">${esc(live.message || '')}</div><div class="live-line small" id="pl-${esc(s.id)}">${liveLine(s.id, live)}</div>`;
    }
    const sc = s.scan || {};
    if (sc.state === 'complete') return `<span class="badge scan-complete">✓ Scan complete</span><div class="small faint">${esc(fmtDate(sc.finishedAt))} · ${sc.pages || 0} pages</div>`;
    if (sc.state === 'failed') return `<span class="badge scan-failed" title="${esc(sc.error)}">Scan failed</span>`;
    if (sc.state === 'scanning' || sc.state === 'queued') {
      const age = Date.now() - new Date(sc.startedAt || s.createdAt || 0).getTime();
      return age > 20 * 60000 || sc.state === 'queued' ? `<span class="badge scan-interrupted" title="The tab running this scan was closed">Interrupted, rescan</span>` : `<span class="badge scan-scanning">Scanning (another tab)</span>`;
    }
    return `<span class="badge scan-none">Not scanned</span>`;
  }
  function renderProgress(id) {
    const live = state.scanning[id]; if (!live) return;
    const bar = document.getElementById('pg-' + id);
    if (!bar) { if (!document.getElementById('pb-' + id) && route().name === 'sites') renderSites(); return; }
    bar.style.width = (live.total ? Math.round((live.done / live.total) * 100) : 3) + '%';
    const m = document.getElementById('pm-' + id); if (m) m.textContent = live.message || '';
    if (live.message !== live._m) { live._m = live.message; live.since = Date.now(); const l = document.getElementById('pl-' + id); if (l) l.innerHTML = liveLine(id, live); }
    const b = document.getElementById('pb-' + id); if (b) b.textContent = `Scanning ${live.done}/${live.total}`;
  }
  /** Live line under the progress bar: a pulsing dot, seconds on the current step, and "Skip AI" during AI steps. */
  function liveLine(id, live) {
    const isAI = /✨/.test(live.message || '');
    return `<span class="pulse-dot"></span> <span data-since="${live.since || Date.now()}" data-ai="${isAI ? 1 : 0}">working…</span>${isAI && !state.skipAI[id] ? ` · <button class="linkbtn" data-skipai="${esc(id)}" title="Stop the AI check for this scan. Unchecked pages become 'AI check pending' items that resume later.">Skip AI for now</button>` : ''}`;
  }
  setInterval(() => {
    $$('[data-since]').forEach((el) => {
      const sec = Math.floor((Date.now() - Number(el.dataset.since)) / 1000);
      const ai = el.dataset.ai === '1';
      let t = sec < 2 ? 'working…' : `${sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + String(sec % 60).padStart(2, '0') + 's'} on this step`;
      if (ai && sec >= 30 && sec < 130) t += '. Still working: the AI can take up to 2 minutes when models are busy';
      else if (ai && sec >= 130) t += '. This looks stuck: it will retry automatically, or skip the AI for now';
      else if (!ai && sec >= 45) t += '. Waiting for a slow page to load';
      el.textContent = t; el.classList.toggle('slow', (ai && sec >= 130) || (!ai && sec >= 45));
    });
  }, 1000);
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-skipai]'); if (b) { e.preventDefault(); e.stopPropagation(); skipAI(b.dataset.skipai); b.remove(); } });
  function issueChips(c, done) {
    c = c || {};
    const chips = [];
    if (c.critical) chips.push(`<span class="badge sev-critical">${c.critical} critical</span>`);
    if (c.warning) chips.push(`<span class="badge sev-warning">${c.warning} warning</span>`);
    if (c.info) chips.push(`<span class="badge sev-info">${c.info} info</span>`);
    if (c.clarification) chips.push(`<span class="badge fs-clarification">${c.clarification} for clarification</span>`);
    if (c.hold) chips.push(`<span class="badge fs-hold">${c.hold} on hold</span>`);
    if (c.comments) chips.push(`<span class="badge subtle">💬 ${c.comments}</span>`);
    if (!chips.length && done) chips.push('<span class="badge scan-complete">No open issues</span>');
    return `<span class="chips">${chips.join('')}</span>`;
  }
  function renderSites() {
    const f = state.filters;
    const list = state.sites.filter((s) => (!f.status || s.status === f.status) && (!f.assignee || (f.assignee === '_none' ? !s.assignee : f.assignee === '_mine' ? s.assignee === state.me.email : s.assignee === f.assignee)) &&
      (!f.q || (s.businessName + ' ' + s.siteId + ' ' + s.editorUrl + ' ' + (s.addedByName || '')).toLowerCase().includes(f.q.toLowerCase())))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const tot = { crit: 0, clar: 0, complete: 0, scanned: 0 };
    state.sites.forEach((s) => { const c = s.counts || {}; tot.crit += c.critical || 0; tot.clar += c.clarification || 0; if (s.status === 'Complete') tot.complete++; if (s.scan && s.scan.state === 'complete') tot.scanned++; });
    $('#view').innerHTML = `
      <div class="page-head"><div><h1>Websites</h1><div class="muted">Audit Duda sites against their Business Info on every device.</div></div></div>
      <div class="stats">
        <div class="panel stat"><div class="n">${state.sites.length}</div><div class="l">Websites</div></div>
        <div class="panel stat"><div class="n">${tot.scanned}</div><div class="l">Scan complete</div></div>
        <div class="panel stat"><div class="n" style="color:var(--crit)">${tot.crit}</div><div class="l">Open critical issues</div></div>
        <div class="panel stat"><div class="n" style="color:var(--query)">${tot.clar}</div><div class="l">For clarification</div></div>
        <div class="panel stat"><div class="n" style="color:var(--ok)">${tot.complete}</div><div class="l">Marked Complete</div></div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <input type="search" id="fq" placeholder="Search business name, site ID or who added it…" value="${esc(f.q)}">
          <select id="fstatus"><option value="">All statuses</option>${SITE_STATUSES.map((s) => `<option ${s === f.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <select id="fwho"><option value="">Everyone</option><option value="_mine" ${f.assignee === '_mine' ? 'selected' : ''}>Assigned to me</option><option value="_none" ${f.assignee === '_none' ? 'selected' : ''}>Unassigned</option>${activeUsers().map((u) => `<option value="${esc(u.email)}" ${u.email === f.assignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
          <span class="spacer"></span>
          <button class="btn sm" id="rescanAll">Rescan all shown</button>
        </div>
        ${list.length ? `<div class="table-wrap"><table class="grid">
          <thead><tr><th>Website</th><th>Assigned</th><th>Status</th><th>Scan</th><th>Open issues</th><th>Closed</th><th></th></tr></thead>
          <tbody>${list.map((s) => {
            const c = s.counts || {};
            const pct = c.total ? Math.round(((c.closed || 0) / c.total) * 100) : 0;
            return `<tr class="row-link" data-open="${esc(s.id)}">
              <td><div class="site-name">${esc(s.businessName || 'Not scanned yet')}</div><div class="small muted mono">${esc(s.siteId)} · ${esc(s.host)}</div>
                <div class="small faint">Added by ${esc(s.addedByName || nameOf(s.addedBy, '—'))}${s.createdAt ? ' · ' + esc(fmtDate(s.createdAt)) : ''}</div></td>
              <td data-stop><span class="member-select">${avatar(s.assignee)}<select data-assign="${esc(s.id)}">${userOptions(s.assignee)}</select></span></td>
              <td data-stop><select class="pill st-${slug(s.status)}" data-status="${esc(s.id)}">${SITE_STATUSES.map((x) => `<option ${x === s.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
              <td>${scanBadge(s)}</td>
              <td>${issueChips(c, s.scan && s.scan.state === 'complete')}</td>
              <td style="min-width:110px"><div class="small">${c.closed || 0}/${c.total || 0}</div><div class="progress"><i style="width:${pct}%;background:var(--ok)"></i></div></td>
              <td data-stop style="white-space:nowrap"><button class="btn sm" data-rescan="${esc(s.id)}" ${state.scanning[s.id] ? 'disabled' : ''}>Rescan</button>
                ${state.me.role === 'admin' || s.addedBy === state.me.email ? `<button class="btn sm ghost danger" data-delete="${esc(s.id)}" title="Delete">✕</button>` : ''}</td>
            </tr>`;
          }).join('')}</tbody></table></div>` : `<div class="empty">${state.sites.length ? 'No websites match these filters.' : 'No websites yet. Click <b>+ Add website</b> and paste a Duda editor link.'}</div>`}
      </div>`;
    const v = $('#view');
    $('#fq').oninput = (e) => { f.q = e.target.value; const p = e.target.selectionStart; renderSites(); const i = $('#fq'); i.focus(); i.setSelectionRange(p, p); };
    $('#fstatus').onchange = (e) => { f.status = e.target.value; renderSites(); };
    $('#fwho').onchange = (e) => { f.assignee = e.target.value; renderSites(); };
    $('#rescanAll').onclick = () => { if (list.length && confirm(`Rescan ${list.length} website(s)?`)) { list.forEach((s) => enqueue(s.id)); renderSites(); } };
    $$('[data-open]', v).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('[data-stop]')) location.hash = '#/site/' + tr.dataset.open; }));
    $$('[data-assign]', v).forEach((sel) => (sel.onchange = async () => { upsertSummary(await store({ op: 'patchSite', id: sel.dataset.assign, changes: { assignee: sel.value } })); renderSites(); }));
    $$('[data-status]', v).forEach((sel) => (sel.onchange = async () => { upsertSummary(await store({ op: 'patchSite', id: sel.dataset.status, changes: { status: sel.value } })); renderSites(); }));
    $$('[data-rescan]', v).forEach((b) => (b.onclick = () => { enqueue(b.dataset.rescan); renderSites(); }));
    $$('[data-delete]', v).forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this website with its audit, comments and activity log?')) return;
      try { await store({ op: 'deleteSite', id: b.dataset.delete }); state.sites = state.sites.filter((s) => s.id !== b.dataset.delete); renderSites(); } catch (e) { toast(e.message); }
    }));
  }

  // =====================================================================
  // RICH TEXT (mentions, #IDs, links)
  // =====================================================================
  function formatText(text, site) {
    let h = esc(text || '');
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/@\[([^\]\n]{1,60})\]/g, (m, n) => `<span class="mention">@${n}</span>`);
    h = h.replace(/(^|[\s(])#(\d{1,5})\b/g, (m, pre, n) => {
      const f = site && (site.findings || []).find((x) => x.num === Number(n));
      return f ? `${pre}<a class="item-ref" href="#/site/${esc(site.id)}/item/${n}" title="${esc(f.message)}">#${n}</a>` : m;
    });
    return h.replace(/\n/g, '<br>');
  }

  // =====================================================================
  // COMMENTS
  // =====================================================================
  function renderComment(c, site, opts = {}) {
    if (c.deleted) return `<div class="comment deleted" id="c-${esc(c.id)}"><div class="c-body faint small">Comment deleted${c.deletedAt ? ' · ' + esc(ago(c.deletedAt)) : ''}</div></div>`;
    const f = site && c.target && c.target !== 'site' ? (site.findings || []).find((x) => x.id === c.target) : null;
    return `<div class="comment ${c.mentions && c.mentions.includes(state.me.email) ? 'mentions-me' : ''}" id="c-${esc(c.id)}">
      ${avatar(c.by, 30)}
      <div class="c-main">
        <div class="c-head"><b>${esc(c.byName || nameOf(c.by))}</b><span class="faint small" title="${esc(fmtFull(c.createdAt))}">${esc(fmtFull(c.createdAt))}</span>
          ${opts.showTarget && f ? `<a class="item-ref small" href="#/site/${esc(site.id)}/item/${f.num}">on #${f.num}</a>` : ''}</div>
        ${c.replyTo ? `<a class="quote" href="#" data-jump="${esc(c.replyTo.id)}"><span class="q-by">↩ ${esc(c.replyTo.byName)}</span>${esc(String(c.replyTo.excerpt || '').replace(/@\[([^\]]+)\]/g, '@$1'))}</a>` : ''}
        ${c.text ? `<div class="c-body">${formatText(c.text, site)}</div>` : ''}
        ${c.images && c.images.length ? `<div class="c-imgs">${c.images.map((u) => `<button class="c-img" data-img="${esc(u)}"><img src="${esc(u)}" alt="Attached screenshot" loading="lazy"></button>`).join('')}</div>` : ''}
        <div class="c-actions"><button class="linkbtn" data-reply="${esc(c.id)}">Reply</button>
          ${!opts.noDelete && (c.by === state.me.email || state.me.role === 'admin') ? `<button class="linkbtn danger" data-delc="${esc(c.id)}">Delete</button>` : ''}</div>
      </div></div>`;
  }
  function bindComments(root, site, composerApi) {
    $$('[data-img]', root).forEach((b) => (b.onclick = () => lightbox(b.dataset.img)));
    $$('[data-jump]', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); const t = document.getElementById('c-' + a.dataset.jump); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1500); } }));
    $$('[data-reply]', root).forEach((b) => (b.onclick = () => { const c = site.comments.find((x) => x.id === b.dataset.reply); if (c && composerApi) composerApi.replyTo(c); }));
    $$('[data-delc]', root).forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this comment?')) return;
      try { await store({ op: 'deleteComment', siteId: site.id, commentId: b.dataset.delc }); await loadSite(site.id); renderSite(); } catch (e) { toast(e.message); }
    }));
  }

  /** Comment box with @mentions, #ID suggestions, pasted/attached screenshots and reply-quote. */
  function composer(host, { site, target, placeholder, onPosted, onSubmit, submitLabel, noMentions, allowEmpty }) {
    host.innerHTML = `<div class="composer">
      <div class="reply-bar" hidden></div>
      <div class="ta-wrap"><textarea rows="3" placeholder="${esc(placeholder || 'Write a comment… Type @ to tag a member, # to link an audit item. Paste a screenshot with Cmd/Ctrl+V.')}"></textarea><div class="suggest" hidden></div></div>
      <div class="c-previews"></div>
      <div class="composer-foot"><label class="btn sm ghost attach" title="Attach image">📎 Image<input type="file" accept="image/*" multiple hidden></label>
        <span class="small faint">Cmd/Ctrl+Enter to send</span><span class="spacer"></span><button class="btn sm primary" type="button">${esc(submitLabel || 'Comment')}</button></div></div>`;
    const ta = $('textarea', host), sug = $('.suggest', host), prev = $('.c-previews', host), bar = $('.reply-bar', host), btn = $('.composer-foot .btn.primary', host), file = $('input[type=file]', host);
    const images = []; let uploading = 0; let replyTo = null; let sel = 0; let items = [];
    const refresh = () => {
      prev.innerHTML = images.map((im, i) => `<div class="pv">${im.url ? `<img src="${esc(im.url)}" alt="">` : '<div class="pv-load">Uploading…</div>'}<button type="button" data-rm="${i}" title="Remove">✕</button></div>`).join('');
      $$('[data-rm]', prev).forEach((b) => (b.onclick = () => { images.splice(Number(b.dataset.rm), 1); refresh(); }));
      btn.disabled = uploading > 0;
    };
    async function addFile(f) {
      if (!f || !/^image\//.test(f.type)) return;
      const slot = { url: '' }; images.push(slot); uploading++; refresh();
      try { const { data, type } = await compressImage(f); const r = await post('/api/img', { data, type }); slot.url = r.url; }
      catch (e) { images.splice(images.indexOf(slot), 1); toast('Image upload failed: ' + e.message); }
      uploading--; refresh();
    }
    ta.addEventListener('paste', (e) => { const fs = Array.from((e.clipboardData || {}).items || []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()); if (fs.length) { e.preventDefault(); fs.forEach(addFile); } });
    host.addEventListener('dragover', (e) => { e.preventDefault(); host.classList.add('drag'); });
    host.addEventListener('dragleave', () => host.classList.remove('drag'));
    host.addEventListener('drop', (e) => { e.preventDefault(); host.classList.remove('drag'); Array.from(e.dataTransfer.files || []).forEach(addFile); });
    file.onchange = () => { Array.from(file.files).forEach(addFile); file.value = ''; };
    // Suggestions
    const hideSug = () => { sug.hidden = true; items = []; };
    const showSug = () => {
      if (!items.length) return hideSug();
      sug.innerHTML = items.map((it, i) => `<div class="sg ${i === sel ? 'on' : ''}" data-i="${i}">${it.html}</div>`).join(''); sug.hidden = false;
      $$('.sg', sug).forEach((d) => (d.onmousedown = (e) => { e.preventDefault(); pick(Number(d.dataset.i)); }));
    };
    let trig = null;
    const pick = (i) => {
      const it = items[i]; if (!it || !trig) return;
      const v = ta.value, pos = ta.selectionStart;
      ta.value = v.slice(0, trig.start) + it.insert + ' ' + v.slice(pos);
      const np = trig.start + it.insert.length + 1; ta.setSelectionRange(np, np); ta.focus(); hideSug();
    };
    ta.addEventListener('input', () => {
      const pos = ta.selectionStart, before = ta.value.slice(0, pos);
      let m = noMentions ? null : before.match(/(^|\s)@([^\s@#\[\]]{0,30})$/);
      if (m) {
        trig = { start: pos - m[2].length - 1 }; const q = m[2].toLowerCase(); sel = 0;
        items = activeUsers().filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q)).slice(0, 6)
          .map((u) => ({ insert: `@[${u.name}]`, html: `${avatar(u.email, 22)}<span>${esc(u.name)}</span><span class="faint small">${esc(u.email)}</span>` }));
        return showSug();
      }
      m = before.match(/(^|\s)#(\d{0,5})$/);
      if (m && site && site.findings && site.findings.length) {
        trig = { start: pos - m[2].length - 1 }; sel = 0;
        items = site.findings.filter((f) => !m[2] || String(f.num).startsWith(m[2])).sort((a, b) => a.num - b.num).slice(0, 7)
          .map((f) => ({ insert: `#${f.num}`, html: `<b>#${f.num}</b><span class="badge sev-${f.severity}">${esc(f.severity)}</span><span class="sg-t">${esc(f.message)}</span>` }));
        return showSug();
      }
      hideSug();
    });
    ta.addEventListener('keydown', (e) => {
      if (!sug.hidden && items.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; return showSug(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; return showSug(); }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pick(sel); }
        if (e.key === 'Escape') { e.stopPropagation(); return hideSug(); }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
    ta.addEventListener('blur', () => setTimeout(hideSug, 150));
    async function submit() {
      if (uploading) return toast('Wait for the image to finish uploading');
      const text = ta.value.trim();
      const imgs = images.filter((i) => i.url).map((i) => i.url);
      if (!text && !imgs.length && !allowEmpty) return;
      const mentions = [];
      (text.match(/@\[([^\]\n]{1,60})\]/g) || []).forEach((tok) => { const n = tok.slice(2, -1).toLowerCase(); activeUsers().filter((u) => u.name.toLowerCase() === n).forEach((u) => { if (!mentions.includes(u.email)) mentions.push(u.email); }); });
      btn.disabled = true;
      try {
        if (onSubmit) await onSubmit({ text, images: imgs, mentions, replyTo: replyTo ? replyTo.id : null });
        else await store({ op: 'comment', siteId: site.id, target, text, images: imgs, mentions, replyTo: replyTo ? replyTo.id : null });
        ta.value = ''; images.length = 0; api_.replyTo(null); refresh();
        if (onPosted) await onPosted();
      } catch (e) { toast(e.message); }
      btn.disabled = false;
    }
    btn.onclick = submit;
    const api_ = {
      replyTo(c) {
        replyTo = c;
        bar.hidden = !c;
        if (c) { bar.innerHTML = `<span>↩ Replying to <b>${esc(c.byName)}</b>: <span class="muted">${esc((c.text || '[image]').replace(/@\[([^\]]+)\]/g, '@$1').slice(0, 90))}</span></span><button type="button" class="linkbtn">Cancel</button>`; $('button', bar).onclick = () => api_.replyTo(null); ta.focus(); host.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      },
      busy: () => !!ta.value.trim() || images.length > 0 || uploading > 0,
    };
    return api_;
  }
  /**
   * Every pasted or uploaded image is optimized in the browser before upload:
   * resized to at most 1600px wide (and ~4 megapixels for tall full-page screenshots), then saved as WebP
   * (JPEG where WebP isn't supported), stepping the quality down until it's under ~400 KB.
   * Small PNG screenshots stay PNG when that is smaller, so text stays crisp.
   */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const scale = Math.min(1, 1600 / w, Math.sqrt(4200000 / (w * h)));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, w, h);
        const bytes = (d) => Math.round((d.length - d.indexOf(',') - 1) * 0.75);
        const webpOk = cv.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
        const type = webpOk ? 'image/webp' : 'image/jpeg';
        const TARGET = 400 * 1024;
        let q = 0.82, best = cv.toDataURL(type, q);
        while (bytes(best) > TARGET && q > 0.45) { q -= 0.08; best = cv.toDataURL(type, q); }
        let outType = type;
        if (file.type === 'image/png' && scale === 1 && file.size < bytes(best)) { const png = cv.toDataURL('image/png'); if (bytes(png) <= bytes(best)) { best = png; outType = 'image/png'; } }
        resolve({ data: best.split(',')[1], type: outType, bytes: bytes(best), original: file.size, width: w, height: h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  // =====================================================================
  // SITE DETAIL
  // =====================================================================
  const effWho = (f, s) => f.assignee || s.assignee || '';
  function devChips(f) {
    return A.DEVICES.map((d) => {
      if (!(f.devices || []).includes(d)) return '';
      const on = (f.visibleOn || []).includes(d);
      return `<span class="dev ${on ? 'on' : 'hidden'}" title="${on ? 'Visible on ' + A.DEVICE_LABEL[d] : 'In the HTML but hidden on ' + A.DEVICE_LABEL[d]}">${A.DEVICE_LABEL[d]}${on ? '' : ' (hidden)'}</span>`;
    }).join('');
  }
  const previewUrl = (site, path, device) => `https://${site.host}/site/${site.siteId}${path === '/' ? '' : path}?preview=true&insitepreview=true&dm_device=${device || 'desktop'}`;
  const statusSelect = (f, attr) => `<select class="pill fs-${f.status}" ${attr}="${esc(f.id)}">${FSTATUS.map((s) => `<option value="${s.v}" ${s.v === f.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>`;

  function filteredFindings(s) {
    const ff = state.ff;
    return (s.findings || []).filter((f) => {
      if (ff.st === 'active' && !['open', 'clarification'].includes(f.status)) return false;
      if (ff.st !== 'active' && ff.st !== 'all' && f.status !== ff.st) return false;
      if (ff.sev && f.severity !== ff.sev) return false;
      if (ff.cat === '__ai' ? !f.ai : ff.cat && f.category !== ff.cat) return false;
      if (ff.loc && f.location !== ff.loc) return false;
      if (ff.dev === 'hidden' && (f.visibleOn || []).length) return false;
      if (ff.dev && ff.dev !== 'hidden' && !(f.visibleOn || []).includes(ff.dev)) return false;
      if (ff.who && (ff.who === '_none' ? effWho(f, s) : ff.who === '_mine' ? effWho(f, s) !== state.me.email : effWho(f, s) !== ff.who)) return false;
      if (ff.q) { const q = ff.q.replace(/^#/, ''); if (!(String(f.num) === q || [f.message, f.found, f.expected, f.path, f.selector, f.location].join(' ').toLowerCase().includes(ff.q.toLowerCase()))) return false; }
      return true;
    }).sort((a, b) => (a.num || 0) - (b.num || 0));
  }

  let siteComposer = null;
  function renderSite() {
    const s = state.current;
    if (!s) { $('#view').innerHTML = `<div class="empty">Website not found. <a href="#/">Back to list</a></div>`; return; }
    const r = route();
    const scrollY = window.scrollY;
    const live = state.scanning[s.id];
    const findings = s.findings || [];
    const cnt = (st) => findings.filter((f) => f.status === st).length;
    const generalComments = (s.comments || []).filter((c) => c.target === 'site' && !c.deleted).length;
    const sc = s.scan || {};
    $('#view').innerHTML = `
      <div class="page-head">
        <div><div class="small"><a href="#/">← All websites</a></div>
          <h1>${esc(s.businessName || s.siteId)}</h1>
          <div class="muted mono small">${esc(s.siteId)} · ${esc(s.host)}</div>
          <div class="small faint">Added by ${esc(s.addedByName || nameOf(s.addedBy, '—'))}${s.createdAt ? ' · ' + esc(fmtFull(s.createdAt)) : ''}</div>
          <div class="last-scan">${sc.finishedAt ? `🕑 Last scan: <b>${esc(fmtFull(sc.finishedAt))}</b>${sc.by || sc.startedBy ? ' by ' + esc(nameOf(sc.by || sc.startedBy)) : ''}${sc.state === 'failed' ? ' <span class="badge scan-failed">last attempt failed</span>' : ''}` : '🕑 Not scanned yet'}${live ? ' <span class="badge scan-scanning">Scanning now</span>' : ''}</div></div>
        <div class="head-actions">
          <span class="member-select">${avatar(s.assignee)}<select id="sAssign">${userOptions(s.assignee)}</select></span>
          <select class="pill st-${slug(s.status)}" id="sStatus">${SITE_STATUSES.map((x) => `<option ${x === s.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <a class="btn" href="${esc(s.editorUrl)}" target="_blank" rel="noopener">Open editor ↗</a>
          <a class="btn" href="https://${esc(s.host)}/preview/${esc(s.siteId)}" target="_blank" rel="noopener">Preview ↗</a>
          <button class="btn" id="sCsv" ${findings.length ? '' : 'disabled'}>Export CSV</button>
          <button class="btn primary" id="sRescan" ${live ? 'disabled' : ''}>${live ? 'Scanning…' : 'Rescan'}</button>
        </div>
      </div>
      <div class="tabs">
        <a href="#/site/${esc(s.id)}" class="${r.tab === 'findings' ? 'on' : ''}">Audit items <span class="tcount">${findings.length}</span></a>
        <a href="#/site/${esc(s.id)}/comments" class="${r.tab === 'comments' ? 'on' : ''}">Comments <span class="tcount">${generalComments}</span></a>
        <a href="#/site/${esc(s.id)}/activity" class="${r.tab === 'activity' ? 'on' : ''}">Activity log</a>
      </div>
      <div id="tabBody"></div>`;
    $('#sAssign').onchange = async (e) => { upsertSummary(await store({ op: 'patchSite', id: s.id, changes: { assignee: e.target.value } })); await loadSite(s.id); renderSite(); };
    $('#sStatus').onchange = async (e) => { upsertSummary(await store({ op: 'patchSite', id: s.id, changes: { status: e.target.value } })); await loadSite(s.id); renderSite(); };
    $('#sRescan').onclick = () => { enqueue(s.id); renderSite(); };
    $('#sCsv').onclick = () => exportCsv(s);
    const body = $('#tabBody');
    state.renderedTab = r.tab;
    if (r.tab === 'comments') renderCommentsTab(body, s);
    else if (r.tab === 'activity') renderActivityTab(body, s);
    else renderFindingsTab(body, s, { cnt, sc, live });
    window.scrollTo(0, scrollY);
    if (r.item) openDrawer(r.item); else closeDrawer(true);
  }

  function renderFindingsTab(body, s, { cnt, sc, live }) {
    const t = s.truth || {};
    const ff = state.ff;
    const findings = s.findings || [];
    const cats = [...new Set(findings.map((f) => f.category))].sort();
    const locs = [...new Set(findings.map((f) => f.location))].sort();
    const shown = filteredFindings(s);
    const socials = Object.entries(t.socials || {}).map(([k, v]) => {
      const links = (t.socialLinks || {})[k] || [];
      const items = v.map((h, i) => { const u = A.socialUrl(k, links[i] || h); const label = k === 'google_my_business' ? (A.placeNameFromUrl(u) || h) : (h || links[i]); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : esc(label); });
      return `${esc(k.replace('google_my_business', 'Google Business'))}: ${items.join(', ')}`;
    }).join('<br>');
    const activeCount = findings.filter((f) => ['open', 'clarification'].includes(f.status));
    const sevCount = (sev) => activeCount.filter((f) => f.severity === sev).length;
    body.innerHTML = `
      <div class="panel panel-pad" style="margin-bottom:16px">${scanBadge(s)}
        ${sc.state === 'complete' ? `<span class="small muted" style="margin-left:8px">3 devices each · ${sc.externalLinks || 0} external links · ${sc.images || 0} images checked · ${Math.round((sc.durationMs || 0) / 1000)}s${sc.by ? ' · by ' + esc(nameOf(sc.by)) : ''}</span>` : ''}
        ${sc.ai ? `<div class="small" style="margin-top:6px">✨ AI reviewed <b>${sc.ai.checked}</b> alt texts${sc.ai.cached ? ` (${sc.ai.cached} from cache)` : ''}: <b>${sc.ai.flagged}</b> flagged${sc.ai.softened ? `, ${sc.ai.softened} logo warning(s) softened` : ''}.
            ${sc.ai.text ? ` Page text: <b>${sc.ai.text.blocks}</b> blocks read${sc.ai.text.truncated ? ` (of ${sc.ai.text.of}, the rest skipped to limit cost)` : ''}, <b>${sc.ai.text.flagged}</b> flagged.` : ''}
            ${sc.ai.aliases ? `<span class="faint">Answered by ${esc(sc.ai.aliases)}</span>` : ''} <a href="javascript:void 0" class="small" data-ai-status>AI models ↗</a></div>
            ${sc.ai.paused && (s.findings || []).some((x) => /^AI_PENDING/.test(x.code) && x.status !== 'done' && x.status !== 'false') ? `<div class="note unk" style="margin-top:6px"><b>AI check paused</b>: every AI model ran out of free credits during this scan. The unchecked pages are listed as <b>AI check pending</b> audit items.
              ${aiResumeAt(sc.ai.paused.retryAt) ? `They resume automatically after <b>${esc(fmtWhen(aiResumeAt(sc.ai.paused.retryAt)))}</b> (in ${countdown(aiResumeAt(sc.ai.paused.retryAt))}).` : 'AI credits are available again, so they resume automatically within a minute.'}
              Check them by hand and mark them <b>Done</b> if you can't wait. <a href="#/ai">AI Status ↗</a></div>` : ''}`
          : state.ai && !state.ai.enabled && state.me.role === 'admin' && sc.state === 'complete' ? '<div class="small faint" style="margin-top:6px">✨ AI checks are off. Add the AI keys in Vercel (see the README) to turn them on.</div>' : ''}
        ${sc.error ? `<div class="note bad">${esc(sc.error)}</div>` : ''}
        ${(sc.log || []).length ? `<details style="margin-top:8px"><summary class="small">Scan notes (${sc.log.length})</summary>${sc.log.map((l) => `<div class="note unk">${esc(l)}</div>`).join('')}</details>` : ''}
      </div>
      <details class="ref-details" open>
        <summary class="small muted">Reference data</summary>
        <div class="grid-2">
          <div class="panel panel-pad">
            <h2>Reference: Business Info <span class="badge ${t.source === 'api' ? 'scan-complete' : 'sev-warning'}">${t.source === 'api' ? 'From Duda API' : t.source === 'schema' ? 'Fallback: site schema' : 'Not loaded yet'}</span></h2>
            <div class="truth">
              <div><div class="k">Business name</div><div class="v">${esc((t.names || []).join(' / ') || '—')}</div></div>
              <div><div class="k">Phone</div><div class="v">${esc((t.phones || []).map(A.fmtPhone).join(', ') || '—')}</div></div>
              <div><div class="k">Email</div><div class="v">${esc((t.emails || []).join(', ') || '—')}</div></div>
              <div><div class="k">Address</div><div class="v">${esc((t.addresses || []).map((a) => [a.street, a.city, a.region, a.zip].filter(Boolean).join(', ')).join(' | ') || '—')}</div></div>
              <div><div class="k">Domain</div><div class="v">${esc(t.domain || '—')}</div></div>
              <div><div class="k">Social (Business Info)</div><div class="v small">${socials || '—'}</div></div>
            </div>
          </div>
          <div class="panel panel-pad">
            <h2>Facebook / Google Business check</h2>
            ${s.profiles ? (s.profiles.items || []).map((p) => `<div class="note ${p.result === 'match' ? 'good' : p.result === 'mismatch' ? 'bad' : 'unk'}"><b>${esc(p.net)}</b>: ${esc(p.text)} <a href="${esc(A.socialUrl(p.net === 'Google Business' ? 'google_my_business' : String(p.net).toLowerCase(), p.url))}" target="_blank" rel="noopener">open ↗</a></div>`).join('') + (s.profiles.note ? `<div class="note unk">${esc(s.profiles.note)}</div>` : '') : '<p class="muted small">Runs with each scan.</p>'}
            <p class="small faint" style="margin:8px 0 0">General note only. Facebook and Google often block automated reads, so verify anything marked yellow by hand.</p>
          </div>
        </div>
      </details>
      <div class="panel">
        <div class="toolbar">
          <span class="chips">
            <button class="chipbtn ${ff.sev === '' ? 'active' : ''}" data-sev="">All ${activeCount.length}</button>
            <button class="chipbtn ${ff.sev === 'critical' ? 'active' : ''}" data-sev="critical">Critical ${sevCount('critical')}</button>
            <button class="chipbtn ${ff.sev === 'warning' ? 'active' : ''}" data-sev="warning">Warning ${sevCount('warning')}</button>
            <button class="chipbtn ${ff.sev === 'info' ? 'active' : ''}" data-sev="info">Info ${sevCount('info')}</button>
          </span>
          <select id="ffst">
            <option value="active" ${ff.st === 'active' ? 'selected' : ''}>Open + for clarification (${cnt('open') + cnt('clarification')})</option>
            ${FSTATUS.map((x) => `<option value="${x.v}" ${ff.st === x.v ? 'selected' : ''}>${x.label} (${cnt(x.v)})</option>`).join('')}
            <option value="all" ${ff.st === 'all' ? 'selected' : ''}>All (${findings.length})</option>
          </select>
          <input type="search" id="ffq" placeholder="Search, or #12 to jump to an ID…" value="${esc(ff.q)}">
          <select id="ffcat"><option value="">All categories</option>${findings.some((f) => f.ai) ? `<option value="__ai" ${ff.cat === '__ai' ? 'selected' : ''}>✨ AI-reviewed (${findings.filter((f) => f.ai).length})</option>` : ''}${cats.map((c) => `<option ${c === ff.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="ffloc"><option value="">All locations</option>${locs.map((c) => `<option ${c === ff.loc ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="ffdev"><option value="">All devices</option>${A.DEVICES.map((d) => `<option value="${d}" ${ff.dev === d ? 'selected' : ''}>Visible on ${A.DEVICE_LABEL[d]}</option>`).join('')}<option value="hidden" ${ff.dev === 'hidden' ? 'selected' : ''}>Hidden on all devices</option></select>
          <select id="ffwho"><option value="">Anyone</option><option value="_mine" ${ff.who === '_mine' ? 'selected' : ''}>Assigned to me</option><option value="_none" ${ff.who === '_none' ? 'selected' : ''}>Unassigned</option>${activeUsers().map((u) => `<option value="${esc(u.email)}" ${ff.who === u.email ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        </div>
        ${!findings.length ? `<div class="empty">${sc.state === 'complete' ? 'No issues found.' : live ? 'Scanning… results appear here when it finishes.' : 'Not scanned yet.'}</div>` : !shown.length ? '<div class="empty">No audit items match these filters.</div>' : `
        <div class="table-wrap"><table class="grid findings">
          <thead><tr><th>ID</th><th>Status</th><th>Severity</th><th>Page / path</th><th>Where</th><th>Unique CSS selector</th><th>Finding</th><th title="Comments">💬</th><th>Assignee</th></tr></thead>
          <tbody>${shown.map((f) => {
            const dev = (f.visibleOn && f.visibleOn[0]) || (f.devices && f.devices[0]) || 'desktop';
            const closed = f.status === 'done' || f.status === 'false';
            return `<tr class="row-link ${closed ? 'done' : ''}" data-item="${f.num}">
              <td><a class="item-id" href="#/site/${esc(s.id)}/item/${f.num}">#${f.num}</a></td>
              <td data-stop>${statusSelect(f, 'data-fst')}</td>
              <td><span class="badge sev-${f.severity}">${esc(f.severity)}</span><div class="small faint" style="margin-top:4px">${esc(f.category)}</div></td>
              <td style="max-width:200px" data-stop><a href="${esc(previewUrl(s, f.path, dev))}" target="_blank" rel="noopener" class="mono small" title="Open ${esc(A.DEVICE_LABEL[dev])} preview">${esc(f.path)}</a>
                ${f.pages && f.pages.length > 1 ? `<div class="small muted">+${f.pages.length - 1} more pages</div>` : ''}</td>
              <td><div class="loc">${esc(f.location)}</div>${devChips(f)}</td>
              <td class="cell-sel" data-stop>${f.selector && f.selector !== '(page)' ? `<code class="sel inspect" data-inspect="${esc(f.id)}" title="Click to open the page with this element highlighted">${esc(f.selector)}</code>
                <div class="sel-actions"><button class="linkbtn" data-inspect="${esc(f.id)}">👁 Show on page</button><button class="linkbtn" data-copy="${esc(f.selector)}">Copy</button></div>` : '<span class="faint">(whole page)</span>'}</td>
              <td style="min-width:240px"><div class="finding-msg">${esc(f.message)}</div>
                ${f.found ? `<div class="kv"><b>Found:</b> ${esc(f.found)}</div>` : ''}
                ${f.expected ? `<div class="kv"><b>Expected:</b> ${esc(f.expected)}</div>` : ''}${aiNote(f, false)}${aiPendingHtml(f, false)}</td>
              <td>${f.comments ? `<span class="badge subtle">💬 ${f.comments}</span>` : '<span class="faint small">—</span>'}</td>
              <td data-stop><span class="member-select">${avatar(effWho(f, s))}<select data-fwho="${esc(f.id)}">${userOptions(f.assignee, s.assignee && user(s.assignee) ? `${user(s.assignee).name} (site default)` : 'Unassigned')}</select></span></td>
            </tr>`;
          }).join('')}</tbody></table></div>`}
      </div>
      ${s.pages && s.pages.length ? `<details class="panel panel-pad" style="margin-top:16px"><summary>Pages scanned (${s.pages.length})</summary>
        <div class="table-wrap" style="margin-top:10px"><table class="grid"><thead><tr><th>Path</th><th>SEO title</th><th>Devices</th><th>Status</th></tr></thead><tbody>
        ${s.pages.map((p) => `<tr><td class="mono"><a href="${esc(previewUrl(s, p.path, 'desktop'))}" target="_blank" rel="noopener">${esc(p.path)}</a></td><td>${esc(p.title)}</td><td>${(p.devices || []).map((d) => `<span class="dev on">${A.DEVICE_LABEL[d]}</span>`).join('')}</td><td>${p.notFound ? '<span class="badge sev-critical">404</span>' : p.error ? `<span class="badge sev-warning">${esc(p.error)}</span>` : '<span class="badge scan-complete">OK</span>'}</td></tr>`).join('')}
        </tbody></table></div></details>` : ''}`;

    $$('[data-sev]', body).forEach((b) => (b.onclick = () => { ff.sev = b.dataset.sev; renderSite(); }));
    $('#ffq') && ($('#ffq').oninput = (e) => { ff.q = e.target.value; const p = e.target.selectionStart; renderSite(); const i = $('#ffq'); i.focus(); i.setSelectionRange(p, p); });
    [['#ffst', 'st'], ['#ffcat', 'cat'], ['#ffloc', 'loc'], ['#ffdev', 'dev'], ['#ffwho', 'who']].forEach(([sel, k]) => { const el = $(sel, body); if (el) el.onchange = (e) => { ff[k] = e.target.value; renderSite(); }; });
    $$('[data-copy]', body).forEach((c) => (c.onclick = () => copy(c.dataset.copy, 'Selector copied')));
    $$('[data-inspect]', body).forEach((c) => (c.onclick = () => { const f = s.findings.find((x) => x.id === c.dataset.inspect); if (f) openInspector(s, f); }));
    $$('tr[data-item]', body).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('[data-stop], a, select, button')) return; location.hash = `#/site/${s.id}/item/${tr.dataset.item}`; }));
    $$('[data-fst]', body).forEach((sel) => (sel.onchange = () => setFinding(s, [sel.dataset.fst], { status: sel.value })));
    $$('[data-fwho]', body).forEach((sel) => (sel.onchange = () => setFinding(s, [sel.dataset.fwho], { assignee: sel.value })));
  }
  async function setFinding(s, ids, changes) {
    try { upsertSummary(await store({ op: 'patchFinding', siteId: s.id, findingIds: ids, changes })); await loadSite(s.id); renderSite(); if (changes.status) toast(`Marked ${FLABEL[changes.status]}`); }
    catch (e) { toast('Save failed: ' + e.message); }
  }

  function renderCommentsTab(body, s) {
    const scope = state.commentScope;
    const list = (s.comments || []).filter((c) => scope === 'all' || c.target === 'site');
    body.innerHTML = `<div class="panel panel-pad comments-panel">
      <div class="row-between" style="margin-bottom:10px"><h2 style="margin:0">Discussion</h2>
        <span class="chips"><button class="chipbtn ${scope === 'general' ? 'active' : ''}" data-scope="general">General</button><button class="chipbtn ${scope === 'all' ? 'active' : ''}" data-scope="all">Include audit-item comments</button></span></div>
      <div class="c-list">${list.length ? list.map((c) => renderComment(c, s, { showTarget: true })).join('') : '<div class="empty small">No comments yet. Start the discussion below. Tip: type #12 to link audit item 12.</div>'}</div>
      <div id="siteComposer"></div></div>`;
    $$('[data-scope]', body).forEach((b) => (b.onclick = () => { state.commentScope = b.dataset.scope; renderSite(); }));
    siteComposer = composer($('#siteComposer'), { site: s, target: 'site', onPosted: async () => { await loadSite(s.id); renderSite(); setTimeout(() => { const l = $$('.c-list .comment'); if (l.length) l[l.length - 1].scrollIntoView({ block: 'center' }); }, 50); } });
    bindComments(body, s, siteComposer);
  }

  const ACT_ICON = { ai: '✨', 'scan-start': '▶', 'site-add': '＋', 'site-delete': '🗑', signup: '🙋', approve: '✅', reject: '⛔', remove: '⛔', role: '🛡', reset: '🔑', site: '＋', scan: '⟳', status: '●', assign: '👤', 'item-status': '✓', 'item-assign': '👤', comment: '💬', reply: '↩', 'item-comment': '💬', 'comment-delete': '🗑' };
  function renderActivityTab(body, s) {
    const act = s.activity || [];
    body.innerHTML = `<div class="panel panel-pad"><h2>Activity log</h2>${act.length ? `<ul class="activity">${act.map((e) => {
      let text = esc(e.text).replace(/#(\d+)/g, (m, n) => `<a class="item-ref" href="#/site/${esc(s.id)}/item/${n}">#${n}</a>`);
      if (e.commentId && !e.findingNum) text += ` <a href="#/site/${esc(s.id)}/comments" class="small" data-goc="${esc(e.commentId)}">view</a>`;
      return `<li><span class="a-ic">${ACT_ICON[e.type] || '•'}</span>${avatar(e.by, 24)}<div class="grow"><b>${esc(e.byName || nameOf(e.by))}</b> ${text}</div><div class="a-time"><div>${esc(fmtFull(e.at))}</div><div class="faint">${esc(ago(e.at))}</div></div></li>`;
    }).join('')}</ul>` : '<div class="empty small">No activity yet.</div>'}</div>`;
    $$('[data-goc]', body).forEach((a) => (a.onclick = () => setTimeout(() => { const t = document.getElementById('c-' + a.dataset.goc); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); } }, 300)));
  }

  // ---------- Audit item drawer ----------
  let drawerComposer = null;
  function closeDrawer(silent) {
    const d = $('#drawer'); if (d) d.remove();
    const b = $('#drawerBack'); if (b) b.remove();
    drawerComposer = null;
    document.body.classList.remove('drawer-open');
    if (!silent && route().item) location.hash = `#/site/${route().id}`;
  }
  function openDrawer(num) {
    const s = state.current; if (!s) return;
    const f = (s.findings || []).find((x) => x.num === num);
    if (!f) { toast(`Audit item #${num} not found`); return; }
    const prevScroll = $('#drawer .dr-body') ? $('#drawer .dr-body').scrollTop : 0;
    const keep = drawerComposer && drawerComposer.busy() && $('#drawer') && Number($('#drawer').dataset.num) === num;
    if (keep) return; // don't wipe a comment someone is typing
    closeDrawer(true);
    document.body.classList.add('drawer-open');
    const back = document.createElement('div'); back.id = 'drawerBack'; back.className = 'drawer-back'; back.onclick = () => closeDrawer();
    const d = document.createElement('aside'); d.id = 'drawer'; d.className = 'drawer'; d.dataset.num = num; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', `Audit item #${num}`);
    const dev = (f.visibleOn && f.visibleOn[0]) || (f.devices && f.devices[0]) || 'desktop';
    const comments = (s.comments || []).filter((c) => c.target === f.id);
    const idx = filteredFindings(s).findIndex((x) => x.id === f.id); const list = filteredFindings(s);
    d.innerHTML = `
      <div class="dr-head">
        <div><span class="item-id big">#${f.num}</span> <span class="badge sev-${f.severity}">${esc(f.severity)}</span> <span class="small muted">${esc(f.category)}</span></div>
        <div class="dr-nav">
          <button class="btn sm ghost" id="drPrev" ${idx > 0 ? '' : 'disabled'} title="Previous">↑</button><button class="btn sm ghost" id="drNext" ${idx >= 0 && idx < list.length - 1 ? '' : 'disabled'} title="Next">↓</button>
          <button class="btn sm ghost" id="drLink" title="Copy link to this item">🔗</button><button class="btn sm ghost" id="drClose" title="Close (Esc)">✕</button></div>
      </div>
      <div class="dr-body">
        <h2 class="dr-title">${esc(f.message)}</h2>
        ${f.found ? `<div class="kv"><b>Found:</b> ${esc(f.found)}</div>` : ''}
        ${f.expected ? `<div class="kv"><b>Expected:</b> ${esc(f.expected)}</div>` : ''}
        ${f.snippet && f.snippet !== f.found ? `<div class="snip">${esc(f.snippet)}</div>` : ''}
        ${aiNote(f, true)}${aiPendingHtml(f, true)}
        <div class="dr-meta">
          <div><div class="k">Page</div><a href="${esc(previewUrl(s, f.path, dev))}" target="_blank" rel="noopener" class="mono small">${esc(f.path)} ↗</a>${f.pages && f.pages.length > 1 ? `<details class="small"><summary class="muted">+${f.pages.length - 1} more pages</summary><div class="mono faint">${f.pages.slice(1).map(esc).join('<br>')}</div></details>` : ''}</div>
          <div><div class="k">Where</div><div class="loc">${esc(f.location)}</div>${devChips(f)}${f.hiddenOn && f.hiddenOn.length ? `<div class="small faint">Hidden: ${esc(f.hiddenOn.join(', '))}</div>` : ''}</div>
          <div class="span2"><div class="k">Unique CSS selector</div>${f.selector && f.selector !== '(page)' ? `<code class="sel inspect" id="drInspect2" title="Click to open the page with this element highlighted">${esc(f.selector)}</code>
            <button class="btn sm primary" id="drInspect">👁 Show on page</button> <button class="btn sm ghost" data-copy="${esc(f.selector)}">Copy selector</button>
            <button class="btn sm ghost" id="drSnip" title="Copy a console snippet that scrolls to and highlights this element">⌖ Console snippet</button>` : '<span class="faint">(whole page)</span>'}</div>
        </div>
        ${aiPendingList(f)}
        <div class="k" style="margin-top:14px">Status</div>
        <div class="status-btns">${FSTATUS.map((x) => `<button class="sbtn fs-${x.v} ${f.status === x.v ? 'on' : ''}" data-set="${x.v}">${x.label}</button>`).join('')}</div>
        ${f.statusBy ? `<div class="small faint" style="margin-top:4px">Last changed by ${esc(nameOf(f.statusBy))} · ${esc(fmtFull(f.statusAt))}</div>` : ''}
        <div class="k" style="margin-top:14px">Assignee</div>
        <span class="member-select">${avatar(effWho(f, s))}<select id="drWho">${userOptions(f.assignee, s.assignee && user(s.assignee) ? `${user(s.assignee).name} (site default)` : 'Unassigned')}</select></span>
        <h3 style="margin-top:22px">Discussion <span class="faint">(${comments.filter((c) => !c.deleted).length})</span></h3>
        <div class="c-list">${comments.length ? comments.map((c) => renderComment(c, s)).join('') : '<div class="small faint" style="padding:6px 0 10px">No comments yet. Ask a question or attach a screenshot, then set the status to <b>For clarification</b> if you need an answer.</div>'}</div>
        <div id="drComposer"></div>
      </div>`;
    document.body.appendChild(back); document.body.appendChild(d);
    $('#drClose').onclick = () => closeDrawer();
    $('#drPrev').onclick = () => { if (idx > 0) location.hash = `#/site/${s.id}/item/${list[idx - 1].num}`; };
    $('#drNext').onclick = () => { if (idx < list.length - 1) location.hash = `#/site/${s.id}/item/${list[idx + 1].num}`; };
    $('#drLink').onclick = () => copy(`${location.origin}/#/site/${s.id}/item/${f.num}`, 'Link to #' + f.num + ' copied');
    $$('[data-copy]', d).forEach((c) => (c.onclick = () => copy(c.dataset.copy, c.closest('.ai-sugg') ? 'Suggestion copied' : 'Selector copied')));
    ['#drInspect', '#drInspect2'].forEach((sel) => { const b = $(sel, d); if (b) b.onclick = () => openInspector(s, f); });
    $$('[data-pshow]', d).forEach((b) => (b.onclick = () => { const x = f.aiPending.items[Number(b.dataset.pshow)]; openInspector(s, Object.assign({}, f, { selector: x.selector, path: (x.pages || [f.path])[0], pages: x.pages || [f.path], devices: x.devices || f.devices, visibleOn: x.visibleOn || f.visibleOn, location: x.location })); }));
    if ($('#drAiNow')) $('#drAiNow').onclick = () => aiResume(s.id, true);
    if ($('#drSnip')) $('#drSnip').onclick = () => {
      const snip = `(s=>{const e=document.querySelector(s);if(!e)return console.warn('Not found on this device view:',s);let p=e;while(p){if(p.id==='hamburger-drawer'){console.log('This element is inside the side panel (hamburger menu), so open it to see.');}p=p.parentElement;}e.scrollIntoView({block:'center'});e.style.outline='4px solid #e11d48';e.style.outlineOffset='2px';console.log(e);})(${JSON.stringify(f.selector)})`;
      copy(snip, `Snippet copied. Paste it in the ${A.DEVICE_LABEL[dev]} preview's console.`);
    };
    $$('[data-set]', d).forEach((b) => (b.onclick = () => { if (b.dataset.set !== f.status) setFinding(s, [f.id], { status: b.dataset.set }); }));
    $('#drWho').onchange = (e) => setFinding(s, [f.id], { assignee: e.target.value });
    drawerComposer = composer($('#drComposer'), { site: s, target: f.id, placeholder: 'Comment on this item… @ to tag, # to link another item, paste screenshots with Cmd/Ctrl+V.', onPosted: async () => { await loadSite(s.id); renderSite(); setTimeout(() => { const b = $('#drawer .dr-body'); if (b) b.scrollTop = b.scrollHeight; }, 50); } });
    bindComments(d, s, drawerComposer);
    if (prevScroll) $('.dr-body', d).scrollTop = prevScroll;
  }

  // ---------- Page inspector: open the page for a device and highlight the element ----------
  /**
   * Runs INSIDE the sandboxed preview. Walks from the element up to <html> and undoes anything that hides it:
   * display:none, visibility:hidden, opacity 0 (scroll animations), hidden attribute, content-visibility,
   * screen-reader-only clipping, off-screen transforms/positions and 0-height collapsed containers.
   * Then scrolls to it and reports back what it had to force.
   */
  function inspectorRuntime() {
    var forced = [];
    function label(e) { var s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (e.classList && e.classList.length) s += '.' + [].slice.call(e.classList, 0, 2).join('.'); return s; }
    function setI(e, k, v) { e.style.setProperty(k, v, 'important'); }
    function note(e, why) { var t = (e.hasAttribute('data-dsa-hl') ? 'the element itself' : 'parent ' + label(e)) + ': ' + why; if (forced.indexOf(t) < 0) forced.push(t); }
    function fix() {
      var target = document.querySelector('[data-dsa-hl]'); if (!target) return null;
      for (var e = target; e && e !== document.documentElement; e = e.parentElement) {
        var c = getComputedStyle(e);
        if (e.hasAttribute('hidden')) { e.removeAttribute('hidden'); note(e, 'hidden attribute'); c = getComputedStyle(e); }
        if (c.display === 'none') { setI(e, 'display', 'revert'); if (getComputedStyle(e).display === 'none') setI(e, 'display', 'block'); note(e, 'display: none'); }
        if (c.visibility === 'hidden' || c.visibility === 'collapse') { setI(e, 'visibility', 'visible'); note(e, 'visibility: hidden'); }
        if (parseFloat(c.opacity) < 0.05) { setI(e, 'opacity', '1'); note(e, (e.getAttribute('data-anim-desktop') || e.getAttribute('data-aos') || /anim|aos|wow|fade|reveal/i.test(String(e.className))) ? 'opacity 0 until a scroll animation plays' : 'opacity: 0'); }
        if (c.contentVisibility === 'hidden') { setI(e, 'content-visibility', 'visible'); note(e, 'content-visibility: hidden'); }
        if (c.clipPath && c.clipPath !== 'none') { setI(e, 'clip-path', 'none'); }
        if (c.position === 'absolute' && c.clip && c.clip !== 'auto') { setI(e, 'clip', 'auto'); setI(e, 'width', 'auto'); setI(e, 'height', 'auto'); note(e, 'clipped (screen-reader-only)'); }
        var r = e.getBoundingClientRect();
        if (c.transform && c.transform !== 'none') {
          var m = c.transform.match(/\(([^)]+)\)/); var v = m ? m[1].split(',').map(parseFloat) : [];
          var zero = v.length >= 4 && Math.abs(v[0]) < 0.01 && Math.abs(v[3]) < 0.01;
          if (zero || r.right < 0 || r.left > innerWidth * 1.2 || r.bottom < -100) { setI(e, 'transform', 'none'); note(e, zero ? 'scaled to 0' : 'moved off-screen (transform)'); r = e.getBoundingClientRect(); }
        }
        if ((c.position === 'fixed' || c.position === 'absolute') && (r.right <= 0 || r.left >= document.documentElement.scrollWidth || r.bottom <= -50)) {
          setI(e, 'position', 'relative'); setI(e, 'left', 'auto'); setI(e, 'right', 'auto'); setI(e, 'top', 'auto'); setI(e, 'transform', 'none'); note(e, 'positioned off-screen');
        }
        if ((parseFloat(c.maxHeight) === 0 || (parseFloat(c.height) === 0 && e.scrollHeight > 0)) && c.overflow !== 'visible') { setI(e, 'max-height', 'none'); setI(e, 'height', 'auto'); setI(e, 'overflow', 'visible'); note(e, 'collapsed to 0 height'); }
        if (e.tagName === 'DETAILS' && !e.open) { e.open = true; note(e, 'closed <details>'); }
      }
      var rr = target.getBoundingClientRect();
      return { w: Math.round(rr.width), h: Math.round(rr.height) };
    }
    var sent = false;
    function go(final) {
      var size = fix(); var t = document.querySelector('[data-dsa-hl]');
      if (t) t.scrollIntoView({ block: 'center' });
      if (final && !sent) { sent = true; parent.postMessage({ dsaInspector: true, forced: forced, size: size, found: !!t }, '*'); }
    }
    document.addEventListener('DOMContentLoaded', function () { go(false); });
    window.addEventListener('load', function () { go(false); setTimeout(function () { go(true); }, 400); });
    setTimeout(function () { go(true); }, 2500);
    document.addEventListener('click', function (ev) { var a = ev.target.closest('a'); if (a) ev.preventDefault(); }, true);
  }
  window.addEventListener('message', (ev) => {
    const d = ev.data; const box = $('#inForced');
    if (!d || !d.dsaInspector || !box) return;
    const parts = [];
    if (d.forced && d.forced.length) parts.push(`👁 <b>Shown anyway.</b> On the live page it's hidden by ${d.forced.map((x) => `<code>${esc(x)}</code>`).join(', ')}.`);
    if (d.size && (d.size.w < 2 || d.size.h < 2)) parts.push('⚠ The element has no visible size here (it may be empty, or sized by scripts that don\'t run in this snapshot). Use <b>Open live preview</b> to check.');
    box.innerHTML = parts.map((x) => `<div style="margin-top:4px">${x}</div>`).join('');
  });
  const VIEW_W = { desktop: 1280, tablet: 800, mobile: 390 };
  async function openInspector(s, f, device) {
    const devs = A.DEVICES.filter((d) => (f.devices || []).includes(d));
    device = device || (f.visibleOn && f.visibleOn[0]) || devs[0] || 'desktop';
    const pages = f.pages && f.pages.length ? f.pages : [f.path];
    let page = pages[0];
    const draw = () => modal(`<div class="insp">
      <div class="insp-bar">
        <div class="insp-title"><b>${f.num ? '#' + f.num + ' · ' : ''}${esc(f.message)}</b><div class="small muted mono">${esc(f.selector)}</div></div>
        <div class="insp-controls">
          ${pages.length > 1 ? `<select id="inPage" class="sm-select">${pages.slice(0, 50).map((p) => `<option ${p === page ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : `<span class="mono small">${esc(page)}</span>`}
          <span class="chips">${A.DEVICES.map((d) => `<button class="chipbtn ${d === device ? 'active' : ''}" data-dev="${d}" ${devs.includes(d) ? '' : 'disabled title="Not on this device"'}>${A.DEVICE_LABEL[d]}</button>`).join('')}</span>
          <a class="btn sm" href="${esc(previewUrl(s, page, device))}" target="_blank" rel="noopener">Open live preview ↗</a>
          <button class="btn sm ghost" data-close>✕</button>
        </div>
      </div>
      <div class="insp-note" id="inNote">Loading the ${A.DEVICE_LABEL[device]} page…</div>
      <div class="insp-stage" id="inStage"></div></div>`, { wide: true, full: true });
    draw();
    const load = async () => {
      const note = $('#inNote'), stage = $('#inStage');
      let html = '';
      try { const r = await api('/api/fetch?' + new URLSearchParams({ host: s.host, site: s.siteId, path: page, device })); html = r.html || ''; if (!html) throw new Error(r.error || 'empty page'); }
      catch (e) { note.textContent = 'Could not load the page: ' + e.message; return; }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let el = null; try { el = doc.querySelector(f.selector); } catch (e) { /* bad selector */ }
      if (el && el.closest('head')) {
        note.innerHTML = `This item is in the page's <b>SEO settings</b> (not visible on the page). Current value: <b>${esc(el.tagName === 'TITLE' ? el.textContent : el.getAttribute('content') || '')}</b>. Edit it in Duda under <b>Pages → Page settings → SEO</b>.`;
        stage.innerHTML = ''; return;
      }
      // Make it render safely as a static snapshot: no Duda scripts, real image sources, assets from the preview host
      doc.querySelectorAll('script:not([type="application/ld+json"])').forEach((x) => x.remove());
      doc.querySelectorAll('img[data-src]').forEach((im) => { if (!im.getAttribute('src')) im.setAttribute('src', im.getAttribute('data-src')); });
      doc.querySelectorAll('[data-srcset]').forEach((im) => im.setAttribute('srcset', im.getAttribute('data-srcset')));
      const base = doc.createElement('base'); base.href = `https://${s.host}/`; doc.head.prepend(base);
      let msg = '';
      if (!el) msg = `This element wasn't found on the <b>${A.DEVICE_LABEL[device]}</b> version of <b>${esc(page)}</b>. Try another device or page above.`;
      else {
        const hidden = A.hiddenReason(el, device);
        const inPanel = !!el.closest('#hamburger-drawer, .hamburger-drawer, .layout-drawer');
        if (hidden || inPanel || el.closest('.dmPopup, #dmPopup')) {
          // Force the element (and whatever hides it) to show, so it can be seen in the snapshot
          for (let e = el; e && e !== doc.body; e = e.parentElement) {
            const cs = e.style;
            if (A.hiddenReason(e, device) || e.id === 'hamburger-drawer' || /hamburger-drawer|layout-drawer|dmPopup|p_hfcontainer|showOn|hide-for/.test(e.getAttribute('class') || '')) {
              ['display:block', 'visibility:visible', 'opacity:1', 'transform:none', 'position:relative', 'left:auto', 'right:auto', 'top:auto', 'max-height:none', 'height:auto', 'width:auto']
                .forEach((d) => { const [k, v] = d.split(':'); cs.setProperty(k, v, 'important'); });
            }
          }
          msg = inPanel ? '📌 This element is inside the <b>side panel</b> (hamburger menu). It has been opened below so you can see it.' : `📌 This element is <b>hidden on ${A.DEVICE_LABEL[device]}</b> (${esc(hidden || 'popup')}). It is shown below anyway.`;
        }
        el.setAttribute('data-dsa-hl', '1');
        if (msg) el.setAttribute('data-dsa-force', '1');
      }
      const style = doc.createElement('style');
      // Snapshot has no scripts: finish every animation instantly and reveal elements that wait for a scroll animation
      style.textContent = `*,*::before,*::after{animation-delay:0s!important;animation-duration:.001s!important;animation-iteration-count:1!important;transition:none!important;scroll-behavior:auto!important}
        [data-anim-desktop],[data-anim-tablet],[data-anim-mobile],[data-anim],[data-aos],.aos-init,.wow,.animated,[data-animation],.dmAnimated,[class*="animate__"]{opacity:1!important;visibility:visible!important;transform:none!important}
        [data-dsa-hl]{outline:4px solid #e11d48!important;outline-offset:3px!important;background-color:rgba(255,214,0,.35)!important;animation:dsaPulse 1.2s ease-in-out 3!important;scroll-margin:120px}
        @keyframes dsaPulse{50%{outline-color:#fbbf24;outline-offset:8px}}`;
      doc.head.appendChild(style);
      const sc = doc.createElement('script');
      sc.textContent = `(${inspectorRuntime.toString()})();`;
      doc.body.appendChild(sc);
      note.innerHTML = (msg || `Showing <b>${esc(page)}</b> on <b>${A.DEVICE_LABEL[device]}</b>. The element is outlined in red. <span class="faint">Snapshot without scripts, so sliders and animations may look static.</span>`) + '<div id="inForced" class="small"></div>';
      const w = VIEW_W[device];
      const scale = Math.min(1, (stage.clientWidth - 2) / w);
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts'); // isolated: no access to this app
      frame.setAttribute('title', 'Page preview');
      frame.style.width = w + 'px'; frame.style.height = Math.round(stage.clientHeight / scale) + 'px'; frame.style.transform = `scale(${scale})`;
      frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
      stage.innerHTML = ''; stage.appendChild(frame);
    };
    const bind = () => {
      $$('[data-dev]').forEach((b) => (b.onclick = () => { if (b.disabled) return; device = b.dataset.dev; draw(); bind(); load(); }));
      const ps = $('#inPage'); if (ps) ps.onchange = () => { page = ps.value; draw(); bind(); load(); };
    };
    bind(); load();
  }

  function exportCsv(s) {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['ID', 'Status', 'Severity', 'Category', 'Page', 'Other pages', 'Location', 'Visible on', 'CSS selector', 'Finding', 'Found', 'Expected', 'Assignee', 'Comments']];
    (s.findings || []).slice().sort((a, b) => a.num - b.num).forEach((f) => rows.push(['#' + f.num, FLABEL[f.status], f.severity, f.category, f.path, (f.pages || []).slice(1).join(' '), f.location, (f.visibleOn || []).map((d) => A.DEVICE_LABEL[d]).join('/') || 'Hidden', f.selector, f.message, f.found, f.expected, nameOf(effWho(f, s), ''), f.comments || 0]));
    const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `audit-${slug(s.businessName || s.siteId)}.csv`; a.click();
  }

  // =====================================================================
  // GUIDE
  // =====================================================================
  // =====================================================================
  // ADMIN: GLOBAL ACTIVITY LOG
  // =====================================================================
  const GFILTERS = [{ v: '', label: 'Everything' }, { v: 'site-add', label: 'Websites added' }, { v: 'site-delete', label: 'Websites deleted' }, { v: 'accounts', label: 'Accounts & approvals' }];
  async function renderGlobalActivity() {
    if (state.me.role !== 'admin') { $('#view').innerHTML = '<div class="empty">Only admins can see the activity log.</div>'; return; }
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    let items = [];
    try { items = (await api('/api/store?op=gactivity')).items; } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const draw = () => {
      const f = state.gfilter;
      const list = items.filter((e) => !f || (f === 'accounts' ? ['signup', 'approve', 'reject', 'remove', 'role', 'reset'].includes(e.type) : e.type === f));
      $('#view').innerHTML = `<div class="page-head"><div><h1>Activity log</h1><div class="muted">Admin only. Who added or deleted websites, and account changes, with date and time.</div></div></div>
        <div class="panel"><div class="toolbar"><span class="chips">${GFILTERS.map((x) => `<button class="chipbtn ${f === x.v ? 'active' : ''}" data-gf="${x.v}">${x.label}</button>`).join('')}</span><span class="spacer"></span><span class="small muted">${list.length} entries</span></div>
        ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Date &amp; time</th><th>Who</th><th>What happened</th></tr></thead><tbody>${list.map((e) => {
          const site = e.siteId && state.sites.find((x) => x.id === e.siteId);
          return `<tr><td style="white-space:nowrap"><div>${esc(fmtFull(e.at))}</div><div class="small faint">${esc(ago(e.at))}</div></td>
            <td><span class="member-select">${avatar(e.by, 24)}<b>${esc(e.byName || nameOf(e.by))}</b></span></td>
            <td><span class="a-ic">${ACT_ICON[e.type] || '•'}</span> ${esc(e.text)}${site ? ` · <a href="#/site/${esc(site.id)}">${esc(site.businessName || site.siteId)}</a>` : ''}${e.type === 'site-delete' && e.addedByName ? ` <span class="small faint">(originally added by ${esc(e.addedByName)})</span>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">Nothing here yet.</div>'}</div>`;
      $$('[data-gf]').forEach((b) => (b.onclick = () => { state.gfilter = b.dataset.gf; draw(); }));
    };
    draw();
  }

  // =====================================================================
  // FEATURE SUGGESTIONS (private to the owner; submitters see their own)
  // =====================================================================
  function openSuggest() {
    modal(`<header><h2>💡 Suggest a feature</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body"><p class="small muted" style="margin:0">Your idea goes privately to the app owner. You can follow its status and replies under <b>My suggestions</b>.</p>
        <label class="field">Title<input type="text" id="sgTitle" maxlength="140" placeholder="e.g. Show business hours in the reference card" autofocus></label>
        <div><div class="k">Details (optional). Paste screenshots with Cmd/Ctrl+V.</div><div id="sgComposer"></div></div></div>`);
    composer($('#sgComposer'), { site: null, noMentions: true, allowEmpty: true, submitLabel: 'Send suggestion', placeholder: 'What should it do, and why would it help?',
      onSubmit: async ({ text, images }) => {
        const title = $('#sgTitle').value.trim();
        if (!title) { $('#sgTitle').focus(); throw new Error('Add a short title'); }
        await post('/api/suggest', { op: 'create', title, text, images });
      },
      onPosted: async () => { closeModal(); toast('Thanks! Your suggestion was sent.'); if (route().name === 'suggestions') renderSuggestions(); } });
  }
  async function renderSuggestions() {
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    let data;
    try { data = await api('/api/suggest'); } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const owner = data.owner;
    const counts = Object.fromEntries(SUG.map((x) => [x.v, data.items.filter((i) => i.status === x.v).length]));
    const f = state.sfilter;
    const list = data.items.filter((i) => f === 'all' || (f === 'open' ? ['new', 'ongoing'].includes(i.status) : i.status === f));
    $('#view').innerHTML = `<div class="page-head"><div><h1>${owner ? 'Feature suggestions' : 'My suggestions'}</h1>
        <div class="muted">${owner ? 'Only you can see this page. Everyone else sees only the suggestions they sent.' : 'Ideas you sent to the app owner, with their status and replies.'}</div></div>
        <button class="btn primary" id="sgNew">💡 Suggest a feature</button></div>
      <div class="panel"><div class="toolbar"><span class="chips">
        <button class="chipbtn ${f === 'open' ? 'active' : ''}" data-sf="open">New + On going ${counts.new + counts.ongoing}</button>
        ${SUG.map((x) => `<button class="chipbtn ${f === x.v ? 'active' : ''}" data-sf="${x.v}">${x.label} ${counts[x.v]}</button>`).join('')}
        <button class="chipbtn ${f === 'all' ? 'active' : ''}" data-sf="all">All ${data.items.length}</button></span></div>
      <div class="sg-list">${list.length ? list.map((i) => `<div class="sg-card" id="sg-${esc(i.id)}">
        <div class="row-between"><div><div class="sg-title">${esc(i.title)}</div><div class="small faint">${owner ? `${esc(i.byName)} · ` : ''}${esc(fmtFull(i.createdAt))}</div></div>
          ${owner ? `<select class="pill sg-${i.status}" data-sgst="${esc(i.id)}">${SUG.map((x) => `<option value="${x.v}" ${x.v === i.status ? 'selected' : ''}>${x.label}</option>`).join('')}</select>` : `<span class="badge sg-${i.status}">${SUGL[i.status]}</span>`}</div>
        ${i.text ? `<div class="c-body" style="margin-top:8px">${formatText(i.text, null)}</div>` : ''}
        ${i.images && i.images.length ? `<div class="c-imgs">${i.images.map((u) => `<button class="c-img" data-img="${esc(u)}"><img src="${esc(u)}" alt="Screenshot" loading="lazy"></button>`).join('')}</div>` : ''}
        ${(i.history || []).length ? `<div class="small faint" style="margin-top:6px">${i.history.slice(-3).map((h) => `${esc(h.byName)} changed ${esc(SUGL[h.from])} → ${esc(SUGL[h.to])} · ${esc(fmtFull(h.at))}`).join('<br>')}</div>` : ''}
        <details class="sg-disc" ${i.comments.length ? 'open' : ''}><summary class="small">Comments (${i.comments.length})</summary>
          <div class="c-list">${i.comments.map((c) => renderComment(c, null, { noDelete: true })).join('')}</div><div data-sgc="${esc(i.id)}"></div></details>
      </div>`).join('') : `<div class="empty">${data.items.length ? 'No suggestions with this status.' : 'No suggestions yet.'}</div>`}</div></div>`;
    $('#sgNew').onclick = openSuggest;
    $$('[data-sf]').forEach((b) => (b.onclick = () => { state.sfilter = b.dataset.sf; renderSuggestions(); }));
    $$('[data-img]').forEach((b) => (b.onclick = () => lightbox(b.dataset.img)));
    $$('[data-sgst]').forEach((sel) => (sel.onchange = async () => {
      try { await post('/api/suggest', { op: 'status', id: sel.dataset.sgst, status: sel.value }); toast(`Marked ${SUGL[sel.value]}${sel.value === 'nope' ? '. Add a comment to explain why.' : ''}`); renderSuggestions(); } catch (e) { toast(e.message); }
    }));
    $$('[data-sgc]').forEach((host) => {
      const item = data.items.find((x) => x.id === host.dataset.sgc);
      const api_ = composer(host, { site: null, noMentions: true, placeholder: owner ? 'Reply to the person who suggested this, e.g. why it is "Nope"…' : 'Add more detail or reply…',
        onSubmit: (pl) => post('/api/suggest', { op: 'comment', id: item.id, text: pl.text, images: pl.images, replyTo: pl.replyTo }), onPosted: renderSuggestions });
      const card = host.closest('.sg-card');
      $$('[data-reply]', card).forEach((b) => (b.onclick = () => { const c = item.comments.find((x) => x.id === b.dataset.reply); if (c) api_.replyTo(c); }));
      $$('[data-jump]', card).forEach((a) => (a.onclick = (e) => { e.preventDefault(); const t = document.getElementById('c-' + a.dataset.jump); if (t) t.scrollIntoView({ block: 'center' }); }));
    });
  }

  // =====================================================================
  // ABOUT
  // =====================================================================
  function renderAbout() {
    $('#view').innerHTML = `<div class="guide">
      <div class="page-head"><div><h1>About Duda Site Auditor</h1><div class="muted">A team tool for checking Duda websites before and after launch, so no client ends up with someone else's details.</div></div>
        <button class="btn" id="abSuggest">💡 Suggest a feature</button></div>
      <div class="panel panel-pad"><h2>What it does</h2>
        <p>Paste a Duda editor link and it reads every page on <b>Desktop, Tablet and Mobile</b>, including side panels, popups and elements hidden on some devices. Everything is compared against the site's <b>Business Info</b> from the Duda API:</p>
        <ul>
          <li><b>Contact info:</b> phone numbers, emails, phone buttons that show one number but dial another, map embeds and social links</li>
          <li><b>Other-client leftovers:</b> names, logos, links and copyright lines from a different business</li>
          <li><b>Links and images:</b> broken pages, broken links and images, alt text</li>
          <li><b>SEO basics:</b> titles, descriptions, H1s, noindex, placeholder text</li>
        </ul></div>
      <ol class="steps" style="margin-top:14px">
        <li class="panel"><h3>Add websites</h3><p>Click <b>+ Add website</b>, paste editor links (one per line) and assign someone. Keep the tab open while it scans.</p></li>
        <li class="panel"><h3>Work through audit items</h3><p>Each item has an ID like <b>#12</b>. Click it to set the status (Open, For clarification, Done, On hold, False alarm), reassign it, comment and paste screenshots.</p></li>
        <li class="panel"><h3>Talk it through</h3><p>Use a website's <b>Comments</b> tab. Type <b>@</b> to tag a teammate and <b>#12</b> to link an item. Click <b>Reply</b> to quote someone.</p></li>
        <li class="panel"><h3>See who did what</h3><p>Each website has an <b>Activity log</b> (scans, rescans, statuses and comments, with date and time). Admins also get an app-wide <b>Activity</b> page. The dots at the top right show who's online: green is active, grey is idle for an hour or more.</p></li>
      </ol>
      <p class="small faint" style="margin-top:14px">Still review by hand: business hours, prices, service areas, form recipients, and text inside images.</p></div>`;
    $('#abSuggest').onclick = openSuggest;
  }

  // =====================================================================
  // BOOT
  // =====================================================================
  async function boot2() {
    document.body.classList.remove('auth-mode');
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    await Promise.all([loadUsers(), loadSites(), api('/api/ai').then((r) => { state.ai = r; if (r.now) state.aiSkew = r.now - Date.now(); }).catch(() => { state.ai = { enabled: false }; })]);
    renderTop();
    pulse();
    render();
  }
  window.addEventListener('hashchange', () => {
    const r = route();
    if (state.me && r.name === 'site' && state.current && state.current.id === r.id) {
      // same site: switch tab / open drawer without refetching
      if (r.tab === 'findings' && state.renderedTab === 'findings' && $('#tabBody')) { if (r.item) openDrawer(r.item); else closeDrawer(true); return; }
      return renderSite();
    }
    render();
  });
  (async () => {
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    try { state.config = await api('/api/auth?op=config'); const r = await api('/api/auth?op=me'); state.me = r.user; }
    catch (e) { $('#view').innerHTML = `<div class="empty">Could not start the app: ${esc(e.message)}</div>`; return; }
    if (!state.me) return renderAuth();
    if (state.me.status !== 'active') { state.auth.mode = 'pending'; state.me = null; return renderAuth(); }
    await boot2();
    // Keep data fresh so teammates' changes show up
    setInterval(async () => {
      if (!state.me || document.hidden || modalOpts) return;
      try {
        if (Date.now() - lastPulse > 85000) pulse();
        const r = route();
        if (r.name === 'sites') { await loadSites(); renderSites(); }
        else if (r.name === 'site' && state.current && !state.scanning[state.current.id]) {
          const busy = (siteComposer && document.body.contains($('#siteComposer')) && siteComposer.busy()) || (drawerComposer && drawerComposer.busy()) || document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
          if (!busy) { await loadSite(state.current.id); renderSite(); }
        }
      } catch (e) { /* ignore */ }
    }, 45000);
    setInterval(() => { if (Date.now() - lastPulse > 85000) pulse(); }, 30000);
  })();
})();
