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
  // One token that means "whoever can answer this". The server turns it into today's admins.
  const GROUP_ADMINS = '*admins';
  const GROUP_ADMINS_LABEL = 'Admins';
  const SCAN_CONCURRENCY_SITES = 2;
  const DUDA_HOST = 'my.duda.co';
  const SUG = [{ v: 'new', label: 'New' }, { v: 'ongoing', label: 'On going' }, { v: 'done', label: 'Done' }, { v: 'nope', label: 'Nope' }];
  const SUGL = Object.fromEntries(SUG.map((x) => [x.v, x.label]));

  // This tab's id: the server lets only one tab at a time queue or scan a website
  const CID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const state = {
    config: {}, me: null, users: [], sites: [], current: null,
    scanning: {}, queue: [], running: 0, skipAI: {}, aiAbort: {}, claims: {},
    filters: { q: '', status: '', assignee: '', oldChecks: false, clar: false },
    ff: { q: '', sev: '', cat: '', dev: '', st: 'active', who: '', loc: '', cmt: false },
    refTab: 'info',
    fixedChecks: {},
    notifs: { items: [], unread: 0 }, presence: {}, commentScope: 'general', gfilter: '', sfilter: 'open', auth: { mode: 'login', email: '', remember: true },
    // The client side of the app. `viewAs` is set when one of us is previewing a website as its
    // client — the server is told, and answers with exactly what a real client would get.
    cl: { sites: null, site: null, leads: null, comments: null, loading: false, error: '', months: 12, group: 'pages', pick: {} },
    leadSums: {}, clients: null, perms: [], roles: [], roleCounts: {}, accessVer: '', sitesScoped: false, viewRole: null, previewOf: null,
    viewAs: '',
  };

  // ---------- utils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z]+/g, '-');
  const fmtDate = (d) => d ? new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const ago = (d) => {
    if (!d) return ''; const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return fmtDate(d);
  };
  const fmtFull = (d) => d ? new Date(d).toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
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
    const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers: Object.assign({ 'Content-Type': 'application/json' }, viewHeaders(), opts.headers || {}) }));
    // The server tells every response what version of "who may do what" it answered with.
    const av = r.headers.get('X-Access-Ver');
    if (av && state.accessVer && av !== state.accessVer && !state.viewRole) { state.accessVer = av; setTimeout(accessChanged, 0); }
    else if (av && !state.accessVer) state.accessVer = av;
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (r.status === 401 && !path.startsWith('/api/auth')) { state.me = null; renderAuth(); throw new Error('Please sign in'); }
    if (r.status === 403 && data && data.disabled) { state.auth.mode = 'disabled'; state.me = null; renderAuth(); throw new Error(data.error); }
    if (r.status === 403 && data && data.pending) { state.auth.mode = 'pending'; state.me = null; renderAuth(); throw new Error(data.error); }
    if (!r.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${r.status}`), { status: r.status, data });
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  /** The client endpoints, called as a client — or, while previewing, as that one website's client. */
  const clientHeaders = () => (state.viewAs ? { 'x-view-as-client': '1', 'x-view-site': state.viewAs } : {});
  /** While previewing a role or a person, every request says so, so the server answers as they would be answered. */
  const viewHeaders = () => (state.viewRole ? (state.viewRole.user ? { 'x-view-as-user': state.viewRole.user } : { 'x-view-as-role': state.viewRole.role }) : {});
  const capi = (path) => api(path, { headers: clientHeaders() });
  const cpost = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body), headers: clientHeaders() });
  /** True when the page should be the client's, either because they are one or we are previewing. */
  const clientMode = () => !!(state.viewAs || (state.me && state.me.role === 'client'));
  /**
   * What this person may do has changed while they were using the app.
   *
   * Their own permissions are re-read and the page is redrawn where they stand. Nothing is thrown
   * away: a half-written comment is left alone, and if they are in the middle of a website they
   * can no longer see, they are told rather than dropped on an error.
   */
  async function accessChanged() {
    const before = (state.perms || []).slice().sort().join(',');
    let m;
    try { m = await api('/api/auth?op=me'); } catch (e) { return; }
    state.perms = m.perms || []; state.myRole = m.role || null; state.me = m.user || state.me;
    if ((state.perms || []).slice().sort().join(',') === before) return;
    const r = route();
    const lost = r.name === 'site' && state.current && !can('site.viewall')
      && !((state.current.people || []).concat(state.current.assignee || '', state.current.addedBy || '').some((e) => String(e).toLowerCase() === String(state.me.email).toLowerCase()));
    alertUser({ email: '', title: 'Your access has changed',
      body: `You are now <b>${esc(state.myRole ? state.myRole.name : 'a team member')}</b>${lost ? '. This website is no longer one of yours, so the page has gone back to the list.' : '. The page has been updated.'}`,
      deskBody: 'Your access in Duda Site Auditor has changed.' });
    await loadSites(false).catch(() => {});
    // The top bar carries half of what a permission controls — the nav links and Add website — so it
    // has to be redrawn too, not just the page under it.
    renderTop();
    if (lost) location.hash = '#/';
    else render();
  }
  /**
   * May I? Only ever used to leave out what somebody cannot reach — every endpoint checks again
   * for itself, so a wrong answer here is untidy, never a way in.
   */
  const can = (perm) => { const p2 = state.perms || []; return p2.includes('*') || p2.includes(perm); };
  const roleName = (id) => { const r = (state.roles || []).find((x) => x.id === id); return r ? r.name : (id === 'admin' ? 'Admin' : id === 'member' ? 'Member' : id || ''); };
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
    const list = activeUsers();
    const cur = selected && !list.some((u) => u.email === selected) ? user(selected) : null;
    return `<option value="">${esc(emptyLabel || 'Unassigned')}</option>`
      + (cur ? `<option value="${esc(cur.email)}" selected>${esc(cur.name)} (switched off)</option>` : '')
      + list.map((u) => `<option value="${esc(u.email)}" ${u.email === selected ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
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
    else if (a.mode === 'disabled') body = `<h1>Account switched off</h1><p class="muted">An admin has switched this account off, so it can't sign in. Everything you worked on is still there. Ask an admin to switch it back on.</p>
      <button class="btn block" data-mode="login">Back to sign in</button>`;
    else if (a.mode === 'pending') body = `<h1>Account created</h1><div><span class="badge fs-clarification" style="font-size:13px;padding:4px 12px">Status: Admin for Approval</span></div><p class="muted">The admins have been notified. You can sign in as soon as one of them approves your account.</p>
      <button class="btn block" data-mode="login">Back to sign in</button>`;
    $('#view').innerHTML = `<div class="auth-wrap"><div class="panel auth-card">
      <div class="brand auth-brand"><span class="logo"><svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M9 16.5l4.5 4.5L23 11" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Duda Site Auditor</div>
      ${body}<div id="auMsg" class="au-msg" role="alert"></div></div></div>`;
    $$('[data-mode]').forEach((l) => (l.onclick = (e) => { e.preventDefault(); a.email = ($('#auEmail') || {}).value || a.email; a.mode = l.dataset.mode; renderAuth(); }));
    const msg = (t, ok) => { const m = $('#auMsg'); m.textContent = t || ''; m.className = 'au-msg ' + (ok ? 'ok' : 'bad'); };
    const rem = () => ($('#auRemember') ? $('#auRemember').checked : a.remember);
    const done = async (r) => {
      if (r.user) {
        state.me = r.user; document.body.classList.remove('auth-mode');
        // Signing in does not say what this role may do; ask before drawing anything.
        try { const m = await api('/api/auth?op=me'); state.perms = m.perms || []; state.myRole = m.role || null; state.superAdmin = !!m.superAdmin; state.rtChannel = m.rtChannel || ''; state.previewOf = m.preview || null; state.accessVer = m.accessVer || ''; } catch (e) { state.perms = []; }
        await boot2(); return;
      }
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
  /** Loads the website list. With onlyIfChanged, first asks whether anything changed (returns false if not). */
  async function loadSites(onlyIfChanged) {
    const r = await api('/api/store?op=list' + (onlyIfChanged && state.sitesVer ? '&since=' + encodeURIComponent(state.sitesVer) : ''));
    const claimsChanged = setClaims(r.claims);
    noteBuild(r);
    if (r.unchanged) return claimsChanged;
    state.sites = r.sites || []; state.sitesVer = r.ver || ''; state.sitesScoped = !!r.scoped;
    state.fixedChecks = r.fixedChecks || {};
    return true;
  }
  /**
   * The scan runs in THIS tab, using the checks this tab loaded. So a tab left open across an update
   * is still running the old ones, and a rescan quietly produces the old answer — which reads as
   * "I rescanned and the item is still there". The app notices and says so, rather than leaving it
   * to a line in the Guide that nobody reads on the day it matters.
   */
  function noteBuild(r) {
    if (!r || !r.build) return;
    if (!state.build) { state.build = r.build; return; }
    if (state.build === r.build || state.stale) return;
    state.stale = true;
    setTimeout(() => { try { render(); } catch (e) { /* the next render will carry it */ } }, 0);
  }
  /**
   * Point at the control that produced what you are looking at.
   *
   * When a click somewhere else sets a filter for you, the result is a list you didn't choose and
   * can't obviously undo. Flashing the control that did it answers "where did this come from" and
   * shows where to reach for it next time, without a tour or a tooltip nobody reads.
   */
  let pendingHint = '';
  const hintNext = (sel) => { pendingHint = sel; };
  function runHint() {
    if (!pendingHint) return;
    const sel = pendingHint; pendingHint = '';
    setTimeout(() => {
      const el = $(sel);
      if (!el) return;
      el.classList.add('hint-flash');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => el.classList.remove('hint-flash'), 2600);
    }, 120);
  }
  const bindStale = (root) => { const b = $('#staleReload', root || document); if (b) b.onclick = () => location.reload(); };
  /** A scan the person asked for just before reloading, resumed once the new checks are loaded. */
  function resumeAfterReload() {
    let ids = [];
    try { ids = JSON.parse(sessionStorage.getItem('dsa:scanAfterReload') || '[]'); sessionStorage.removeItem('dsa:scanAfterReload'); } catch (e) { return; }
    if (Array.isArray(ids) && ids.length) setTimeout(() => requestScan(ids), 400);
  }
  const staleBanner = () => (state.stale ? `<div class="note fixed-checks" id="staleNote">
      <div class="row-between" style="align-items:center;gap:12px">
        <div class="grow"><b>⚠ The app has been updated since you opened this tab.</b>
          <div class="small" style="margin-top:3px">Scans run in your own browser, so this tab is still using the checks it loaded when you opened it. <b>Reload before you scan or rescan</b>, or you'll get the old answers back.</div></div>
        <div style="white-space:nowrap"><button class="btn sm primary" id="staleReload">Reload now</button></div>
      </div></div>` : '');
  async function refreshSite(id) {
    const v = state.current && state.current.id === id ? state.current.ver : '';
    const r = await api('/api/store?op=site&id=' + encodeURIComponent(id) + (v ? '&since=' + encodeURIComponent(v) : ''));
    if (r.unchanged) {
      const was = JSON.stringify(state.current && state.current.claim || null), now = JSON.stringify(r.claim || null);
      if (state.current) state.current.claim = r.claim || null;
      return was !== now;
    }
    state.current = r; return true;
  }
  /** Who else has a website queued or scanning (from the server). Returns true when something changed. */
  function setClaims(c) {
    if (!c) return false;
    const sig = (o) => Object.keys(o).sort().map((k) => k + ':' + o[k].cid + ':' + o[k].state).join('|');
    const changed = sig(c) !== sig(state.claims || {});
    state.claims = c; return changed;
  }
  /** The claim on a website held by ANOTHER tab or member (still fresh), or null. */
  function otherClaim(id) {
    let c = state.claims[id];
    if (state.current && state.current.id === id && state.current.claim !== undefined) c = state.current.claim || c;
    if (!c || c.cid === CID || !(c.until > srvNow())) return null;
    return c;
  }
  function claimText(c) {
    const who = c.by === (state.me && state.me.email) ? 'you in another tab' : c.byName || 'another member';
    return c.state === 'queued' ? `Queued by ${who}` : `Being scanned by ${who}`;
  }
  async function loadNotifs() { try { state.notifs = await api('/api/store?op=notifs'); renderBell(); } catch (e) { /* ignore */ } }
  async function loadSite(id) { state.current = await api('/api/store?op=site&id=' + encodeURIComponent(id)); return state.current; }
  /** Changing who owns a website (or reopening a finished audit) always tells the people involved. */
  async function changeSite(site, changes, after) {
    const who = (e) => nameOf(e, 'nobody');
    let reason = '';
    if ('assignee' in changes && site.assignee && changes.assignee !== site.assignee && site.assignee !== state.me.email) {
      const taking = changes.assignee === state.me.email;
      const closed = (site.counts && site.counts.closed) || 0;
      const msg = `${who(site.assignee)} is working on this website${closed ? ` and has already closed ${closed} item(s)` : ''}.\n\n${taking ? 'Take it over?' : `Reassign it to ${who(changes.assignee)}?`} ${who(site.assignee)} will be told who did it.\n\nAdd a short reason (optional):`;
      const r = prompt(msg, '');
      if (r === null) { if (after) after(); return null; }
      reason = r.trim();
    } else if ('status' in changes && site.status === 'Complete' && changes.status !== 'Complete') {
      const r = prompt(`This audit was marked Complete${site.completedByName ? ` by ${site.completedByName}` : ''}. Reopening it will tell them.\n\nWhy are you reopening it? (optional)`, '');
      if (r === null) { if (after) after(); return null; }
      reason = r.trim();
    }
    try { const sum = await store({ op: 'patchSite', id: site.id, changes, reason }); upsertSummary(sum); return sum; }
    catch (e) { toast(e.message); return null; }
    finally { if (after) after(); }
  }
  /**
   * Taking an audit off the Audits list. It asks what for, because in six months
   * "why is this one gone?" is a real question — and it gives you a moment to stop.
   * The website itself is never touched in Duda.
   */
  async function removeAudit(site, after) {
    if (!site) return false;
    const c = site.counts || {};
    const bits = [`${c.total || 0} audit item(s)`];
    if (c.closed) bits.push(`${c.closed} already closed`);
    if (site.status === 'Complete') bits.push(`marked Complete${site.completedByName ? ' by ' + site.completedByName : ''}`);
    const r = prompt(`Remove "${site.businessName || site.siteId}" (${site.siteId}) from the Audits list?\n\nThis throws away ${bits.join(', ')}, the comments and the activity log. The website itself stays exactly as it is in Duda.\n\nIt will be listed under Removed from Audits with your reason, so it can be found and audited again later.\n\nWhy are you removing it?`, '');
    if (r === null) { if (after) after(); return false; }
    const reason = r.trim();
    if (!reason) { toast('Please give a short reason — it is what makes this findable later.'); if (after) after(); return false; }
    try {
      await store({ op: 'deleteSite', id: site.id, reason });
      state.sites = state.sites.filter((s) => s.id !== site.id);
      toast('Removed from Audits. You can find it under Removed from Audits.');
      return true;
    } catch (e) { toast(e.message); return false; } finally { if (after) after(); }
  }
  function upsertSummary(sum) { if (!sum) return; const i = state.sites.findIndex((s) => s.id === sum.id); if (i >= 0) state.sites[i] = sum; else state.sites.push(sum); }

  // =====================================================================
  // TOP BAR
  // =====================================================================
  function renderTop() {
    const pb = $('#previewBar');
    if (pb) { pb.innerHTML = previewBanner(); const x = $('#pvExit'); if (x) x.onclick = exitViewAs; }
    const isOwner = !!state.superAdmin;
    $('.topnav').innerHTML = `<a href="#/" data-nav="sites">Audits</a>
      ${can('project.view') ? `<a href="#/projects" data-nav="projects">Projects${projWaiting() ? ' <span class="nav-dot bad" title="Something is past its date"></span>' : ''}</a>` : ''}
      ${can('live.view') ? '<a href="#/live" data-nav="live">Live DR Sites</a>' : ''}
      ${can('leads.view') ? '<a href="#/analysis" data-nav="analysis">Lead analysis</a>' : ''}
      ${can('activity.view') ? '<a href="#/activity" data-nav="activity">Activity</a>' : ''}
      <a href="#/comments" data-nav="comments">Duda comments${cmtWaiting() ? ` <span class="nav-dot bad" title="A client is waiting for an answer"></span>` : cmtUnread() ? ' <span class="nav-dot"></span>' : ''}</a>
      <a href="#/suggestions" data-nav="suggestions">${isOwner || can('fa.manage') ? 'Suggestions' : 'My suggestions'}</a>`;
    // Light-bulb menu (left of the logo): About, AI Status, Help, Suggest a feature, AI credits
    if (!$('#btnMenu')) {
      const mb = document.createElement('button');
      mb.id = 'btnMenu'; mb.type = 'button'; mb.className = 'btn ghost menu-btn'; mb.title = 'Menu'; mb.setAttribute('aria-label', 'Menu'); mb.setAttribute('aria-haspopup', 'menu');
      mb.innerHTML = ICONS.bulb;
      $('.topbar').prepend(mb);
    }
    $('#btnMenu').onclick = toggleMenu;
    $('#topRight').innerHTML = `
      <div class="presence" id="presence" title="Who's online"></div>
      <button class="btn ghost ai-chip" id="btnAi" type="button" hidden></button>
      <button class="btn ghost bell" id="btnBell" title="Notifications" aria-label="Notifications">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="bell-count" id="bellCount" hidden></span></button>
      <button class="btn ghost" id="btnMembers" type="button">Members${can('members.approve') && state.users.some((u) => u.status === 'pending') ? ` <span class="badge fs-clarification">${state.users.filter((u) => u.status === 'pending').length} for approval</span>` : ''}</button>
      ${can('project.manage') ? '<button class="btn primary" id="btnProj" type="button">+ Add project</button>' : ''}
      ${can('site.add') ? `<button class="btn ${can('project.manage') ? '' : 'primary'}" id="btnAdd" type="button">+ Add audit</button>` : ''}
      <button class="btn ghost me-btn" id="btnMe" title="${esc(state.me.email)}">${avatar(state.me.email, 26)}</button>`;
    if ($('#btnAdd')) $('#btnAdd').onclick = openAdd;
    if ($('#btnProj')) $('#btnProj').onclick = openNewProject;
    $('#btnMembers').onclick = openMembers;
    $('#btnBell').onclick = toggleNotifs;
    $('#btnMe').onclick = openMe;
    $('#btnAi').onclick = () => { location.hash = '#/ai'; }; renderAiChip();
    $('#presence').onclick = togglePresence;
    renderBell(); renderPresence(); markNav();
  }
  const ICONS = {
    bulb: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/></svg>',
    help: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    idea: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v9H4v-9"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  };
  // ---------- "What's New" ----------
  const news = { items: null, latest: '', loading: false };
  function newsUnread() { return !!(news.latest && news.latest !== (state.me && state.me.newsSeen)); }
  async function loadNews(force) {
    if (news.loading || (news.items && !force)) return;
    news.loading = true;
    try { const r = await api('/api/ai?op=news'); news.items = r.items || []; news.latest = r.latest || ''; markBulb(); } catch (e) { /* ignore */ }
    news.loading = false;
  }
  function markBulb() { const b = $('#btnMenu'); if (b) b.classList.toggle('glow', newsUnread()); }
  async function markNewsSeen() {
    if (!newsUnread()) return;
    try { const r = await post('/api/users', { op: 'profile', name: state.me.name, newsSeen: news.latest }); state.me = r.user; } catch (e) { state.me.newsSeen = news.latest; }
    markBulb();
  }
  function openNews() {
    const items = news.items || [];
    const seen = (state.me && state.me.newsSeen) || '';
    const isNew = (n) => !seen || items.findIndex((x) => x.id === n.id) < items.findIndex((x) => x.id === seen);
    modal(`<header><h2>✨ What's New</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body news-body">${items.length ? items.map((n) => `<div class="news-item ${isNew(n) ? 'fresh' : ''}">
        <div class="news-top"><b>${esc(n.title)}</b>${isNew(n) ? '<span class="badge fs-clarification">New</span>' : ''}<span class="spacer"></span><span class="small faint">${esc(n.tag || '')} · ${esc(fmtDate(n.date))}</span></div>
        <div class="small">${n.what}</div>
        ${(n.where || []).length ? `<div class="news-where"><div class="k">Where to find it</div><ol class="small">${n.where.map((w) => `<li>${w}</li>`).join('')}</ol></div>` : ''}
        ${n.link ? `<a class="btn sm" href="${esc(n.link)}" data-news-go>${esc(n.linkText || 'Take me there')}</a>` : ''}
      </div>`).join('') : '<div class="empty small">Nothing new yet.</div>'}</div>
      <footer><span class="small faint">Ideas for the next update? Use <b>Suggest a feature</b>.</span><span class="spacer"></span><button class="btn primary" data-close>Got it</button></footer>`, { wide: true });
    $$('[data-news-go]', $('.modal')).forEach((a) => (a.onclick = () => closeModal()));
    markNewsSeen();
  }
  function closeMenu() { const m = $('#appMenu'); if (m) m.remove(); const b = $('#btnMenu'); if (b) { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); } }
  function toggleMenu() {
    if ($('#appMenu')) return closeMenu();
    const r = route().name;
    const item = (href, icon, label, nav) => `<a class="am-item ${r === nav ? 'on' : ''}" href="${href}" role="menuitem">${icon}<span>${label}</span></a>`;
    const t = state.ai && state.ai.enabled ? aiTotals() : null;
    const at = state.ai && state.ai.enabled ? aiResumeAt() : null;
    const credits = t ? (t.total
      ? `<a class="am-credits" href="#/ai" role="menuitem"><div class="row-between"><b>AI credits</b><span><b>${t.left.toLocaleString()}</b> left</span></div><div class="am-meter"><i style="width:${Math.round((t.left / t.total) * 100)}%"></i></div><div class="row-between small faint"><span>${at === 0 ? 'Ready' : at ? 'Paused · back in ' + countdown(at) : 'Paused'}</span><span>refills daily</span></div></a>`
      : `<a class="am-credits" href="#/ai" role="menuitem"><div class="row-between"><b>AI</b><span>${at === 0 ? 'Ready' : at ? 'back in ' + countdown(at) : 'Paused'}</span></div></a>`) : '';
    const m = document.createElement('div');
    m.id = 'appMenu'; m.className = 'app-menu panel'; m.setAttribute('role', 'menu');
    m.innerHTML = `<button class="am-item" type="button" data-am-news role="menuitem">${ICONS.gift}<span>What's New</span>${newsUnread() ? '<span class="badge fs-clarification">New</span>' : ''}</button>
      ${item('#/about', ICONS.info, 'About', 'about')}${item('#/ai', ICONS.spark, 'AI Status', 'ai')}${item('#/help', ICONS.help, 'Help', 'help')}
      <div class="am-sep"></div>
      <button class="am-item" type="button" data-am-suggest role="menuitem">${ICONS.idea}<span>Suggest a feature</span></button>
      ${credits ? `<div class="am-sep"></div>${credits}` : ''}`;
    document.body.appendChild(m);
    const b = $('#btnMenu'); b.classList.add('on'); b.setAttribute('aria-expanded', 'true');
    const rect = b.getBoundingClientRect(); m.style.top = (rect.bottom + 8) + 'px'; m.style.left = Math.max(8, rect.left) + 'px';
    $$('a', m).forEach((a) => a.addEventListener('click', closeMenu));
    $('[data-am-suggest]', m).onclick = () => { closeMenu(); openSuggest(); };
    $('[data-am-news]', m).onclick = () => { closeMenu(); openNews(); };
    setTimeout(() => {
      const away = (e) => { if (!m.contains(e.target) && !e.target.closest('#btnMenu')) { closeMenu(); document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc1); } };
      const esc1 = (e) => { if (e.key === 'Escape') { closeMenu(); document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc1); } };
      document.addEventListener('mousedown', away); document.addEventListener('keydown', esc1);
    }, 0);
  }
  window.addEventListener('hashchange', closeMenu);
  function markNav() {
    const r = route();
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (r.name === 'site' ? 'sites' : r.name)));
  }
  function renderBell() {
    const c = $('#bellCount'); if (!c) return;
    c.hidden = !state.notifs.unread; c.textContent = state.notifs.unread > 9 ? '9+' : state.notifs.unread;
  }
  const NOTIF_TEXT = { 'scan-done': 'finished the scan', 'rescan-done': 'rescanned a website you completed', 'site-assign': 'assigned a website to you', 'site-unassign': 'took a website off you', 'site-reopen': 'reopened an audit you completed', 'site-removed': 'removed an audit from the Audits list', 'comment-waiting': 'has client comments waiting for an answer', 'false-alarm': 'marked an audit item as False alarm', mention: 'mentioned you', reply: 'replied to you', assign: 'assigned you', signup: 'created an account (Admin for Approval)', suggestion: 'sent a feature suggestion', 'suggestion-status': 'updated your suggestion', 'suggestion-comment': 'commented on a suggestion', 'fa-status': 'answered your false alarm report', 'fa-note': 'wrote on a false alarm report' };
  function notifLink(n) {
    if (n.kind === 'signup') return '#/?members=1';
    if (/^suggestion/.test(n.kind)) return '#/suggestions';
    // The report itself, not the top of the queue. Older notifications have no key, so they fall
    // back to matching on the website and item number, which is enough to find the one card.
    if (n.kind === 'false-alarm') return '#/suggestions/false-alarms' + (n.faKey ? '/' + encodeURIComponent(n.faKey) : n.siteId && n.findingNum ? '/' + encodeURIComponent(n.siteId + '#' + n.findingNum) : '');
    // A verdict is about a specific audit item, so it opens the item, not the queue.
    if (/^fa-/.test(n.kind)) return n.siteId && n.findingNum ? `#/site/${encodeURIComponent(n.siteId)}/item/${n.findingNum}` : '#/suggestions/false-alarms';
    if (n.kind === 'site-removed') return '#/removed';
    if (n.kind === 'comment-waiting') return '#/comments';
    if (['scan-done', 'rescan-done', 'site-assign', 'site-unassign', 'site-reopen'].includes(n.kind)) return `#/site/${n.siteId}`;
    return `#/site/${n.siteId}${n.findingNum ? '/item/' + n.findingNum : '/comments'}`;
  }
  // Everything lands in one bell, so a client waiting on an answer sits between two finished scans.
  // These groups are the questions people actually arrive with: "is a client waiting on me?",
  // "did someone tag me?", "did my scan finish?".
  const NOTIF_TABS = [
    { key: 'all', label: 'All', has: () => true },
    { key: 'duda', label: 'Duda comments', has: (n) => n.kind === 'comment-waiting' },
    { key: 'talk', label: 'Mentions & replies', has: (n) => ['mention', 'reply', 'assign'].includes(n.kind) },
    { key: 'scans', label: 'Scans', has: (n) => ['scan-done', 'rescan-done'].includes(n.kind) },
    { key: 'audits', label: 'Audits', has: (n) => ['site-assign', 'site-unassign', 'site-reopen', 'site-removed', 'false-alarm', 'fa-status', 'fa-note'].includes(n.kind) },
    { key: 'admin', label: 'Admin', has: (n) => n.kind === 'signup' || /^suggestion/.test(n.kind) },
  ];
  let notifTab = 'all';

  function notifList(p) {
    const items = state.notifs.items.filter((n) => (NOTIF_TABS.find((t) => t.key === notifTab) || NOTIF_TABS[0]).has(n));
    const body = $('.np-body', p);
    body.innerHTML = items.length ? items.map((n) => `
      <a class="np-item" href="${esc(notifLink(n))}">${avatar(n.by, 26)}
        <div><div>${n.self ? `<b>Your ${n.kind === 'rescan-done' ? 'rescan' : 'scan'} finished</b>` : `<b>${esc(n.byName)}</b> ${esc(NOTIF_TEXT[n.kind] || 'notified you')}`}${n.count ? ` <span class="badge ${n.oldestHours >= 48 ? 'sev-critical' : 'sev-warning'}">${n.count} waiting · longest ${n.oldestHours}h</span>` : ''}${n.siteName ? ' · ' + esc(n.siteName) : ''}${n.findingNum ? ' #' + n.findingNum : ''}</div>
        ${Array.isArray(n.lines) && n.lines.length
          ? `<ul class="np-lines">${n.lines.map((l) => `<li>${esc(String(l).replace(/^\d+\.\s*/, '').replace(/\*/g, ''))}</li>`).join('')}</ul>`
          : `<div class="small muted np-text">${esc(n.text || '')}</div>`}
        <div class="small faint">${esc(fmtFull(n.at))}</div></div></a>`).join('')
      : `<div class="empty small">${notifTab === 'all' ? 'No notifications yet.' : 'Nothing here. Try <b>All</b>.'}</div>`;
  }

  function toggleNotifs() {
    const ex = $('.notif-panel'); if (ex) return ex.remove();
    const p = document.createElement('div'); p.className = 'notif-panel panel';
    const ds = deskState();
    const count = (t) => state.notifs.items.filter(t.has).length;
    p.innerHTML = `<div class="np-head"><b>Notifications</b></div>`
      + (ds === 'default' ? `<div class="np-desk">🔔 Get desktop alerts when this app is minimized <button class="btn sm primary" id="npDesk">Turn on</button></div>`
        : ds === 'denied' ? `<div class="np-desk faint small">Desktop alerts are blocked in this browser's site settings. You'll still see everything here.</div>` : '')
      + `<div class="np-tabs"><span class="chips">${NOTIF_TABS.filter((t) => t.key === 'all' || count(t)).map((t) =>
          `<button class="chipbtn ${notifTab === t.key ? 'active' : ''}" data-nt="${t.key}">${esc(t.label)}${t.key === 'all' ? '' : ` <span class="tcount">${count(t)}</span>`}</button>`).join('')}</span></div>`
      + `<div class="np-body"></div>`;
    document.body.appendChild(p);
    notifList(p);
    $$('[data-nt]', p).forEach((b) => (b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      notifTab = b.dataset.nt;
      $$('[data-nt]', p).forEach((x) => x.classList.toggle('active', x.dataset.nt === notifTab));
      notifList(p);
    }));
    const nd = $('#npDesk', p); if (nd) nd.onclick = (e) => { e.preventDefault(); askDesktop(); };
    p.addEventListener('click', (e) => { if (e.target.closest('a')) p.remove(); });
    setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!p.contains(e.target) && !e.target.closest('#btnBell')) { p.remove(); document.removeEventListener('mousedown', h); } }), 0);
    if (state.notifs.unread) { store({ op: 'readNotifs' }).catch(() => {}); state.notifs.unread = 0; renderBell(); }
  }

  // ---------- Presence (who has the app open) ----------
  // Green = app open and used within the last hour. Grey = app open but idle for 1 hour or more. Offline = app closed.
  let lastActive = Date.now(), lastPulse = 0, serverSkew = 0, pulseCount = 0, wantNotifs = true;
  // With realtime nudges, the heartbeat can be much less frequent: fewer server calls and database reads
  const beatMs = () => (state.config && state.config.realtime ? (document.hidden ? 480000 : 240000) : (document.hidden ? 290000 : 115000));
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastActive = Date.now(); if (Date.now() - lastPulse > 60000) pulse(); } });
  async function pulse(force) {
    if (!state.me || (!force && Date.now() - lastPulse < 3000)) return;
    lastPulse = Date.now();
    try {
      const rt = route();
      const sum = rt.name === 'site' ? (state.current && state.current.id === rt.id ? state.current : state.sites.find((x) => x.id === rt.id)) : null;
      const where = rt.name === 'site' ? { siteKey: rt.id, name: (sum && (sum.businessName || sum.siteId)) || '', item: rt.item || null, tab: rt.tab } : null;
      pulseCount++;
      const rt2 = !!(state.config && state.config.realtime);
      const notifs = !rt2 || wantNotifs || pulseCount % 3 === 1 || !!$('.notif-panel');
      wantNotifs = false;
      const r = await post('/api/pulse', { lastActive: new Date(lastActive).toISOString(), where, notifs });
      serverSkew = Date.parse(r.serverTime) - Date.now();
      // Somebody's role or exceptions changed. Pick it up now rather than at the next reload, and
      // say so plainly — a page that quietly starts refusing things is worse than one that explains.
      if (r.accessVer && state.accessVer && r.accessVer !== state.accessVer) { state.accessVer = r.accessVer; accessChanged(); }
      else if (r.accessVer) state.accessVer = r.accessVer;
      if (r.lq) onQueueState(r.lq);
      state.presence = r.presence || {};
      const hadUnread = state.notifs.unread;
      if (r.notifs) state.notifs = r.notifs;
      renderBell(); renderPresence(); roomFromPulse(); announceNotifs(state.notifs.items || []);
      if (state.notifs.unread > hadUnread && can('members.approve') && state.notifs.items.some((n) => n.kind === 'signup')) { loadUsers().then(renderTop).catch(() => {}); }
      // A Duda comment landed somewhere: pick it up without anyone pressing Refresh.
      if (r.cmtVer !== undefined && String(r.cmtVer) !== String(state.cmtVer || '')) {
        if (state.cmtVer === undefined) state.cmtVer = String(r.cmtVer);
        else refreshComments();
      }
    } catch (e) { /* ignore */ }
  }
  function presenceOf(email) {
    if (email === state.me.email) return { st: document.hidden && Date.now() - lastActive > 3600000 ? 'idle' : 'active', active: new Date(lastActive).toISOString() };
    const p = (state.presence || {})[email];
    if (!p || !p.seen) return { st: 'offline' };
    const nowS = Date.now() + serverSkew;
    if (nowS - Date.parse(p.seen) > (state.config && state.config.realtime ? 10 : 6.5) * 60000) return { st: 'offline', seen: p.seen }; // allow for the background heartbeat
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
    p.innerHTML = `<div class="np-head"><b>Team status</b></div>` + rows.map((x) => {
      const w = x.pr.st !== 'offline' ? whereOf(x.u.email) : null;
      return `<button type="button" class="np-item np-member" data-member="${esc(x.u.email)}" title="See what ${esc(x.u.name)} worked on">
        <span class="pav">${avatar(x.u.email, 28)}<span class="pdot ${x.pr.st}"></span></span>
        <div class="grow"><div><b>${esc(x.u.name)}</b>${x.u.email === state.me.email ? ' <span class="badge subtle">You</span>' : ''}${can('members.manage') ? ` <span class="badge subtle">${esc(roleName(x.u.role))}</span>` : ''}</div>
        <div class="small ${x.pr.st === 'active' ? 'pt-active' : 'muted'}">${esc(presenceText(x.pr))}</div>
        ${w ? `<div class="small muted np-where">Now on <b>${esc(w.name)}</b>${w.item ? ` · #${w.item}` : ''}</div>` : ''}</div><span class="faint">›</span></button>`;
    }).join('');
    $$('[data-member]', p).forEach((b) => (b.onclick = () => { p.remove(); openMemberActivity(b.dataset.member); }));
  }
  // ---------- Desktop (system) notifications ----------
  // Shown by the operating system when the app is minimized or in a background tab. If the person declines
  // or ignores the permission request, everything keeps working with the in-app pop-ups and the bell.
  const ICON = (document.querySelector('link[rel="icon"]') || {}).href || '';
  const deskState = () => ('Notification' in window ? Notification.permission : 'unsupported'); // default | granted | denied
  function desktopNotify({ title, body, tag, link }) {
    if (deskState() !== 'granted') return false;
    try {
      const n = new Notification(title, { body: String(body || '').replace(/<[^>]+>/g, ''), tag, icon: ICON, badge: ICON });
      n.onclick = () => { window.focus(); if (link) location.hash = link; n.close(); };
      return true;
    } catch (e) { return false; } // e.g. mobile browsers that only allow notifications from a service worker
  }
  async function askDesktop() {
    if (!('Notification' in window)) return toast('This browser does not support desktop notifications');
    let p = 'default';
    try { p = await Notification.requestPermission(); } catch (e) { /* ignore */ }
    if (p === 'granted') { desktopNotify({ title: 'Desktop notifications are on', body: "You'll get alerts even when the app is minimized." }); toast('Desktop notifications are on'); }
    else if (p === 'denied') toast("Desktop notifications are blocked. You'll still see them in the app.");
    const b = $('.notif-panel'); if (b) { b.remove(); toggleNotifs(); }
  }
  /** Minimized / background tab → system notification; otherwise the in-app pop-up. */
  function alertUser(opts) {
    if (document.hidden && desktopNotify({ title: opts.title, body: opts.deskBody || opts.body, tag: opts.tag, link: opts.link })) return;
    popNotify(opts);
  }
  /** New bell notifications since the last check (signups for admins, mentions, replies, assignments…). */
  function announceNotifs(items) {
    if (!state.notifKnown) { state.notifKnown = new Set(items.map((n) => n.id)); return; } // first load: don't replay old ones
    const fresh = items.filter((n) => !state.notifKnown.has(n.id));
    fresh.forEach((n) => state.notifKnown.add(n.id));
    // The bell still carries it; this is only whether it jumps onto the screen as well.
    fresh.filter((n) => !popupMuted(n.kind)).slice(0, 3).reverse().forEach((n) => {
      const title = n.self ? `Your ${n.kind === 'rescan-done' ? 'rescan' : 'scan'} finished` : `${n.byName || 'Someone'} ${NOTIF_TEXT[n.kind] || 'notified you'}`;
      const body = [n.siteName, n.findingNum ? '#' + n.findingNum : '', n.text].filter(Boolean).join(' · ');
      alertUser({ email: n.by, title, deskBody: body || 'Open the app to see details.', body: esc(body || 'Open the bell to see details.') + ` <a href="${esc(notifLink(n))}">Open</a>`, tag: n.id, link: notifLink(n), at: n.at });
    });
  }
  /** Ask once (in-app, never a surprise browser prompt), mainly so admins hear about new sign-ups. */
  function offerDesktop() {
    if (deskState() !== 'default' || navigator.webdriver) return;
    let asked = false; try { asked = localStorage.getItem('dsa-desk-asked') === '1'; } catch (e) { /* ignore */ }
    if (asked) return;
    try { localStorage.setItem('dsa-desk-asked', '1'); } catch (e) { /* ignore */ }
    const card = popNotify({ email: state.me.email, title: 'Get desktop notifications?', secs: 25,
      body: `${can('members.approve') ? 'See new sign-ups, mentions and replies' : 'See mentions, replies and assignments'} even when this app is minimized.<div style="margin-top:8px;display:flex;gap:6px"><button class="btn sm primary" data-desk-yes>Turn on</button><button class="btn sm ghost" data-desk-no>Not now</button></div>` });
    card.querySelector('[data-desk-yes]').onclick = () => { card.querySelector('.pop-x').click(); askDesktop(); };
    card.querySelector('[data-desk-no]').onclick = () => card.querySelector('.pop-x').click();
  }
  /** Instant nudges from the server on this person's own realtime channel (no database polling). */
  async function listenPersonal() {
    if (!state.rtChannel || !state.config || !state.config.realtime) return;
    const client = await rtReady(); if (!client) return;
    try { client.channels.get(state.rtChannel).subscribe('notif', () => { wantNotifs = true; pulse(true); }); } catch (e) { /* ignore */ }
    // Everyone listens on one channel for Duda comments, so they land while you are looking at them.
    try { client.channels.get((state.config && state.config.cmtChannel) || '').subscribe('cmt', () => { refreshComments(); }); } catch (e) { /* the heartbeat still catches it */ }
  }

  // ---------- Click a teammate's name → Slack DM ----------
  const slackCache = {};
  async function openSlackDM(email) {
    let r = slackCache[email];
    if (!r) {
      try { r = await post('/api/users', { op: 'slackLink', email }); } catch (e) { toast(e.message); return; }
      if (r.ok) slackCache[email] = r;
    }
    if (!r.ok) { toast(r.message || "Couldn't open Slack"); return; }
    // Try the Slack app first; if nothing takes over within ~1.5 s, open Slack in the browser instead
    let left = false; const onBlur = () => { left = true; };
    window.addEventListener('blur', onBlur, { once: true });
    const a = document.createElement('a'); a.href = r.app; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { window.removeEventListener('blur', onBlur); if (!left && !document.hidden) window.open(r.web, '_blank', 'noopener'); }, 1500);
  }
  document.addEventListener('click', (e) => {
    const w = e.target.closest && e.target.closest('[data-who]');
    if (w) { e.preventDefault(); e.stopPropagation(); openMemberActivity(w.dataset.who); }
  }, true);
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-slack]');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    openSlackDM(a.dataset.slack);
  }, true);

  // ---------- Pop-up notifications (top right, macOS style) ----------
  /** Shows a card that fades out after the member's chosen time (profile). Several stack with a small offset. */
  function popNotify({ email, emails, title, body, note, secs, at }) {
    let stack = $('#popStack');
    if (!stack) { stack = document.createElement('div'); stack.id = 'popStack'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
    const life = secs !== undefined ? secs : Number(state.me && state.me.notifySecs !== undefined ? state.me.notifySecs : 8);
    const when = new Date(at || Date.now());
    const card = document.createElement('div'); card.className = 'pop'; card.setAttribute('role', 'status');
    const avs = (emails || [email]).filter(Boolean).slice(0, 3);
    card.innerHTML = `<div class="pop-av">${avs.map((e) => avatar(e, 30)).join('')}</div>
      <div class="pop-main"><div class="pop-top"><b>${esc(title)}</b><span class="pop-time">${esc(when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))} · ${esc(when.toLocaleDateString([], { month: 'short', day: 'numeric' }))}</span></div>
        ${body ? `<div class="pop-body">${body}</div>` : ''}${note ? `<div class="pop-note">${esc(note)}</div>` : ''}</div>
      <button class="pop-x" type="button" aria-label="Close notification">✕</button>${life ? `<i class="pop-bar" style="animation-duration:${life}s"></i>` : ''}`;
    stack.prepend(card);
    requestAnimationFrame(() => card.classList.add('in')); setTimeout(() => card.classList.add('in'), 50);
    const close = () => { if (card.dataset.closing) return; card.dataset.closing = 1; card.classList.remove('in'); card.classList.add('out'); setTimeout(() => card.remove(), 350); };
    card.querySelector('.pop-x').onclick = close;
    // Timer pauses while the pointer is over the card
    let left = life * 1000, started = Date.now(), timer = null;
    const start = () => { if (life && !timer && !card.dataset.closing) { started = Date.now(); timer = setTimeout(close, Math.max(800, left)); } };
    // Background tab: start the countdown only once the person can actually see it
    if (document.hidden) document.addEventListener('visibilitychange', function v() { if (!document.hidden) { document.removeEventListener('visibilitychange', v); card.classList.add('in'); start(); } });
    else start();
    card.addEventListener('mouseenter', () => { if (!timer) return; clearTimeout(timer); timer = null; left -= Date.now() - started; card.classList.add('paused'); });
    card.addEventListener('mouseleave', () => { if (!life || timer || card.dataset.closing || document.hidden) return; card.classList.remove('paused'); start(); });
    [...stack.children].slice(6).forEach((c) => c.remove());
    return card;
  }

  // ---------- Who else is on this website ----------
  // When realtime is set up, browsers signal each other instantly (no database at all).
  // Without it, the regular heartbeat (every ~2 min, sent right away when you open a website) is used instead.
  const ROOM_NOTE = 'Make sure to communicate with them to avoid working on the same audit item.';
  const room = { siteKey: null, known: null, people: [], ch: null, joining: null };
  /** A teammate's name; once Slack is connected it's a link that opens a Slack DM with them. */
  const personName = (email, name) => {
    const n = esc(name || nameOf(email));
    if (!state.config || !state.config.slackDM || !email || (state.me && email === state.me.email)) return `<b>${n}</b>`;
    return `<a href="#" class="slack-name" data-slack="${esc(email)}" title="Message ${n} on Slack"><b>${n}</b></a>`;
  };
  const namesList = (arr) => { const n = arr.map((p) => personName(p.email, p.name)); return n.length <= 1 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
  function roomBarHtml() {
    const others = room.people.filter((p) => p.email !== (state.me && state.me.email));
    if (!others.length || !state.current || room.siteKey !== state.current.id) return '';
    return `<div class="room-bar" title="${esc(others.map((p) => `${p.name}${p.since ? ' · here since ' + new Date(p.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}${p.item ? ' · on #' + p.item : ''}`).join('\n'))}">
      <span class="pstack">${others.slice(0, 4).map((p) => `<span class="pav">${avatar(p.email, 22)}<span class="pdot active"></span></span>`).join('')}</span>
      <span>${namesList(others)} ${others.length > 1 ? 'are' : 'is'} also here${others.length === 1 && others[0].item ? ` · on <a href="#/site/${esc(room.siteKey)}/item/${others[0].item}">#${others[0].item}</a>` : ''}</span></div>`;
  }
  /** Compare who's here now with who was here before, and announce the difference. */
  function roomSeen(siteKey, people) {
    if (room.siteKey !== siteKey) return;
    const byEmail = new Map(); people.forEach((p) => { if (!byEmail.has(p.email)) byEmail.set(p.email, p); });
    room.people = [...byEmail.values()];
    const others = room.people.filter((p) => p.email !== state.me.email);
    const siteName = state.current && state.current.id === siteKey ? (state.current.businessName || state.current.siteId) : 'this website';
    if (room.known === null) {
      if (others.length) alertUser({ emails: others.map((p) => p.email), link: '#/site/' + siteKey, title: others.length > 1 ? 'Others are on this website' : 'Someone is on this website',
        body: `${namesList(others)} ${others.length > 1 ? 'are inside' : 'is currently working on'} <b>${esc(siteName)}</b>.`, note: ROOM_NOTE });
    } else {
      const fresh = others.filter((p) => !room.known.has(p.email));
      if (fresh.length) alertUser({ emails: fresh.map((p) => p.email), link: '#/site/' + siteKey, title: fresh.length > 1 ? 'People just joined' : 'Someone just joined',
        body: `${namesList(fresh)} just entered <b>${esc(siteName)}</b>.`, note: ROOM_NOTE });
    }
    room.known = new Set(others.map((p) => p.email));
    const bar = $('#roomBar'); if (bar) bar.innerHTML = roomBarHtml();
  }
  // --- Realtime (instant) ---
  let rtClient = null, rtLoading = null;
  function rtReady() {
    if (!state.config || !state.config.realtime) return Promise.resolve(null);
    if (rtClient) return Promise.resolve(rtClient);
    if (!rtLoading) rtLoading = new Promise((ok) => {
      const sc = document.createElement('script'); sc.src = 'https://cdn.ably.com/lib/ably.min-2.js'; sc.async = true;
      sc.onload = () => {
        try {
          rtClient = new window.Ably.Realtime({ clientId: state.me.email, echoMessages: false,
            authCallback: (params, cb) => { api('/api/realtime').then((t) => cb(null, t)).catch((e) => cb(e.message, null)); } });
          ok(rtClient);
        } catch (e) { ok(null); }
      };
      sc.onerror = () => ok(null); // blocked or offline: fall back to the heartbeat
      document.head.appendChild(sc);
    });
    return rtLoading;
  }
  const memberOf = (m) => ({ email: m.clientId, name: (m.data && m.data.name) || nameOf(m.clientId), item: (m.data && m.data.item) || null, since: (m.data && m.data.since) || m.timestamp });
  async function roomSync(siteKey) {
    const ch = room.ch; if (!ch || room.siteKey !== siteKey) return;
    try { const members = await ch.presence.get(); roomSeen(siteKey, members.map(memberOf)); } catch (e) { /* ignore */ }
  }
  async function roomEnter(siteKey, item) {
    const client = await rtReady();
    if (!client || room.siteKey !== siteKey) return false;
    const ch = client.channels.get(`${state.config.realtimePrefix || 'dsa'}-site:${siteKey}`);
    room.ch = ch;
    try {
      await ch.presence.subscribe(['enter', 'leave', 'update'], () => roomSync(siteKey));
      await ch.presence.enter({ name: state.me.name, item: item || null, since: Date.now() });
      await roomSync(siteKey);
      return true;
    } catch (e) { return false; }
  }
  function roomLeave() {
    const ch = room.ch; room.ch = null;
    if (ch) { try { ch.presence.unsubscribe(); ch.presence.leave(); ch.detach(); } catch (e) { /* ignore */ } }
  }
  // --- Heartbeat fallback: people whose last heartbeat says they have this website open ---
  function roomFromPulse() {
    if (!room.siteKey || room.ch || (state.config && state.config.realtime && rtClient)) return;
    // Everyone with a recent heartbeat (including people who joined after this page loaded)
    const emails = [...new Set([state.me.email, ...Object.keys(state.presence || {})])];
    const people = emails.filter((e) => { const w = whereOf(e); return presenceOf(e).st !== 'offline' && w && w.siteKey === room.siteKey; })
      .map((e) => { const w = whereOf(e) || {}; const u = state.users.find((x) => x.email === e); return { email: e, name: (u && u.name) || ((state.presence || {})[e] || {}).name || e, item: w.item || null }; });
    if (emails.some((e) => !state.users.find((x) => x.email === e))) loadUsers().catch(() => {});
    roomSeen(room.siteKey, people);
  }
  /** Called on navigation: leave the previous website, join the new one. */
  async function roomTick() {
    if (!state.me) return;
    const rt = route();
    const siteKey = rt.name === 'site' ? rt.id : null;
    if (room.siteKey && room.siteKey !== siteKey) { roomLeave(); room.siteKey = null; room.known = null; room.people = []; }
    if (!siteKey) return;
    if (siteKey === room.siteKey) { if (room.ch) { try { await room.ch.presence.update({ name: state.me.name, item: rt.item || null, since: (room.people.find((p) => p.email === state.me.email) || {}).since || Date.now() }); } catch (e) { /* ignore */ } } return; }
    room.siteKey = siteKey; room.known = null; room.people = [];
    const live = await roomEnter(siteKey, rt.item);
    if (!live) { await pulse(true); roomFromPulse(); }
  }
  window.addEventListener('pagehide', () => roomLeave());

  /** The website / item a teammate has open right now (from their heartbeat). */
  function whereOf(email) {
    if (email === state.me.email) { const rt = route(); return rt.name === 'site' && state.current ? { siteKey: rt.id, name: state.current.businessName || state.current.siteId, item: rt.item } : null; }
    const p = (state.presence || {})[email]; return p && p.where ? p.where : null;
  }
  const MA_FILTERS = { all: ['All', () => true], items: ['Audit items', (e) => /^item-/.test(e.type) && e.type !== 'item-comment'], comments: ['Comments', (e) => /comment|reply/.test(e.type)], scans: ['Scans', (e) => /scan|^ai$/.test(e.type)], sites: ['Websites', (e) => /^site|^status$|^assign$/.test(e.type)] };
  async function openMemberActivity(email) {
    const u = state.users.find((x) => x.email === email) || { email, name: email, role: '' };
    let data = null, filter = 'all';
    const draw = () => {
      const pr = presenceOf(email); const w = pr.st !== 'offline' ? whereOf(email) : null;
      const link = (e) => e.siteKey && !e.global && !e.removedSite ? `#/site/${encodeURIComponent(e.siteKey)}${e.findingNum ? '/item/' + e.findingNum : /comment|reply/.test(e.type) && !e.findingNum ? '/comments' : ''}` : '';
      // A website that is no longer on the Audits list: say so, and say who took it off and why.
      const goneTip = (r) => (r ? `Removed from Audits by ${r.removedByName || 'someone'} on ${fmtFull(r.removedAt)}${r.reason ? ' · ' + r.reason : ''}` : 'This audit is no longer on the Audits list.');
      const goneTag = (e) => (e.removedSite ? ` <a href="#/removed" data-close-nav class="badge sev-info" title="${esc(goneTip(e.removedInfo))}">removed from Audits</a>` : '');
      const body = !data ? '<div class="empty small">Loading…</div>' : (() => {
        const list = data.items.filter(MA_FILTERS[filter][1]);
        const recentOthers = data.recent.filter((r, k) => (w ? r.siteKey !== w.siteKey : k > 0));
        let lastDay = '';
        return `
        <div class="ma-now panel panel-pad">
          ${w ? `<div class="k">Working on now</div><a class="ma-site" href="#/site/${encodeURIComponent(w.siteKey)}${w.item ? '/item/' + w.item : ''}" data-close-nav><b>${esc(w.name)}</b>${w.item ? ` · audit item #${w.item}` : ''} ›</a>`
            : data.recent[0] ? `<div class="k">Last worked on</div>${link(data.recent[0]) ? `<a class="ma-site" href="${link(data.recent[0])}" data-close-nav><b>${esc(data.recent[0].siteName)}</b> ›</a>` : `<div class="ma-site"><b>${esc(data.recent[0].siteName)}</b>${goneTag(data.recent[0])}</div>`}<div class="small muted">${esc(data.recent[0].text)} · ${esc(ago(data.recent[0].at))}</div>`
            : '<div class="small muted">No activity yet.</div>'}
          ${data.lastItem ? `<div class="k" style="margin-top:12px">Latest audit item</div><a class="ma-item" href="${link(data.lastItem) || '#/removed'}" data-close-nav><span class="item-id">#${data.lastItem.findingNum}</span> ${esc(data.lastItem.type === 'item-status' ? data.lastItem.text.replace(/^changed #\d+ /, 'status changed ') : data.lastItem.type === 'item-assign' ? data.lastItem.text.replace(/#\d+ /, '') : data.lastItem.type === 'reply' ? 'replied to a comment' : 'commented')} <span class="muted">on</span> <b>${esc(data.lastItem.siteName)}</b>${goneTag(data.lastItem)} <span class="faint">· ${esc(ago(data.lastItem.at))}</span></a>` : ''}
          ${recentOthers.length ? `<div class="k" style="margin-top:12px">Recent websites</div><div class="ma-recent">${recentOthers.map((r) => (link(r) ? `<a href="${link(r)}" data-close-nav class="chipbtn"><b>${esc(r.siteName)}</b> <span class="faint">${esc(ago(r.at))}</span></a>` : `<a href="#/removed" data-close-nav class="chipbtn" title="${esc(goneTip(r.removedInfo))}"><b>${esc(r.siteName)}</b> <span class="faint">${esc(ago(r.at))} · removed</span></a>`)).join('')}</div>` : ''}
        </div>
        <div class="ma-stats"><div><b>${data.counts.sites}</b><span>websites</span></div><div><b>${data.counts.items}</b><span>item status changes</span></div><div><b>${data.counts.comments}</b><span>comments</span></div><div><b>${data.counts.scans}</b><span>scans started</span></div></div>
        <div class="chips" style="margin:12px 0 6px">${Object.entries(MA_FILTERS).map(([k, [lbl, fn]]) => `<button class="chipbtn ${filter === k ? 'active' : ''}" data-maf="${k}">${lbl} <span class="faint">${data.items.filter(fn).length}</span></button>`).join('')}</div>
        ${list.length ? `<ul class="activity ma-list">${list.map((e) => {
          const day = new Date(e.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
          const head = day !== lastDay ? `<li class="ma-day">${esc(day)}</li>` : ''; lastDay = day;
          const text = esc(e.text).replace(/#(\d+)/g, (m, n) => e.siteKey && !e.global ? `<a class="item-ref" href="#/site/${encodeURIComponent(e.siteKey)}/item/${n}" data-close-nav>#${n}</a>` : m);
          return `${head}<li><span class="a-ic">${ACT_ICON[e.type] || '•'}</span><div class="grow">${text}${e.siteName ? ` <span class="muted">on</span> ${link(e) ? `<a href="${link(e)}" data-close-nav><b>${esc(e.siteName)}</b></a>` : `<b>${esc(e.siteName)}</b>${goneTag(e)}`}` : ''}</div><div class="a-time"><div>${esc(new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</div><div class="faint">${esc(ago(e.at))}</div></div></li>`;
        }).join('')}</ul>` : '<div class="empty small">Nothing here yet.</div>'}`;
      })();
      $('.modal').innerHTML = `<header><div style="display:flex;gap:12px;align-items:center"><span class="pav">${avatar(email, 36)}<span class="pdot ${pr.st}"></span></span><div><h2 style="margin:0">${esc(u.name)}${u.status === 'disabled' ? ' <span class="badge sev-warning">Switched off</span>' : ''}</h2>
        <div class="small mono muted">${esc(u.email)}</div>
        <div class="small ${pr.st === 'active' ? 'pt-active' : 'muted'}">${esc(u.status === 'disabled' ? 'This account can no longer sign in. Its past work is kept.' : presenceText(pr))}${u.role && can('members.manage') ? ' · ' + esc(roleName(u.role)) : ''}</div>
        ${(u.nameHistory || []).length ? `<div class="small faint">Previously: ${esc([...new Set(u.nameHistory.map((h) => h.from).filter(Boolean))].join(', '))}</div>` : ''}</div></div><button class="btn ghost" data-close>✕</button></header>
        <div class="body ma-body">${body}</div>`;
      $$('[data-close]', $('.modal')).forEach((b) => (b.onclick = closeModal));
      $$('[data-close-nav]', $('.modal')).forEach((a) => a.addEventListener('click', () => closeModal()));
      $$('[data-maf]', $('.modal')).forEach((b) => (b.onclick = () => { filter = b.dataset.maf; draw(); }));
    };
    modal('<div></div>', { wide: true }); draw();
    try { data = await api('/api/store?op=userActivity&email=' + encodeURIComponent(email)); } catch (e) { data = { items: [], recent: [], counts: { sites: 0, items: 0, comments: 0, scans: 0 } }; toast(e.message); }
    if ($('.modal')) draw();
  }
  function togglePresence() {
    const ex = $('.presence-panel'); if (ex) return ex.remove();
    const p = document.createElement('div'); p.className = 'notif-panel presence-panel panel';
    fillPresencePanel(p); document.body.appendChild(p);
    setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!p.contains(e.target) && !e.target.closest('#presence')) { p.remove(); document.removeEventListener('mousedown', h); } }), 0);
  }
  /** "…you'll be told when it's done" — mentions Slack only when Slack is connected for this person. */
  const doneNote = () => `You'll get a notification${state.config && state.config.slackDM && state.me && state.me.slackDM !== false ? ' and a Slack message' : ''} when the scan finishes.`;
  async function slackTest() {
    try { const r = await post('/api/users', { op: 'slackTest' }); toast(r.message); } catch (e) { toast(e.message); }
  }
  const CHANNEL_LABEL = { bell: 'Bell', popup: 'Pop-up', slack: 'Slack', email: 'Email' };
  const CHANNEL_HINT = { bell: 'The list behind the 🔔 in the top bar', popup: 'The card on screen, or a desktop alert when the app is minimized', slack: 'A direct message from Site Auditor', email: 'An email to your inbox' };
  /** The groups this person is offered: admin-only ones stay hidden, as does Email with no mail set up. */
  function myNotifyGroups() {
    const all = (state.config && state.config.notifyGroups) || [];
    const mailOn = !!(state.config && state.config.emailEnabled);
    const slackOn = !!(state.config && state.config.slackDM);
    return all.filter((g) => !g.admin || can('members.approve'))
      .map((g) => Object.assign({}, g, { channels: g.channels.filter((c) => (c !== 'email' || mailOn) && (c !== 'slack' || slackOn)) }))
      .filter((g) => g.channels.length);
  }
  /** Is this notification kind switched off for the on-screen pop-up? Decided here, in the browser. */
  function popupMuted(kind) {
    const off = (state.me && state.me.notifyOff) || [];
    const g = ((state.config && state.config.notifyGroups) || []).find((x) => (x.kinds || []).includes(kind));
    return !!(g && off.includes(g.key + ':popup'));
  }
  /**
   * One row per kind of notification, one column per way it can reach you.
   *
   * Switches that are OFF are what gets stored, so anything added later starts out reaching
   * everybody — a new notification going silently to nobody is the worse failure.
   */
  function notifyGrid() {
    const groups = myNotifyGroups();
    if (!groups.length) return '';
    const cols = ['bell', 'popup', 'slack', 'email'].filter((c) => groups.some((g) => g.channels.includes(c)));
    const off = new Set((state.me.notifyOff || []));
    return `<div class="k" style="margin-top:14px">What you get told about</div>
      <div class="small muted" style="margin-bottom:6px">Everything is on unless you turn it off. This only changes what reaches <b>you</b> — nobody else's notifications change.</div>
      <div class="notif-grid-wrap"><table class="notif-grid"><thead><tr><th></th>
        ${cols.map((c) => `<th title="${esc(CHANNEL_HINT[c])}">${esc(CHANNEL_LABEL[c])}</th>`).join('')}</tr></thead><tbody>
        ${groups.map((g) => `<tr><th scope="row"><b>${esc(g.label)}</b><div class="small faint">${esc(g.desc || '')}</div>
          ${g.lockNote ? `<div class="small faint lock-note">🔒 ${esc(g.lockNote)}</div>` : ''}</th>
          ${cols.map((c) => {
            if (!g.channels.includes(c)) return '<td class="na" title="This notification never uses this">—</td>';
            const key = g.key + ':' + c;
            // A locked channel shows as a word, not a greyed checkbox: a disabled tick box reads as
            // "off" at a glance, which is the opposite of what this one means.
            if ((g.locked || []).includes(c)) return `<td><span class="ng-always" title="${esc(g.lockNote || 'Always on')}">Always</span></td>`;
            return `<td><label class="ng-cell" title="${esc(g.label)} · ${esc(CHANNEL_LABEL[c])}">
              <input type="checkbox" data-ng="${esc(key)}" ${!off.has(key) ? 'checked' : ''}></label></td>`;
          }).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  }
  /** What the Save button sends: every unticked switch, which is what gets stored. */
  const readNotifyGrid = () => $$('[data-ng]').filter((i) => !i.checked).map((i) => i.dataset.ng);

  function openMe() {
    modal(`<header><h2>Your account</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body"><div class="member-row" style="border:0">${avatar(state.me.email, 36)}<div><b>${esc(state.me.name)}</b><div class="small muted">${esc(state.me.email)}${state.superAdmin ? ' · Super Admin' : state.myRole ? ' · ' + esc(state.myRole.name.toLowerCase()) : ''}</div></div></div>
      ${state.superAdmin ? `<button class="btn sm" id="meHealth" type="button" style="justify-self:start">⚑ System health</button>
        <div class="small muted" style="margin-top:-4px">Storage, allowances and whether everything is still arriving. Only you can open it.</div>` : ''}
      <label class="field">Display name<input type="text" id="meName" value="${esc(state.me.name)}"></label>
      <label class="field">Pop-up notifications stay on screen for
        <select id="meSecs">${[[4, '4 seconds'], [8, '8 seconds (default)'], [12, '12 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute'], [0, 'Until I close them']].map(([v, l]) => `<option value="${v}" ${Number(state.me.notifySecs === undefined ? 8 : state.me.notifySecs) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn sm" id="meTest" type="button" style="justify-self:start">Show a test notification</button>
      <label class="field">Open the Duda editor and previews on
        <select id="meEnv"><option value="white" ${state.me.editorEnv !== 'duda' ? 'selected' : ''}>White-label (${esc(editorHost() || 'agency address')})</option><option value="duda" ${state.me.editorEnv === 'duda' ? 'selected' : ''}>Duda (${DUDA_HOST})</option></select>
        <span class="small muted">Only changes where the Editor and Preview links take you. Audits are the same either way.</span></label>
      ${!(state.config && state.config.slackDM) && state.superAdmin ? `<div class="small muted">Slack messages are not switched on yet. Once the Slack connection is added, a Slack option appears here for everyone.</div>` : ''}
      ${state.config && state.config.slackDM ? `<label class="check-row slack-row"><input type="checkbox" id="meSlack" ${state.me.slackDM !== false ? 'checked' : ''}><span>Also message me on Slack (from <b>Site Auditor</b>) when someone mentions me, replies, or assigns me an item${can('members.approve') ? ', and when someone signs up' : ''}.</span></label>
        <div class="small muted" style="margin-top:-4px">Uses your Slack account with the same email as here: <b>${esc(state.me.email)}</b>.</div>
        <button class="btn sm" id="meSlackTest" type="button" style="justify-self:start">Send a Slack test message</button>` : ''}
      ${notifyGrid()}</div>
      <footer><button class="btn danger" id="meOut">Sign out</button><span class="spacer"></span><button class="btn primary" id="meSave">Save</button></footer>`);
    $('#meOut').onclick = () => { closeModal(); logout(); };
    if ($('#meHealth')) $('#meHealth').onclick = () => { closeModal(); location.hash = '#/health'; };
    // The test shows the pop-up and, when Slack messages are switched on here, also sends a Slack test message
    $('#meTest').onclick = () => {
      popNotify({ email: state.me.email, title: 'Test notification', body: 'This is how long pop-ups will stay on screen.' + ($('#meSlack') && $('#meSlack').checked ? ' A Slack test message is on its way too.' : ''), secs: Number($('#meSecs').value) });
      if ($('#meSlack') && $('#meSlack').checked) slackTest();
    };
    if ($('#meSlackTest')) $('#meSlackTest').onclick = () => slackTest();
    // The master Slack switch greys its column, so the two can't disagree on screen.
    const syncSlackCol = () => { const on = !$('#meSlack') || $('#meSlack').checked; $$('[data-ng$=":slack"]').forEach((i) => { i.disabled = !on; i.closest('.ng-cell').classList.toggle('off', !on); }); };
    if ($('#meSlack')) { $('#meSlack').addEventListener('change', syncSlackCol); syncSlackCol(); }
    $('#meSave').onclick = async () => {
      // Read the grid BEFORE the modal closes, and keep any switch the master Slack toggle disabled.
      const shown = new Set($$('[data-ng]').map((i) => i.dataset.ng));
      const notifyOff = [...new Set(readNotifyGrid().concat((state.me.notifyOff || []).filter((k) => !shown.has(k))))];
      try { const r = await post('/api/users', { op: 'profile', name: $('#meName').value, notifySecs: Number($('#meSecs').value), slackDM: $('#meSlack') ? $('#meSlack').checked : undefined, editorEnv: $('#meEnv').value, notifyOff }); state.me = r.user; await loadUsers(); closeModal(); render(); toast('Saved'); } catch (e) { toast(e.message); }
    };
  }





  // =====================================================================
  // SYSTEM HEALTH — is anything about to run out, and is anything not arriving
  // =====================================================================
  const bytes = (n) => {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  };
  const STATE_WORD = { good: '✓', warning: '•', serious: '▲', critical: '▲' };
  /**
   * One thing measured against its limit.
   *
   * A number against a ceiling is not a chart — it is a value, a bar and a word. The word matters:
   * a colour alone tells somebody who cannot see it nothing at all.
   */
  function meter({ title, value, of, pct, state, label, foot }) {
    return `<div class="hx-tile">
      <div class="hx-k">${esc(title)}</div>
      <div class="hx-v">${esc(value)}<span class="hx-of"> of ${esc(of)}</span></div>
      <div class="hx-bar" role="img" aria-label="${pct}% used"><div class="hx-fill hx-${state}" style="width:${Math.max(pct, 0.6)}%"></div></div>
      <div class="hx-foot"><span class="hx-state hx-${state}">${STATE_WORD[state] || '•'} ${esc(label)}</span>
        <span class="faint">${pct}% used</span></div>
      ${foot ? `<div class="hx-note">${foot}</div>` : ''}
    </div>`;
  }

  async function renderHealth() {
    $('#view').innerHTML = `<div class="page-head"><div><h1>System health</h1>
      <div class="muted">Where the app stands, and anything that needs attention.</div></div>
      <button class="btn" id="hxMeasure" title="Walk the store and measure what it actually holds">⟳ Measure storage now</button></div>
      <div id="hxBody"><div class="empty">Loading…</div></div>`;
    $('#hxMeasure').onclick = async () => {
      const b2 = $('#hxMeasure'); b2.disabled = true; b2.textContent = 'Measuring…';
      try { await post('/api/health', { op: 'measure' }); toast('Measured'); } catch (e) { toast(e.message); }
      renderHealth();
    };
    let d;
    try { d = await api('/api/health'); } catch (e) { $('#hxBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

    const kvFoot = d.kv.measuredAt
      ? `Measured ${esc(fmtWhen(Date.parse(d.kv.measuredAt)))} · ${d.kv.keys.toLocaleString()} keys`
        + (d.kv.perDay > 0 ? ` · growing ${esc(bytes(d.kv.perDay))} a day` : '')
        + (d.kv.daysLeft !== null && d.kv.daysLeft < 400 ? ` · <b>about ${d.kv.daysLeft} days</b> before it needs attention` : '')
      : 'Never measured — press <b>Measure storage now</b>.';
    const cmdFoot = `Day ${d.commands.dayOfMonth} of ${d.commands.daysInMonth} · on course for <b>${d.commands.projected.toLocaleString()}</b> this month`
      + (d.commands.free ? `<br>The first ${d.commands.free.toLocaleString()} are free. Beyond them: about <b>$${Number(d.commands.costSoFar || 0).toFixed(2)}</b> so far. At its cap the app pauses itself, so a month can never cost more than about $${Number(d.commands.costCap || 0).toFixed(2)}.` : '');

    $('#hxBody').innerHTML = `
      ${d.alerts.length ? `<div class="hx-alerts">${d.alerts.map((a) => `<div class="hx-alert hx-${a.level === 'info' ? 'good' : a.level}">
        <span class="hx-mark" aria-hidden="true">${STATE_WORD[a.level] || '•'}</span><span>${a.text}</span></div>`).join('')}</div>`
        : '<div class="hx-alerts"><div class="hx-alert hx-good"><span class="hx-mark" aria-hidden="true">✓</span><span>Nothing needs attention.</span></div></div>'}

      <div class="k" style="margin-top:18px">Storage and allowances</div>
      <div class="hx-tiles">
        ${meter({ title: 'Main database', value: bytes(d.kv.used), of: bytes(d.kv.limit), pct: d.kv.pct, state: d.kv.state, label: d.kv.label, foot: kvFoot })}
        ${meter({ title: 'Commands this month (against the app\u2019s cap)', value: d.commands.used.toLocaleString(), of: d.commands.limit.toLocaleString(), pct: d.commands.pct, state: d.commands.state, label: d.commands.label, foot: cmdFoot })}
        ${d.sql && !d.sql.error ? meter({ title: 'Analysis database', value: bytes(d.sql.used), of: bytes(d.sql.limit), pct: d.sql.pct, state: d.sql.state, label: d.sql.label,
          foot: `${d.sql.leads.toLocaleString()} enquiries across ${d.sql.sites} websites`
            + (d.sql.monthsLeft !== null && d.sql.monthsLeft < 600 ? ` · <b>about ${d.sql.monthsLeft} months</b> at this rate` : '')
            + (d.sql.sizeKnown === false ? ' · <b>size not reported</b> — the enquiry count is still right' : '') })
          : `<div class="hx-tile"><div class="hx-k">Analysis database</div>
             <div class="hx-v sm">${d.sql && d.sql.error ? 'Not answering' : 'Not connected'}</div>
             <div class="hx-note">${d.sql && d.sql.error ? esc(d.sql.error) : 'Enquiries are stored in the main database instead. Nothing is being lost.'}</div></div>`}
        ${d.sql && !d.sql.error ? meter({ title: 'Enquiries written this month', value: d.sql.writtenThisMonth.toLocaleString(), of: d.sql.writeLimit.toLocaleString(),
          pct: Math.round((d.sql.writtenThisMonth / d.sql.writeLimit) * 1000) / 10, state: 'good', label: 'Healthy',
          foot: 'Rows <i>read</i> are billed too, and are not visible from here — the provider’s own dashboard has that figure.' }) : ''}
      </div>

      ${d.kv.history && d.kv.history.length > 1 ? `<div class="cl-card" style="margin-top:14px"><div class="cl-card-h">Main database over time</div>
        ${barChart(d.kv.history.map((h) => ({ m: String(h.at).slice(0, 10), n: Math.round(h.bytes / 1048576) })))}
        <div class="small faint">Megabytes, one bar per measurement.</div></div>` : ''}

      <div class="k" style="margin-top:18px">Is everything arriving</div>
      <div class="hx-conn">${d.connections.map((c) => {
        // Each row says its state in words. A mark and a colour alone leave a reader guessing
        // whether a dot is "fine" or "off", which is the one thing this list exists to answer.
        const st = !c.ok ? 'warning' : c.stale ? 'serious' : 'good';
        const word = !c.ok ? 'Not set up' : c.stale ? 'Gone quiet' : 'Fine';
        return `<div class="hx-row">
          <span class="hx-state hx-${st}">${STATE_WORD[st]} ${word}</span>
          <b>${esc(c.label)}</b>
          <span class="small faint">${esc(c.note)}</span></div>`;
      }).join('')}</div>

      <div class="k" style="margin-top:18px">Catching up with Duda</div>
      <div class="hx-conn">
        <div class="hx-row"><span class="hx-state hx-${d.queue && d.queue.pending ? 'warning' : 'good'}">${d.queue && d.queue.pending ? '•' : '✓'} ${d.queue && d.queue.pending ? 'Working' : 'Up to date'}</span>
          <b>Form submission history</b>
          <span class="small faint">${d.queue && d.queue.pending
            ? `${d.queue.pending} website${d.queue.pending === 1 ? '' : 's'} still to fetch${d.queue.running ? ' · fetching now' : ' · picks up whenever someone has the app open'}`
            : 'Every website has had its history fetched. New enquiries arrive on their own.'}</span></div>
        ${['pull', 'domains', 'leads'].map((k) => { const r = (d.runs || {})[k]; const label = { pull: 'Website list pulled', domains: 'Domains checked', leads: 'Form submissions fetched' }[k];
          return `<div class="hx-row"><span class="hx-state hx-${r ? 'good' : 'warning'}">${r ? '✓ Done' : '• Never'}</span><b>${label}</b>
            <span class="small faint">${r ? `${esc(fmtWhen(Date.parse(r.at)))} · ${r.manual ? (r.byName ? 'by ' + esc(r.byName) : 'manually') : 'automatically'}` : 'has not run yet'}</span></div>`; }).join('')}
      </div>

      ${(d.sentAlerts || []).length ? `<div class="k" style="margin-top:18px">Already sent to you</div>
        <div class="hx-conn">${d.sentAlerts.map((a) => `<div class="hx-row" style="grid-template-columns:150px 1fr">
          <span class="small faint">${esc(fmtWhen(Date.parse(a.at)))}</span><span class="small">${esc(a.text)}</span></div>`).join('')}</div>
        <div class="small faint" style="margin-top:4px">Each kind is sent at most once in several hours, so a problem that persists does not become noise.</div>` : ''}

      <div class="k" style="margin-top:18px">The app right now</div>
      <div class="hx-tiles small-tiles">
        ${[['Websites', d.app.websites], ['Scanned in 7 days', d.app.scanned7], ['Marked complete', d.app.complete],
          ['Open critical items', d.app.openCritical], ['Team members', d.app.users], ['Client sign-ins', d.app.clients]]
          .map(([k, v]) => `<div class="hx-tile"><div class="hx-k">${esc(k)}</div><div class="hx-v">${Number(v || 0).toLocaleString()}</div></div>`).join('')}
      </div>`;
  }

  /**
   * The agreed business details for a website, if a project carries them.
   *
   * Cached for the session: a rescan-all across forty websites must not become forty extra
   * requests, and these change about once per project.
   */
  let briefCache = null;
  async function briefFor(siteId) {
    if (!siteId || !can('project.view')) return null;
    if (!briefCache) {
      briefCache = {};
      try {
        const r = await api('/api/projects?op=list');
        (r.projects || []).forEach((p) => { if (p.siteId && p.facts) briefCache[p.siteId] = p.id; });
      } catch (e) { return null; }
    }
    const id = briefCache[siteId];
    if (!id) return null;
    try {
      const r = await api(`/api/projects?op=one&id=${encodeURIComponent(id)}`);
      const f = (r.project || {}).facts || {};
      return Object.keys(f).length ? f : null;
    } catch (e) { return null; }
  }

  // =====================================================================
  // PROJECTS — the build, from the client's files to the client's comments
  // =====================================================================
  const proj = { list: null, phases: [], loading: false, dropbox: false, one: null, scan: null, read: null };
  const PHASE_OF = (k) => (proj.phases || []).find((p) => p.key === k) || { key: k, label: k, owner: '' };
  /** Anything past its date, for the dot in the top bar. */
  const projWaiting = () => (proj.list || []).some((p) => p.due && p.due < today() && p.phase !== 'done');
  const today = () => new Date().toISOString().slice(0, 10);
  const dueClass = (p) => (!p.due || p.phase === 'done') ? '' : p.due < today() ? 'sev-critical' : p.due === today() ? 'sev-warning' : 'subtle';
  const dueWord = (p) => {
    if (!p.due) return '';
    const d = Math.round((Date.parse(p.due) - Date.parse(today())) / 86400000);
    if (p.phase === 'done') return p.due;
    if (d < 0) return `${-d} day${d === -1 ? '' : 's'} late`;
    if (d === 0) return 'due today';
    if (d === 1) return 'due tomorrow';
    return `due in ${d} days`;
  };

  async function loadProjects() {
    try { const r = await api('/api/projects?op=list'); proj.list = r.projects || []; proj.phases = r.phases || []; proj.dropbox = !!r.dropbox; proj.scoped = !!r.scoped; }
    catch (e) { proj.list = []; proj.error = e.message; }
  }

  /** The board: one column per phase, so "where is everything" is a glance rather than a question. */
  async function renderProjects() {
    if (!proj.list) { $('#view').innerHTML = '<div class="empty">Loading…</div>'; await loadProjects(); renderTop(); }
    const list = proj.list || [];
    const late = list.filter((p) => p.due && p.due < today() && p.phase !== 'done');
    const open = list.filter((p) => p.phase !== 'done');
    $('#view').innerHTML = `<div class="page-head"><div><h1>Projects</h1>
        <div class="muted">Every build and where it has got to.${proj.scoped ? ' You are seeing the ones you are on.' : ''}</div></div>
        ${can('project.manage') ? '<button class="btn primary" id="pjNew">+ Add project</button>' : ''}</div>
      ${proj.error ? `<div class="note bad">${esc(proj.error)}</div>` : ''}
      ${late.length ? `<div class="note unk"><b>${late.length} past its date.</b>
        <div class="small" style="margin-top:3px">${late.slice(0, 4).map((p) => `<a href="#/project/${esc(p.id)}">${esc(p.name)}</a> — ${esc(PHASE_OF(p.phase).label)}, ${esc(dueWord(p))}${p.assignee ? ` (${esc(nameOf(p.assignee))})` : ''}`).join('<br>')}</div></div>` : ''}
      ${!list.length ? `<div class="empty">No projects yet.${can('project.manage') ? ' Click <b>+ Add project</b> to start one.' : ''}</div>`
        : `<div class="pj-board">${(proj.phases || []).filter((ph) => ph.key !== 'done' || list.some((p) => p.phase === 'done')).map((ph) => {
            const inPhase = list.filter((p) => p.phase === ph.key);
            return `<div class="pj-col${inPhase.length ? '' : ' empty-col'}">
              <div class="pj-col-h"><b>${esc(ph.label)}</b> <span class="faint">${inPhase.length || ''}</span>
                ${ph.owner ? `<div class="small faint">${esc(ph.owner)}</div>` : ''}</div>
              ${inPhase.map((p) => `<a class="pj-card" href="#/project/${esc(p.id)}">
                <b>${esc(p.name)}</b>
                ${p.client ? `<div class="small faint">${esc(p.client)}</div>` : ''}
                <div class="pj-card-f">${p.assignee ? avatar(p.assignee, 20) + `<span class="small">${esc(nameOf(p.assignee))}</span>` : '<span class="small faint">nobody</span>'}</div>
                ${p.due ? `<span class="badge ${dueClass(p)}">${esc(dueWord(p))}</span>` : ''}</a>`).join('')}
            </div>`;
          }).join('')}</div>
        <div class="small faint" style="margin-top:10px">${open.length} open · ${list.length - open.length} finished</div>`}`;
    if ($('#pjNew')) $('#pjNew').onclick = openNewProject;
  }

  function openNewProject() {
    const people = (state.users || []).filter((u) => u.status === 'active' && u.role !== 'client');
    modal(`<header><h2>Start a project</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <label class="field">Project name<input type="text" id="pjName" placeholder="Obsessed Detail and Restoration — new build"></label>
        <label class="field">Client<input type="text" id="pjClient" placeholder="Obsessed Detail and Restoration"></label>
        <label class="field">Dropbox folder link
          <input type="text" id="pjDrop" placeholder="https://www.dropbox.com/scl/fo/…">
          <span class="small muted">${proj.dropbox ? 'The app will read this folder, find the client’s brief and offer the business details from it. The link must be set so that anyone with it can view.' : 'Dropbox is not connected yet, so the link is kept for reference only.'}</span></label>
        <label class="field">Hand it to
          <select id="pjWho"><option value="${esc(state.me.email)}">Me (${esc(state.me.name)})</option>
            ${people.filter((u) => u.email !== state.me.email).map((u) => `<option value="${esc(u.email)}">${esc(u.name)}</option>`).join('')}</select></label>
        <label class="field">Due<input type="date" id="pjDue" min="${today()}"></label>
        <div class="field"><span>Who else is involved</span>
          <div class="pj-people">${people.map((u) => `<label class="check-row"><input type="checkbox" data-pjm="${esc(u.email)}" ${u.email === state.me.email ? 'checked disabled' : ''}><span>${esc(u.name)}</span></label>`).join('')}</div>
          <span class="small muted">They get the project in their list and hear about anything written in it.</span></div>
      </div>
      <footer><span class="spacer"></span><button class="btn primary" id="pjGo">Start project</button></footer>`);
    $('#pjGo').onclick = async () => {
      const body = {
        op: 'create', name: $('#pjName').value.trim(), client: $('#pjClient').value.trim(),
        dropbox: $('#pjDrop').value.trim(), assignee: $('#pjWho').value, due: $('#pjDue').value,
        members: $$('[data-pjm]').filter((i) => i.checked).map((i) => i.dataset.pjm).concat([state.me.email]),
      };
      if (!body.name) return toast('Give the project a name.');
      $('#pjGo').disabled = true;
      try { const r = await post('/api/projects', body); closeModal(); proj.list = null; location.hash = `#/project/${r.project.id}`; }
      catch (e) { toast(e.message); $('#pjGo').disabled = false; }
    };
  }

  /** One project: its details, its files, and the handover that moves it on. */
  async function renderProject(id) {
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    let d;
    try { d = await api(`/api/projects?op=one&id=${encodeURIComponent(id)}`); }
    catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    proj.phases = d.phases || proj.phases;
    const p = d.project;
    proj.one = p;
    proj.scan = d.listing || null;
    const ph = PHASE_OF(p.phase);
    const may = can('project.manage') || p.assignee === state.me.email;
    const facts = p.facts || {};
    const hasFacts = Object.keys(facts).length > 0;

    $('#view').innerHTML = `<div class="page-head"><div>
        <div class="small muted"><a href="#/projects">← Projects</a></div>
        <h1>${esc(p.name)}</h1>
        <div class="muted small">${p.client ? esc(p.client) + ' · ' : ''}<b>${esc(ph.label)}</b>
          ${p.assignee ? ` · with ${esc(nameOf(p.assignee))}` : ' · nobody is holding it'}
          ${p.due ? ` · <span class="badge ${dueClass(p)}">${esc(dueWord(p))}</span>` : ''}</div></div>
      <div style="display:flex;gap:8px">
        ${may ? '<button class="btn primary" id="pjHand">Hand on →</button>' : ''}
        ${can('project.manage') ? '<button class="btn ghost" id="pjEdit">Edit</button>' : ''}</div></div>

      <div class="pj-rail">${(proj.phases || []).map((x, i) => {
        const at = (proj.phases || []).findIndex((y) => y.key === p.phase);
        return `<span class="pj-step ${i < at ? 'past' : i === at ? 'now' : ''}" title="${esc(x.desc || '')}">${esc(x.label)}</span>`;
      }).join('')}</div>

      <div class="cl-two" style="margin-top:14px">
        <div class="cl-card">
          <div class="cl-card-h">Business details <span class="faint small">${hasFacts ? 'the reference every audit is checked against' : 'not agreed yet'}</span></div>
          ${hasFacts ? `<table class="grid sm"><tbody>${(d.factFields || []).filter((f) => facts[f.key]).map((f) => `<tr>
              <td class="faint" style="width:150px">${esc(f.label)}</td><td style="white-space:pre-line">${esc(facts[f.key])}</td></tr>`).join('')}</tbody></table>
            ${p.factsFile ? `<div class="small faint" style="margin-top:6px">From <b>${esc(String(p.factsFile).split('/').pop())}</b></div>` : ''}`
            : '<div class="empty small">Nothing agreed yet. Read the client’s brief from Dropbox, or type them in.</div>'}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            ${may ? '<button class="btn sm" id="pjFacts">Edit details</button>' : ''}
            ${may && Object.keys(p.factsFrom || {}).length ? '<button class="btn sm ghost" id="pjReset" title="Put back exactly what the brief said">↺ Reset to the brief</button>' : ''}
          </div>
        </div>
        <div class="cl-card">
          <div class="cl-card-h">Dropbox</div>
          ${p.dropbox ? `<div class="small"><a href="${esc(p.dropbox)}" target="_blank" rel="noopener">Open the folder ↗</a></div>
            ${!d.dropbox ? '<div class="small faint" style="margin-top:6px">Dropbox is not connected, so the app cannot read this folder — the link is here for reference.</div>'
              : `<div style="margin-top:8px"><button class="btn sm" id="pjScan">${proj.scan ? '↻ Read the folder again' : 'Read the folder'}</button></div>
                 <div id="pjFiles">${filesPanel()}</div>`}`
            : `<div class="empty small">No Dropbox folder linked yet.${can('project.manage') ? ' Use <b>Edit</b> to add one.' : ''}</div>`}
        </div>
      </div>

      <div class="cl-card" style="margin-top:12px">
        <div class="cl-card-h">The website</div>
        ${p.auditId ? `<div class="small"><a href="#/site/${esc(p.auditId)}">Open the audit ↗</a>${p.siteId ? ` <span class="faint mono">${esc(p.siteId)}</span>` : ''}</div>`
          : p.siteId ? `<div class="small"><a href="#/dr/${esc(p.siteId)}">Open the profile ↗</a> <span class="faint mono">${esc(p.siteId)}</span>
              ${can('site.add') ? ` · <button class="linkbtn" id="pjAudit">Start the audit</button>` : ''}</div>`
          : `<div class="empty small">No website linked yet.${may ? ' Add its Duda site ID with <b>Edit</b>, and the agreed details above become what its audit is checked against.' : ''}</div>`}
      </div>

      <div class="cl-card" style="margin-top:12px">
        <div class="cl-card-h">What has happened <span class="faint small">${(p.members || []).length} involved</span></div>
        <div class="pj-say">${may || (p.members || []).includes(state.me.email) ? `<input type="text" id="pjNote" placeholder="Say something to everyone on this project…"><button class="btn sm" id="pjSay">Post</button>` : ''}</div>
        <div class="pj-trail">${(p.history || []).slice().reverse().map(trailLine).join('') || '<div class="empty small">Nothing yet.</div>'}</div>
      </div>`;

    if ($('#pjHand')) $('#pjHand').onclick = () => openHand(p);
    if ($('#pjEdit')) $('#pjEdit').onclick = () => openEditProject(p);
    if ($('#pjFacts')) $('#pjFacts').onclick = () => openFacts(p, d.factFields || []);
    if ($('#pjScan')) $('#pjScan').onclick = () => scanDropbox(p);
    if ($('#pjReset')) $('#pjReset').onclick = async () => {
      if (!confirm('Put the business details back to exactly what the brief said?')) return;
      try { await post('/api/projects', { op: 'facts', id: p.id, reset: true }); toast('Back to the brief'); renderProject(p.id); } catch (e) { toast(e.message); }
    };
    if ($('#pjSay')) $('#pjSay').onclick = async () => {
      const t = $('#pjNote').value.trim(); if (!t) return;
      $('#pjSay').disabled = true;
      try { await post('/api/projects', { op: 'say', id: p.id, text: t }); renderProject(p.id); } catch (e) { toast(e.message); $('#pjSay').disabled = false; }
    };
    if ($('#pjAudit')) $('#pjAudit').onclick = async () => {
      const host = editorHostOr();
      try {
        const sum = await store({ op: 'create', siteId: p.siteId, host, editorUrl: `https://${host}/home/site/${p.siteId}/home`, assignee: state.me.email });
        upsertSummary(sum); requestScan([sum.id]);
        await post('/api/projects', { op: 'link', id: p.id, auditId: sum.id });
        toast('Audit started'); renderProject(p.id);
      } catch (e) { toast(e.message); }
    };
    bindFiles(p);
  }

  /** One line of the trail, in words rather than field names. */
  function trailLine(h) {
    const who = esc(h.byName || h.by || 'somebody');
    const when = `<span class="faint small">${esc(fmtWhen(Date.parse(h.at)))}</span>`;
    const body = {
      created: () => `<b>${who}</b> started the project`,
      phase: () => `<b>${who}</b> moved it to <b>${esc(PHASE_OF(h.to).label)}</b>${h.toWho ? ` and gave it to ${esc(nameOf(h.toWho))}` : ''}${h.due ? `, due ${esc(h.due)}` : ''}${h.note ? `<div class="pj-note">${esc(h.note)}</div>` : ''}`,
      facts: () => `<b>${who}</b> set the business details${(h.fields || []).length ? ` (${h.fields.map(esc).join(', ')})` : ''}${h.file ? ` from <b>${esc(String(h.file).split('/').pop())}</b>` : ''}`,
      'facts-reset': () => `<b>${who}</b> put the details back to the brief`,
      scanned: () => `<b>${who}</b> read the Dropbox folder — ${Number(h.n || 0)} files`,
      members: () => `<b>${who}</b> changed who is involved`,
      linked: () => `<b>${who}</b> linked the website${h.siteId ? ` <span class="mono faint">${esc(h.siteId)}</span>` : ''}`,
      note: () => `<b>${who}</b>: ${esc(h.note || '')}`,
      late: () => `<span class="sev-critical badge">Past its date</span> on ${esc(PHASE_OF(h.phase).label)} (was due ${esc(h.due || '')})`,
    }[h.what];
    return `<div class="pj-ev">${body ? body() : esc(h.what)} ${when}</div>`;
  }

  function filesPanel() {
    const sc = proj.scan;
    if (!sc) return '';
    const briefs = sc.briefs || [];
    return `<div class="small faint" style="margin:8px 0 4px">${sc.count} file${sc.count === 1 ? '' : 's'} in the folder${briefs.length ? ` · ${briefs.length} PDF${briefs.length === 1 ? '' : 's'} that could be the brief` : ' · no PDFs'}</div>
      ${briefs.map((f) => `<div class="pj-file"><span class="grow">${esc(f.name)}<div class="small faint">${Math.round((f.size || 0) / 1024)} KB</div></span>
        <button class="btn sm" data-pjread="${esc(f.path)}">Read it</button></div>`).join('')}`;
  }

  function bindFiles(p) {
    $$('[data-pjread]').forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = 'Reading…';
      try {
        const r = await post('/api/projects', { op: 'read', id: p.id, file: b.dataset.pjread });
        if (!r.readable) { toast(r.why); b.disabled = false; b.textContent = 'Read it'; return; }
        offerFacts(p, r);
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Read it'; }
    }));
  }

  async function scanDropbox(p) {
    const b = $('#pjScan'); b.disabled = true; b.textContent = 'Reading the folder…';
    try { proj.scan = await post('/api/projects', { op: 'scan', id: p.id }); $('#pjFiles').innerHTML = filesPanel(); bindFiles(p); }
    catch (e) { toast(e.message); }
    b.disabled = false; b.textContent = '↻ Read the folder again';
  }

  /**
   * What the brief says, offered rather than applied.
   *
   * Every value shows how it was arrived at, because "it said so on the form" and "we matched a
   * pattern in the text" deserve different amounts of trust, and the person confirming is the only
   * one who can tell them apart.
   */
  function offerFacts(p, r) {
    const F = (proj.factFields || [
      { key: 'businessName', label: 'Business name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
      { key: 'address', label: 'Address' }, { key: 'hours', label: 'Opening hours' }, { key: 'website', label: 'Website' }]);
    const got = r.found || {};
    modal(`<header><h2>What the brief says</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <div class="note"><b>Check these before they become the reference.</b>
          <div class="small" style="margin-top:3px">Every audit of this website will be checked against whatever is saved here, so a wrong value here becomes a wrong value everywhere. <b>Answered</b> means the brief had a label for it; <b>guessed</b> means it was matched out of the text.</div></div>
        ${F.map((f) => {
          const g = got[f.key];
          const multi = f.key === 'hours' || f.key === 'address';
          return `<label class="field">${esc(f.label)}
            ${g ? `<span class="badge ${g.how === 'labelled' ? 'subtle' : 'sev-warning'}" style="margin-left:6px">${g.how === 'labelled' ? 'answered' : 'guessed'}</span>` : ''}
            ${multi ? `<textarea id="ff-${f.key}" rows="${f.key === 'hours' ? 4 : 2}">${esc((g || {}).value || '')}</textarea>`
              : `<input type="text" id="ff-${f.key}" value="${esc((g || {}).value || '')}">`}</label>`;
        }).join('')}
        ${(got.otherPhones || []).length ? `<div class="small muted">Other phone numbers in the document: ${got.otherPhones.map(esc).join(', ')}</div>` : ''}
        ${(got.otherEmails || []).length ? `<div class="small muted">Other emails: ${got.otherEmails.map(esc).join(', ')}</div>` : ''}
        <details style="margin-top:8px"><summary class="small">What the document actually said</summary>
          <pre class="pj-raw">${esc(r.text || '')}</pre></details>
      </div>
      <footer><span class="spacer"></span><button class="btn primary" id="ffSave">Use these details</button></footer>`);
    $('#ffSave').onclick = async () => {
      const facts = {};
      F.forEach((f) => { const el = $(`#ff-${f.key}`); if (el && el.value.trim()) facts[f.key] = el.value.trim(); });
      $('#ffSave').disabled = true;
      try { await post('/api/projects', { op: 'facts', id: p.id, facts, from: r.file }); closeModal(); toast('These are the reference now'); renderProject(p.id); }
      catch (e) { toast(e.message); $('#ffSave').disabled = false; }
    };
  }

  function openFacts(p, fields) {
    const F = fields.length ? fields : [{ key: 'businessName', label: 'Business name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address' }, { key: 'hours', label: 'Opening hours' }, { key: 'website', label: 'Website' }];
    modal(`<header><h2>Business details</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body"><div class="small muted">These are what every audit of this website is checked against.</div>
        ${F.map((f) => { const multi = f.key === 'hours' || f.key === 'address';
          return `<label class="field">${esc(f.label)}${multi ? `<textarea id="fe-${f.key}" rows="${f.key === 'hours' ? 4 : 2}">${esc((p.facts || {})[f.key] || '')}</textarea>` : `<input type="text" id="fe-${f.key}" value="${esc((p.facts || {})[f.key] || '')}">`}</label>`;
        }).join('')}</div>
      <footer><span class="spacer"></span><button class="btn primary" id="feSave">Save</button></footer>`);
    $('#feSave').onclick = async () => {
      const facts = {};
      F.forEach((f) => { const el = $(`#fe-${f.key}`); if (el && el.value.trim()) facts[f.key] = el.value.trim(); });
      try { await post('/api/projects', { op: 'facts', id: p.id, facts }); closeModal(); renderProject(p.id); } catch (e) { toast(e.message); }
    };
  }

  /** The handover. One screen, because it is one decision: who, which phase, by when, and why. */
  function openHand(p) {
    const people = (state.users || []).filter((u) => u.status === 'active' && u.role !== 'client');
    const at = (proj.phases || []).findIndex((x) => x.key === p.phase);
    const suggested = (proj.phases || [])[Math.min((proj.phases || []).length - 1, at + 1)] || {};
    modal(`<header><h2>Hand on</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <label class="field">To which phase
          <select id="hdPhase">${(proj.phases || []).map((x) => `<option value="${esc(x.key)}" ${x.key === suggested.key ? 'selected' : ''}>${esc(x.label)}${x.owner ? ` — ${esc(x.owner)}` : ''}</option>`).join('')}</select>
          <span class="small muted">Going backwards is normal — revisions are a phase, not a failure.</span></label>
        <label class="field">To whom
          <select id="hdWho"><option value="">Nobody yet</option>
            ${people.map((u) => `<option value="${esc(u.email)}" ${u.email === state.me.email ? '' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label class="field">Due<input type="date" id="hdDue" min="${today()}">
          <span class="small muted">If it passes, the project manager and whoever is holding it both hear about it — once.</span></label>
        <label class="field">Anything they should know<textarea id="hdNote" rows="3" placeholder="What is done, what is left, anything odd…"></textarea></label>
      </div>
      <footer><span class="spacer"></span><button class="btn primary" id="hdGo">Hand on</button></footer>`);
    $('#hdGo').onclick = async () => {
      $('#hdGo').disabled = true;
      try {
        await post('/api/projects', { op: 'hand', id: p.id, phase: $('#hdPhase').value, assignee: $('#hdWho').value, due: $('#hdDue').value, note: $('#hdNote').value });
        closeModal(); proj.list = null; toast('Handed on'); renderProject(p.id);
      } catch (e) { toast(e.message); $('#hdGo').disabled = false; }
    };
  }

  function openEditProject(p) {
    const people = (state.users || []).filter((u) => u.status === 'active' && u.role !== 'client');
    modal(`<header><h2>Edit project</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <label class="field">Project name<input type="text" id="peName" value="${esc(p.name)}"></label>
        <label class="field">Client<input type="text" id="peClient" value="${esc(p.client || '')}"></label>
        <label class="field">Dropbox folder link<input type="text" id="peDrop" value="${esc(p.dropbox || '')}"></label>
        <label class="field">Duda site ID<input type="text" id="peSite" value="${esc(p.siteId || '')}" placeholder="e.g. 018964f1">
          <span class="small muted">Once this is set, the business details above become what its audit is checked against.</span></label>
        <div class="field"><span>Who is involved</span>
          <div class="pj-people">${people.map((u) => `<label class="check-row"><input type="checkbox" data-pem="${esc(u.email)}" ${(p.members || []).includes(u.email) ? 'checked' : ''}><span>${esc(u.name)}</span></label>`).join('')}</div></div>
      </div>
      <footer><button class="btn danger" id="peDel">Delete</button><span class="spacer"></span><button class="btn primary" id="peSave">Save</button></footer>`);
    $('#peSave').onclick = async () => {
      try {
        await post('/api/projects', { op: 'link', id: p.id, name: $('#peName').value.trim(), client: $('#peClient').value.trim(), dropbox: $('#peDrop').value.trim(), siteId: $('#peSite').value.trim() });
        await post('/api/projects', { op: 'members', id: p.id, members: $$('[data-pem]').filter((i) => i.checked).map((i) => i.dataset.pem) });
        closeModal(); proj.list = null; renderProject(p.id);
      } catch (e) { toast(e.message); }
    };
    $('#peDel').onclick = async () => {
      if (!confirm(`Delete ${p.name}? The audit and its form submissions are not touched.`)) return;
      try { await post('/api/projects', { op: 'remove', id: p.id }); closeModal(); proj.list = null; location.hash = '#/projects'; } catch (e) { toast(e.message); }
    };
  }

  // =====================================================================
  // LEAD ANALYSIS — what the enquiries say, once there are enough to ask
  // =====================================================================
  const AN_TABS = [
    ['quiet', 'Forms gone quiet'],
    ['benchmarks', 'Across all websites'],
    ['junk', 'Junk and blasts'],
  ];
  async function renderAnalysis(tab) {
    const t = AN_TABS.some(([k]) => k === tab) ? tab : 'quiet';
    $('#view').innerHTML = `<div class="page-head"><div><h1>Lead analysis</h1>
        <div class="muted">What the enquiries across every website add up to.</div></div>
        ${can('leads.import') ? '<button class="btn" id="anMigrate" title="Copy enquiries already stored into the analysis database">⇪ Bring enquiries in</button>' : ''}</div>
      <div class="tabs">${AN_TABS.map(([k, label]) => `<a href="#/analysis/${k}" class="${t === k ? 'on' : ''}">${esc(label)}</a>`).join('')}</div>
      <div id="anBody"><div class="empty">Loading…</div></div>`;
    if ($('#anMigrate')) $('#anMigrate').onclick = migrateLeads;
    const body = $('#anBody');
    let d;
    try { d = await api(`/api/analysis?op=${t === 'junk' ? 'benchmarks' : t}`); }
    catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (d.ready === false) {
      body.innerHTML = `<div class="note"><b>The analysis database is not connected yet.</b>
        <div class="small" style="margin-top:4px">Enquiries are still arriving and being stored — nothing is being lost. These pages fill in as soon as it is set up, and <b>Bring enquiries in</b> copies across everything already held.</div></div>`;
      return;
    }
    if (t === 'quiet') return anQuiet(body, d);
    if (t === 'benchmarks') return anBench(body, d);
    return anJunk(body, d);
  }

  /** Websites that used to get enquiries and have stopped. The one worth money. */
  function anQuiet(body, d) {
    const list = d.sites || [];
    body.innerHTML = `<p class="small muted">A form that quietly breaks looks like a slow month. These websites <b>used to get enquiries and have stopped</b> — counting real customers only, so a form still collecting junk still shows up here.</p>
      ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Website</th><th>Quiet for</th><th>Usually</th><th>Last real enquiry</th><th></th></tr></thead><tbody>
        ${list.map((r) => `<tr>
          <td><b>${esc(r.name)}</b><div class="small faint mono">${esc(r.site)}</div></td>
          <td><span class="badge ${r.quiet_days > 45 ? 'sev-critical' : 'sev-warning'}">${r.quiet_days} days</span></td>
          <td>${r.per_month}/month <span class="faint small">over ${r.months} months</span></td>
          <td class="small">${r.last_real ? esc(r.last_real) : '<span class="faint">never</span>'}</td>
          <td>${r.auditId ? `<a class="btn sm" href="#/site/${esc(r.auditId)}/leads">Open</a>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`
      : '<div class="empty">Nothing has gone quiet. Every website with a history is still getting enquiries.</div>'}`;
  }

  /** What the busy websites do differently — counts only, nobody named. */
  function anBench(body, d) {
    const o = d.overall || {};
    const pct = o.total ? Math.round((o.junk / o.total) * 100) : 0;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowList = days.map((n, i) => ({ k: n, n: ((d.dows || []).find((x) => x.dow === i) || {}).n || 0 }));
    const hours = Array.from({ length: 24 }, (_, i) => ({ m: String(i).padStart(2, '0'), n: ((d.hours || []).find((x) => x.hour === i) || {}).n || 0 }));
    body.innerHTML = `
      <div class="cl-tiles">
        <div class="cl-tile"><div class="cl-t-k">Websites with enquiries</div><div class="cl-t-v">${o.sites || 0}</div></div>
        <div class="cl-tile"><div class="cl-t-k">Real enquiries</div><div class="cl-t-v">${o.real || 0}</div></div>
        <div class="cl-tile"><div class="cl-t-k">Set aside as junk</div><div class="cl-t-v">${o.junk || 0}</div><div class="cl-t-d faint">${pct}% of everything</div></div>
      </div>
      <p class="small muted">Counts across every website, with none of them named. A row needs <b>at least three websites</b> behind it before it is shown — otherwise it is one shop's story dressed up as a pattern.</p>
      <div class="cl-two">
        <div class="cl-card"><div class="cl-card-h">Pages that produce enquiries</div>
          <div class="small faint" style="margin:-6px 0 8px">Average per website that has one</div>
          ${hBars((d.pages || []).map((p) => ({ k: p.page + ` · ${p.sites} sites`, n: p.per_site })))}</div>
        <div class="cl-card"><div class="cl-card-h">Where enquiries come from</div>${hBars((d.sources || []).map((s) => ({ k: s.source, n: s.n })))}</div>
      </div>
      <div class="cl-two">
        <div class="cl-card"><div class="cl-card-h">Which day people get in touch</div>${barChart(dowList.map((x) => ({ m: x.k, n: x.n })))}</div>
        <div class="cl-card"><div class="cl-card-h">And what time</div>${barChart(hours)}</div>
      </div>`;
  }

  /** The blasts: one message, several clients. */
  function anJunk(body, d) {
    const blasts = d.blasts || [];
    body.innerHTML = `<p class="small muted">The same message sent to <b>more than one client</b>. Any one shop sees an odd email; across the whole list it is plainly a blast — which is why this can be seen here and nowhere else.</p>
      ${blasts.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Websites</th><th>Copies</th><th>Last seen</th><th>The message</th></tr></thead><tbody>
        ${blasts.map((b2) => `<tr><td><b>${b2.sites}</b></td><td>${b2.n}</td><td class="small">${esc(dayLabel(b2.last))}</td>
          <td class="small">${esc(String(b2.sample || '').slice(0, 140))}…</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No message has been sent to more than one client yet.</div>'}`;
  }

  /** Copy what the key-value store holds into the analysis database, a few websites at a time. */
  async function migrateLeads() {
    const ids = [...new Set(state.sites.map((s) => s.siteId).filter(Boolean))];
    if (!ids.length) return toast('No websites to bring in yet.');
    if (!confirm(`Copy the enquiries held for ${ids.length} website${ids.length === 1 ? '' : 's'} into the analysis database?\n\nNothing is deleted — the existing copy stays exactly where it is.`)) return;
    const btn = $('#anMigrate'); let done = 0; let added = 0;
    for (let i = 0; i < ids.length; i += 5) {
      if (btn) { btn.disabled = true; btn.textContent = `Bringing in ${done}/${ids.length}…`; }
      try { const r = await post('/api/analysis', { op: 'migrate', ids: ids.slice(i, i + 5) }); (r.done || []).forEach((x) => { added += x.added; }); }
      catch (e) { toast(e.message); break; }
      done = Math.min(ids.length, i + 5);
    }
    if (btn) { btn.disabled = false; btn.textContent = '⇪ Bring enquiries in'; }
    toast(`${added} enquir${added === 1 ? 'y' : 'ies'} brought in`);
    renderAnalysis(route().tab);
  }

  // =====================================================================
  // PROFILE — the website, as a whole, for us
  // =====================================================================
  const leadCount = (id) => ((state.leadSums && state.leadSums[id]) || {}).total || 0;
  /** The small per-website lead counts, fetched once for the whole list. */
  async function loadLeadSums(ids) {
    if (!ids.length) return;
    try { const r = await api('/api/leads?op=summary&ids=' + encodeURIComponent(ids.slice(0, 400).join(','))); state.leadSums = Object.assign(state.leadSums || {}, r.summaries || {}); }
    catch (e) { /* the profile still works without the counts */ }
  }

  // =====================================================================
  // THE BACKFILL QUEUE — websites still waiting for their history from Duda
  // =====================================================================
  /**
   * Keep the queue moving.
   *
   * Nothing is scheduled anywhere: this browser asks whether there is work, and if there is, does a
   * few websites' worth. The server's lock means six people with the app open still only ever
   * produce one pull at a time, so this is safe to call from every browser without coordination.
   *
   * It stops the moment the queue is empty, which is why it costs nothing on an ordinary day.
   */
  /**
   * The heartbeat says whether there is catching up to do; only then does this browser do any.
   *
   * There used to be a separate check every 20 seconds in every open tab, visible or not, and it was
   * one of the two things that ran through the month's database allowance in five days. Now an idle
   * app costs nothing extra: the state rides on the heartbeat that was already running.
   */
  function onQueueState(lq) {
    live.q2 = Object.assign({}, live.q2 || {}, lq);
    if (route().name === 'live') renderLive();
    if (!(lq.pending > 0 || lq.tidyDone === false) || !can('leads.view')) return;
    // Work that turns up while a run is already finishing must not wait for the next heartbeat.
    if (live.draining) live.drainAgain = true; else drainLoop();
  }

  /**
   * Work through the catch-up, one chunk at a time, while there is any.
   *
   * Every call here does real work — fetching a few websites' history or tidying a few — so there is
   * no idle polling at all. It stops the moment the server says there is nothing left, or that
   * another browser has the lock (that browser will finish it).
   */
  async function drainLoop() {
    if (live.draining) { live.drainAgain = true; return; }
    live.draining = true; live.drainAgain = false;
    try {
      for (let i = 0; i < 400; i++) {
        let r;
        try { r = await post('/api/leadq', { op: 'drain', by: 'auto' }); } catch (e) { break; }
        if (r.done && r.done.length) {
          await loadLeadSums(r.done.map((d) => d.id));
          r.done.forEach((d) => { delete (live.queued || {})[d.id]; });
        }
        live.q2 = Object.assign({}, live.q2 || {}, { pending: r.pending || 0, tidyDone: r.tidyDone });
        if (route().name === 'live') renderLive();
        const more = (r.done && r.done.length) || (r.tidied && r.tidied.sites);
        if (!more) break;                                   // nothing done: finished, or someone else has it
        await new Promise((res) => setTimeout(res, 1500));  // breathing room between chunks
      }
    } finally {
      live.draining = false;
      if (live.drainAgain) { live.drainAgain = false; setTimeout(drainLoop, 500); }
    }
  }

  /** Which websites are still waiting — asked once when Live DR Sites opens, not on a timer. */
  async function loadQueueIds() {
    if (live.qIdsLoaded || !can('leads.view')) return;
    live.qIdsLoaded = true;
    try {
      const st = await api('/api/leadq');
      live.queued = {}; (st.ids || []).forEach((id) => { live.queued[id] = 1; });
      live.q2 = Object.assign({}, live.q2 || {}, { pending: st.pending, tidyDone: st.tidyDone });
      if (route().name === 'live') renderLive();
    } catch (e) { /* the list still works without the markers */ }
  }
  function startQueue() { /* nothing to start: the heartbeat drives the catch-up now */ }

  function renderProfileTab(body, s, { cnt, generalComments }) {
    const sum = (state.leadSums && state.leadSums[s.siteId]) || {};
    const t = s.truth || {};
    const prevUrl = `https://${linkHost(s)}/site/${s.siteId}?preview=true&insitepreview=true&dm_device=desktop`;
    const sc = s.scan || {};
    const sev = (k, label) => `<button class="pf-count ${k}" data-gofilter="${k}">${cnt[k] || 0}<span>${label}</span></button>`;
    body.innerHTML = `
      <div class="pf">
        <div class="pf-top">
          <a class="pf-shot" href="${esc(prevUrl)}" target="_blank" rel="noopener" title="Open the desktop preview">
            <iframe src="${esc(prevUrl)}" title="Preview of ${esc(s.businessName || s.siteId)}" loading="lazy" tabindex="-1"></iframe><span class="pf-shot-o">Open preview ↗</span></a>
          <div class="pf-id">
            <h2>${esc(s.businessName || s.siteId)}</h2>
            <div class="pf-meta">
              ${t.domain || s.host ? `<a href="https://${esc(t.domain || s.host)}" target="_blank" rel="noopener">${esc(t.domain || s.host)} ↗</a>` : '<span class="faint">No domain yet</span>'}
              ${(t.addresses || [])[0] && t.addresses[0].city ? ` · ${esc(t.addresses[0].city)}` : ''}
              ${sc.at ? ` · last scan ${esc(fmtWhen(Date.parse(sc.at)))}` : ' · never scanned'}
            </div>
            <div class="pf-owner">
              <label>Client contact</label>
              <div class="pf-owner-row" id="pfOwner">${clientsFor(s.id).length
                ? clientsFor(s.id).map((c) => `<span class="pill">${esc(c.name)}<span class="faint small"> · ${esc(c.email)}</span></span>`).join('')
                : '<span class="faint">Nobody yet</span>'}
                ${can('client.manage') ? '<button class="linkbtn" id="pfClient">Manage client access</button>' : ''}</div>
            </div>
            <div class="pf-acts">
              ${can('client.viewas') ? '<button class="btn" id="pfView">👁 View as client</button>' : ''}
              <a class="btn ghost" href="${esc(editorUrl(s, '/'))}" target="_blank" rel="noopener">Open editor ↗</a>
            </div>
          </div>
        </div>

        <div class="pf-cards">
          <div class="pf-card">
            <div class="pf-card-h">Audit <a href="#/site/${esc(s.id)}">open ↗</a></div>
            <div class="pf-counts">${sev('critical', 'critical')}${sev('outdated', 'outdated')}${sev('warning', 'warning')}${sev('info', 'info')}</div>
            <div class="small faint">${esc(s.status || 'Open')}${sc.pages ? ` · ${sc.pages} pages checked` : ''}</div>
          </div>
          <div class="pf-card">
            <div class="pf-card-h">Form submissions <a href="#/site/${esc(s.id)}/leads">open ↗</a></div>
            <div class="pf-big">${sum.total || 0}</div>
            <div class="small faint">${sum.last ? `last one ${esc(fmtWhen(Date.parse(sum.last)))}` : 'none recorded yet'}</div>
          </div>
          <div class="pf-card">
            <div class="pf-card-h">Comments <a href="#/site/${esc(s.id)}/comments">open ↗</a></div>
            <div class="pf-big">${generalComments || 0}</div>
            <div class="small faint">on this website</div>
          </div>
        </div>
      </div>`;
    if ($('#pfView')) $('#pfView').onclick = () => { state.viewAs = s.id; state.cl.sites = null; location.hash = `#/my/${encodeURIComponent(s.id)}/dashboard`; };
    // Who can see this website is only known once; after that the panel redraws from what we hold.
    if (can('client.manage') && state.clients === null) {
      state.clients = [];
      post('/api/users', { op: 'clients' }).then((r) => { state.clients = r.clients || []; if (route().tab === 'profile') renderProfileTab(body, s, { cnt, generalComments }); }).catch(() => {});
    }
    if (!state.leadSums[s.siteId]) loadLeadSums([s.siteId]).then(() => { if (route().tab === 'profile') renderProfileTab(body, s, { cnt, generalComments }); });
    if ($('#pfClient')) $('#pfClient').onclick = () => openClients(s);
    $$('[data-gofilter]', body).forEach((b) => (b.onclick = () => { state.ff.sev = b.dataset.gofilter; location.hash = '#/site/' + encodeURIComponent(s.id); }));
  }
  const clientsFor = (siteId) => (state.clients || []).filter((c) => (c.sites || []).includes(siteId));

  /** Who outside the team can see this website. Admin only. */
  async function openClients(s) {
    modal(`<header><h2>Client access — ${esc(s.businessName || s.siteId)}</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body" id="clBody"><div class="empty">Loading…</div></div>`);
    const draw = async () => {
      try { const r = await post('/api/users', { op: 'clients' }); state.clients = r.clients || []; } catch (e) { toast(e.message); }
      const here = clientsFor(s.id); const others = (state.clients || []).filter((c) => !(c.sites || []).includes(s.id));
      $('#clBody').innerHTML = `
        <p class="small muted">A client sees only the websites listed on their account: their enquiries, their comments, and a link into their own website. They never see audit items, false alarm reports or anything the team writes to itself.</p>
        <div class="k">Can see this website</div>
        ${here.length ? here.map((c) => `<div class="member-row"><div><b>${esc(c.name)}</b><div class="small muted">${esc(c.email)}${c.company ? ' · ' + esc(c.company) : ''} · ${c.sites.length} website${c.sites.length === 1 ? '' : 's'}</div></div>
          <button class="btn sm ghost" data-cloff="${esc(c.email)}">Remove</button></div>`).join('') : '<div class="empty small">Nobody outside the team can see this website.</div>'}
        <div class="k" style="margin-top:14px">Add somebody</div>
        ${others.length ? `<div class="member-row"><select id="clPick">${others.map((c) => `<option value="${esc(c.email)}">${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select>
          <button class="btn sm" id="clAddExisting">Give access</button></div>` : ''}
        <div class="cl-new"><input id="clName" placeholder="Name" maxlength="60"><input id="clEmail" placeholder="email@theircompany.com" maxlength="160">
          <input id="clCo" placeholder="Company (optional)" maxlength="80"><button class="btn primary" id="clAdd">Create and give access</button></div>
        <div class="small faint" style="margin-top:6px">They get an email saying their dashboard is ready, and set their own password with <b>Forgot password</b>.</div>`;
      $$('[data-cloff]').forEach((b) => (b.onclick = async () => {
        const c = state.clients.find((x) => x.email === b.dataset.cloff); if (!c) return;
        try { await post('/api/users', { op: 'clientSave', email: c.email, name: c.name, company: c.company, sites: c.sites.filter((x) => x !== s.id) }); toast('Access removed'); draw(); } catch (e) { toast(e.message); }
      }));
      if ($('#clAddExisting')) $('#clAddExisting').onclick = async () => {
        const c = state.clients.find((x) => x.email === $('#clPick').value); if (!c) return;
        try { await post('/api/users', { op: 'clientSave', email: c.email, name: c.name, company: c.company, sites: c.sites.concat([s.id]) }); toast('Access given'); draw(); } catch (e) { toast(e.message); }
      };
      $('#clAdd').onclick = async () => {
        const email = $('#clEmail').value.trim(); if (!email) return toast('An email address is needed');
        try { await post('/api/users', { op: 'clientSave', email, name: $('#clName').value.trim(), company: $('#clCo').value.trim(), sites: [s.id] }); toast('Client added'); draw(); renderSite(); } catch (e) { toast(e.message); }
      };
    };
    draw();
  }

  /**
   * Enquiries by page, with the unknowns said out loud.
   *
   * Duda's history endpoint does not record which page a form was on; only enquiries that arrive
   * live do. Those used to be filed under "/" and the chart then credited the homepage with almost
   * everything. Now they are one honest bucket, always last, with a line saying why.
   */
  const NO_PAGE = 'Page not recorded';
  function pageBars(pages) {
    const list = (pages || []).map((p) => ({ k: p.k && p.k !== '/' && p.k !== '\u2014' ? p.k : NO_PAGE, n: p.n }));
    const known = list.filter((p) => p.k !== NO_PAGE);
    const unknown = list.filter((p) => p.k === NO_PAGE).reduce((a, p) => a + p.n, 0);
    const rows = unknown ? known.concat({ k: NO_PAGE, n: unknown }) : known;
    return hBars(rows) + (unknown ? `<div class="small faint" style="margin-top:8px">${unknown} enquir${unknown === 1 ? 'y' : 'ies'} came in through Duda's history, which does not say which page the form was on. Enquiries arriving from now on record their page.</div>` : '');
  }
  const busiestPage = (pages) => (pages || []).find((p) => p.k && p.k !== '/' && p.k !== '\u2014') || null;
  const pageLabel = (pg) => (pg && pg !== '/' ? esc(pg) : '<span class="faint">page not recorded</span>');

  // --- the team's own view of a website's form submissions ---
  async function renderLeadsTab(body, s) {
    body.innerHTML = '<div class="empty">Loading…</div>';
    let d; try { d = await api(`/api/leads?op=list&id=${encodeURIComponent(s.siteId)}&months=12`); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    state.leadSums = Object.assign(state.leadSums || {}, { [s.siteId]: d.summary || {} });
    const g = d.groups || {};
    body.innerHTML = `
      <div class="note">${d.total
        ? `<b>${d.total}</b> form submissions stored for this website over the last 12 months. ${d.summary && d.summary.d30 ? `<b>${d.summary.d30}</b> in the last 30 days.` : ''}`
        : 'No form submissions stored yet. New ones arrive on their own once Duda is connected; use <b>Import history</b> to bring in what Duda already has.'}
        ${can('leads.import') ? '<button class="btn sm" id="lbFill" style="margin-left:8px" title="Reads the history again from Duda. Duda keeps the original of every submission, so this also repairs anything stored before a reading fix — your own junk and real rulings are left alone.">Import history from Duda</button>' : ''}
        <span id="lbNote" class="small faint"></span></div>
      ${(d.leads || []).some((l) => l.broken) ? `<div class="note unk" style="margin-top:10px"><b>Some of these were stored before the app could read their shape.</b>
        <div class="small" style="margin-top:4px">What the customer actually wrote is still safe in Duda — only our copy is unreadable, and it is hidden rather than shown as nonsense.
        ${can('leads.import') ? '<b>Import history from Duda</b> reads them again and puts them right; your own junk and real rulings are left alone.' : 'Ask an admin to re-import this website’s history.'}</div></div>` : ''}
      ${d.total ? `<div class="cl-two" style="margin-top:12px">
        <div class="cl-card"><div class="cl-card-h">Each month</div>${barChart(d.series || [])}</div>
        <div class="cl-card"><div class="cl-card-h">By page</div>${pageBars(g.pages || [])}</div></div>
      <div class="cl-card" style="margin-top:12px"><div class="cl-card-h">Recent</div>
        <div class="cl-leadlist">${(d.leads || []).slice(0, 100).map((l) => `<div class="cl-lead">
          <div class="cl-l-when">${esc(dayLabel(l.at))}<div class="faint small">${pageLabel(l.pg)}</div></div>
          <div class="cl-l-who">${l.redacted ? '<span class="faint" title="Your role does not allow seeing enquirers\u2019 contact details">Contact details hidden</span>' : `<b>${esc(l.n || 'No name given')}</b><div class="small faint">${l.e ? esc(l.e) : ''}</div>`}</div>
          <div class="cl-l-what">${Object.entries(l.f || {}).slice(0, 3).map(([k, v]) => `<div><span class="faint">${esc(k)}:</span> ${esc(String(v).slice(0, 120))}</div>`).join('')}</div>
          <div class="cl-l-src">${l.src ? `<span class="pill sm">${esc(l.src)}</span>` : ''}</div></div>`).join('')}</div></div>` : ''}`;
    if ($('#lbFill')) $('#lbFill').onclick = async () => {
      const note = $('#lbNote'); note.textContent = ' importing…'; $('#lbFill').disabled = true;
      try { const r = await post('/api/leads', { op: 'backfill', id: s.siteId, months: 12 }); note.textContent = ` imported ${r.added}`; renderLeadsTab(body, s); }
      catch (e) { note.textContent = ' ' + e.message; $('#lbFill').disabled = false; }
    };
  }

  // =====================================================================
  // THE CLIENT VIEW
  //
  // A different app, not the team's with pieces hidden. It reads only /api/client, which assembles
  // its own answers — so there is no path by which an audit item, a false alarm report, a team note
  // or another company's website can reach this screen, even if a template here were wrong.
  // =====================================================================
  const CL_SECTIONS = [
    { k: 'dashboard', label: 'Dashboard', icon: '📊' },
    { k: 'leads', label: 'Form Submissions', icon: '✉️' },
    { k: 'comments', label: 'Comments', icon: '💬' },
    { k: 'access', label: 'Access website', icon: '↗' },
  ];
  const clRoute = () => {
    const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean);
    if (parts[0] !== 'my') return { site: '', section: 'dashboard' };
    return { site: parts[1] ? decodeURIComponent(parts[1]) : '', section: CL_SECTIONS.some((s) => s.k === parts[2]) ? parts[2] : 'dashboard' };
  };
  const clGo = (site, section) => { location.hash = `#/my/${encodeURIComponent(site)}/${section || 'dashboard'}`; };

  async function clLoadSites() {
    if (state.cl.sites || state.cl.loading) return;
    state.cl.loading = true;
    try { const r = await capi('/api/client?op=me'); state.cl.sites = r.sites || []; state.cl.who = r.me || {}; state.cl.error = ''; }
    catch (e) { state.cl.error = e.message; state.cl.sites = []; }
    state.cl.loading = false;
  }

  /** The whole page: our own chrome, so nothing of the team's can be on screen by accident. */
  async function renderClient() {
    document.body.classList.add('client-mode');
    await clLoadSites();
    const sites = state.cl.sites || [];
    const r = clRoute();
    const current = sites.find((s) => s.id === r.site) || sites[0];
    if (!current) {
      $('#view').innerHTML = `<div class="cl-shell"><div class="cl-main"><div class="empty">
        ${state.cl.error ? esc(state.cl.error) : 'No websites have been shared with you yet. Your account manager can add them.'}</div></div></div>`;
      return;
    }
    if (!r.site || r.site !== current.id) { clGo(current.id, r.section); return; }

    $('#view').innerHTML = `${state.viewAs ? `<div class="cl-preview">👁 <b>Viewing as the client</b> — this is exactly what they see on <b>${esc(current.name)}</b>.
        <button class="btn sm" id="clExit">Back to the team view</button></div>` : ''}
      <div class="cl-shell">
        <aside class="cl-side">
          <div class="cl-brand">${esc((state.cl.who && state.cl.who.company) || (state.cl.who && state.cl.who.name) || 'Your websites')}</div>
          <div class="cl-side-k">Websites</div>
          ${sites.map((s) => `<div class="cl-site${s.id === current.id ? ' on' : ''}">
            <button class="cl-sitebtn" data-clsite="${esc(s.id)}">${esc(s.name)}<div class="cl-dom">${esc(s.domain || '')}</div></button>
            ${s.id === current.id ? `<nav class="cl-nav">${CL_SECTIONS.map((x) => `<a href="#/my/${encodeURIComponent(s.id)}/${x.k}" class="${r.section === x.k ? 'on' : ''}"><span class="cl-ic">${x.icon}</span>${esc(x.label)}</a>`).join('')}</nav>` : ''}
          </div>`).join('')}
        </aside>
        <main class="cl-main" id="clMain"><div class="empty">Loading…</div></main>
      </div>`;
    $$('[data-clsite]').forEach((b) => (b.onclick = () => clGo(b.dataset.clsite, 'dashboard')));
    if ($('#clExit')) $('#clExit').onclick = () => { state.viewAs = ''; state.cl = { sites: null, site: null, leads: null, comments: null, loading: false, error: '', months: 12, group: 'pages', pick: {} }; document.body.classList.remove('client-mode'); location.hash = '#/site/' + encodeURIComponent(current.id); };
    clSection(current, r.section);
  }

  async function clSection(site, section) {
    const el = $('#clMain'); if (!el) return;
    if (section === 'access') return clAccess(el, site);
    if (section === 'comments') return clComments(el, site);
    if (section === 'leads' || section === 'dashboard') return clLeads(el, site, section);
  }

  function clHead(site, title, sub) {
    return `<div class="cl-head"><div><h1>${esc(title)}</h1><div class="cl-sub">${esc(sub || '')}</div></div>
      <a class="btn ghost" href="https://${esc(site.domain)}" target="_blank" rel="noopener">Open ${esc(site.domain || 'website')} ↗</a></div>`;
  }

  async function clAccess(el, site) {
    el.innerHTML = `${clHead(site, 'Access your website', 'Open the editor without a separate login.')}
      <div class="cl-card"><p>This opens <b>${esc(site.name)}</b> in the website editor, signed in as you. The link is made fresh each time you click and is only valid for a couple of minutes, so there is nothing to keep or share.</p>
      <button class="btn primary" id="clOpen">Open my website editor ↗</button>
      <div class="small muted" id="clOpenNote" style="margin-top:10px"></div></div>`;
    $('#clOpen').onclick = async () => {
      const note = $('#clOpenNote'); note.textContent = 'Preparing your link…';
      try { const r = await cpost('/api/client', { op: 'access', id: site.id }); note.textContent = ''; window.open(r.url, '_blank', 'noopener'); }
      catch (e) { note.textContent = e.message; }
    };
  }

  async function clComments(el, site) {
    el.innerHTML = `${clHead(site, 'Comments', 'Messages between you and the team about this website.')}<div class="empty">Loading…</div>`;
    let d; try { d = await capi('/api/client?op=comments&id=' + encodeURIComponent(site.id)); } catch (e) { el.innerHTML = clHead(site, 'Comments', '') + `<div class="empty">${esc(e.message)}</div>`; return; }
    const list = d.comments || [];
    el.innerHTML = `${clHead(site, 'Comments', `${list.length} message${list.length === 1 ? '' : 's'} on this website.`)}
      ${list.length ? `<div class="cl-card cl-cmts">${list.map((c) => `<div class="cl-cmt${c.mine ? ' mine' : ''}">
        <div class="cl-cmt-h"><b>${esc(c.by)}</b><span class="faint small">${esc(isoLabel(c.at))}</span></div>
        <div class="cl-cmt-b">${esc(c.text).replace(/\n/g, '<br>')}</div></div>`).join('')}</div>`
      : '<div class="cl-card"><div class="empty">No comments yet. Anything your team posts about this website will appear here.</div></div>'}`;
  }

  const isoLabel = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const dayLabel = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); };

  async function clLeads(el, site, section) {
    el.innerHTML = clHead(site, section === 'dashboard' ? 'Dashboard' : 'Form Submissions', '') + '<div class="empty">Loading…</div>';
    const pick = state.cl.pick[site.id] || {};
    const q = ['op=leads', 'id=' + encodeURIComponent(site.id), 'months=' + state.cl.months];
    ['page', 'form', 'source'].forEach((k) => { if (pick[k]) q.push(k + '=' + encodeURIComponent(pick[k])); });
    let d; try { d = await capi('/api/client?' + q.join('&')); } catch (e) { el.innerHTML = clHead(site, 'Form Submissions', '') + `<div class="empty">${esc(e.message)}</div>`; return; }
    state.cl.leads = d;
    const rows = d.leads || [];
    const sum = (n) => rows.length && n;
    const last30 = (d.series || []).slice(-1)[0] || { n: 0 };
    const prev30 = (d.series || []).slice(-2)[0] || { n: 0 };
    const delta = prev30.n ? Math.round(((last30.n - prev30.n) / prev30.n) * 100) : 0;

    const tiles = `<div class="cl-tiles">
      <div class="cl-tile"><div class="cl-t-k">Enquiries this month</div><div class="cl-t-v">${last30.n}</div>
        ${!prev30.n ? '<div class="cl-t-d faint">first month</div>'
          : delta === 0 ? '<div class="cl-t-d faint">same as last month</div>'
          : `<div class="cl-t-d ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last month</div>`}</div>
      <div class="cl-tile"><div class="cl-t-k">All enquiries</div><div class="cl-t-v">${d.total}</div><div class="cl-t-d faint">in the last ${state.cl.months} months</div></div>
      <div class="cl-tile"><div class="cl-t-k">Busiest page</div><div class="cl-t-v sm">${esc((busiestPage((d.groups || {}).pages) || {}).k || '—')}</div><div class="cl-t-d faint">${busiestPage((d.groups || {}).pages) ? busiestPage(d.groups.pages).n + ' enquiries' : 'not recorded yet'}</div></div>
      <div class="cl-tile"><div class="cl-t-k">Top source</div><div class="cl-t-v sm">${esc(((d.groups || {}).sources || [])[0] ? d.groups.sources[0].k : '—')}</div><div class="cl-t-d faint">${((d.groups || {}).sources || [])[0] ? d.groups.sources[0].n + ' enquiries' : ''}</div></div>
    </div>`;

    if (section === 'dashboard') {
      el.innerHTML = clHead(site, 'Dashboard', `Where your enquiries come from, over the last ${state.cl.months} months.`) + tiles
        + `<div class="cl-card"><div class="cl-card-h">Enquiries each month</div>${barChart(d.series || [])}</div>
           <div class="cl-two">
             <div class="cl-card"><div class="cl-card-h">By page</div>${pageBars((d.groups || {}).pages || [])}</div>
             <div class="cl-card"><div class="cl-card-h">By source</div>${hBars((d.groups || {}).sources || [])}</div>
           </div>
           <div class="cl-card"><div class="cl-card-h">When people get in touch</div>${dowChart((d.when || {}).dow || [])}</div>`;
      return;
    }

    const groups = d.groups || {};
    const chip = (k, g) => (g || []).slice(0, 8).map((x) => `<button class="pill${pick[k] === x.k ? ' on' : ''}" data-clf="${esc(k)}" data-clv="${esc(x.k)}">${esc(x.k)} <b>${x.n}</b></button>`).join('');
    el.innerHTML = clHead(site, 'Form Submissions', `${d.matched} of ${d.total} enquiries.`) + tiles
      + `<div class="cl-card">
          <div class="cl-filters"><div class="cl-f-row"><span class="cl-f-k">Page</span>${chip('page', groups.pages)}</div>
            ${(groups.forms || []).filter((f) => f.k !== '—').length ? `<div class="cl-f-row"><span class="cl-f-k">Form</span>${chip('form', groups.forms)}</div>` : ''}
            ${(groups.sources || []).filter((f) => f.k !== '—').length ? `<div class="cl-f-row"><span class="cl-f-k">Source</span>${chip('source', groups.sources)}</div>` : ''}
            ${Object.keys(pick).length ? '<button class="linkbtn" id="clClear">Clear filters</button>' : ''}</div>
        </div>
        ${rows.length ? `<div class="cl-card cl-leadlist">${rows.map((l) => `<div class="cl-lead">
            <div class="cl-l-when">${esc(dayLabel(l.at))}<div class="faint small">${pageLabel(l.pg)}</div></div>
            <div class="cl-l-who"><b>${esc(l.n || 'No name given')}</b>
              <div class="small">${l.e ? `<a href="mailto:${esc(l.e)}">${esc(l.e)}</a>` : ''}${l.e && l.p ? ' · ' : ''}${l.p ? `<a href="tel:${esc(l.p.replace(/[^\d+]/g, ''))}">${esc(l.p)}</a>` : ''}</div></div>
            <div class="cl-l-what">${Object.entries(l.f || {}).map(([k, v]) => `<div><span class="faint">${esc(k)}:</span> ${esc(v)}</div>`).join('') || '<span class="faint">—</span>'}</div>
            <div class="cl-l-src">${l.src ? `<span class="pill sm">${esc(l.src)}</span>` : ''}</div>
          </div>`).join('')}</div>`
        : `<div class="cl-card"><div class="empty">${d.total ? 'Nothing matches those filters.' : 'No enquiries recorded yet for this website.'}</div></div>`}`;
    $$('[data-clf]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.clf; const v = b.dataset.clv;
      const p2 = Object.assign({}, state.cl.pick[site.id] || {});
      if (p2[k] === v) delete p2[k]; else p2[k] = v;
      state.cl.pick[site.id] = p2; clLeads(el, site, section);
    }));
    if ($('#clClear')) $('#clClear').onclick = () => { state.cl.pick[site.id] = {}; clLeads(el, site, section); };
  }

  // --- small charts, drawn with plain elements so nothing has to be loaded ---
  function barChart(series) {
    const max = Math.max(1, ...series.map((x) => x.n));
    return `<div class="ch-bars">${series.map((x) => `<div class="ch-b" title="${esc(x.m)}: ${x.n}">
      <div class="ch-b-v" style="height:${Math.round((x.n / max) * 100)}%"><span>${x.n || ''}</span></div>
      <div class="ch-b-l">${esc(x.m.slice(5))}</div></div>`).join('')}</div>`;
  }
  function hBars(rows) {
    const max = Math.max(1, ...rows.map((x) => x.n));
    if (!rows.length) return '<div class="empty small">Nothing yet.</div>';
    return `<div class="ch-h">${rows.slice(0, 8).map((x) => `<div class="ch-h-r">
      <div class="ch-h-k" title="${esc(x.k)}">${esc(x.k)}</div>
      <div class="ch-h-t"><div class="ch-h-f" style="width:${Math.round((x.n / max) * 100)}%"></div></div>
      <div class="ch-h-n">${x.n}</div></div>`).join('')}</div>`;
  }
  function dowChart(dow) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const max = Math.max(1, ...dow);
    return `<div class="ch-bars dow">${names.map((n, i) => `<div class="ch-b" title="${n}: ${dow[i] || 0}">
      <div class="ch-b-v" style="height:${Math.round(((dow[i] || 0) / max) * 100)}%"><span>${dow[i] || ''}</span></div>
      <div class="ch-b-l">${n}</div></div>`).join('')}</div>`;
  }

  // =====================================================================
  // MEMBERS (user accounts)
  // =====================================================================
  let slackWho = null;
  /** Who closed what: assigned / completed websites and how each person closed audit items. */
  async function openStats() {
    modal(`<header><h2>Team stats</h2><button class="btn ghost" data-close>✕</button></header><div class="body"><div id="statsBody" class="empty small">Loading…</div></div><footer><button class="btn" data-close>Done</button></footer>`, { wide: true });
    let d; try { d = await api('/api/store?op=stats'); } catch (e) { const el = $('#statsBody'); if (el) el.textContent = e.message; return; }
    const el = $('#statsBody'); if (!el) return;
    const rows = (d.rows || []).sort((a, b) => (b.itemsDone + b.sitesComplete * 10) - (a.itemsDone + a.sitesComplete * 10));
    el.className = '';
    el.innerHTML = `<div class="table-wrap"><table class="grid stats-table">
      <thead><tr><th>Member</th><th title="Websites currently assigned to them">Assigned</th><th title="Of those, marked Complete">Complete now</th><th title="Times they set a website to Complete">Marked Complete</th><th>Items Done</th><th>False alarm</th><th>On hold</th><th>For clarification</th><th title="Items they reopened">Reopened</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><button type="button" class="whobtn" data-who="${esc(r.email)}"><b>${esc(r.name)}</b></button>${r.status === 'disabled' ? ' <span class="badge sev-warning">Switched off</span>' : ''}<div class="small faint">${esc(r.email)}</div></td>
        <td>${r.assigned}</td><td>${r.complete}</td><td>${r.sitesComplete}</td><td>${r.itemsDone}</td>
        <td class="${r.itemsFalse >= 30 ? 'v-still-t' : ''}">${r.itemsFalse}</td><td>${r.itemsHold}</td><td>${r.itemsClarify}</td><td>${r.itemsReopen}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Counted from the moment this was switched on, so older work isn't included. A high <b>False alarm</b> or <b>On hold</b> count is worth a look: open <b>Suggestions → False alarms</b> to read the reasons.</p>`;
    $$('[data-who]', el).forEach((b) => (b.onclick = () => openMemberActivity(b.dataset.who)));
  }


  // --- one person's own exceptions, and looking through their eyes ----------
  /**
   * What this person may do, with anything that is not simply their role picked out.
   *
   * Only the difference is stored, so the highlight is not a guess: a ticked box outside the role is
   * an addition somebody made on purpose, and an unticked box inside it is something taken away.
   */
  async function openAccess(u) {
    await loadRoles();
    const role = (state.roles || []).find((r) => r.id === u.role) || { name: u.role, perms: [] };
    const base = new Set(role.perms || []);
    const grant = new Set(u.grant || []); const revoke = new Set(u.revoke || []);
    const now2 = new Set([...base, ...grant]); revoke.forEach((k) => now2.delete(k));
    const label = (k) => { for (const g of state.permGroups || []) { const i = g.items.find((x) => x.key === k); if (i) return i.label; } return k; };
    modal(`<header><h2>${esc(u.name)}</h2><span class="spacer"></span>
        <button class="btn sm" id="acView">👁 View as ${esc(u.name)}</button><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <p class="small muted" style="margin:0 0 10px">Role: <b>${esc(role.name)}</b>. Ticking something this role doesn't have, or unticking something it does, gives this person <b>custom access</b> — it is stored as the difference, so if the role changes later they move with it and only these exceptions stay.</p>
        ${grant.size || revoke.size ? `<div class="note"><b>Custom access</b>
          ${grant.size ? `<div class="small" style="margin-top:4px"><span class="ac-add">+ extra</span> ${[...grant].map((k) => esc(label(k))).join(', ')}</div>` : ''}
          ${revoke.size ? `<div class="small" style="margin-top:4px"><span class="ac-rem">− removed</span> ${[...revoke].map((k) => esc(label(k))).join(', ')}</div>` : ''}</div>` : ''}
        <div class="rl-perms">${(state.permGroups || []).map((g) => `<div class="rl-g"><div class="rl-g-h">${esc(g.group)}</div>
          ${g.items.map((i) => {
            const on = now2.has(i.key); const diff = grant.has(i.key) ? 'add' : revoke.has(i.key) ? 'rem' : '';
            return `<label class="rl-p ${diff ? 'ac-' + diff : ''}"><input type="checkbox" data-acp="${esc(i.key)}" ${on ? 'checked' : ''}>
              <span><b>${esc(i.label)}</b>${diff ? ` <span class="ac-tag ac-${diff}">${diff === 'add' ? 'added for them' : 'removed for them'}</span>` : ''}
              ${i.desc ? `<span class="small faint"> — ${esc(i.desc)}</span>` : ''}</span></label>`;
          }).join('')}</div>`).join('')}</div>
      </div>
      <footer><button class="btn ghost" id="acReset">Put back to plain ${esc(role.name)}</button><span class="spacer"></span>
        <button class="btn" data-close>Cancel</button><button class="btn primary" id="acSave">Save</button></footer>`, { wide: true });
    $('#acView').onclick = () => { closeModal(); viewAs({ user: u.email, name: u.name }); };
    $('#acReset').onclick = () => { $$('[data-acp]').forEach((i) => { i.checked = base.has(i.dataset.acp); }); };
    $('#acSave').onclick = async () => {
      const perms = $$('[data-acp]').filter((i) => i.checked).map((i) => i.dataset.acp);
      try {
        // Pulling access out from under somebody mid-audit is the thing to avoid, so check first.
        const busy = await post('/api/users', { op: 'busy', email: u.email });
        if (busy.online && busy.where && busy.where.name
          && !confirm(`${u.name} is working on ${busy.where.name} right now${busy.where.item ? ` (item #${busy.where.item})` : ''}.\n\nTheir page will update as soon as you save, and they will be told what changed.\n\nSave anyway?`)) return;
        await post('/api/users', { op: 'access', email: u.email, perms });
        await loadUsers(); closeModal(); toast('Access updated');
      } catch (e) { toast(e.message); }
    };
  }

  /** Look at the app as a role, or as one person, sees it. The server applies it too. */
  function viewAs(what) {
    state.viewRole = what;
    try { sessionStorage.setItem('dsa-viewas', JSON.stringify(what)); } catch (e) { /* ignore */ }
    location.hash = '#/';
    bootPreview();
  }
  async function bootPreview() {
    try { const m = await api('/api/auth?op=me'); state.perms = m.perms || []; state.myRole = m.role || null; state.previewOf = m.preview || null; } catch (e) { /* ignore */ }
    await loadSites(false).catch(() => {});
    renderTop(); render();
  }
  /** Keep the band on screen whatever the page redraws. */
  function renderTopPreview() {
    const pb = $('#previewBar'); if (!pb) return;
    const want = previewBanner();
    if (pb.innerHTML !== want) { pb.innerHTML = want; const x = $('#pvExit'); if (x) x.onclick = exitViewAs; }
  }
  function exitViewAs() {
    state.viewRole = null; state.previewOf = null;
    try { sessionStorage.removeItem('dsa-viewas'); } catch (e) { /* ignore */ }
    bootPreview();
  }
  /** The band across the top while previewing, so nobody mistakes it for their own account. */
  function previewBanner() {
    if (!state.viewRole) return '';
    const p2 = state.previewOf || {};
    const who = p2.name ? `${esc(p2.name)}${p2.custom ? ' <span class="badge subtle">custom access</span>' : ''}` : esc(p2.roleName || state.viewRole.role || '');
    return `<div class="cl-preview">👁 <b>Viewing as ${who}</b> — buttons and pages you cannot see are the ones they cannot use, and the server refuses them too.
      <button class="btn sm" id="pvExit">Back to my own view</button></div>`;
  }

  // =====================================================================
  // ROLES — what each kind of teammate is allowed to do
  // =====================================================================
  /** Loaded once and kept, so the Members list can name a role without asking again. */
  async function loadRoles(force) {
    if (state.roles.length && !force) return state.roles;
    try { const r = await post('/api/users', { op: 'roles' }); state.roles = r.roles || []; state.roleCounts = r.counts || {}; state.permGroups = r.permissions || []; }
    catch (e) { state.roles = []; }
    return state.roles;
  }

  function openRoles() {
    modal(`<header><h2>Roles</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body" id="rlBody"><div class="empty">Loading…</div></div>`, { wide: true });
    const draw = () => {
      const roles = state.roles || [];
      const editable = can('roles.manage');
      $('#rlBody').innerHTML = `
        <p class="small muted" style="margin:0 0 12px">A role is a name and a list of what it allows. Rename them to match how your team actually works — <b>Member</b> can become <b>Dev</b> — and add as many as you need.
        ${editable ? '' : '<br>Your role does not allow changing these, so this is a read-only view.'}</p>
        <div class="rl-list">${roles.map((r) => {
          const n = state.roleCounts[r.id] || 0;
          return `<div class="rl-row">
            <div class="grow"><b>${esc(r.name)}</b>${r.builtin ? ' <span class="badge subtle" title="Built in: it can be renamed and (except Admin) changed, but not removed">built in</span>' : ''}
              <div class="small muted">${esc(r.desc || '')}</div>
              <div class="small faint">${r.perms.includes('*') ? 'Everything' : `${r.perms.length} of ${permCount()} permissions`} · ${n} ${n === 1 ? 'person' : 'people'}</div></div>
            ${r.id === 'admin' ? '' : `<button class="btn sm ghost" data-rlview="${esc(r.id)}" title="See the app as this role sees it">👁 View as</button>`}
            ${editable ? `<button class="btn sm" data-rledit="${esc(r.id)}">${r.locked ? 'Rename' : 'Edit'}</button>` : ''}
            ${editable && !r.builtin ? `<button class="btn sm ghost danger" data-rldel="${esc(r.id)}">Remove</button>` : ''}
          </div>`;
        }).join('')}</div>
        ${editable ? '<button class="btn primary" id="rlNew" style="margin-top:12px">+ Add a role</button>' : ''}`;
      $$('[data-rlview]').forEach((b) => (b.onclick = () => { closeModal(); viewAs({ role: b.dataset.rlview }); }));
      $$('[data-rledit]').forEach((b) => (b.onclick = () => editRole(roles.find((r) => r.id === b.dataset.rledit), draw)));
      $$('[data-rldel]').forEach((b) => (b.onclick = () => removeRole(roles.find((r) => r.id === b.dataset.rldel), draw)));
      if ($('#rlNew')) $('#rlNew').onclick = () => editRole(null, draw);
    };
    loadRoles(true).then(draw);
  }
  const permCount = () => (state.permGroups || []).reduce((a, g) => a + g.items.length, 0);

  /** Add or change one role. Admin shows its permissions, greyed, so it is obvious why. */
  function editRole(role, after) {
    const isNew = !role;
    const locked = !!(role && role.locked);
    const have = new Set((role && role.perms) || []);
    const all = locked || have.has('*');
    modal(`<header><h2>${isNew ? 'Add a role' : esc(role.name)}</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <label class="field">Name<input type="text" id="rlName" maxlength="40" value="${esc(role ? role.name : '')}" placeholder="Dev, QA, Project Manager…"></label>
        <label class="field">What this role is for <span class="faint small">(optional)</span><input type="text" id="rlDesc" maxlength="160" value="${esc((role && role.desc) || '')}"></label>
        ${locked ? '<div class="note"><b>Admin can do everything</b>, and always will — otherwise it would be possible to lock everybody out of the app. You can rename it.</div>' : ''}
        <div class="k" style="margin-top:14px">What it allows</div>
        <div class="rl-perms">${(state.permGroups || []).map((g) => `<div class="rl-g"><div class="rl-g-h">${esc(g.group)}
            ${locked ? '' : `<button class="linkbtn" data-rlall="${esc(g.group)}">all</button><button class="linkbtn" data-rlnone="${esc(g.group)}">none</button>`}</div>
          ${g.items.map((i) => `<label class="rl-p${locked ? ' off' : ''}">
            <input type="checkbox" data-perm="${esc(i.key)}" data-group="${esc(g.group)}" ${all || have.has(i.key) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span><b>${esc(i.label)}</b>${i.desc ? `<span class="small faint"> — ${esc(i.desc)}</span>` : ''}</span></label>`).join('')}
        </div>`).join('')}</div>
      </div>
      <footer><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="rlSave">Save</button></footer>`, { wide: true });
    $$('[data-rlall]').forEach((b) => (b.onclick = () => $$(`[data-group="${CSS.escape(b.dataset.rlall)}"]`).forEach((i) => { i.checked = true; })));
    $$('[data-rlnone]').forEach((b) => (b.onclick = () => $$(`[data-group="${CSS.escape(b.dataset.rlnone)}"]`).forEach((i) => { i.checked = false; })));
    $('#rlSave').onclick = async () => {
      const perms = $$('[data-perm]').filter((i) => i.checked && !i.disabled).map((i) => i.dataset.perm);
      try {
        await post('/api/users', { op: 'roleSave', id: role ? role.id : '', name: $('#rlName').value, desc: $('#rlDesc').value, perms });
        await loadRoles(true); await loadUsers(); closeModal(); toast('Saved');
        openRoles();
      } catch (e) { toast(e.message); }
    };
  }

  /**
   * Removing a role that people hold.
   *
   * Nobody is left with no role and nobody is quietly promoted, so the only way through is to say
   * what those people become instead — and the server refuses it until you have.
   */
  async function removeRole(role, after) {
    try {
      await post('/api/users', { op: 'roleDelete', id: role.id });
      await loadRoles(true); await loadUsers(); toast('Role removed'); openRoles();
    } catch (e) {
      const d = (e.data || {});
      if (!d.needsMove) return toast(e.message);
      const names = (d.names || []).join(', ') + (d.count > (d.names || []).length ? ` and ${d.count - d.names.length} more` : '');
      modal(`<header><h2>Remove “${esc(role.name)}”</h2><button class="btn ghost" data-close>✕</button></header>
        <div class="body">
          <div class="note"><b>${d.count} ${d.count === 1 ? 'person has' : 'people have'} this role.</b>
            <div class="small" style="margin-top:3px">${esc(names)}</div></div>
          <p class="small">Removing a role can't leave anybody without one, so choose what they become instead. Everything they have done is untouched — only what they are allowed to do changes.</p>
          <label class="field">They become<select id="rlMove">${(d.choices || []).map((c) => `<option value="${esc(c.id)}" ${c.id === 'member' ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        </div>
        <footer><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn danger" id="rlGo">Remove the role and move them</button></footer>`);
      $('#rlGo').onclick = async () => {
        try {
          const r = await post('/api/users', { op: 'roleDelete', id: role.id, moveTo: $('#rlMove').value });
          await loadRoles(true); await loadUsers(); closeModal();
          toast(`Role removed · ${r.moved} ${r.moved === 1 ? 'person' : 'people'} moved`);
          openRoles();
        } catch (e2) { toast(e2.message); }
      };
    }
  }

  const memFilter = { q: '', view: 'all' };
  function openMembers() {
    const isAdmin = can('members.manage');
    const draw = () => {
      const pending = state.users.filter((u) => u.status === 'pending');
      const all = state.users.filter((u) => u.status === 'active' || u.status === 'disabled');
      const q = memFilter.q.trim().toLowerCase();
      const VIEWS = {
        all: ['Everyone', () => true],
        online: ['Online now', (u) => u.status === 'active' && presenceOf(u.email).st === 'active'],
        offline: ['Offline', (u) => u.status === 'active' && presenceOf(u.email).st === 'offline'],
        off: ['Switched off', (u) => u.status === 'disabled'],
      };
      const match = (u) => (!q || (u.name + ' ' + u.email).toLowerCase().includes(q)) && VIEWS[memFilter.view][1](u);
      const list = all.filter(match).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'disabled' ? 1 : -1));
      $('#memList').innerHTML = `
        <div class="toolbar" style="margin:8px 0 10px"><input type="search" id="memQ" placeholder="Search name or email…" value="${esc(memFilter.q)}" style="flex:1;min-width:180px">
          <span class="chips">${Object.entries(VIEWS).filter(([k]) => k !== 'off' || isAdmin || all.some((u) => u.status === 'disabled')).map(([k, [label, fn]]) => `<button class="chipbtn ${memFilter.view === k ? 'active' : ''}" data-memv="${k}">${esc(label)} <span class="faint">${all.filter(fn).length}</span></button>`).join('')}</span></div>
        ${isAdmin && pending.length ? `<h3>Admin for Approval (${pending.length})</h3>` + pending.map((u) => `
          <div class="member-row">${avatar(u.email, 30)}<div class="grow"><b>${esc(u.name)}</b> <span class="badge fs-clarification">Admin for Approval</span><div class="small muted">${esc(u.email)} · signed up ${esc(fmtFull(u.createdAt))}${u.google ? ' · Google' : ''}</div></div>
          <button class="btn sm primary" data-approve="${esc(u.email)}">Approve</button><button class="btn sm danger" data-remove="${esc(u.email)}">Reject</button></div>`).join('') + '<h3 style="margin-top:14px">Members</h3>' : ''}
        ${list.length ? list.map((u) => `<div class="member-row ${u.status === 'disabled' ? 'off' : ''}"><span class="pav">${avatar(u.email, 30)}${u.status === 'disabled' ? '' : pdot(u.email)}</span>
          <div class="grow"><button type="button" class="whobtn" data-who="${esc(u.email)}"><b>${esc(u.name)}</b></button>${u.email === state.me.email ? ' <span class="badge subtle">You</span>' : ''}${u.status === 'disabled' ? ' <span class="badge sev-warning">Switched off</span>' : ''}${isAdmin && u.status !== 'disabled' ? ` <span class="badge ${u.role === 'admin' ? 'st-in-progress' : 'subtle'}">${u.superAdmin ? 'Super Admin' : esc(roleName(u.role))}</span>${u.custom ? ' <span class="badge sev-info" title="This person has access that is not simply their role">Custom access</span>' : ''}` : ''}
            <div class="small muted">${esc(u.email)} · ${state.sites.filter((s) => s.assignee === u.email).length} sites · ${esc(u.status === 'disabled' ? 'Can no longer sign in · past work kept' : presenceText(presenceOf(u.email)))}${isAdmin && slackWho && u.status !== 'disabled' ? (slackWho[u.email] ? ' · <span class="v-ok-t">Slack ✓</span>' : ' · <span class="v-still-t" title="No Slack account uses this email, so Slack messages can\'t reach them. They should register here with their Slack email.">No Slack match</span>') : ''}</div>
            ${(u.nameHistory || []).length ? `<div class="small faint">Renamed ${u.nameHistory.length}× · was ${esc([...new Set(u.nameHistory.map((h) => h.from).filter(Boolean))].slice(-3).join(', '))}</div>` : ''}</div>
          ${isAdmin && u.superAdmin ? `<span class="small faint" title="Only you can change your own account">🔒 Protected</span>` : isAdmin && u.locked ? `<select class="sm-select" disabled><option>${esc(roleName('admin'))}</option></select>` : isAdmin && u.status !== 'disabled' ? `<select data-role="${esc(u.email)}" class="sm-select">${(state.roles || []).map((r) => `<option value="${esc(r.id)}" ${u.role === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
            <button class="btn sm ghost" data-access="${esc(u.email)}" title="What this person can do, on top of their role">Access</button>${u.email !== state.me.email ? `<button class="btn sm ghost" data-reset="${esc(u.email)}" title="Create a temporary password">Reset password</button><button class="btn sm ghost" data-disable="${esc(u.email)}" title="Switch the account off: they can't sign in, but everything they did is kept">Switch off</button>` : ''}`
            : isAdmin && u.status === 'disabled' ? `<button class="btn sm" data-enable="${esc(u.email)}">Switch back on</button><button class="btn sm ghost danger" data-remove="${esc(u.email)}" title="Delete for good — their name disappears from old items">Delete</button>` : ''}</div>`).join('')
          : '<div class="empty small">Nobody matches.</div>'}`;
      const mq = $('#memQ'); mq.oninput = () => { memFilter.q = mq.value; const p = mq.selectionStart; draw(); const i2 = $('#memQ'); if (i2) { i2.focus(); i2.setSelectionRange(p, p); } };
      $$('[data-memv]', $('#memList')).forEach((b) => (b.onclick = () => { memFilter.view = b.dataset.memv; draw(); }));
      const act = (sel, fn) => $$(sel, $('#memList')).forEach((b) => (b.onclick = b.onchange = null, b.tagName === 'SELECT' ? (b.onchange = () => fn(b)) : (b.onclick = () => fn(b))));
      act('[data-approve]', async (b) => { await post('/api/users', { op: 'approve', email: b.dataset.approve }); await loadUsers(); draw(); renderTop(); toast('Approved'); });
      act('[data-remove]', async (b) => { if (!confirm('Delete this account for good? Their name will disappear from old audit items and comments. "Switch off" keeps the history.')) return; try { await post('/api/users', { op: 'remove', email: b.dataset.remove }); } catch (e) { toast(e.message); } await loadUsers(); draw(); renderTop(); });
      act('[data-disable]', async (b) => { if (!confirm('Switch this account off? They can no longer sign in, but everything they did stays on record and their name keeps showing.')) return; try { await post('/api/users', { op: 'disable', email: b.dataset.disable }); toast('Account switched off'); } catch (e) { toast(e.message); } await loadUsers(); draw(); });
      act('[data-enable]', async (b) => { try { await post('/api/users', { op: 'enable', email: b.dataset.enable }); toast('Account switched back on'); } catch (e) { toast(e.message); } await loadUsers(); draw(); });
      act('[data-access]', (b) => { const u = state.users.find((x) => x.email === b.dataset.access); if (u) openAccess(u); });
      act('[data-role]', async (b) => {
        try {
          const who = state.users.find((x) => x.email === b.dataset.role) || {};
          const busy = await post('/api/users', { op: 'busy', email: b.dataset.role }).catch(() => ({}));
          if (busy.online && busy.where && busy.where.name
            && !confirm(`${who.name || 'They'} is working on ${busy.where.name} right now${busy.where.item ? ` (item #${busy.where.item})` : ''}.\n\nTheir page will update as soon as you save, and they will be told what changed.\n\nChange their role anyway?`)) { await loadUsers(); draw(); return; }
          await post('/api/users', { op: 'role', email: b.dataset.role, role: b.value }); await loadUsers(); toast('Role updated');
        } catch (e) { toast(e.message); await loadUsers(); }
        draw();
      });
      act('[data-reset]', async (b) => {
        if (!confirm('Create a temporary password for this member? Their current password stops working.')) return;
        const r = await post('/api/users', { op: 'resetPassword', email: b.dataset.reset });
        prompt('Temporary password — send it to them privately. They can change it later with "Forgot password".', r.tempPassword);
      });
    };
    modal(`<header><h2>Team members</h2><span class="spacer"></span><button class="btn sm" id="memStats" type="button">📊 Team stats</button>${can('members.manage') ? '<button class="btn sm" id="memRoles" type="button">🧩 Roles</button>' : ''}<button class="btn ghost" data-close>✕</button></header>
      <div class="body"><p class="small muted" style="margin:0">${isAdmin ? 'Everyone who registers is listed here automatically. New accounts show as <b>Admin for Approval</b> until you approve them. <b>Switch off</b> an account when someone leaves: they can\'t sign in, but their name stays on everything they did.' : 'Everyone on the team. Click a name to see what they have been working on.'}</p><div id="memList"></div></div>
      <footer><button class="btn" data-close>Done</button></footer>`);
    draw();
    $('#memStats').onclick = () => openStats();
    if ($('#memRoles')) $('#memRoles').onclick = () => openRoles();
    loadUsers().then(draw).catch(() => {});
    if (isAdmin && state.config && state.config.slackDM && !slackWho) {
      post('/api/users', { op: 'slackWho' }).then((r) => { slackWho = r.who || {}; if ($('#memList')) draw(); }).catch(() => {});
    }
  }

  // =====================================================================
  // ADD WEBSITE + SCANNING
  // =====================================================================
  /** An editor/preview link, or just the site ID (e.g. cb89784b). IDs use the agency's white-label editor address. */
  function parseLink(input) {
    const raw = String(input || '').trim().replace(/^[,;]+|[,;]+$/g, '');
    if (/^[A-Za-z0-9_-]{6,20}$/.test(raw) && !/^https?$/i.test(raw)) {
      const host = editorHostOr();
      return { host, siteId: raw, link: `https://${host}/home/site/${raw}/home` };
    }
    try {
      const u = new URL(input.trim());
      const m = u.pathname.match(/\/(?:site|preview|editor\/direct|editor)\/([A-Za-z0-9_-]{4,})/);
      return { host: u.hostname, siteId: m ? m[1] : '', link: raw };
    } catch (e) { return { host: '', siteId: '' }; }
  }
  function openAdd(prefill) {
    modal(`<header><h2>Add website(s)</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <label class="field">Site IDs or Duda editor links, one per line
          <textarea id="addLinks" rows="5" autofocus placeholder="cb89784b&#10;2a458f73&#10;https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home">${esc(prefill || '')}</textarea></label>
        <label class="field">Assign to<select id="addWho">${userOptions(state.me.email, 'Unassigned')}</select></label>
        <p class="small muted" style="margin:0">Each site is scanned on Desktop, Tablet and Mobile and compared to its Duda Business Info. Keep this tab open while scans run (${SCAN_CONCURRENCY_SITES} at a time).<br><b>${doneNote()}</b> The person you assign it to is told as well.</p>
      </div>
      <footer><button class="btn" data-close>Cancel</button><button class="btn primary" id="addGo">Add &amp; start audit</button></footer>`);
    const addBody = $('.modal .body');
    // Warn about duplicates while typing
    const dupHint = document.createElement('div'); dupHint.id = 'addDup'; addBody.insertBefore(dupHint, addBody.children[1]);
    const findExisting = (siteId) => state.sites.find((x) => x.siteId === siteId);
    const showDups = () => {
      const ids = [...new Set($('#addLinks').value.split(/[\s,;]+/).map((l) => parseLink(l).siteId).filter(Boolean))];
      const d = ids.map(findExisting).filter(Boolean);
      // Show which business each new ID is (from the Live DR Sites list), so typos stand out
      const fresh = ids.filter((id) => !findExisting(id));
      const names = fresh.length ? `<div class="small" style="margin-bottom:6px">${fresh.map((id) => { const lx = liveOf(id); return `<div><span class="mono">${esc(id)}</span> · ${lx ? `<b>${esc(lx.name || lx.domain || 'Published site')}</b>${lx.domain && lx.name ? ` <span class="faint">${esc(lx.domain)}</span>` : ''}` : lx === false ? '<span class="faint">not in the published list (unpublished, or check the ID)</span>' : '<span class="faint">new</span>'}</div>`; }).join('')}</div>` : '';
      dupHint.innerHTML = names + (d.length ? `<div class="note unk">${d.map((x) => `<div><b>Already exists:</b> ${esc(x.businessName || x.siteId)} <span class="faint mono">${esc(x.siteId)}</span> · <a href="#/site/${esc(x.id)}" data-open-existing>Open existing audit</a></div>`).join('')}<div class="small faint">These are skipped. Use <b>Rescan</b> on the existing audit instead.</div></div>` : '');
      $$('[data-open-existing]', dupHint).forEach((a) => (a.onclick = () => closeModal()));
    };
    $('#addLinks').addEventListener('input', showDups);
    if (prefill) showDups();
    // Load the published-sites list (cached on the server) so pasted IDs show their business names
    if (!liveDR.data && !liveDR.loading && !liveDR.error) loadLive(false).then(() => { if ($('#addLinks')) showDups(); }).catch(() => {});
    $('#addGo').onclick = async () => {
      const lines = $('#addLinks').value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return toast('Paste at least one site ID or editor link');
      $('#addGo').disabled = true;
      let added = 0, bad = 0; const dups = []; const seen = new Set(); const newIds = [];
      for (const link of lines) {
        const p = parseLink(link);
        if (!p.siteId) { bad++; continue; }
        if (seen.has(p.siteId)) continue; seen.add(p.siteId);
        const ex = findExisting(p.siteId);
        if (ex) { dups.push(ex); continue; }
        try { const sum = await store({ op: 'create', siteId: p.siteId, host: p.host, editorUrl: p.link || link, assignee: $('#addWho').value }); upsertSummary(sum); newIds.push(sum.id); added++; }
        catch (e) {
          if (e.status === 409) { await loadSites().catch(() => {}); dups.push(findExisting(p.siteId) || { id: e.data && e.data.id, siteId: p.siteId }); }
          else { bad++; toast(e.message); }
        }
      }
      if (newIds.length) requestScan(newIds);
      render();
      if (!dups.length) { closeModal(); toast(`${added} website(s) submitted for audit. ${doneNote()}`); return; }
      // Keep the dialog open to show which ones already exist, with a way to open them
      $('.modal').innerHTML = `<header><h2>${added ? `${added} added · ` : ''}${dups.length} already exist${dups.length > 1 ? '' : 's'}</h2><button class="btn ghost" data-close>✕</button></header>
        <div class="body"><table class="grid"><thead><tr><th>Website</th><th>Status</th><th>Last scan</th><th></th></tr></thead><tbody>
        ${dups.map((x) => `<tr><td><b>${esc(x.businessName || x.siteId)}</b><div class="faint mono small">${esc(x.siteId)}</div></td><td>${esc(x.status || '')}</td><td class="small">${x.scan && x.scan.finishedAt ? esc(fmtDate(x.scan.finishedAt)) : '—'}</td>
          <td><a class="btn sm primary" href="#/site/${esc(x.id)}" data-open-existing>Open existing audit</a></td></tr>`).join('')}
        </tbody></table>${bad ? `<p class="small muted">${bad} line(s) weren't a site ID or a Duda editor link.</p>` : ''}</div>
        <footer><button class="btn" data-close>Close</button></footer>`;
      $$('[data-close]', $('.modal')).forEach((b) => (b.onclick = closeModal));
      $$('[data-open-existing]', $('.modal')).forEach((a) => (a.onclick = () => closeModal()));
    };
  }
  /** Asks the server to reserve the websites for this tab, then queues the ones it got. Anything someone else has queued
   *  or is scanning is skipped, so two browsers never scan the same website at the same time. */
  async function requestScan(ids) {
    ids = [...new Set(ids)].filter((id) => !state.scanning[id] && !state.queue.includes(id));
    if (!ids.length) return;
    const batch0 = ids.length > 1;
    // Show the click landing BEFORE anything is awaited: the previous "Scan complete" has to leave
    // the screen the moment the button is pressed, or the page looks like it ignored you.
    ids.forEach((id) => { state.scanning[id] = { done: 0, total: 0, message: 'Queued', queued: true, bulk: batch0 }; });
    render();
    // Asked right here rather than waiting for the next poll: this is the one moment where running
    // the old checks actually costs something, and the question is one tiny read.
    if (!state.stale) { try { await loadSites(true); } catch (e) { /* offline is not stale */ } }
    // Scanning from a tab that predates an update runs the OLD checks and hands back the old
    // answers, which is indistinguishable from "the fix didn't work". Stop before that happens.
    if (state.stale) {
      ids.forEach((id) => delete state.scanning[id]);
      render();
      modal(`<header><h2>Reload before scanning</h2><button class="btn ghost" data-close>✕</button></header>
        <div class="body"><p>The app has been updated since you opened this tab, and the scan runs <b>here, in your browser</b> — so this tab would scan with the old checks and give you the old answers back.</p>
        <p class="small muted">Reloading takes a second and loses nothing.</p></div>
        <footer><button class="btn" data-close>Not now</button><span class="spacer"></span><button class="btn primary" id="staleGo">Reload and scan</button></footer>`);
      $('#staleGo').onclick = () => { try { sessionStorage.setItem('dsa:scanAfterReload', JSON.stringify(ids)); } catch (e) { /* private window */ } location.reload(); };
      return;
    }
    const batch = batch0;
    let r;
    try { r = await store({ op: 'scanClaim', ids, cid: CID, state: 'queued' }); }
    catch (e) { ids.forEach((id) => delete state.scanning[id]); render(); toast("Couldn't start the scan: " + e.message); return; }
    Object.assign(state.claims, r.claims || {});
    (r.taken || []).forEach((t) => { delete state.scanning[t.id]; state.claims[t.id] = Object.assign({ until: srvNow() + 60000 }, t); });
    (r.ok || []).forEach((id) => enqueue(id));
    const tk = r.taken || [];
    if (tk.length === 1 && ids.length === 1) toast(`${claimText(tk[0])}. It wasn't scanned again here.`);
    else if (tk.length) toast(`${tk.length} website(s) skipped: another member already queued or is scanning them.`);
    render();
  }
  function releaseScan(ids, beacon) {
    ids = [].concat(ids).filter(Boolean); if (!ids.length) return;
    ids.forEach((id) => { if (state.claims[id] && state.claims[id].cid === CID) delete state.claims[id]; });
    const body = JSON.stringify({ op: 'scanRelease', ids, cid: CID });
    if (beacon) { try { fetch('/api/store', { method: 'POST', body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }); } catch (e) { /* ignore */ } return; }
    store({ op: 'scanRelease', ids, cid: CID }).catch(() => {});
  }
  // Queued websites keep their reservation while they wait; closing the tab gives them back right away
  setInterval(() => { if (state.queue.length) store({ op: 'scanClaim', ids: state.queue.slice(), cid: CID, state: 'queued' }).catch(() => {}); }, 5 * 60000);
  window.addEventListener('pagehide', () => { const ids = state.queue.concat(Object.keys(state.scanning).filter((id) => !state.queue.includes(id))); if (ids.length) releaseScan(ids, true); });
  function enqueue(id) {
    if (!state.queue.includes(id) && !(state.scanning[id] && !state.scanning[id].queued)) state.queue.push(id);
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
    // Take the website for this tab. If another member got to it first, skip it here.
    let got;
    try { got = await store({ op: 'scanClaim', ids: [id], cid: CID, state: 'scanning' }); } catch (e) { toast("Couldn't start the scan: " + e.message); return; }
    if (!(got.ok || []).includes(id)) {
      const t = (got.taken || [])[0] || {};
      state.claims[id] = Object.assign({ until: srvNow() + 60000 }, t);
      const nm = (state.sites.find((x) => x.id === id) || {}).businessName || 'This website';
      toast(`${nm}: ${claimText(t)}. Skipped here so it isn't scanned twice.`);
      return;
    }
    Object.assign(state.claims, got.claims || {});
    const beat = setInterval(() => store({ op: 'scanClaim', ids: [id], cid: CID, state: 'scanning' }).catch(() => {}), 60000);
    try { await scanSiteRun(id); } finally { clearInterval(beat); releaseScan([id]); }
  }
  async function scanSiteRun(id) {
    const site = await api('/api/store?op=site&id=' + encodeURIComponent(id));
    const t0 = Date.now();
    delete state.skipAI[id];
    const startedAt = new Date().toISOString();
    state.scanning[id] = { done: 0, total: 0, message: 'Reading Business Info…' };
    const st0 = await store({ op: 'scanState', id, stamp: backupStamp(), scan: { state: 'scanning', startedAt, error: '' } });
    upsertSummary(st0); render();
    if (st0 && st0.backup) toast(st0.backup.ok ? `Backed up in Duda first: ${st0.backup.name}` : `Couldn't back up in Duda: ${st0.backup.error}`);
    const log = [];
    try {
      let meta = null;
      try { meta = await api('/api/site?editor=' + encodeURIComponent(site.editorUrl)); } catch (e) { log.push('Duda API call failed: ' + e.message); }
      const host = (meta && meta.host) || site.host;
      // Websites added by ID before the agency's editor address was known were saved under Duda's address: tidy that up
      const fixHost = site.host === DUDA_HOST && editorHost() ? editorHost() : '';
      if (meta) (meta.errors || []).forEach((x) => log.push(x));
      // The client's own brief, when this website belongs to a project that has one. It goes ahead
      // of Duda's Business Info: during a build, Duda often still carries the template's details.
      const brief = await briefFor(site.siteId);
      let truth = meta || brief ? A.buildTruth({ site: (meta || {}).site, content: (meta || {}).content }, null, brief) : null;
      if (truth && truth.source === 'none') truth = null;
      if (brief) log.push('Business details taken from the client brief on the project');
      // Duda's copy is kept as it is — it is what the page shows and what gets saved. The scan is
      // judged against it minus anything the team has struck out for this website.
      const scanTruth = A.truthWithout(truth, site.allow);
      const pagesMeta = {};
      ((meta && meta.pages) || []).forEach((p) => { pagesMeta[A.normalizePath(p.path)] = p; });
      const res = await A.runScan({
        siteId: site.siteId, allow: site.allow || [], host, truth: scanTruth, pagesMeta, seedPaths: Object.keys(pagesMeta), concurrency: 4,
        fetchPage: async (path, device) => {
          const q = new URLSearchParams({ host, site: site.siteId, path, device });
          for (let attempt = 0; attempt < 3; attempt++) {
            try { const r = await api('/api/fetch?' + q); if (r.status || attempt === 2) return r; } catch (e) { if (attempt === 2) return { status: 0, html: '', error: e.message }; }
            await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
          }
        },
        checkUrls: (urls) => post('/api/check', { urls }),
        // Fingerprinting pictures: the cache is asked first, so a rescan downloads nothing.
        imageHashes: (urls) => post('/api/imghash', { urls }).then((r) => r.hashes || {}),
        saveImageHashes: (rows) => post('/api/imghash', { save: rows }),
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
      // Values approved as "correct for this website" are never flagged
      res.findings = A.filterAllowed(res.findings, site.allow);
      res.counts = { critical: 0, outdated: 0, warning: 0, info: 0 }; res.findings.forEach((f) => { res.counts[f.severity]++; });
      const profiles = await checkProfiles(res.truth);
      // Checks corrected since this website was last scanned: an item that disappears for THAT reason
      // was never really fixed, and is closed saying so rather than credited as a fix.
      // Both kinds: corrected in an update, and set to Audit Adjusted by an admin since the last scan.
      const corrected = [...A.fixedSince((site.scan && site.scan.cv) || 1)];
      const lastDone = (site.scan && site.scan.finishedAt) || '';
      Object.values(state.fixedChecks || {}).forEach((x) => { if (x && x.code && lastDone && x.at > lastDone && !corrected.includes(x.code)) corrected.push(x.code); });
      const sum = await store({ op: 'saveScan', id, corrected, bulk: !!(state.scanning[id] && state.scanning[id].bulk), result: {
        host: fixHost || host, ...(fixHost ? { editorUrl: `https://${fixHost}/home/site/${site.siteId}/home` } : {}), businessName: (truth || res.truth).businessName || site.businessName, truth: truth || res.truth, profiles, findings: res.findings, pages: res.pages, fonts: res.fonts || null, photos: res.photos || null,
        scan: { state: 'complete', cv: A.CHECKS_VERSION, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, pages: res.pages.length, externalLinks: res.externalLinks, images: res.images, counts: res.counts, log, by: state.me.email, ai: aiSummary },
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
        errors++; log.push('AI alt-text check: ' + e.message); if (e.status === 429 || e.status === 400) { pending = pending.concat(items.slice(k).map((x) => res.alts[x.i])); if (!paused) paused = { retryAt: aiResumeAt() || srvNow() + 3600000, next: '' }; break; }
      }
    }
    res.findings = A.applyAltVerdicts(res.findings, res.alts, verdicts, t);
    res.counts = { critical: 0, outdated: 0, warning: 0, info: 0 }; res.findings.forEach((f) => { res.counts[f.severity]++; });
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
    if (pausedAlready) return { blocks: 0, of: res.texts.length, truncated: false, cached: 0, flagged: 0, errors: 0, used: [], paused: pausedAlready, pending: todoTexts.filter((b) => A.textRisk(b.text, res.truth)).slice(0, 300) };
    const MAX_CHARS = 240000, BATCH_CHARS = 9000, BATCH_ITEMS = 45, MAX_PER_PAGE = 25, CUT = 900;
    // Only text that could hide a problem is sent (another business's name, a wrong place, filler).
    // Plain marketing prose is skipped, which keeps long blogs from eating the day's AI credits.
    const perPage = {};
    const worth = (b) => {
      if (!A.textRisk(b.text, res.truth)) return false;
      const pg = (b.pages || [])[0] || '/';
      perPage[pg] = (perPage[pg] || 0) + 1;
      return perPage[pg] <= MAX_PER_PAGE;
    };
    const business = aiBusiness(res);
    const blocks = []; let total = 0;
    let skipped = 0;
    res.texts.forEach((b, i) => {
      if (skip.has('text|' + ((b.pages || [])[0] || '/'))) return;
      if (!worth(b)) { skipped++; return; }
      if (total < MAX_CHARS) { blocks.push({ i, text: b.text.slice(0, CUT), location: b.location, page: b.pages[0] }); total += Math.min(CUT, b.text.length); }
    });
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
        // Don't lose the rest: keep it as "AI check pending" so it's picked up automatically later
        if (e.status === 429 || e.status === 400) { pending = pending.concat([].concat(...batches.slice(k)).map((x) => res.texts[x.i])); if (!paused) paused = { retryAt: aiResumeAt() || srvNow() + 3600000, next: '' }; break; }
      }
    }
    const before = res.findings.length;
    res.findings = A.applyTextIssues(res.findings, res.texts, issues, res.truth);
    return { blocks: sent, of: res.texts.length, skipped, truncated: sent + skipped < res.texts.length, cached, flagged: res.findings.length - before, errors, used: [...used], paused, pending };
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
    const ac = $('#aiCredits'); if (ac) ac.innerHTML = aiCreditsHtml();
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
      state.scanning[id] = Object.assign({}, state.scanning[id], { message: state.ai && state.ai.owner ? `✨ All AI models busy. ${next ? next.label + ' is' : 'One is'} free again in ${fmtLeft(end - Date.now())}` : `✨ The AI is busy. Continuing in ${fmtLeft(end - Date.now())}` });
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
    const own = !!(state.ai && state.ai.owner);
    b.innerHTML = `<span class="ai-dot ${ready ? 'good' : 'unk'}"></span> ✨ <span class="hide-sm">AI${own ? ` ${ready}/${list.length}` : ''}</span>`;
    b.title = ready ? (own ? `${ready} of ${list.length} AI models ready` : 'AI is ready') : 'AI is paused. Click to see when it comes back.';
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
    if (otherClaim(siteId)) { if (manual) toast(claimText(otherClaim(siteId)) + '. Try again when it finishes.'); return; }
    aiResumeBusy = true;
    let aiBeat = null;
    try {
      const lock = await store({ op: 'aiLock', id: siteId });
      if (!lock.ok) { if (manual) toast('Someone else is already resuming this AI check'); return; }
      const sl = await store({ op: 'scanClaim', ids: [siteId], cid: CID, state: 'scanning' });
      if (!(sl.ok || []).includes(siteId)) { await store({ op: 'aiUnlock', id: siteId }); if (manual) toast(claimText((sl.taken || [])[0] || {}) + '. Try again when it finishes.'); return; }
      aiBeat = setInterval(() => store({ op: 'scanClaim', ids: [siteId], cid: CID, state: 'scanning' }).catch(() => {}), 60000);
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
      res.findings = A.filterAllowed(res.findings, s.allow);
      const counts = { critical: 0, outdated: 0, warning: 0, info: 0 }; res.findings.forEach((f) => { counts[f.severity]++; });
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
    } finally { if (aiBeat) { clearInterval(aiBeat); releaseScan([siteId]); } aiResumeBusy = false; delete state.scanning[siteId]; if (route().name === 'sites') renderSites(); if (route().name === 'ai') renderAiPage(); }
  }
  async function aiResumeTick() {
    if (!state.me || !state.ai || !state.ai.enabled || aiResumeBusy || state.running || state.queue.length) return;
    const waiting = (state.sites || []).filter((x) => x.counts && x.counts.aiPending > 0 && !state.scanning[x.id] && !otherClaim(x.id));
    if (!waiting.length) return;
    // Only ask the server when a model should be back by now (or every 15 min), to keep database reads low
    const due = aiResumeAt();
    if (due !== 0 && due !== null && due > srvNow() && Date.now() - (state.aiCheckedAt || 0) < 15 * 60000) return;
    try { const r = await api('/api/ai'); state.aiCheckedAt = Date.now(); aiUpdate(r); } catch (e) { return; }
    if (aiResumeAt() !== 0) return;
    await aiResume(waiting[0].id, false);
  }
  setInterval(aiResumeTick, 60000);
  setTimeout(aiResumeTick, 8000);

  // ---------- Live DR Sites: every published site in the Duda account ----------
  const live = { data: null, loading: false, error: '', q: '', audit: '', dom: '', sort: 'published', page: 0, names: null, doms: null, tab: 'published', un: null, unLoading: false, unError: '', unQ: '', unOnly: 'comments', leadJob: null, leadsLoaded: false, queued: {}, q2: null, draining: false };
  const liveDR = live; // alias: some views use a local variable called `live` for scan progress
  const DOM_OK = ['ok'];
  const domProblem = (d) => d && !['ok', 'nodomain'].includes(d.status);
  const DOM_CLS = { ok: 'scan-complete', nodomain: '', redirect: 'sev-critical', hijacked: 'sev-critical', notduda: 'sev-critical', dns: 'sev-critical', http: 'sev-critical', down: 'sev-critical', ssl: 'sev-warning', timeout: 'sev-warning', error: 'sev-warning' };
  const DOM_ICON = { ok: '✓', redirect: '↪', hijacked: '⛔', notduda: '⚠', dns: '⛔', http: '⛔', down: '⛔', ssl: '🔓', timeout: '⏱', error: '⚠', nodomain: '–' };
  function domBadge(d) {
    if (!d) return '<span class="faint small">Not checked</span>';
    return `<span class="badge ${DOM_CLS[d.status] || ''}" title="${esc((d.detail || '') + (d.checkedAt ? '\nChecked ' + fmtFull(new Date(d.checkedAt).toISOString()) : ''))}">${DOM_ICON[d.status] || ''} ${esc(d.label || d.status)}</span>${domProblem(d) ? `<div class="small faint dom-detail">${esc(d.detail || '')}</div>` : ''}`;
  }
  let liveDraw = null;
  const liveRedraw = () => { if (liveDraw) return; liveDraw = setTimeout(() => { liveDraw = null; if (route().name === 'live' && document.activeElement !== $('#liveQ')) renderLive(); }, 600); };
  /** Business names aren't in Duda's site list, so fetch them in the background (20 at a time) and remember them. */
  async function fillNames() {
    if (live.names || !live.data) return;
    const todo = live.data.sites.filter((x) => !x.nameChecked).map((x) => x.id);
    if (!todo.length) return;
    live.names = { done: 0, total: todo.length };
    for (let k = 0; k < todo.length; k += 20) {
      try {
        const r = await post('/api/dudasites', { op: 'names', ids: todo.slice(k, k + 20) });
        Object.entries(r.names || {}).forEach(([id, n]) => { const x = live.data.sites.find((y) => y.id === id); if (x) { x.name = n === '-' ? '' : n; x.nameChecked = true; } });
      } catch (e) { break; }
      live.names.done = Math.min(todo.length, k + 20); liveRedraw();
    }
    live.names = null; liveRedraw();
  }
  /** Checks each live domain (10 at a time). all=true rechecks everything; otherwise only unchecked or older than 7 days. */
  async function checkDomains(all) {
    if (live.doms || !live.data) return;
    const stale = Date.now() - 7 * 86400000;
    const todo = live.data.sites.filter((x) => all || !x.dom || x.dom.checkedAt < stale).map((x) => x.id);
    if (!todo.length) return;
    live.doms = { done: 0, total: todo.length }; liveRedraw();
    for (let k = 0; k < todo.length; k += 10) {
      try {
        const r = await post('/api/dudasites', { op: 'domains', ids: todo.slice(k, k + 10) });
        Object.entries(r.domains || {}).forEach(([id, d]) => { const x = live.data.sites.find((y) => y.id === id); if (x) x.dom = d; });
      } catch (e) { break; }
      live.doms.done = Math.min(todo.length, k + 10); liveRedraw();
    }
    live.doms = null; liveRedraw();
  }
  /** The editor host used to build editor links for new audits (the most common one among existing audits). */
  /** The agency's editor address: from the app settings, learned from Duda, or the most common one among audits. */
  function editorHost() {
    if (state.config && state.config.editorHost) return state.config.editorHost;
    const count = {}; state.sites.forEach((x) => { if (x.host && x.host !== DUDA_HOST) count[x.host] = (count[x.host] || 0) + 1; });
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
  }
  /** Never blocks adding a website: falls back to Duda's own address. */
  const editorHostOr = () => editorHost() || DUDA_HOST;
  /**
   * Websites that are not published yet. Live DR Sites only lists published ones, but the draft is
   * exactly where clients leave comments — so this is the roster nobody could see before.
   */
  async function loadDrafts(refresh) {
    if (live.unLoading) return;
    live.unLoading = true; live.unError = '';
    if (route().name === 'live') renderLive();
    try { const d = await api('/api/dudasites?scope=unpublished' + (refresh ? '&refresh=1' : '')); live.un = d; }
    catch (e) { live.unError = e.message; }
    live.unLoading = false; if (route().name === 'live') renderLive();
  }
  async function loadLive(refresh) {
    live.loading = true; live.error = ''; if (route().name === 'live') renderLive();
    try {
      const [d] = await Promise.all([api('/api/dudasites' + (refresh ? '?refresh=1' : '')), loadSites().catch(() => {})]); live.data = d;
      // A pull can have just queued websites for their form history: start on them now.
      if (d && d.lq && d.lq.pending > 0) { live.qIdsLoaded = false; onQueueState(Object.assign({}, live.q2 || {}, d.lq)); }
    }
    catch (e) { live.error = e.message; }
    // The published list alone cannot tell "not launched yet" from "gone", and getting that wrong
    // puts an alarming badge on every pre-launch audit. So the draft list is read too, quietly.
    try { if (!live.un && !live.unLoading) await loadDrafts(refresh); } catch (e) { /* secondary: never fails the page */ }
    live.loading = false; if (route().name === 'live') renderLive();
    if (live.data && route().name === 'live') { live.bgStarted = true; fillNames().then(() => checkDomains(false)); }
    if (!cmt.sites && !cmt.loading) loadCommentSites(true).then(() => { if (route().name === 'live') renderLive(); }).catch(() => {});
  }
  /** Comment counts for a Duda site, from whatever the Duda comments page has already loaded. */
  const cmtFor = (id) => (cmt.sites || []).find((x) => String(x.id) === String(id));
  /**
   * "New" split by who it came from, because the two mean different things: a client comment you
   * haven't read is somebody waiting on you, and one of ours is a colleague keeping you posted.
   * The word "new" is dropped — the colour and the place already say that — so the space goes on
   * the part that is actually news. A side with nothing in it shows no chip at all.
   */
  function newChips(c) {
    if (!c) return [];
    const out = [];
    const cl = c.newClient || 0; const tm = c.newTeam || 0;
    // Older conversations have no per-comment history, so their unread count can't be split. Rather
    // than guess, the total is shown unlabelled until the next comment on that website arrives.
    if (!cl && !tm) return c.unread ? [`<span class="badge sev-warning" title="${c.unread} unread — from before comments were split by who sent them">${c.unread} new</span>`] : [];
    if (cl) out.push(`<span class="badge sev-warning" title="${cl} comment${cl === 1 ? '' : 's'} from the client that you haven't read">${cl} client</span>`);
    if (tm) out.push(`<span class="badge subtle" title="${tm} comment${tm === 1 ? '' : 's'} from the team that you haven't read">${tm} team</span>`);
    return out;
  }
  function cmtCell(id) {
    const c = cmtFor(id);
    if (!c || !c.total) return '<span class="faint small">—</span>';
    const bits = [];
    if (c.waiting) bits.push(`<span class="badge sev-critical" title="A client is waiting for an answer">${c.waiting} waiting</span>`);
    newChips(c).forEach((x) => bits.push(x));
    if (!bits.length) bits.push(c.open ? `<span class="small muted">${c.open} open</span>` : `<span class="small faint">${c.total} resolved</span>`);
    return `<a href="#/comments/${encodeURIComponent(id)}" title="Read these comments">${bits.join(' ')}</a>`;
  }
  const sameId = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  /** The existing audit for a Duda site, however it was added (Live DR Sites or a pasted editor link). */
  const auditFor = (id) => state.sites.find((s) => sameId(s.siteId, id));
  function auditCell(x) {
    const a = auditFor(x.id);
    if (!a) return '<span class="faint small">Not audited</span>';
    const running = state.scanning[a.id];
    const sc = a.scan || {};
    const c = a.counts || {};
    const open = (c.critical || 0) + (c.warning || 0);
    return `<a class="live-audit" href="#/site/${esc(a.id)}">${running ? '<span class="badge scan-scanning">Scanning…</span>'
      : sc.finishedAt ? `<span class="badge ${c.critical ? 'sev-critical' : open ? 'sev-warning' : 'scan-complete'}">${c.critical ? c.critical + ' critical' : open ? open + ' open' : '✓ Clean'}</span> <span class="small">Audited ${esc(fmtFull(sc.finishedAt))}</span>`
      : '<span class="badge">Added, not scanned</span>'}<div class="small faint">${esc(a.status || '')}${a.assignee ? ' · ' + esc(nameOf(a.assignee)) : ''}</div></a>`;
  }

  /** The tab strip shared by both rosters. */
  function liveTabs(which) {
    const n = (live.un && live.un.count) || '';
    return `<div class="tabs" style="margin-bottom:14px">
      <a href="#/live" data-ltab="published" class="${which === 'published' ? 'on' : ''}">Live DR Sites${live.data ? ` <span class="tcount">${live.data.count}</span>` : ''}</a>
      <a href="#/live/unpublished" data-ltab="unpublished" class="${which === 'unpublished' ? 'on' : ''}">Not published yet${n !== '' ? ` <span class="tcount">${n}</span>` : ''}</a>
    </div>`;
  }
  /**
   * Websites that have not gone live. Clients review and comment on the draft, so these are the ones
   * with conversations on them — and none of them appear on Live DR Sites.
   */
  function renderDrafts() {
    if (!live.un && !live.unLoading && !live.unError) loadDrafts(false);
    if (!cmt.sites && !cmt.loading) loadCommentSites(true).then(() => { if (route().name === 'live' && live.tab === 'unpublished') renderDrafts(); }).catch(() => {});
    const q = live.unQ.trim().toLowerCase();
    const audited = (id) => auditFor(id);
    // Duda's own unpublished list does not always include every draft, but a website we are
    // receiving comments for is proof it exists — so the two are merged, and anything we have
    // comments for that is not published belongs here whatever Duda's list says.
    const byId = new Map(((live.un && live.un.sites) || []).map((x) => [String(x.id), Object.assign({}, x)]));
    (cmt.sites || []).forEach((c) => {
      if (c.published) return;                       // it is live: it belongs on the other tab
      const have = byId.get(String(c.id));
      if (have) { if (!have.name && c.name) have.name = c.name; return; }
      byId.set(String(c.id), { id: c.id, name: c.name || '', defaultDomain: c.domain || '', created: c.firstSeen || '', fromComments: true });
    });
    const rows = [...byId.values()].map((x) => Object.assign({}, x, { audit: audited(x.id), cmt: cmtFor(x.id) }));
    const withCmt = rows.filter((r) => r.cmt && r.cmt.total);
    const active = rows.filter((r) => r.audit || (r.cmt && r.cmt.total));
    let list = live.unOnly === 'comments' ? withCmt : live.unOnly === 'active' ? active : live.unOnly === 'audits' ? rows.filter((r) => r.audit) : rows;
    if (q) list = list.filter((r) => [r.id, r.name, r.defaultDomain].some((v) => String(v || '').toLowerCase().includes(q)));
    list = list.slice().sort((a, b) => ((b.cmt && b.cmt.waiting) || 0) - ((a.cmt && a.cmt.waiting) || 0)
      || ((b.cmt && b.cmt.unread) || 0) - ((a.cmt && a.cmt.unread) || 0)
      || String((b.cmt && b.cmt.last) || '').localeCompare(String((a.cmt && a.cmt.last) || ''))
      || String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const PER = 100; const pages = Math.max(1, Math.ceil(list.length / PER));
    live.page = Math.min(live.page, pages - 1);
    const shown = list.slice(live.page * PER, live.page * PER + PER);

    $('#view').innerHTML = `<div class="page-head"><div><h1>Not published yet</h1>
        <div class="muted">Websites still in build. This is where clients review the draft and leave comments — none of them show on Live DR Sites.</div></div>
        <button class="btn" id="unRefresh" ${live.unLoading ? 'disabled' : ''}>${live.unLoading ? 'Pulling from Duda…' : '↻ Pull from Duda'}</button></div>
      ${liveTabs('unpublished')}
      ${live.unError ? `<div class="note bad">${esc(live.unError)}</div>` : ''}
      <div class="panel"><div class="toolbar">
        <input type="search" id="unQ" placeholder="Search by name or site ID…" value="${esc(live.unQ)}" style="flex:1;min-width:200px">
        <select id="unOnly">
          <option value="comments" ${live.unOnly === 'comments' ? 'selected' : ''}>Has comments (${withCmt.length})</option>
          <option value="active" ${live.unOnly === 'active' ? 'selected' : ''}>In Audits or has comments (${active.length})</option>
          <option value="audits" ${live.unOnly === 'audits' ? 'selected' : ''}>In Audits (${rows.filter((r) => r.audit).length})</option>
          <option value="all" ${live.unOnly === 'all' ? 'selected' : ''}>Every unpublished website (${rows.length})</option>
        </select>
        <span class="spacer"></span>
        ${live.un ? `<span class="small muted">Last pulled ${esc(ago(new Date(live.un.at).toISOString()))}</span>` : ''}
      </div>
      ${!live.un ? `<div class="empty">${live.unLoading ? 'Loading unpublished websites from Duda…' : 'No data yet.'}</div>`
        : !list.length ? `<div class="empty">${q ? 'Nothing matches that search.' : live.unOnly === 'comments' ? 'No unpublished website has comments yet.' : live.unOnly === 'active' ? 'No unpublished website is in Audits or has comments yet.' : 'Nothing here.'}</div>` : `
      <div class="table-wrap"><table class="grid"><thead><tr><th>Website</th><th>Site ID</th><th>Created</th><th>Comments</th><th>Audit</th><th></th></tr></thead><tbody>
      ${shown.map((r) => `<tr>
        <td><b>${r.name ? esc(r.name) : `<span class="muted">${esc(r.defaultDomain || r.id)}</span>`}</b>${r.defaultDomain ? `<div class="small faint">${esc(r.defaultDomain)}</div>` : ''}${r.fromComments ? '<div class="small faint" title="Duda\'s unpublished list did not include this one; we know about it because comments arrived for it">not in Duda\'s draft list</div>' : ''}</td>
        <td class="mono small">${esc(r.id)} <button class="linkbtn" data-copy="${esc(r.id)}" title="Copy site ID">Copy</button></td>
        <td class="small">${r.created ? esc(fmtFull(r.created)) : '—'}</td>
        <td style="white-space:nowrap">${cmtCell(r.id)}</td>
        <td>${auditCell(r)}</td>
        <td style="white-space:nowrap">${r.audit ? `<a class="btn sm" href="#/site/${esc(r.audit.id)}">Open audit</a>` : `<button class="btn sm primary" data-audit="${esc(r.id)}">Audit this website</button>`}
          <a class="btn sm ghost" href="https://${esc(linkHost(null))}/home/site/${esc(r.id)}/home" target="_blank" rel="noopener" title="Open in the Duda editor">Editor ↗</a></td>
      </tr>`).join('')}
      </tbody></table></div>
      ${pages > 1 ? `<div class="row-between" style="padding:10px 14px"><span class="small muted">${live.page * PER + 1}–${Math.min(list.length, live.page * PER + PER)} of ${list.length}</span><span><button class="btn sm" id="unPrev" ${live.page ? '' : 'disabled'}>← Prev</button> <button class="btn sm" id="unNext" ${live.page < pages - 1 ? '' : 'disabled'}>Next →</button></span></div>` : ''}`}
      </div>`;

    bindLiveTabs();
    const qi = $('#unQ'); if (qi) qi.oninput = (e) => { live.unQ = e.target.value; live.page = 0; const at = e.target.selectionStart; renderDrafts(); const n = $('#unQ'); if (n) { n.focus(); n.setSelectionRange(at, at); } };
    const on = $('#unOnly'); if (on) on.onchange = (e) => { live.unOnly = e.target.value; live.page = 0; renderDrafts(); };
    const rf = $('#unRefresh'); if (rf) rf.onclick = () => loadDrafts(true);
    if ($('#unPrev')) $('#unPrev').onclick = () => { live.page--; renderDrafts(); window.scrollTo(0, 0); };
    if ($('#unNext')) $('#unNext').onclick = () => { live.page++; renderDrafts(); window.scrollTo(0, 0); };
    $$('[data-copy]').forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Site ID copied.')).catch(() => {})));
    $$('[data-audit]').forEach((b) => (b.onclick = () => openAdd(b.dataset.audit)));
    // Comment counts come from the Duda comments page; load them once so the column is not empty.
    if (!cmt.sites && !cmt.loading) loadCommentSites(true).then(() => { if (route().name === 'live' && live.tab === 'unpublished') renderDrafts(); }).catch(() => {});
  }
  function bindLiveTabs() {
    $$('[data-ltab]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); live.tab = a.dataset.ltab; live.page = 0; location.hash = a.dataset.ltab === 'unpublished' ? '#/live/unpublished' : '#/live'; }));
  }

  /** A date as an ISO string, or '' — a missing or malformed one must never take a whole page down. */
  const isoOf = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString(); };

  // --- Form submissions on Live DR Sites ---------------------------------
  /**
   * Pull enquiries for a list of websites, a few at a time.
   *
   * The loop lives in the browser, like a scan queue: each request covers a handful of websites, so
   * nothing runs long enough to be cut off, a failure costs one chunk rather than the run, and
   * closing the tab simply stops it.
   */
  async function pullLeads(ids, months) {
    if (live.leadJob) return;
    live.leadJob = { done: 0, total: ids.length, added: 0, failed: 0, stop: false };
    renderLive();
    for (let i = 0; i < ids.length && !live.leadJob.stop; i += 5) {
      const chunk = ids.slice(i, i + 5);
      try {
        const r = await post('/api/leads', { op: 'fetch', ids: chunk, months });
        (r.done || []).forEach((x) => { state.leadSums[x.id] = { total: x.total, last: x.last }; live.leadJob.added += x.added; });
        live.leadJob.failed += (r.failed || []).length;
      } catch (e) {
        // Busy is not a failure. The background queue has the line for a moment; wait and ask again
        // for the same websites rather than counting them as unreadable.
        if (e.status === 503 || (e.data && e.data.busy)) {
          live.leadJob.note = e.message;
          if (route().name === 'live') renderLive();
          await new Promise((r) => setTimeout(r, Math.min(60, Number((e.data && e.data.retryAfter) || 20)) * 1000));
          live.leadJob.note = '';
          i -= 5;                         // same chunk again
          continue;
        }
        live.leadJob.failed += chunk.length;
        if (/not set up|Admins|role does not allow/i.test(e.message)) { toast(e.message); break; }
      }
      live.leadJob.done = Math.min(ids.length, i + chunk.length);
      if (route().name === 'live') renderLive();
    }
    const n = live.leadJob.added; const bad = live.leadJob.failed;
    live.leadJob = null;
    toast(`${n} new form submission${n === 1 ? '' : 's'} stored${bad ? ` · ${bad} website${bad === 1 ? '' : 's'} could not be read` : ''}`);
    if (route().name === 'live') renderLive();
  }

  /**
   * The enquiries cell.
   *
   * Three honest states, because "—" for all of them told you nothing: a count, "none yet" for a
   * website we have asked Duda about and it really has none, and "waiting" for one still in the
   * queue. Every one of them opens the profile, whether or not the website was ever audited.
   */
  function leadCell(x) {
    const s = state.leadSums[String(x.id)] || {};
    const waiting = (live.queued || {})[String(x.id)];
    if (!s.total) {
      return `<button class="linkbtn lead-cell faint small" data-goleads="${esc(x.id)}" title="${waiting ? 'Waiting to be fetched from Duda' : 'No form submissions stored for this website'}">${waiting ? 'waiting…' : 'none yet'}</button>`;
    }
    const when = s.last ? ago(s.last) : '';
    return `<button class="linkbtn lead-cell" data-goleads="${esc(x.id)}" title="Open this website’s profile and form submissions">
      <b>${s.total}</b> ${when ? `<span class="faint small">last ${esc(when)}</span>` : ''}</button>`;
  }

  /**
   * Open a website's profile.
   *
   * Every live website has one, audited or not. A website that has never been audited has no record
   * and does not need one — its profile is built from the Duda list and its own enquiries — so this
   * no longer asks anybody to create something before they can look at their own data.
   */
  async function goLeads(siteId) {
    const a = auditFor(siteId);
    location.hash = a ? `#/site/${encodeURIComponent(a.id)}/leads` : `#/dr/${encodeURIComponent(siteId)}`;
  }

  /** Kept for the one path that genuinely wants a record: adding a website from its profile. */
  async function addFromProfile(siteId) {
    const host = editorHostOr();
    try {
      const sum = await store({ op: 'create', siteId, host, editorUrl: `https://${host}/home/site/${siteId}/home`, assignee: state.me.email });
      upsertSummary(sum);
      location.hash = `#/site/${encodeURIComponent(sum.id)}/leads`;
    } catch (e) { toast(e.message); }
  }

  /**
   * A website's profile when it has never been audited.
   *
   * There is no record behind this page and there does not need to be one. Everything on it already
   * exists somewhere: the website itself in the Duda list, its enquiries under its own site id. The
   * alternative — writing a record for all 700 live websites — would put 700 rows into the one piece
   * of data every single page load reads, to show what can be assembled for nothing.
   */
  async function renderDrProfile(siteId) {
    const a = auditFor(siteId);
    if (a) { location.hash = `#/site/${encodeURIComponent(a.id)}/leads`; return; }
    if (!live.data) { $('#view').innerHTML = '<div class="empty">Loading…</div>'; await loadLive(false); }
    const x = ((live.data && live.data.sites) || []).find((y) => y.id === siteId)
      || ((live.draft && live.draft.sites) || []).find((y) => y.id === siteId) || null;
    const dom = x && (x.domain || x.defaultDomain);
    const host = editorHostOr();
    $('#view').innerHTML = `<div class="page-head"><div>
        <div class="small muted"><a href="#/live">← Live DR Sites</a></div>
        <h1>${esc((x && x.name) || siteId)}</h1>
        <div class="muted small">${dom ? `<a href="https://${esc(dom)}" target="_blank" rel="noopener">${esc(dom)} ↗</a> · ` : ''}<span class="mono">${esc(siteId)}</span>
          ${x && x.published ? ` · published ${esc(fmtFull(x.published))}` : ' · <span class="badge subtle">Not published yet</span>'}</div>
        ${(x && (x.labels || []).length) ? `<div class="small faint" style="margin-top:3px">${x.labels.map(esc).join(' · ')}</div>` : ''}</div>
      <div style="display:flex;gap:8px;align-items:flex-start">
        ${can('live.audit') ? `<button class="btn primary" id="drAudit">Audit this website</button>` : ''}
        ${host ? `<a class="btn ghost" href="https://${esc(linkHost(null))}/home/site/${esc(siteId)}/home" target="_blank" rel="noopener">Editor ↗</a>` : ''}</div></div>
      <div class="note" style="margin-bottom:12px"><b>This website has not been audited.</b>
        <div class="small" style="margin-top:3px">Its form submissions are collected and kept all the same — nothing here needs an audit first.
        ${can('live.audit') ? 'Press <b>Audit this website</b> when it should be checked.' : ''}</div></div>
      <div id="drBody"><div class="empty">Loading…</div></div>`;
    if ($('#drAudit')) {
      $('#drAudit').onclick = async () => {
        $('#drAudit').disabled = true; $('#drAudit').textContent = 'Adding…';
        try {
          const sum = await store({ op: 'create', siteId, host, editorUrl: `https://${host}/home/site/${siteId}/home`, assignee: state.me.email });
          upsertSummary(sum); requestScan([sum.id]); toast(`Submitted for audit. ${doneNote()}`);
          location.hash = `#/site/${encodeURIComponent(sum.id)}`;
        } catch (e) {
          if (e.status === 409) { await loadSites(); goLeads(siteId); }
          else { toast(e.message); $('#drAudit').disabled = false; $('#drAudit').textContent = 'Audit this website'; }
        }
      };
    }
    // The same enquiries view the audited websites get — it only ever needed a Duda site id.
    renderLeadsTab($('#drBody'), { siteId });
  }

  /**
   * "Last done: 2 hours ago, automatically."
   *
   * Under each button rather than in a corner, because the question it answers — do I need to press
   * this? — is asked while looking at the button.
   */
  function runStamp(kind) {
    const r = (live.data && live.data.runs && live.data.runs[kind]) || null;
    if (!r) return '<div class="live-stamp faint">Never run</div>';
    const who = r.manual ? (r.byName ? `by ${esc(r.byName)}` : 'manually') : 'automatically';
    return `<div class="live-stamp" title="${esc(fmtFull(isoOf(r.at)))}">${esc(ago(isoOf(r.at)))} · ${who}</div>`;
  }

  /** What the queue is doing, in one line, and only while it has something to do. */
  function queueNote() {
    const q = live.q2;
    if (!q || !q.pending) return '';
    return `<span class="small live-q"><span class="spin-dot"></span> Fetching form submissions in the background — <b>${q.pending}</b> website${q.pending === 1 ? '' : 's'} to go. You can carry on; it looks after itself.</span>`;
  }
  function renderLive() {
    const d = live.data;
    if (!d && !live.loading && !live.error) { loadLive(false); }
    else if (d && !live.bgStarted) { live.bgStarted = true; fillNames().then(() => checkDomains(false)); }
    // Every website's enquiry count arrives in one small request, not one per row.
    if (d && live.q2 && live.q2.pending > 0) loadQueueIds();
    if (d && !live.leadsLoaded) { live.leadsLoaded = true; loadLeadSums(d.sites.map((x) => x.id)).then(() => { if (route().name === 'live') renderLive(); }); }
    const all = (d && d.sites) || [];
    const q = live.q.trim().toLowerCase();
    const audited = new Set(state.sites.map((x) => String(x.siteId || '').toLowerCase()));
    const isAudited = (id) => audited.has(String(id || '').toLowerCase());
    let list = all.filter((x) => !q || [x.id, x.name, x.domain, x.defaultDomain, ...(x.labels || [])].some((v) => String(v || '').toLowerCase().includes(q)));
    if (live.audit === 'no') list = list.filter((x) => !isAudited(x.id));
    if (live.audit === 'yes') list = list.filter((x) => isAudited(x.id));
    if (live.audit === 'issues') list = list.filter((x) => { const a = auditFor(x.id); return a && a.counts && (a.counts.critical || a.counts.warning); });
    if (live.audit === 'leads') list = list.filter((x) => (state.leadSums[String(x.id)] || {}).total);
    if (live.dom === 'problem') list = list.filter((x) => domProblem(x.dom));
    if (live.dom === 'ok') list = list.filter((x) => x.dom && x.dom.status === 'ok');
    if (live.dom === 'none') list = list.filter((x) => !x.dom);
    list = list.slice().sort((a, b) => live.sort === 'domain' ? (domProblem(b.dom) ? 1 : 0) - (domProblem(a.dom) ? 1 : 0) || String(b.published).localeCompare(String(a.published)) : live.sort === 'name' ? (a.name || a.id).localeCompare(b.name || b.id) : String(b.published).localeCompare(String(a.published)));
    const PER = 100; const pages = Math.max(1, Math.ceil(list.length / PER)); live.page = Math.min(live.page, pages - 1);
    const shown = list.slice(live.page * PER, live.page * PER + PER);
    const host = editorHostOr();
    if (live.tab === 'unpublished') return renderDrafts();
    $('#view').innerHTML = `<div class="page-head"><div><h1>Live DR Sites</h1><div class="muted">Every published website in the Duda account. Pick one to audit.</div></div>
        <div class="live-acts">
          ${can('leads.import') ? `<div class="live-act"><button class="btn" id="liveLeads" ${live.leadJob || !d ? 'disabled' : ''} title="Fetch form submissions from Duda for the websites currently listed">${live.leadJob ? 'Fetching…' : '✉️ Get form submissions'}</button>${runStamp('leads')}</div>` : ''}
          ${can('live.domains') ? `<div class="live-act"><button class="btn" id="liveCheck" ${live.doms || !d ? 'disabled' : ''} title="Opens every live domain to check it still shows this website">${live.doms ? 'Checking…' : '🌐 Check domains'}</button>${runStamp('domains')}</div>` : ''}
          ${can('live.pull') ? `<div class="live-act"><button class="btn" id="liveRefresh" ${live.loading ? 'disabled' : ''}>${live.loading ? 'Pulling from Duda…' : '↻ Pull from Duda'}</button>${runStamp('pull')}</div>` : ''}
        </div></div>
      ${d ? `<div class="live-status">
        <span class="small"><b>${d.count}</b> published sites</span>
        <span class="small muted" title="${d.manual ? 'Pulled manually' : 'Pulled automatically (every 6 hours)'}">Last pulled <b>${esc(fmtFull(isoOf(d.at)))}</b> <span class="faint">(${esc(ago(isoOf(d.at)))}${d.byName ? ` · ${d.manual ? 'by ' + esc(d.byName) : 'automatically'}` : ''})</span></span>
        ${queueNote()}</div>` : ''}
      ${liveTabs('published')}
      ${live.error ? `<div class="note bad">${esc(live.error)}</div>` : ''}

      <div class="panel"><div class="toolbar">
        <input type="search" id="liveQ" placeholder="Search by name, site ID, domain or label…" value="${esc(live.q)}" style="flex:1;min-width:220px">
        <select id="liveAudit"><option value="">All sites (${all.length})</option><option value="no" ${live.audit === 'no' ? 'selected' : ''}>Not audited yet (${all.filter((x) => !isAudited(x.id)).length})</option><option value="yes" ${live.audit === 'yes' ? 'selected' : ''}>Audited (${all.filter((x) => isAudited(x.id)).length})</option><option value="issues" ${live.audit === 'issues' ? 'selected' : ''}>Audited, with open issues</option><option value="leads" ${live.audit === 'leads' ? 'selected' : ''}>With enquiries (${all.filter((x) => (state.leadSums[String(x.id)] || {}).total).length})</option></select>
        <select id="liveDom"><option value="">Any domain status</option><option value="problem" ${live.dom === 'problem' ? 'selected' : ''}>Domain problems (${all.filter((x) => domProblem(x.dom)).length})</option><option value="ok" ${live.dom === 'ok' ? 'selected' : ''}>Domain working (${all.filter((x) => x.dom && x.dom.status === 'ok').length})</option><option value="none" ${live.dom === 'none' ? 'selected' : ''}>Not checked yet (${all.filter((x) => !x.dom).length})</option></select>
        <select id="liveSort"><option value="published">Recently published first</option><option value="domain" ${live.sort === 'domain' ? 'selected' : ''}>Domain problems first</option><option value="name" ${live.sort === 'name' ? 'selected' : ''}>Name A–Z</option></select>
      </div>
      ${live.names || live.doms ? `<div class="live-progress small muted"><span class="pulse-dot"></span> ${live.names ? `Loading business names ${live.names.done}/${live.names.total}` : ''}${live.names && live.doms ? ' · ' : ''}${live.doms ? `Checking domains ${live.doms.done}/${live.doms.total}` : ''}</div>` : ''}
      ${live.leadJob ? (live.leadJob.note
        ? `<div class="live-progress small sev-warning" style="border-radius:8px"><span class="pulse-dot"></span> ${esc(live.leadJob.note)} <button class="linkbtn" id="liveLeadStop">Stop waiting</button></div>`
        : `<div class="live-progress small muted"><span class="pulse-dot"></span> Fetching form submissions ${live.leadJob.done}/${live.leadJob.total} · <b>${live.leadJob.added}</b> new${live.leadJob.failed ? ` · ${live.leadJob.failed} could not be read` : ''} <button class="linkbtn" id="liveLeadStop">Stop</button></div>`) : ''}
      ${!d ? `<div class="empty">${live.loading ? 'Loading published sites from Duda…' : 'No data yet.'}</div>` : !list.length ? '<div class="empty">No sites match.</div>' : `
      <div class="table-wrap"><table class="grid live-table"><thead><tr><th>Website</th><th>Site ID</th><th>Domain</th><th>Last published</th><th>Enquiries</th><th>Comments</th>${can('live.audit') ? '<th>Audit</th>' : ''}<th></th></tr></thead><tbody>
      ${shown.map((x) => { const a = auditFor(x.id); const dom = x.domain || x.defaultDomain; return `<tr>
        <td><b>${x.name ? esc(x.name) : x.nameChecked ? `<span class="muted">${esc(dom || x.id)}</span>` : '<span class="faint">Loading name…</span>'}</b>${dom ? `<div class="small"><a href="https://${esc(dom)}" target="_blank" rel="noopener">${esc(dom)} ↗</a></div>` : ''}${(x.labels || []).length ? `<div class="small faint">${x.labels.map(esc).join(' · ')}</div>` : ''}</td>
        <td class="mono small">${esc(x.id)} <button class="linkbtn" data-copy="${esc(x.id)}" title="Copy site ID">Copy</button></td>
        <td class="dom-cell">${domBadge(x.dom)}</td>
        <td class="small">${x.published ? esc(fmtFull(x.published)) : '—'}</td>
        <td style="white-space:nowrap">${leadCell(x)}</td>
        <td style="white-space:nowrap">${cmtCell(x.id)}</td>
        ${can('live.audit') ? `<td>${auditCell(x)}</td>` : ''}
        <td style="white-space:nowrap">${a ? `<a class="btn sm" href="#/site/${esc(a.id)}">Open audit</a>` : can('live.audit') ? `<button class="btn sm primary" data-audit="${esc(x.id)}">Audit this website</button>` : ''}
          <a class="btn sm ghost" href="#/dr/${esc(x.id)}" title="Form submissions and details for this website, audited or not">Profile</a>
          ${host ? `<a class="btn sm ghost" href="https://${esc(linkHost(null))}/home/site/${esc(x.id)}/home" target="_blank" rel="noopener" title="Open in the Duda editor">Editor ↗</a>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${pages > 1 ? `<div class="row-between" style="padding:10px 14px"><span class="small muted">${live.page * PER + 1}–${Math.min(list.length, live.page * PER + PER)} of ${list.length}</span><span><button class="btn sm" id="livePrev" ${live.page ? '' : 'disabled'}>← Prev</button> <button class="btn sm" id="liveNext" ${live.page < pages - 1 ? '' : 'disabled'}>Next →</button></span></div>` : ''}`}
      </div>`;
    const qi = $('#liveQ'); qi.oninput = (e) => { live.q = e.target.value; live.page = 0; const pos = e.target.selectionStart; renderLive(); const n = $('#liveQ'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#liveAudit').onchange = (e) => { live.audit = e.target.value; live.page = 0; renderLive(); };
    $('#liveSort').onchange = (e) => { live.sort = e.target.value; renderLive(); };
    $('#liveDom').onchange = (e) => { live.dom = e.target.value; live.page = 0; renderLive(); };
    const cd = $('#liveCheck'); if (cd) cd.onclick = () => checkDomains(true);
    if ($('#liveRefresh')) $('#liveRefresh').onclick = () => loadLive(true);
    bindLiveTabs();
    if ($('#livePrev')) $('#livePrev').onclick = () => { live.page--; renderLive(); window.scrollTo(0, 0); };
    if ($('#liveNext')) $('#liveNext').onclick = () => { live.page++; renderLive(); window.scrollTo(0, 0); };
    $$('#view [data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, 'Site ID copied')));
    $$('[data-goleads]').forEach((b) => (b.onclick = () => goLeads(b.dataset.goleads)));
    if ($('#liveLeadStop')) $('#liveLeadStop').onclick = () => { if (live.leadJob) live.leadJob.stop = true; };
    if ($('#liveLeads')) $('#liveLeads').onclick = () => {
      const ids = list.map((x) => x.id);
      const months = Number(prompt(`Fetch form submissions for the ${ids.length} website${ids.length === 1 ? '' : 's'} listed here.\n\nHow many months back? (1–24)`, '3'));
      if (!months || !Number.isFinite(months)) return;
      pullLeads(ids, Math.min(Math.max(Math.round(months), 1), 24));
    };
    $$('[data-audit]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.audit;
      const lx = live.data && live.data.sites.find((y) => y.id === id);
      if (lx && domProblem(lx.dom) && !confirm(`${lx.domain}: ${lx.dom.label}.\n\n${lx.dom.detail}\n\nThe domain should be fixed first (this needs the customer). Audit the website anyway?`)) return;
      b.disabled = true; b.textContent = 'Adding…';
      try {
        const sum = await store({ op: 'create', siteId: id, host, editorUrl: `https://${host}/home/site/${id}/home`, assignee: state.me.email });
        upsertSummary(sum); requestScan([sum.id]); toast(`Submitted for audit. ${doneNote()}`); renderLive();
      } catch (e) {
        if (e.status === 409) { await loadSites(); toast('Already in Audits'); renderLive(); } else { toast(e.message); b.disabled = false; b.textContent = 'Audit this website'; }
      }
    }));
  }

  // ---------- AI Status page ----------
  /** Today's AI credit totals (requests). */
  function aiTotals() {
    const list = (state.ai && state.ai.providers) || [];
    const now = srvNow();
    const free = list.filter((p) => p.limit > 0);
    const leftOf = (p) => { const parked = !p.ready && p.until > now && (p.state === 'limit' || p.state === 'credits' || p.state === 'error'); return parked ? 0 : p.limit ? Math.max(0, p.limit - p.used) : 0; };
    return { total: free.reduce((a, p) => a + (p.limit || 0), 0), left: free.reduce((a, p) => a + leftOf(p), 0), ready: list.filter((p) => p.ready || !(p.until > now)).length, count: list.length };
  }
  /** Small "AI credits left" line for the website page; updates live as the scan uses credits. */
  function aiCreditsHtml() {
    if (!state.ai || !state.ai.enabled) return '';
    const t = aiTotals(); const at = aiResumeAt();
    const readyTxt = state.ai && state.ai.owner ? `${t.ready} of ${t.count} AI models ready` : 'AI ready';
    if (!t.total) return `<a href="#/ai" class="ai-credits" title="Open AI Status">✨ AI: ${at === 0 ? readyTxt : at ? `paused, back in ${countdown(at)}` : 'not available'}</a>`;
    const pct = t.total ? Math.round((t.left / t.total) * 100) : 0;
    return `<a href="#/ai" class="ai-credits" title="Open AI Status">✨ AI credits left today: <b>${t.left.toLocaleString()}</b> of ${t.total.toLocaleString()}
      <span class="meter mini"><span style="width:${pct}%" class="${t.left ? '' : 'full'}"></span></span>
      <span class="faint">${at === 0 ? readyTxt : at ? `paused, back in ${countdown(at)}` : ''}</span></a>`;
  }
  function renderAiPage() {
    const list = (state.ai && state.ai.providers) || [];
    const now = srvNow();
    const free = list.filter((p) => p.limit > 0);
    const leftOf = (p) => { const parked = !p.ready && p.until > now && (p.state === 'limit' || p.state === 'credits' || p.state === 'error'); return parked ? 0 : p.limit ? Math.max(0, p.limit - p.used) : null; };
    const broken = list.length && list.every((p) => !p.ready && p.until > now && p.state === 'error');
    const total = free.reduce((a, p) => a + (p.limit || 0), 0);
    const used = free.reduce((a, p) => a + (p.limit ? Math.min(p.used, p.limit) : 0), 0);
    const left = free.reduce((a, p) => a + (leftOf(p) || 0), 0);
    const at = aiResumeAt();
    const waiting = (state.sites || []).filter((x) => x.counts && x.counts.aiPending > 0);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const own = !!(state.ai && state.ai.owner); // super admin sees every model; everyone else sees one combined AI
    $('#view').innerHTML = `<div class="page-head"><h1>✨ AI Status</h1><div class="row-between">${own ? '<button class="btn" id="aiTest" title="Sends one tiny request to each model (uses 1 credit each)">Test all models</button>' : ''}<button class="btn" id="aiRefresh">Refresh</button></div></div>
      ${!state.ai || !state.ai.enabled ? `<div class="panel panel-pad"><p>AI checks aren't set up yet.${own ? ' Add the AI keys (see the README), then redeploy.' : ' Ask the app owner to turn them on.'}</p></div>` : `
      <div class="ai-stats">
        <div class="panel panel-pad stat"><div class="k">${own ? 'Free credits per day' : 'Credits per day'}</div><div class="big">${total || '—'}</div><div class="small faint" title="A model can also stop earlier when it reaches its own daily word limit">${own ? 'requests, all free models (each model may stop earlier)' : 'AI requests'}</div></div>
        <div class="panel panel-pad stat"><div class="k">Used today</div><div class="big">${used}</div><div class="meter"><span style="width:${pct(used, total)}%"></span></div></div>
        <div class="panel panel-pad stat"><div class="k">Left today</div><div class="big ${left ? 'ok' : 'bad'}">${left}</div><div class="small faint">${pct(left, total)}% of today's credits</div></div>
        <div class="panel panel-pad stat"><div class="k">AI right now</div><div class="big ${at === 0 ? 'ok' : 'bad'}">${at === 0 ? 'Available' : broken ? 'Needs attention' : 'Paused'}</div><div class="small faint">${at === 0 ? (own ? 'At least one model can answer' : 'Ready to check your sites') : broken ? (own ? 'Every model has a setup problem (see below). Click <b>Test all models</b> to retry now.' : 'The AI is temporarily unavailable. It retries automatically.') : at ? `Back in ${countdown(at)} · ${esc(fmtWhen(at))}` : ''}</div></div>
      </div>
      <div class="ai-cards">${list.map((p, k) => {
        const parked = !p.ready && p.until > now;
        const [lbl, cls] = parked ? (AI_STATE[p.state] || [p.state, 'unk']) : ['Ready', 'good'];
        const l = leftOf(p);
        return `<div class="panel panel-pad ai-card">
          <div class="row-between"><div>${own ? `<span class="faint small">#${k + 1}</span> ` : ''}<b>${esc(p.label)}</b> ${own ? (p.free ? '<span class="badge scan-complete">Free</span>' : '<span class="badge">Paid</span>') : ''}</div><span class="small"><span class="ai-dot ${cls}"></span> ${esc(lbl)}</span></div>
          <div class="small faint" style="margin:2px 0 10px">${p.realLabel ? `<span class="mono" title="Only you (the app owner) can see this">${esc(p.realLabel)} · ${esc(p.model)}</span>${p.auto ? ` <span class="badge subtle" title="${esc(p.configured)} was retired, so the app picked the current model automatically">auto-selected</span>` : ''}` : p.combined ? 'All AI checks in this app' : 'AI model'}</div>
          <div class="row-between small"><span>Used today <b>${p.used}</b>${p.limit ? ` of ${p.limit}` : ''}</span><span>${l === null ? 'No daily cap' : `<b>${l}</b> left`}</span></div>
          ${p.limit ? `<div class="meter"><span style="width:${pct(Math.min(p.used, p.limit), p.limit)}%" class="${l === 0 ? 'full' : ''}"></span></div>` : ''}
          ${parked ? `<div class="note ${cls === 'bad' ? 'bad' : 'unk'}" style="margin-top:10px">${p.state === 'error' ? 'Retrying automatically' : 'Back'} in <b>${countdown(p.until)}</b> · ${esc(fmtWhen(p.until))}${p.note ? `<div class="small faint">${esc(p.note)}</div>` : ''}${p.state === 'error' && own ? `<div style="margin-top:6px"><button class="btn sm" data-aitest="${esc(p.id)}">Try again now</button></div>` : ''}</div>` : ''}
          <div class="small muted" style="margin-top:8px">Daily reset in ${countdown(p.resetsAt)} · ${esc(fmtWhen(p.resetsAt))}</div></div>`;
      }).join('')}</div>
      <div class="panel panel-pad" style="margin-top:16px"><h2>Waiting for AI credits (${waiting.length})</h2>
        ${waiting.length ? `<table class="grid"><thead><tr><th>Website</th><th>Items waiting</th><th>Resumes</th><th></th></tr></thead><tbody>${waiting.map((x) => `<tr>
          <td><a href="#/site/${esc(x.id)}">${esc(x.businessName || x.siteId)}</a></td>
          <td>${x.counts.aiPending} item(s) · ${x.counts.aiPendingBlocks} text blocks / images</td>
          <td>${state.scanning[x.id] ? '<span class="badge sev-info">Resuming now…</span>' : at === 0 ? 'Automatically, within a minute' : at ? `after ${esc(fmtWhen(at))} <span class="faint">(${countdown(at)})</span>` : '—'}</td>
          <td>${at === 0 && !state.scanning[x.id] ? `<button class="btn sm" data-resume="${esc(x.id)}">Run now</button>` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<p class="muted small">Nothing is waiting. When the AI runs out of credits during a scan, the unchecked pages show up here and resume automatically.</p>'}
      </div>
      <p class="small muted" style="margin-top:12px">Credits are counted as AI requests. One request checks up to about 45 text blocks or 50 image alt texts. Results are remembered for 60 days, so rescans don't use credits. Audit items marked <b>Done</b> by hand are never sent to the AI.${own ? ' <span class="faint">Models are tried top to bottom (see the README to change the order); when one runs out, the next one answers. Only you see the model details.</span>' : ''}</p>`}`;
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
    if (parts[0] === 'site' && parts[1]) return { name: 'site', id: decodeURIComponent(parts[1]), tab: parts[2] === 'comments' ? 'comments' : parts[2] === 'activity' ? 'activity' : parts[2] === 'profile' ? 'profile' : parts[2] === 'leads' ? 'leads' : 'findings', item: parts[2] === 'item' ? Number(parts[3]) : null };
    if (parts[0] === 'guide' || parts[0] === 'about') return { name: 'about' };
    if (parts[0] === 'help') return { name: 'help', section: parts[1] || '' };
    if (parts[0] === 'health') return { name: 'health' };
    if (parts[0] === 'analysis') return { name: 'analysis', tab: parts[1] || 'quiet' };
    if (parts[0] === 'activity') return { name: 'activity' };
    if (parts[0] === 'removed') return { name: 'removed' };
    if (parts[0] === 'comments') return { name: 'comments', site: parts[1] ? decodeURIComponent(parts[1]) : '' };
    if (parts[0] === 'ai') return { name: 'ai' };
    if (parts[0] === 'projects') return { name: 'projects' };
    if (parts[0] === 'project' && parts[1]) return { name: 'project', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'live') return { name: 'live', tab: parts[1] === 'unpublished' ? 'unpublished' : 'published' };
    // A website's profile addressed by its DUDA site id, so it works for one that has no record.
    if (parts[0] === 'dr' && parts[1]) return { name: 'dr', siteId: decodeURIComponent(parts[1]) };
    // …/false-alarms/<key> comes from a notification: open the queue ON that report, not at the top of a list of 40.
    if (parts[0] === 'suggestions') return { name: 'suggestions', tab: parts[1] === 'false-alarms' ? 'fa' : 'ideas', key: parts[1] === 'false-alarms' && parts[2] ? decodeURIComponent(parts.slice(2).join('/')) : '' };
    return { name: 'sites' };
  }
  let lastSiteId = null;
  let ffSite = null;      // the website the current audit-item filters belong to
  let lastView = '';
  async function render() {
    if (!state.me) return renderAuth();
    renderTopPreview();
    // A client account, or one of us previewing one, gets a different app entirely.
    if (clientMode()) return renderClient();
    document.body.classList.remove('client-mode');
    const r = route();
    markNav();
    if (r.name === 'site') {
      // A filter set on one website shouldn't hide another's items. Tracked separately from
      // lastSiteId, which is cleared by every trip back to the list.
      if (ffSite && ffSite !== r.id) clearFilters();
      ffSite = r.id;
      if (!state.current || state.current.id !== r.id || lastSiteId !== r.id) {
        $('#view').innerHTML = '<div class="empty">Loading…</div>';
        try { await loadSite(r.id); } catch (e) { state.current = null; }
        lastSiteId = r.id;
      }
      if (state.ai && state.ai.enabled) api('/api/ai').then((x) => { state.ai = Object.assign(state.ai, x); aiUpdate(x); }).catch(() => {});
      if (!liveDR.data && !liveDR.loading && !liveDR.error) loadLive(false).then(() => { if (route().name === 'site') renderSite(); });
      return renderSite();
    }
    lastSiteId = null; state.current = null; closeDrawer(true);
    const cameFrom = lastView; lastView = r.name;
    // Coming back to a list while teammates' scans were showing: check whether they finished (one tiny read)
    if ((r.name === 'sites' || r.name === 'live') && Object.keys(state.claims).length && Date.now() - (state.claimsAt || 0) > 10000) {
      state.claimsAt = Date.now();
      loadSites(true).then((ch) => { if (ch && route().name === r.name) render(); }).catch(() => {});
    }
    if (r.name === 'live' && !can('live.view')) { $('#view').innerHTML = '<div class="empty">Your role does not include Live DR Sites.</div>'; return; }
    if (r.name === 'about') return renderAbout();
    if (r.name === 'help') return renderHelp(r.section);
    if (r.name === 'health') return state.superAdmin ? renderHealth() : ($('#view').innerHTML = '<div class="empty">Not available on this account.</div>');
    if (r.name === 'analysis') return can('leads.view') ? renderAnalysis(r.tab) : ($('#view').innerHTML = '<div class="empty">Your role does not include form submissions.</div>');
    if (r.name === 'activity') return renderGlobalActivity();
    if (r.name === 'removed') return renderRemoved();
    // Arriving on the page is an explicit "show me what's there now", so never trust a list that
    // was loaded at sign-in. Re-renders (filters, searching) reuse what is already loaded.
    if (r.name === 'comments') {
      if (cameFrom !== 'comments' && cmt.sites && !cmt.loading) loadCommentSites(true);
      // Arriving from a Comments link on a site list: open that website and flash what is new on it.
      // On a cold load the list is not there yet, and it is the list that knows how many are new —
      // so wait for it rather than opening into an empty count.
      if (r.site && cmt.site !== r.site) {
        if (!cmt.sites) { loadCommentSites(true).finally(() => openCommentSite(r.site, true)); return renderComments(); }
        openCommentSite(r.site, true); return;
      }
      return renderComments();
    }
    if (r.name === 'projects') { if (!can('project.view')) { $('#view').innerHTML = '<div class="empty">Your role does not include projects.</div>'; return; } return renderProjects(); }
    if (r.name === 'project') { if (!can('project.view')) { $('#view').innerHTML = '<div class="empty">Your role does not include projects.</div>'; return; } return renderProject(r.id); }
    if (r.name === 'live') { live.tab = r.tab; return renderLive(); }
    if (r.name === 'dr') { if (!can('live.view')) { $('#view').innerHTML = '<div class="empty">Your role does not include Live DR Sites.</div>'; return; } return renderDrProfile(r.siteId); }
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
    const oc = otherClaim(s.id);
    if (oc) return `<span class="badge ${oc.state === 'queued' ? 'scan-queued' : 'scan-scanning'}" title="Only one scan of a website runs at a time">${oc.state === 'queued' ? 'Queued' : 'Scanning'}</span><div class="small faint">${esc(claimText(oc).replace(/^Queued |^Being scanned /, ''))}</div>`;
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
  /**
   * The counts on an Audits row, each one a way into exactly what it counts.
   *
   * These numbers are the reason somebody opens a website in the first place — "24 warning" is a
   * question, and the answer is a filtered list one click away. The severity counts are worked out
   * with the same rule as the default view (open and for-clarification, never closed or on hold), so
   * clicking "24 warning" lands on exactly twenty-four rows. A count that opened a list of a
   * different size would be worse than no link at all.
   */
  function issueChips(c, done, siteId) {
    c = c || {};
    const chips = [];
    const go = (kind, value, cls, label, title) => chips.push(siteId
      ? `<button class="badge ${cls} badge-btn" data-gofilter="${esc(siteId)}" data-fkind="${kind}" data-fvalue="${esc(value)}" title="${esc(title)}">${label}</button>`
      : `<span class="badge ${cls}">${label}</span>`);
    if (c.critical) go('sev', 'critical', 'sev-critical', `${c.critical} critical`, `Open this website showing only its ${c.critical} critical item${c.critical === 1 ? '' : 's'}`);
    if (c.outdated) go('sev', 'outdated', 'sev-outdated', `${c.outdated} outdated`, `Still showing something that used to be in Business Info — open the ${c.outdated} of them`);
    if (c.warning) go('sev', 'warning', 'sev-warning', `${c.warning} warning`, `Open this website showing only its ${c.warning} warning${c.warning === 1 ? '' : 's'}`);
    if (c.info) go('sev', 'info', 'sev-info', `${c.info} info`, `Open this website showing only its ${c.info} note${c.info === 1 ? '' : 's'}`);
    if (c.clarification) go('st', 'clarification', 'fs-clarification', `${c.clarification} for clarification`, `Open the ${c.clarification} item${c.clarification === 1 ? '' : 's'} waiting on an answer`);
    if (c.hold) go('st', 'hold', 'fs-hold', `${c.hold} on hold`, `Open the ${c.hold} item${c.hold === 1 ? '' : 's'} waiting on somebody outside the team`);
    // A count you can't act on is a puzzle. This one opens the discussion it is counting.
    if (c.comments) chips.push(siteId
      ? `<button class="badge subtle badge-btn" data-gocmt="${esc(siteId)}" title="Open the discussion on this website — ${c.comments} comment${c.comments === 1 ? '' : 's'}, including any left on individual audit items">💬 ${c.comments}</button>`
      : `<span class="badge subtle">💬 ${c.comments}</span>`);
    if (!chips.length && done) chips.push('<span class="badge scan-complete">No open issues</span>');
    return `<span class="chips">${chips.join('')}</span>`;
  }
  /** Is this audited site still published in Duda? (null = unknown, list not loaded yet) */
  /**
   * Where a website stands in Duda: published, not published yet, or not there at all.
   *
   * The published list is only the PUBLISHED sites, so "not in it" used to be read as "gone" — and
   * every website audited BEFORE launch, which is most of them, was labelled as no longer live. The
   * unpublished list is the other half of the answer and the app already fetches it, so both are
   * asked before anything is called missing.
   *
   * Returns 'live' | 'draft' | 'gone' | '' (not known yet).
   */
  function dudaState(siteId) {
    const id = String(siteId).toLowerCase();
    if (!liveDR.data) return '';
    if (liveDR.data.sites.some((y) => String(y.id).toLowerCase() === id)) return 'live';
    if (!liveDR.un) return '';                       // the draft list hasn't been read yet — say nothing
    if ((liveDR.un.sites || []).some((y) => String(y.id).toLowerCase() === id)) return 'draft';
    return 'gone';
  }
  function liveOf(siteId) {
    if (!liveDR.data) return null;
    return liveDR.data.sites.find((y) => String(y.id).toLowerCase() === String(siteId).toLowerCase()) || false;
  }
  function renderSites() {
    if (!liveDR.data && !liveDR.loading && !liveDR.error) loadLive(false).then(() => { if (route().name === 'sites') renderSites(); });
    const f = state.filters;
    const list = state.sites.filter((s) => (!f.status || s.status === f.status) && (!f.assignee || (f.assignee === '_none' ? !s.assignee : f.assignee === '_mine' ? s.assignee === state.me.email : s.assignee === f.assignee)) &&
      (!f.q || (s.businessName + ' ' + s.siteId + ' ' + s.editorUrl + ' ' + (s.addedByName || '')).toLowerCase().includes(f.q.toLowerCase())) &&
      (!f.live || (f.live === 'gone' || f.live === 'draft' ? dudaState(s.siteId) === f.live : f.live === 'domain' ? (liveOf(s.siteId) && domProblem(liveOf(s.siteId).dom)) : true)) &&
      (!f.oldChecks || newChecksFor(s).length) &&
      (!f.clar || ((s.counts || {}).clarification || 0) > 0))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const tot = { crit: 0, clar: 0, complete: 0, scanned: 0, oldChecks: 0 };
    state.sites.forEach((s) => { const c = s.counts || {}; tot.crit += c.critical || 0; tot.clar += c.clarification || 0; if (s.status === 'Complete') tot.complete++; if (s.scan && s.scan.state === 'complete') tot.scanned++; if (newChecksFor(s).length) tot.oldChecks++; });
    $('#view').innerHTML = staleBanner() + `
      <div class="page-head"><div><h1>Audits</h1><div class="muted">${state.sitesScoped
        ? 'The websites you have worked on. One stays here after it moves on to somebody else, so you can always find what you did.'
        : `Audit Duda sites against their Business Info on every device. ${can('live.view') ? '<a href="#/live">Browse Live DR Sites</a> to add more, or see' : 'See'} what was <a href="#/removed">removed from Audits</a>.`}</div></div></div>
      <div class="stats">
        <div class="panel stat"><div class="n">${state.sites.length}</div><div class="l">Audits</div></div>
        <div class="panel stat"><div class="n">${tot.scanned}</div><div class="l">Scan complete</div></div>
        <div class="panel stat"><div class="n" style="color:var(--crit)">${tot.crit}</div><div class="l">Open critical issues</div></div>
        <button class="panel stat ${f.clar ? 'on' : ''}" id="statClar" ${tot.clar ? '' : 'disabled'} title="${tot.clar ? 'Show only the websites with a question waiting for an answer' : 'Nothing is waiting on an answer'}"><div class="n" style="color:var(--query)">${tot.clar}</div><div class="l">For clarification</div></button>
        <div class="panel stat"><div class="n" style="color:var(--ok)">${tot.complete}</div><div class="l">Marked Complete</div></div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <input type="search" id="fq" placeholder="Search business name, site ID or who added it…" value="${esc(f.q)}">
          <select id="fstatus"><option value="">All statuses</option>${SITE_STATUSES.map((s) => `<option ${s === f.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <select id="fwho"><option value="">Everyone</option><option value="_mine" ${f.assignee === '_mine' ? 'selected' : ''}>Assigned to me</option><option value="_none" ${f.assignee === '_none' ? 'selected' : ''}>Unassigned</option>${activeUsers().map((u) => `<option value="${esc(u.email)}" ${u.email === f.assignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
          ${liveDR.data ? `<select id="flive"><option value="">Live or not</option><option value="draft" ${f.live === 'draft' ? 'selected' : ''}>Not published yet (${state.sites.filter((x) => dudaState(x.siteId) === 'draft').length})</option><option value="gone" ${f.live === 'gone' ? 'selected' : ''}>Not found in Duda (${state.sites.filter((x) => dudaState(x.siteId) === 'gone').length})</option><option value="domain" ${f.live === 'domain' ? 'selected' : ''}>Domain problems (${state.sites.filter((x) => liveOf(x.siteId) && domProblem(liveOf(x.siteId).dom)).length})</option></select>` : ''}
          ${tot.oldChecks ? `<button class="btn sm ${f.oldChecks ? 'primary' : ''}" id="foldck" title="These were scanned before the newest checks existed. Their items are unchanged — a rescan is what adds the new ones.">✨ Scanned before the newest checks (${tot.oldChecks})</button>` : ''}
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
                ${(() => {
                  const st = dudaState(s.siteId);
                  if (st === 'draft') return `<div><span class="badge subtle" title="This website is in Duda but hasn't been published yet — normal for an audit done before launch. Live site checks need it published first.">Not published yet</span></div>`;
                  if (st === 'gone') return `<div><span class="badge sev-warning" title="Duda lists this website neither as published nor as a draft, so it looks deleted or moved to another account. The audit is kept.">Not found in Duda</span></div>`;
                  const lx = liveOf(s.siteId);
                  return lx && domProblem(lx.dom) ? `<div><span class="badge sev-critical" title="${esc(lx.dom.detail || '')}">🌐 ${esc(lx.dom.label)}</span></div>` : '';
                })()}
                ${(s.counts || {}).clarification ? `<div><span class="badge fs-clarification" title="Someone asked a question and is waiting for an answer">❓ ${s.counts.clarification} waiting on an answer</span></div>` : ''}
                <div class="small faint">Added by ${esc(s.addedByName || nameOf(s.addedBy, '—'))}${s.createdAt ? ' · ' + esc(fmtDate(s.createdAt)) : ''}</div></td>
              <td data-stop><span class="member-select">${avatar(s.assignee)}<select data-assign="${esc(s.id)}">${userOptions(s.assignee)}</select></span></td>
              <td data-stop><select class="pill st-${slug(s.status)}" data-status="${esc(s.id)}">${SITE_STATUSES.map((x) => `<option ${x === s.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
                ${s.completedAt ? `<div class="small faint" title="Marked Complete ${esc(fmtFull(s.completedAt))}">by ${esc(nameOf(s.completedBy, s.completedByName))}${s.scan && s.scan.finishedAt && new Date(s.scan.finishedAt) > new Date(s.completedAt) ? ' · rescanned since' : ''}</div>` : ''}</td>
              <td>${scanBadge(s)}${fixedCodes(s).size
                ? `<div style="margin-top:4px"><span class="badge ck-fixed" title="A check that produced items on this website has since been corrected. Those items may not be real — open the website and rescan to replace them.">⚠ A check was corrected — rescan</span></div>`
                : newChecksFor(s).length ? `<div style="margin-top:4px"><span class="badge ck-new" title="New audit checks were added after this scan. The items here are unchanged — rescan to add what the new checks find.">✨ New checks available</span></div>` : ''}</td>
              <td>${issueChips(c, s.scan && s.scan.state === 'complete', s.id)}</td>
              <td style="min-width:110px"><div class="small">${c.closed || 0}/${c.total || 0}</div><div class="progress"><i style="width:${pct}%;background:var(--ok)"></i></div></td>
              <td data-stop style="white-space:nowrap"><button class="btn sm" data-rescan="${esc(s.id)}" ${state.scanning[s.id] || otherClaim(s.id) ? `disabled title="${otherClaim(s.id) ? esc(claimText(otherClaim(s.id))) : 'Scanning in this tab'}"` : ''}>Rescan</button>
                ${can('site.remove') || s.addedBy === state.me.email ? `<button class="btn sm ghost danger" data-delete="${esc(s.id)}" title="Remove this audit from the list (the website itself is untouched)">✕</button>` : ''}</td>
            </tr>`;
          }).join('')}</tbody></table></div>` : `<div class="empty">${state.sites.length ? `<div><b>No websites match these filters.</b></div><div class="small muted" style="margin:6px 0 10px">${state.sites.length} website${state.sites.length === 1 ? '' : 's'} on the list.</div><button class="btn sm primary" id="sfClear">Clear filters</button>` : 'No websites yet. Click <b>+ Add website</b> and paste a Duda editor link.'}</div>`}
      </div>`;
    const v = $('#view');
    $('#fq').oninput = (e) => { f.q = e.target.value; const p = e.target.selectionStart; renderSites(); const i = $('#fq'); i.focus(); i.setSelectionRange(p, p); };
    $('#fstatus').onchange = (e) => { f.status = e.target.value; renderSites(); };
    $('#fwho').onchange = (e) => { f.assignee = e.target.value; renderSites(); };
    if ($('#flive')) $('#flive').onchange = (e) => { f.live = e.target.value; renderSites(); };
    if ($('#foldck')) $('#foldck').onclick = () => { f.oldChecks = !f.oldChecks; renderSites(); };
    if ($('#statClar')) $('#statClar').onclick = () => { f.clar = !f.clar; renderSites(); };
    if ($('#sfClear')) $('#sfClear').onclick = () => { Object.assign(f, { q: '', status: '', assignee: '', live: '', oldChecks: false, clar: false }); renderSites(); };
    $('#rescanAll').onclick = () => {
      const todo = list.filter((s) => !state.scanning[s.id] && !otherClaim(s.id)), busy = list.length - todo.length;
      if (!todo.length) { toast('Every website shown is already queued or scanning.'); return; }
      if (confirm(`Rescan ${todo.length} website(s)?${busy ? `\n\n${busy} already queued or scanning will be skipped.` : ''}`)) requestScan(todo.map((s) => s.id));
    };
    // The comment count opens the discussion it counts, with item comments included — otherwise a
    // count of 3 can lead to a page showing none of them.
    $$('[data-gocmt]', v).forEach((btn) => btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      state.commentScope = 'all';
      hintNext('#cmtScope');
      location.hash = '#/site/' + btn.dataset.gocmt + '/comments';
    }));
    // Severity and status counts: open the website already showing what the number counted.
    $$('[data-gofilter]', v).forEach((btn) => btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const kind = btn.dataset.fkind; const value = btn.dataset.fvalue;
      Object.assign(state.ff, FF_DEFAULTS);
      if (kind === 'sev') { state.ff.sev = value; hintNext('#ffSev'); } else { state.ff.st = value; hintNext('#ffst'); }
      ffSite = btn.dataset.gofilter;
      location.hash = '#/site/' + btn.dataset.gofilter;
    }));
    $$('[data-open]', v).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('[data-stop]') && !e.target.closest('[data-gocmt]') && !e.target.closest('[data-gofilter]')) location.hash = '#/site/' + tr.dataset.open; }));
    $$('[data-assign]', v).forEach((sel) => (sel.onchange = async () => { const site = state.sites.find((x) => x.id === sel.dataset.assign); await changeSite(site, { assignee: sel.value }, () => renderSites()); }));
    $$('[data-status]', v).forEach((sel) => (sel.onchange = async () => { const site = state.sites.find((x) => x.id === sel.dataset.status); await changeSite(site, { status: sel.value }, () => renderSites()); }));
    $$('[data-rescan]', v).forEach((b) => (b.onclick = () => requestScan([b.dataset.rescan])));
    $$('[data-delete]', v).forEach((b) => (b.onclick = () => removeAudit(state.sites.find((s) => s.id === b.dataset.delete), () => renderSites())));
  }

  // =====================================================================
  // RICH TEXT (mentions, #IDs, links)
  // =====================================================================
  function formatText(text, site) {
    let h = esc(text || '');
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    // @[Name|email] (new) or @[Name] (older comments). The email makes it clear who was meant, even after a rename.
    h = h.replace(/@\[([^\]\n|]{1,60})(?:\|([^\]\n]{3,80}))?\]/g, (m, n, mail) => {
      const email = (mail || '').toLowerCase();
      if (email === GROUP_ADMINS) {
        const who = activeUsers().filter((x) => x.role === 'admin').map((x) => x.name).join(', ');
        return `<button type="button" class="mention known group" title="${esc('Everyone who can answer: ' + (who || 'the admins'))}">@${esc(GROUP_ADMINS_LABEL)}</button>`;
      }
      const u = email ? user(email) : null;
      const shown = u ? u.name : n;
      const who = u ? `${u.name} · ${u.email}${u.status === 'disabled' ? ' · account switched off' : ''}${u.name !== n ? ` (was "${n}" when written)` : ''}` : email ? `${n} · ${email}` : `${n} — written before names were linked, hover the member list to check`;
      return `<button type="button" class="mention${email ? ' known' : ''}" ${email ? `data-who="${esc(email)}"` : ''} title="${esc(who)}">@${esc(shown)}</button>`;
    });
    h = h.replace(/(^|[\s(])#(\d{1,5})\b/g, (m, pre, n) => {
      const f = site && (site.findings || []).find((x) => x.num === Number(n));
      return f ? `${pre}<a class="item-ref" href="#/site/${esc(site.id)}/item/${n}" title="${esc(f.message)}">#${n}</a>` : m;
    });
    // The app writes a few comments itself — a false alarm reason, an admin's verdict — and they
    // lead with a bold label so they read as a record rather than as somebody talking.
    h = h.replace(/\*\*([^*\n]{1,120})\*\*/g, '<b>$1</b>');
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
        <div class="c-head"><button type="button" class="whobtn" data-who="${esc(c.by)}" title="${esc(c.by)}${c.byName && c.byName !== nameOf(c.by) ? ` · signed "${c.byName}" at the time` : ''}"><b>${esc(nameOf(c.by, c.byName))}</b></button><span class="faint small" title="${esc(fmtFull(c.createdAt))}">${esc(fmtFull(c.createdAt))}</span>
          ${opts.showTarget && f ? `<a class="item-ref small" href="#/site/${esc(site.id)}/item/${f.num}">on #${f.num}</a>` : ''}</div>
        ${c.replyTo ? `<a class="quote" href="#" data-jump="${esc(c.replyTo.id)}"><span class="q-by">↩ ${esc(c.replyTo.byName)}</span>${esc(String(c.replyTo.excerpt || '').replace(/@\[([^\]]+)\]/g, '@$1'))}</a>` : ''}
        ${c.text ? `<div class="c-body">${formatText(c.text, site)}</div>` : ''}
        ${c.images && c.images.length ? `<div class="c-imgs">${c.images.map((u) => `<button class="c-img" data-img="${esc(u)}"><img src="${esc(u)}" alt="Attached screenshot" loading="lazy"></button>`).join('')}</div>` : ''}
        <div class="c-actions"><button class="linkbtn" data-reply="${esc(c.id)}">Reply</button>
          ${!opts.noDelete && (c.by === state.me.email || can('comment.delete')) ? `<button class="linkbtn danger" data-delc="${esc(c.id)}">Delete</button>` : ''}</div>
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
      <div class="composer-foot"><label class="btn sm ghost attach" title="Attach image">📎 Image<input type="file" accept="image/*" multiple hidden></label><button type="button" class="btn sm ghost c-anno" title="Paste a screenshot and mark it up with boxes, circles and arrows">✏️ Screenshot</button>
        <span class="small faint">Cmd/Ctrl+Enter to send</span><span class="spacer"></span><button class="btn sm primary" type="button">${esc(submitLabel || 'Comment')}</button></div></div>`;
    const ta = $('textarea', host), sug = $('.suggest', host), prev = $('.c-previews', host), bar = $('.reply-bar', host), btn = $('.composer-foot .btn.primary', host), file = $('input[type=file]', host);
    const images = []; let uploading = 0; let replyTo = null; let sel = 0; let items = [];
    const refresh = () => {
      prev.innerHTML = images.map((im, i) => `<div class="pv">${im.url ? `<img src="${esc(im.url)}" alt="" data-anno="${i}" title="Click to mark it up">` : '<div class="pv-load">Uploading…</div>'}<button type="button" data-rm="${i}" title="Remove">✕</button></div>`).join('');
      $$('[data-rm]', prev).forEach((b) => (b.onclick = () => { images.splice(Number(b.dataset.rm), 1); refresh(); }));
      // A picture already attached can be marked up in place: the marked-up copy replaces it.
      $$('[data-anno]', prev).forEach((im) => (im.onclick = () => { const i = Number(im.dataset.anno); openAnnotator({ src: images[i].url, doneLabel: 'Replace picture', onDone: (bl) => { images.splice(i, 1); addFile(new File([bl], 'annotated.png', { type: 'image/png' })); } }); }));
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
    $('.c-anno', host).onclick = () => openAnnotator({ doneLabel: 'Attach', onDone: (bl) => addFile(new File([bl], 'annotated.png', { type: 'image/png' })) });
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
        const admins = activeUsers().filter((u) => u.role === 'admin');
        const group = !q || 'admins'.startsWith(q) ? [{ insert: `@[${GROUP_ADMINS_LABEL}|${GROUP_ADMINS}]`,
          html: `<span class="sg-group">@</span><span><b>${GROUP_ADMINS_LABEL}</b></span><span class="faint small">tags all ${admins.length} admin${admins.length === 1 ? '' : 's'} — bell, desktop and Slack</span>` }] : [];
        items = group.concat(activeUsers().filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q)).slice(0, 6)
          .map((u) => ({ insert: `@[${u.name}|${u.email}]`, html: `${avatar(u.email, 22)}<span>${esc(u.name)}</span><span class="faint small">${esc(u.email)}</span>` })));
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
      (text.match(/@\[([^\]\n]{1,140})\]/g) || []).forEach((tok) => {
        const body = tok.slice(2, -1); const bar = body.indexOf('|');
        const n = (bar < 0 ? body : body.slice(0, bar)).toLowerCase(); const mail = bar < 0 ? '' : body.slice(bar + 1).toLowerCase();
        // The group token goes through as-is; the server decides who the admins are today.
        if (mail === GROUP_ADMINS) { if (!mentions.includes(GROUP_ADMINS)) mentions.push(GROUP_ADMINS); return; }
        (mail ? activeUsers().filter((u) => u.email === mail) : activeUsers().filter((u) => u.name.toLowerCase() === n)).forEach((u) => { if (!mentions.includes(u.email)) mentions.push(u.email); });
      });
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
   * resized to at most 1440px wide (and ~3 megapixels for tall full-page screenshots), then saved as WebP
   * (JPEG where WebP isn't supported), stepping the quality down until it's under ~250 KB.
   * Small PNG screenshots stay PNG when that is smaller, so text stays crisp.
   */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const scale = Math.min(1, 1440 / w, Math.sqrt(3200000 / (w * h)));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, w, h);
        const bytes = (d) => Math.round((d.length - d.indexOf(',') - 1) * 0.75);
        const webpOk = cv.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
        const type = webpOk ? 'image/webp' : 'image/jpeg';
        const TARGET = 250 * 1024; // screenshots are the biggest thing in the database, so keep them small
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
  // Each member picks where editor/preview links open (Your account): the white-label address or my.duda.co.
  // The audit itself is the same either way; only the links change.
  function linkHost(site) {
    if (state.me && state.me.editorEnv === 'duda') return DUDA_HOST;
    if (site && site.host && site.host !== DUDA_HOST) return site.host;
    return editorHost() || (site && site.host) || DUDA_HOST;
  }
  const previewUrl = (site, path, device) => `https://${linkHost(site)}/site/${site.siteId}${path === '/' ? '' : path}?preview=true&insitepreview=true&dm_device=${device || 'desktop'}`;
  // ---------- Open an item in the Duda preview or editor ----------
  /** The Duda editor page for a path: /home/site/<id>/<page>, same editor host as the saved editor link. */
  function editorUrl(site, path) {
    const origin = 'https://' + linkHost(site);
    const page = !path || path === '/' ? 'home' : String(path).replace(/^\/+/, '').replace(/\/+$/, '');
    return `${origin}/home/site/${site.siteId}/${page}`;
  }
  /** Text the browser can jump to and highlight by itself (Chrome/Edge/Safari "text fragments"). */
  function fragmentText(f) {
    if (!f.snippet || /^<(img|meta|iframe)\b/i.test(f.snippet)) return '';
    let t = f.snippet.replace(/^<a [^>]*>/i, '').replace(/<\/a>$/i, '').split('…')[0].replace(/\s+/g, ' ').trim();
    if (t.length < 4) return '';
    const words = t.split(' ');
    if (words.length > 8) t = words.slice(0, 8).join(' ');
    return t;
  }
  function previewAtItem(site, f) {
    const dev = (f.visibleOn && f.visibleOn[0]) || (f.devices && f.devices[0]) || 'desktop';
    const txt = fragmentText(f);
    return previewUrl(site, f.path, dev) + '#dsa=' + encodeURIComponent(f.selector || '') + (txt ? ':~:text=' + encodeURIComponent(txt).replace(/-/g, '%2D') : '');
  }
  // One-time bookmark that outlines an element on the preview or in the editor (both are other websites, so the app can't reach in)
  const HIGHLIGHT_BM = `javascript:(async()=>{let s=decodeURIComponent((location.hash.match(/dsa=([^&:]+)/)||[])[1]||'');if(!s){try{s=(await navigator.clipboard.readText()).trim()}catch(e){}}if(!s||s.length>400||/\\s{2}|\\n/.test(s))s=prompt('Paste the CSS selector to highlight:',s||'');if(!s)return;const D=[document];const walk=d=>d.querySelectorAll('iframe').forEach(f=>{try{const c=f.contentDocument;if(c){D.push(c);walk(c)}}catch(e){}});walk(document);let el=null;for(const d of D){try{el=d.querySelector(s)}catch(e){alert('That is not a valid CSS selector.');return}if(el)break}if(!el){alert('Not found on this view. Switch to the device this item is on (Desktop, Tablet or Mobile), or open the side panel, then click the bookmark again.');return}el.scrollIntoView({block:'center',behavior:'smooth'});const o=el.style.outline,oo=el.style.outlineOffset;el.style.outline='4px solid %23e11d48';el.style.outlineOffset='3px';let n=0;const t=setInterval(()=>{el.style.outline=(n++%252?'4px solid %23e11d48':'4px solid %23fbbf24');if(n>7){clearInterval(t);el.style.outline='4px solid %23e11d48'}},350);setTimeout(()=>{el.style.outline=o;el.style.outlineOffset=oo},15000);const r=el.getBoundingClientRect();if(!r.width&&!r.height)alert('Found it, but it is hidden on this view (e.g. inside the side panel or a closed section). Open it, then click the bookmark again.')})()`;
  function openHighlighterHelp() {
    modal(`<header><h2>One-click highlighter</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <p>The preview and the Duda editor are separate websites, so the app can open them at the right page but can't outline the element for you. This bookmark does that part.</p>
        <p><b>1.</b> Show your bookmarks bar (<b>Cmd+Shift+B</b> on Mac, <b>Ctrl+Shift+B</b> on Windows).<br>
        <b>2.</b> Drag this button onto the bookmarks bar: <a class="btn primary bm-drag" href="${esc(HIGHLIGHT_BM)}" onclick="return false" title="Drag me to your bookmarks bar">⌖ DSA Highlight</a></p>
        <p><b>Show on preview:</b> the page opens and scrolls to the text when it can. Click <b>⌖ DSA Highlight</b> to outline the exact element (it reads the selector from the address).</p>
        <p><b>Show in editor:</b> the selector is copied for you and the editor opens on that page. When the editor has loaded, click <b>⌖ DSA Highlight</b>. It reads the copied selector (allow clipboard access the first time), or you can paste it in.</p>
        <p class="small muted">If it says "hidden on this view", switch the editor or preview to the item's device (Desktop, Tablet or Mobile) or open the side panel, then click it again.</p>
      </div>
      <footer><button class="btn" data-close>Done</button></footer>`);
  }
  function hlHintOnce(msg) {
    let n = 0; try { n = Number(localStorage.getItem('dsaHlHint') || 0); localStorage.setItem('dsaHlHint', String(n + 1)); } catch (e) { /* ignore */ }
    toast(n < 3 ? msg + ' (Set up ⌖ DSA Highlight once: click "?" next to the links.)' : msg);
  }
  function openItemPreview(site, f) {
    window.open(previewAtItem(site, f), '_blank', 'noopener');
    hlHintOnce('Preview opened. Click ⌖ DSA Highlight to outline the element.');
  }
  function openItemEditor(site, f) {
    const dev = (f.visibleOn && f.visibleOn[0]) || (f.devices && f.devices[0]) || 'desktop';
    try { navigator.clipboard.writeText(f.selector || ''); } catch (e) { /* ignore */ }
    window.open(editorUrl(site, f.path), '_blank', 'noopener');
    hlHintOnce(`Selector copied, editor opening on ${f.path}. Switch to ${A.DEVICE_LABEL[dev]} if needed, then click ⌖ DSA Highlight.`);
  }
  const selLinks = (f) => `<button class="linkbtn" data-prevat="${esc(f.id)}" title="Open the ${esc(A.DEVICE_LABEL[(f.visibleOn && f.visibleOn[0]) || 'desktop'])} preview at this page">▶ Show on preview</button><button class="linkbtn" data-editat="${esc(f.id)}" title="Open this page in the Duda editor (selector copied)">✎ Show in editor</button><button class="linkbtn faint" data-hlhelp title="How to outline the element on the preview or in the editor">?</button>`;
  function bindSelLinks(root, site, list) {
    const find = (id) => (list || site.findings || []).find((x) => x.id === id);
    $$('[data-prevat]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const f = find(b.dataset.prevat); if (f) openItemPreview(site, f); }));
    $$('[data-editat]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const f = find(b.dataset.editat); if (f) openItemEditor(site, f); }));
    $$('[data-hlhelp]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openHighlighterHelp(); }));
  }
  const statusSelect = (f, attr) => `<select class="pill fs-${f.status}" ${attr}="${esc(f.id)}">${FSTATUS.map((s) => `<option value="${s.v}" ${s.v === f.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>`;

  /** `skip` leaves one filter out, so the severity chips can count what clicking them would give. */
  function filteredFindings(s, skip) {
    const ff = skip ? Object.assign({}, state.ff, { [skip]: skip === 'st' ? 'active' : skip === 'cmt' ? false : '' }) : state.ff;
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
      if (ff.cmt && !f.comments) return false;
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
        <div><div class="small"><a href="#/">← All audits</a></div>
          <h1>${esc(s.businessName || s.siteId)}</h1>
          <div class="muted small"><span class="mono">${esc(s.siteId)}</span> · <span id="sitePub">${sitePubHtml(s)}</span></div>
          <div class="small faint">Added by ${esc(s.addedByName || nameOf(s.addedBy, '—'))}${s.createdAt ? ' · ' + esc(fmtFull(s.createdAt)) : ''}</div>
          ${s.completedAt ? `<div class="small"><span class="badge scan-complete">✓ Marked Complete</span> by <button type="button" class="whobtn" data-who="${esc(s.completedBy || '')}"><b>${esc(nameOf(s.completedBy, s.completedByName))}</b></button> · ${esc(fmtFull(s.completedAt))}${sc.finishedAt && new Date(sc.finishedAt) > new Date(s.completedAt) ? ` <span class="v-still-t">· rescanned since (${esc(fmtFull(sc.finishedAt))})</span>` : ''}</div>` : ''}
          <div class="last-scan">${sc.finishedAt ? `🕑 Last scan: <b>${esc(fmtFull(sc.finishedAt))}</b>${sc.by || sc.startedBy ? ' by ' + esc(nameOf(sc.by || sc.startedBy)) : ''}${sc.state === 'failed' ? ' <span class="badge scan-failed">last attempt failed</span>' : ''}` : '🕑 Not scanned yet'}${live ? ' <span class="badge scan-scanning">Scanning now</span>' : ''}</div>${backupLine(s)}<div id="roomBar">${roomBarHtml()}</div></div>
        <div class="head-actions">
          <span class="member-select">${avatar(s.assignee)}<select id="sAssign">${userOptions(s.assignee)}</select></span>
          <select class="pill st-${slug(s.status)}" id="sStatus">${SITE_STATUSES.map((x) => `<option ${x === s.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <a class="btn" href="${esc(editorUrl(s, '/'))}" target="_blank" rel="noopener">Open editor ↗</a>
          <span id="liveBtn">${liveBtnHtml(s)}</span>
          <a class="btn" href="https://${esc(linkHost(s))}/preview/${esc(s.siteId)}" target="_blank" rel="noopener" title="The editor's current version, including changes that aren't published yet">Draft preview ↗</a>
          <button class="btn" id="sSum" ${findings.length ? '' : 'disabled'} title="What was checked, fixed and left — ready to paste in the group chat">📋 Summary</button>
          <button class="btn" id="sCsv" ${findings.length ? '' : 'disabled'}>Export CSV</button>
          ${otherClaim(s.id) && !live ? `<button class="btn primary" id="sRescan" disabled title="Only one scan of a website runs at a time">${esc(claimText(otherClaim(s.id)))}</button>` : `<button class="btn primary" id="sRescan" ${live ? 'disabled' : ''}>${live ? (live.queued ? 'Queued…' : 'Scanning…') : 'Rescan'}</button>`}
        </div>
      </div>
      <div class="tabs">
        <a href="#/site/${esc(s.id)}/profile" class="${r.tab === 'profile' ? 'on' : ''}">Profile</a>
        <a href="#/site/${esc(s.id)}" class="${r.tab === 'findings' ? 'on' : ''}">Audit items <span class="tcount">${findings.length}</span></a>
        <a href="#/site/${esc(s.id)}/leads" class="${r.tab === 'leads' ? 'on' : ''}">Form submissions${leadCount(s.siteId) ? ` <span class="tcount">${leadCount(s.siteId)}</span>` : ''}</a>
        <a href="#/site/${esc(s.id)}/comments" class="${r.tab === 'comments' ? 'on' : ''}">Comments <span class="tcount">${generalComments}</span></a>
        <a href="#/site/${esc(s.id)}/activity" class="${r.tab === 'activity' ? 'on' : ''}">Activity log</a>
      </div>
      <div id="tabBody"></div>`;
    $('#sAssign').onchange = async (e) => { await changeSite(s, { assignee: e.target.value }); await loadSite(s.id); renderSite(); };
    $('#sStatus').onchange = async (e) => { await changeSite(s, { status: e.target.value }); await loadSite(s.id); renderSite(); };
    $('#sRescan').onclick = () => requestScan([s.id]);
    loadPubInfo(s);
    $('#sCsv').onclick = () => exportCsv(s);
    $('#sSum').onclick = () => openSummary(s);
    if ($('#sBackup')) $('#sBackup').onclick = async (e) => {
      const btn = e.target; btn.disabled = true; btn.textContent = 'Backing up…';
      try { const r = await store({ op: 'backup', id: s.id, stamp: backupStamp() }); toast('Backed up in Duda: ' + r.name); await loadSite(s.id); renderSite(); }
      catch (err) { toast(err.message); await loadSite(s.id); renderSite(); }
    };
    const body = $('#tabBody');
    state.renderedTab = r.tab;
    if (r.tab === 'comments') renderCommentsTab(body, s);
    else if (r.tab === 'activity') renderActivityTab(body, s);
    else if (r.tab === 'profile') renderProfileTab(body, s, { cnt, generalComments });
    else if (r.tab === 'leads') renderLeadsTab(body, s);
    else renderFindingsTab(body, s, { cnt, sc, live });
    window.scrollTo(0, scrollY);
    if (r.item) openDrawer(r.item); else closeDrawer(true);
  }

  // =====================================================================
  // VERIFY ON LIVE SITE: are the items marked Done really fixed on the PUBLISHED website?
  // =====================================================================
  const vKey = (f) => [f.code, f.path, f.selector].join('|'); // looser than the item ID: live links differ slightly from preview links
  const CLOSED = (f) => f.status === 'done' || f.status === 'false';
  const lastDoneAt = (s) => (s.findings || []).filter((f) => f.status === 'done' && f.statusAt).map((f) => f.statusAt).sort().pop() || '';
  async function verifyLive(s) {
    if (state.verifying) return toast('A live check is already running');
    if (!(s.findings || []).some((f) => f.status === 'done')) return toast('No items are marked Done yet. Fix items, mark them Done, publish in Duda, then verify.');
    let info;
    try { info = await api('/api/site?light=1&editor=' + encodeURIComponent(s.editorUrl)); } catch (e) { return toast("Couldn't reach Duda: " + e.message); }
    pubInfo[s.id] = { at: Date.now(), d: info };
    if (!info.domain || !/PUBLISHED/i.test(info.publishStatus || '') || /NOT_PUBLISHED|UNPUBLISHED/i.test(info.publishStatus || '')) return toast('This site is not published yet, so there is no live site to check.');
    const done = lastDoneAt(s);
    if (info.publishedAt && done && new Date(info.publishedAt) < new Date(done)) {
      const n = (s.findings || []).filter((f) => f.status === 'done' && f.statusAt && new Date(f.statusAt) > new Date(info.publishedAt)).length;
      if (!confirm(`Last published: ${fmtFull(info.publishedAt)}.\n\n${n} item(s) were marked Done after that, so those fixes are probably not live yet. Publish the site in Duda first.\n\nCheck the live site anyway?`)) return;
    }
    const got = await store({ op: 'scanClaim', ids: [s.id], cid: CID, state: 'scanning' }).catch(() => ({ ok: [] }));
    if (!(got.ok || []).includes(s.id)) return toast(claimText((got.taken || [])[0] || {}) + '. Try again when it finishes.');
    const beat = setInterval(() => store({ op: 'scanClaim', ids: [s.id], cid: CID, state: 'scanning' }).catch(() => {}), 60000);
    state.verifying = s.id;
    state.scanning[s.id] = { done: 0, total: 0, message: `Checking the live site ${info.domain}…` }; renderSite();
    const log = [];
    try {
      // Page SEO settings (noindex etc.) come from Duda, like a normal scan
      const pagesMeta = {};
      try { const meta = await api('/api/site?editor=' + encodeURIComponent(s.editorUrl)); (meta.pages || []).forEach((p) => { pagesMeta[A.normalizePath(p.path)] = p; }); } catch (e) { log.push('Duda pages list unavailable: ' + e.message); }
      const res = await A.runScan({
        siteId: s.siteId, host: info.domain, truth: A.truthWithout(s.truth, s.allow), allow: s.allow || [], pagesMeta, seedPaths: (s.pages || []).filter((p) => !p.notFound).map((p) => p.path), concurrency: 4, maxPages: Math.max(10, (s.pages || []).length + 5),
        fetchPage: async (path, device) => {
          const q = new URLSearchParams({ live: '1', domain: info.domain, site: s.siteId, path, device });
          for (let attempt = 0; attempt < 3; attempt++) {
            try { const r = await api('/api/fetch?' + q); if (r.status || attempt === 2) return r; } catch (e) { if (attempt === 2) return { status: 0, html: '', error: e.message }; }
            await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
          }
        },
        checkUrls: (urls) => post('/api/check', { urls }),
        // Fingerprinting pictures: the cache is asked first, so a rescan downloads nothing.
        imageHashes: (urls) => post('/api/imghash', { urls }).then((r) => r.hashes || {}),
        saveImageHashes: (rows) => post('/api/imghash', { save: rows }),
        onProgress: (p) => { state.scanning[s.id] = Object.assign({}, p, { message: 'Live site · ' + p.message }); renderProgress(s.id); },
      });
      res.aiSkip = new Set();
      // Same AI checks as a scan (answers are cached, so unchanged text costs nothing)
      const aiAlt = await aiAltCheck(res, s.id, log);
      const aiText = await aiTextCheck(res, s.id, log, aiAlt && aiAlt.paused);
      const aiGap = !!((aiAlt && aiAlt.pending && aiAlt.pending.length) || (aiText && aiText.pending && aiText.pending.length));
      const liveKeys = new Set(res.findings.map(vKey));
      const results = {};
      (s.findings || []).forEach((f) => {
        // False alarms were never real problems, so they stay on the live site by design: skip them
        if (/^AI_PENDING/.test(f.code) || f.status === 'false') return;
        const isAI = !!f.ai;
        const present = liveKeys.has(vKey(f));
        // Only items marked Done are verified. Open items aren't judged: the live site can differ from the preview
        if (f.status === 'done') results[f.id] = present ? 'still' : (isAI && aiGap ? 'unknown' : 'ok');
      });
      const sum = await store({ op: 'saveVerify', id: s.id, verify: { domain: info.domain, publishedAt: info.publishedAt, pages: res.pages.length, results } });
      upsertSummary(sum);
      const v = Object.values(results);
      toast(`Live check done: ${v.filter((x) => x === 'ok').length} confirmed fixed${v.includes('still') ? `, ${v.filter((x) => x === 'still').length} still on the live site` : ''}`);
    } catch (e) { console.error(e); toast('Live check failed: ' + (e.message || e)); }
    finally { clearInterval(beat); releaseScan([s.id]); state.verifying = null; delete state.scanning[s.id]; if (state.current && state.current.id === s.id) { await loadSite(s.id); renderSite(); } }
  }
  // =====================================================================
  // RECHECK SELECTED ITEMS: rescan only the pages behind a few audit items, and judge only those items.
  // =====================================================================
  // Checks that compare the whole website (duplicate titles across pages, the font system, repeated
  // photos, the favicon, a name found on one page and searched for on every other) cannot be judged
  // from a few pages: they would vanish simply because the rest was not read. Those need a full Rescan.
  const RECHECK_SITE_WIDE = /^(META_TITLE_DUP|META_DESC_DUP|TEXT_OTHER_BUSINESS|FONT_[A-Z_]+|IMAGE_DUPLICATE|FAVICON_MISSING|HOMESCREEN_ICON_MISSING|MAILTO_SHARE_NO_TO|LINK_BROKEN_INTERNAL|PAGE_FETCH_ERROR)$/;
  const RECHECK_MAX_PAGES = 12;
  // Rows ticked in the audit items table, for acting on several at once.
  const pick = { site: '', ids: new Set() };
  function recheckWhyNot(f) {
    if (f.gone) return 'already closed by a rescan';
    if (f.manual) return 'written by hand, so no scan can see it';
    if (/^AI_PENDING/.test(f.code)) return 'waiting for the AI — it resumes on its own';
    if (f.status === 'false') return 'marked False alarm';
    if (RECHECK_SITE_WIDE.test(f.code)) return 'compares the whole website — use Rescan';
    return '';
  }
  const canRecheck = (f) => !recheckWhyNot(f);
  const recheckPages = (f) => (f.pages && f.pages.length ? f.pages : [f.path || '/']).map((p) => A.normalizePath(p));
  const looseKey = (f) => [f.code, f.found || '', f.message, (f.pages && f.pages.length > 1) ? '*' : (f.path || '/')].join('|');

  async function recheckItems(s, ids) {
    if (!can('item.status')) return toast('Your role does not allow changing audit item statuses.');
    if (state.scanning[s.id] || state.verifying) return toast('This website is already being scanned. Try again when it finishes.');
    const picked = (s.findings || []).filter((f) => ids.includes(f.id));
    const items = picked.filter(canRecheck);
    const skipped = picked.filter((f) => !canRecheck(f));
    if (!items.length) {
      return toast(skipped.length === 1 ? `#${skipped[0].num} can't be rechecked on its own: ${recheckWhyNot(skipped[0])}.` : `None of these can be rechecked on their own (${[...new Set(skipped.map(recheckWhyNot))].join('; ')}).`);
    }
    const paths = [...new Set(items.flatMap(recheckPages))];
    if (paths.length > RECHECK_MAX_PAGES && !confirm(`These items are on ${paths.length} pages. A full Rescan may be just as quick.\n\nRecheck them anyway?`)) return;
    const got = await store({ op: 'scanClaim', ids: [s.id], cid: CID, state: 'scanning' }).catch(() => ({ ok: [] }));
    if (!(got.ok || []).includes(s.id)) return toast(claimText((got.taken || [])[0] || {}) + '. Try again when it finishes.');
    const beat = setInterval(() => store({ op: 'scanClaim', ids: [s.id], cid: CID, state: 'scanning' }).catch(() => {}), 60000);
    const label = items.length === 1 ? `#${items[0].num}` : `${items.length} items`;
    state.scanning[s.id] = { done: 0, total: 0, message: `Rechecking ${label} on ${paths.length} page${paths.length === 1 ? '' : 's'}…` };
    renderSite();
    const log = [];
    try {
      // SEO settings (noindex) come from Duda, as in a normal scan. Without them a noindex item would
      // look fixed only because the setting wasn't read, so those are left unjudged instead.
      const pagesMeta = {}; let metaOk = true;
      try { const meta = await api('/api/site?editor=' + encodeURIComponent(s.editorUrl)); (meta.pages || []).forEach((p) => { pagesMeta[A.normalizePath(p.path)] = p; }); }
      catch (e) { metaOk = false; }
      const host = s.host;
      const needLinks = items.some((f) => /^(LINK_|IMAGE_BROKEN)/.test(f.code));
      const needAI = items.some((f) => /^AI_/.test(f.code) || f.ai);
      const res = await A.runScan({
        siteId: s.siteId, allow: s.allow || [], host, truth: A.truthWithout(s.truth, s.allow), pagesMeta,
        // Only these pages (plus the home page, which every scan reads first): the page cap stops the crawl there.
        seedPaths: paths, maxPages: paths.length + (paths.includes('/') ? 0 : 1), concurrency: 4,
        fetchPage: async (path, device) => {
          const q = new URLSearchParams({ host, site: s.siteId, path, device });
          for (let attempt = 0; attempt < 3; attempt++) {
            try { const r = await api('/api/fetch?' + q); if (r.status || attempt === 2) return r; } catch (e) { if (attempt === 2) return { status: 0, html: '', error: e.message }; }
            await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
          }
        },
        // Links and pictures are only checked when one of the items is about a link or a picture.
        ...(needLinks ? { checkUrls: (urls) => post('/api/check', { urls }) } : {}),
        onProgress: (p) => { state.scanning[s.id] = Object.assign({}, p, { message: `Rechecking ${label} · ${p.message}` }); renderProgress(s.id); },
      });
      let aiGap = false;
      if (needAI) {
        // Same AI checks as a scan. Answers are cached, so text nobody changed costs nothing.
        res.aiSkip = new Set();
        const aiAlt = await aiAltCheck(res, s.id, log);
        const aiText = await aiTextCheck(res, s.id, log, aiAlt && aiAlt.paused);
        aiGap = !state.ai || !state.ai.enabled || !!((aiAlt && (aiAlt.paused || (aiAlt.pending || []).length)) || (aiText && (aiText.paused || (aiText.pending || []).length)));
      }
      const fresh = A.filterAllowed(res.findings, s.allow);
      const failedPages = new Set((res.pages || []).filter((p) => p.error || p.notFound).map((p) => A.normalizePath(p.path)));
      const ids0 = new Set(fresh.map((x) => x.id)); const loose0 = new Set(fresh.map(looseKey));
      // The same check still flagging the same element, with different wording, is not a fix.
      const near = new Set(fresh.map((x) => [x.code, x.selector, x.path].join('|')));
      const results = {}; const unknown = [];
      items.forEach((f) => {
        if (recheckPages(f).some((p) => failedPages.has(p))) { unknown.push(f); return; }
        if (!metaOk && /NOINDEX/.test(f.code)) { unknown.push(f); return; }
        const present = ids0.has(f.id) || loose0.has(looseKey(f)) || near.has([f.code, f.selector, f.path].join('|'));
        if (!present && (/^AI_/.test(f.code) || f.ai) && aiGap) { unknown.push(f); return; }
        results[f.id] = present ? 'still' : 'gone';
      });
      let out = { fixed: 0, reopened: 0, still: 0 };
      if (Object.keys(results).length) {
        const sum = await store({ op: 'recheck', siteId: s.id, results });
        upsertSummary(sum); out = sum.recheck || out;
      }
      const stillN = Object.values(results).filter((r) => r === 'still').length;
      const parts = [];
      if (out.fixed) parts.push(`${out.fixed} fixed — closed as Done`);
      if (stillN) parts.push(`${stillN} still there${out.reopened ? ` (${out.reopened} reopened)` : ''}`);
      if (unknown.length) parts.push(`${unknown.length} couldn't be checked${aiGap ? ' (AI unavailable right now)' : ''}`);
      if (skipped.length) parts.push(`${skipped.length} skipped`);
      toast(`Recheck ${label}: ${parts.join(' · ') || 'nothing changed'}`);
    } catch (e) { console.error(e); toast('Recheck failed: ' + (e.message || e)); }
    finally {
      clearInterval(beat); releaseScan([s.id]); delete state.scanning[s.id];
      if (state.current && state.current.id === s.id) { await loadSite(s.id); renderSite(); }
    }
  }
  /** What the last quick recheck said about this item, while it still describes the item's current status. */
  function recheckBadge(f) {
    const r = f.recheck; if (!r || !r.at) return '';
    const when = esc(fmtWhen(Date.parse(r.at)));
    const who = esc(nameOf(r.by, 'someone'));
    if (r.r === 'gone' && f.status === 'done' && f.auto && f.auto.why === 'recheck-gone') return `<span class="badge v-ok" title="Rechecked by ${who}: no longer on the website">✓ Fixed · rechecked ${when}</span>`;
    if (r.r === 'still' && f.status !== 'done') return `<span class="badge v-still" title="Rechecked by ${who}: still on the website">⟳ Still there · rechecked ${when}</span>`;
    return '';
  }
  function verifyBadge(s, f) {
    const v = s.verify && s.verify.results && s.verify.results[f.id];
    if (f.status !== 'done') return '';
    if (v === 'ok') return `<span class="badge v-ok" title="Checked on ${esc(s.verify.domain)} ${esc(fmtFull(s.verify.at))}">✓ Fixed on live site</span>`;
    if (v === 'still') return `<span class="badge v-still" title="Marked closed, but still found on ${esc(s.verify.domain)} (${esc(fmtFull(s.verify.at))}). Publish the site, or reopen the item.">⚠ Still on live site</span>`;
    if (v === 'unknown') return `<span class="badge subtle" title="The AI was busy, so this couldn't be checked">? Not checked</span>`;
    return '';
  }
  // Last publish date from Duda (one small call, remembered for 5 minutes per website)
  const pubInfo = {};
  function loadPubInfo(s, force) {
    const c = pubInfo[s.id];
    if (!force && c && (c.loading || Date.now() - c.at < 5 * 60000)) return;
    pubInfo[s.id] = Object.assign({}, c, { loading: true });
    api('/api/site?light=1&editor=' + encodeURIComponent(s.editorUrl))
      .then((d) => { pubInfo[s.id] = { at: Date.now(), d }; })
      .catch((e) => { pubInfo[s.id] = { at: Date.now(), err: e.message }; })
      .finally(() => { if (state.current && state.current.id === s.id) refreshVerifyPanel(s); });
  }
  /** "Last published …" for the site header: Duda's answer when loaded, else the Live DR Sites list. */
  /** Local date and time as YYYYMMDD_HHMM, for backup names people read in their own time zone. */
  function backupStamp() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }
  /** The latest backup made from this app, and a button to make another. */
  function backupLine(s) {
    const last = (s.backups || [])[0];
    const btn = can('site.scan') && s.siteId ? ` <button class="linkbtn" id="sBackup" title="Make a backup of the website in Duda now. It appears in the editor under Site History, where it can be restored.">Back up now</button>` : '';
    if (!last) return `<div class="small faint">💾 No backup made from here yet — one is made automatically before the first scan.${btn}</div>`;
    return `<div class="small ${last.ok ? 'faint' : 'v-still-t'}">💾 ${last.ok ? `Backup in Duda: <span class="mono">${esc(last.name)}</span>` : `Backup failed (${esc(last.error || 'unknown')})`} · ${esc(last.byName || nameOf(last.by))} · ${esc(fmtFull(last.at))}${btn}</div>`;
  }
  function sitePubHtml(s) {
    const pd = (pubInfo[s.id] || {}).d;
    const lx = liveOf(s.siteId);
    const at = (pd && pd.publishedAt) || (lx && lx.published) || '';
    if (pd && (!pd.domain || /NOT_PUBLISHED|UNPUBLISHED/i.test(pd.publishStatus || ''))) return '<span class="faint">Not published yet</span>';
    if (lx === false && !pd) return '<span class="faint">Not in the published list</span>';
    return at ? `Last published <b>${esc(fmtFull(at))}</b> <span class="faint">(${esc(relTime(at))})</span>` : '<span class="faint">Checking publish date…</span>';
  }
  function relTime(at) {
    const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.round(h / 24); if (d < 45) return d + (d === 1 ? ' day ago' : ' days ago');
    const mo = Math.round(d / 30); return mo < 12 ? mo + ' months ago' : Math.round(d / 365) + ' year(s) ago';
  }
  function liveBtnHtml(s) {
    const pd = (pubInfo[s.id] || {}).d;
    const lx = liveOf(s.siteId);
    const dom = (pd && pd.domain) || (lx && lx.domain) || '';
    if (!dom || (pd && /NOT_PUBLISHED|UNPUBLISHED/i.test(pd.publishStatus || ''))) return '';
    return `<a class="btn" href="https://${esc(dom)}/" target="_blank" rel="noopener" title="The published website visitors see">Live site ↗</a>`;
  }
  function refreshSiteHead(s) { const a = $('#sitePub'); if (a) a.innerHTML = sitePubHtml(s); const b = $('#liveBtn'); if (b) b.innerHTML = liveBtnHtml(s); }
  function refreshVerifyPanel(s) {
    refreshSiteHead(s); const el = $('#verifyPanel'); if (el) { el.outerHTML = verifyPanel(s); bindVerify($('#verifyPanel'), s); } }
  const itemChips = (list, s) => list.sort((a, b) => a.num - b.num).map((f) => `<a class="vchip" href="#/site/${esc(s.id)}/item/${f.num}" title="${esc(f.message)}">#${f.num}</a>`).join('');
  /**
   * The live-site check, as one compact strip: where the site is published, a count for each
   * outcome, and the item numbers folded away until somebody asks for them. Hundreds of chips on
   * every visit told nobody anything; the counts do, and the numbers are one click away.
   */
  function verifyPanel(s) {
    const f = (s.findings || []).filter((x) => !/^AI_PENDING/.test(x.code));
    if (!f.length) return '';
    const done = f.filter((x) => x.status === 'done');
    const open = f.filter((x) => !CLOSED(x));
    const v = s.verify;
    const pi = pubInfo[s.id] || {};
    const pd = pi.d;
    const busy = !!state.scanning[s.id];
    const published = pd && pd.publishedAt ? new Date(pd.publishedAt) : null;
    const notLive = pd && (!pd.domain || /NOT_PUBLISHED|UNPUBLISHED/i.test(pd.publishStatus || ''));
    const res = (v && v.results) || {};
    // Each Done item lands in exactly one group. Marked Done after the last publish (and not already
    // seen fixed on the live site) means the fix can't be live yet — that explains a "still there",
    // so it is counted as waiting, not as a failure, and is never offered for reopening.
    const waiting = published ? done.filter((x) => x.statusAt && new Date(x.statusAt) > published && res[x.id] !== 'ok') : [];
    const isW = new Set(waiting.map((x) => x.id));
    const ok = done.filter((x) => res[x.id] === 'ok');
    const still = done.filter((x) => res[x.id] === 'still' && !isW.has(x.id));
    const unk = done.filter((x) => res[x.id] === 'unknown' && !isW.has(x.id));
    const unchecked = done.filter((x) => !(x.id in res) && !isW.has(x.id));
    const pubLine = pi.loading && !pd ? '<span class="faint">Checking when it was last published…</span>'
      : pi.err ? '<span class="faint">Couldn’t get the publish date from Duda.</span>'
      : notLive ? '<b>Not published yet</b> — nothing live to check.'
      : pd ? `<b>${esc(pd.domain)}</b> <span class="faint">· published ${esc(fmtFull(pd.publishedAt))} (${esc(relTime(pd.publishedAt))})</span>` : '';
    const canVerify = done.length && !busy && !otherClaim(s.id) && !notLive;
    const btn = `<button class="btn ${!open.length ? 'primary' : ''} sm" data-verify ${canVerify ? '' : 'disabled'} title="Scan the published website and check every item marked Done">🌐 Verify ${done.length} Done item${done.length === 1 ? '' : 's'}</button>`;
    const pill = (cls, icon, n, label, title) => (n ? `<span class="v-pill ${cls}" title="${esc(title)}">${icon} <b>${n}</b> ${label}</span>` : '');
    const pills = [
      pill('ok', '✓', ok.length, 'fixed on live site', 'The last live check found these gone from the published website.'),
      pill('still', '⚠', still.length, 'still on live site', 'Marked Done, but the published website still has them.'),
      pill('wait', '⏳', waiting.length, 'waiting for publish', 'Marked Done after the last publish. Publish in Duda, then verify.'),
      pill('unk', '?', unk.length, 'couldn’t check', 'The live check could not judge these (usually the AI was busy).'),
      pill('new', '•', unchecked.length, 'not checked yet', 'Marked Done since the last live check.'),
    ].join('');
    const allGood = done.length && ok.length === done.length && !open.length;
    const head = allGood ? `<b>✅ All ${done.length} Done items are fixed on the live site.</b>`
      : !open.length ? '<b>🎉 All items are cleared.</b> Publish in Duda, then verify on the live site.'
      : '<b>🌐 Live site</b>';
    const row = (label, list, extra = '') => (list.length ? `<div class="v-row"><span class="small muted">${label} (${list.length})</span> ${itemChips(list, s)}${extra}</div>` : '');
    const anyList = ok.length + still.length + waiting.length + unk.length + unchecked.length;
    return `<div class="note ${allGood || !open.length ? 'good' : 'unk'} verify-panel" id="verifyPanel">
      <div class="row-between" style="align-items:center;gap:12px;flex-wrap:wrap">
        <div>${head} <span class="small">${pubLine}</span></div>${btn}</div>
      ${pills ? `<div class="v-pills">${pills}${v ? `<span class="small faint">Last check ${esc(fmtFull(v.at))} by ${esc(v.byName || nameOf(v.by))} · ${v.pages || 0} pages</span>` : '<span class="small faint">Not checked on the live site yet.</span>'}</div>` : ''}
      ${still.length ? `<div class="v-row" style="margin-top:6px"><span class="v-still-t">⚠ Still on the live site:</span> ${itemChips(still.slice(0, 30), s)}${still.length > 30 ? ` <span class="faint small">+${still.length - 30} more</span>` : ''} <button class="btn sm" data-vreopen data-ids="${esc(still.map((x) => x.id).join(','))}">Reopen these ${still.length}</button></div>` : ''}
      ${anyList ? `<details class="v-details"><summary class="small">Show item numbers</summary>
        ${row('✓ Fixed on live site', ok)}${row('⏳ Waiting for publish', waiting)}${row('? Couldn’t check', unk)}${row('• Not checked yet', unchecked)}
        <div class="small faint" style="margin-top:6px">The live check scans the <b>published</b> website on Desktop, Tablet and Mobile, and only looks at items marked <b>Done</b>. ${done.length} Done · ${open.length} still open.</div>
      </details>` : ''}</div>`;
  }
  function bindVerify(root, s) {
    if (!root) return;
    const b = $('[data-verify]', root); if (b) b.onclick = () => verifyLive(s);
    const r = $('[data-vreopen]', root); if (r) r.onclick = () => { const ids = (r.dataset.ids || '').split(',').filter(Boolean); if (confirm(`Reopen ${ids.length} item(s)?`)) setFinding(s, ids, { status: 'open' }); };
    loadPubInfo(s);
  }

  // =====================================================================
  // "NEW CHECKS ADDED SINCE THIS SCAN"
  // Nothing recalculates behind anyone's back: an audit keeps exactly the items it was given until
  // somebody rescans it. So when the check list grows, the audits scanned before it say so on their
  // own page — and the team decides, per website, whether it's worth a rescan.
  // =====================================================================
  const ckKey = (s) => `dsa:ck:${s.id}:${A.CHECKS_VERSION}`;
  const ckHidden = (s) => { try { return localStorage.getItem(ckKey(s)) === '1'; } catch (e) { return false; } };
  /** Check releases this audit hasn't been scanned with yet. Empty unless it has a finished scan. */
  function newChecksFor(s) {
    const sc = s.scan || {};
    if (sc.state !== 'complete' || !sc.finishedAt) return [];
    return A.checksSince(sc.cv);
  }
  /**
   * A check can be CORRECTED, not just added — and then the items it already produced are wrong.
   * Nothing is deleted behind anyone's back (an item may carry comments, a status, a number someone
   * quoted in Slack), so instead the items are marked and the website says how many it is carrying.
   */
  /**
   * The checks whose past results this website can no longer be trusted on. Two sources, and they
   * mean the same thing: a release that declared it corrected something, and a false alarm somebody
   * reported that an admin has since marked "Audit Adjusted". The second needs no release at all —
   * the queue is what says the check moved — so a fix reaches all 800 audits the moment it is triaged.
   */
  function fixedCodes(s) {
    const sc = s.scan || {};
    if (sc.state !== 'complete' || !sc.finishedAt) return new Set();
    const out = newChecksFor(s).length ? new Set(A.fixedSince(sc.cv)) : new Set();
    Object.values(state.fixedChecks || {}).forEach((x) => { if (x && x.code && x.at > sc.finishedAt) out.add(x.code); });
    return out;
  }
  /** Why a check is considered corrected, for the note at the top of the audit. */
  const fixedWhy = (s) => {
    const codes = fixedCodes(s);
    const out = newChecksFor(s).filter((r) => (r.fixes || []).some((c) => codes.has(c))).map((r) => r.fixedWhat || r.title);
    Object.values(state.fixedChecks || {}).forEach((x) => { if (x && codes.has(x.code) && x.at > ((s.scan || {}).finishedAt || '')) out.push(`${x.note || 'The ' + x.code + ' check was corrected'}${x.by ? ` (${x.by})` : ''}`); });
    return [...new Set(out)];
  };
  /** Items on this website that came from a check that has since been corrected, and still look like work. */
  function correctedItems(s) {
    const codes = fixedCodes(s);
    if (!codes.size) return [];
    return (s.findings || []).filter((f) => codes.has(f.code) && !['done', 'false'].includes(f.status));
  }
  const isCorrected = (s, f) => fixedCodes(s).has(f.code) && !['done', 'false'].includes(f.status);
  /**
   * Where a repeated photo actually is. The item names the picture; this names each place, so the
   * fix is "open these four elements" rather than "go and find them".
   */
  function dupPlaces(f) {
    const list = f.dupPlaces || [];
    const links = f.placesKind === 'link';
    if (!list.length || (!links && list.length < 2)) return '';
    // A link repeated on every blog post is one element on many pages: each page is its own row,
    // so every one can be opened and ticked off.
    const rows = links ? list.flatMap((x) => (x.paths || ['/']).map((p) => Object.assign({}, x, { paths: [p] }))) : list;
    return `<div class="note known-note"><div class="k">${links ? `Where to find them (${rows.length})` : `Where this photo is used (${list.length})`}</div>
      ${rows.map((x) => `<div class="known-row">
        <span class="badge subtle">${esc(x.location || '')}</span>
        ${links ? `<span class="mono small">${esc(x.paths[0])}</span> <code class="sel">${esc(x.selector)}</code>${x.devices && x.devices.length && x.devices.length < 3 ? ` <span class="faint small">${x.devices.map((d) => esc(A.DEVICE_LABEL[d] || d)).join(', ')} only</span>` : ''}`
          : `<code class="sel">${esc(x.selector)}</code>
        <span class="faint small">${x.how === 'background' ? 'background image' : 'image'}${x.paths && x.paths.length ? ' · ' + x.paths.slice(0, 4).map(esc).join(', ') + (x.paths.length > 4 ? ` +${x.paths.length - 4}` : '') : ''}</span>`}
        <button class="linkbtn" data-dupsel="${esc(x.selector)}" data-duppath="${esc((x.paths || ['/'])[0])}">👁 Show on page</button>
      </div>`).join('')}</div>`;
  }

  /**
   * The same thing, compact enough to sit on an audit row. "Same photo used in 3 places" raises
   * exactly one question — which three — and until now the answer was only inside the item.
   */
  function dupWhereRow(f) {
    const list = f.dupPlaces || [];
    if (!list.length || (f.placesKind !== 'link' && list.length < 2)) return '';
    const show = list.slice(0, 4);
    return `<div class="dup-where"><div class="k">${f.placesKind === 'link' ? 'Found here' : 'Used here'}</div>${show.map((x) => `<div class="dup-row">
      <button class="linkbtn" data-dupsel="${esc(x.selector)}" data-dupfid="${esc(f.id)}" data-duppath="${esc((x.paths || ['/'])[0])}" title="Open the page with this one highlighted">👁</button>
      <span class="faint small">${esc(x.location || '')}${x.how === 'background' ? ' background' : ''}${x.how === 'link' && x.paths && x.paths.length > 1 ? ` \u00b7 ${x.paths.length} pages` : ''}</span>
      <code class="sel">${esc(x.selector)}</code>
      <span class="mono small">${(x.paths || []).slice(0, 3).map(esc).join(', ')}${(x.paths || []).length > 3 ? ` +${x.paths.length - 3}` : ''}</span>
    </div>`).join('')}${list.length > show.length ? `<div class="faint small">…and ${list.length - show.length} more — open the item to see them all</div>` : ''}</div>`;
  }

  /** Closed by a rescan: the thing is no longer on the website (or the check behind it was corrected). */
  const goneBadge = (f) => {
    if (f.gone) return `<div style="margin-bottom:4px"><span class="badge v-ok" title="${esc((f.gone.byName || '') + ' rescanned ' + fmtWhen(Date.parse(f.gone.at)))}">${f.gone.why === 'check-corrected' ? '\u2713 Check corrected \u2014 closed' : '\u2713 Fixed on rescan'}</span></div>`;
    if (f.auto && f.auto.why === 'still-there') return `<div style="margin-bottom:4px"><span class="badge v-still" title="${esc('Marked Done by ' + nameOf(f.auto.ref, 'someone') + (f.auto.at ? ' on ' + fmtWhen(Date.parse(f.auto.at)) : '') + ', but the next rescan still found it')}">\u26A0 Still there after rescan \u2014 reopened</span></div>`;
    if (f.auto && f.auto.why === 'came-back') return `<div style="margin-bottom:4px"><span class="badge v-still" title="It was closed on an earlier rescan, then showed up again">\u21BA Back after a rescan \u2014 reopened</span></div>`;
    return '';
  };
  const correctedBadge = (s, f) => (isCorrected(s, f)
    ? `<div style="margin-bottom:4px"><span class="badge ck-fixed" title="The check that produced this item has since been corrected, so it may not be a real problem. Rescan the website to replace it.">⚠ This check was corrected — rescan</span></div>` : '');

  /** Items somebody marked Done that the last rescan still found, and so reopened. Clears itself as they are dealt with. */
  function stillBanner(s) {
    const list = (s.findings || []).filter((f) => !f.gone && f.auto && f.auto.why === 'still-there' && f.status === 'open');
    if (!list.length) return '';
    return `<div class="note unk" style="margin-bottom:10px"><b>\u26A0 ${list.length} item${list.length === 1 ? '' : 's'} marked Done ${list.length === 1 ? 'was' : 'were'} still on the website at the last rescan, so ${list.length === 1 ? 'it was' : 'they were'} reopened.</b>
      <div class="small" style="margin-top:3px">Whoever marked ${list.length === 1 ? 'it' : 'them'} Done has been told. Fix ${list.length === 1 ? 'it' : 'them'} in the editor and rescan, or mark <b>False alarm</b> if the scan is wrong. This note goes away once each one has a new status.</div>
      <div class="v-row" style="margin-top:6px">${itemChips(list, s)}</div></div>`;
  }
  function newChecksBanner(s) {
    const rel = newChecksFor(s);
    const bad = correctedItems(s);
    // A correction can arrive without a release: an admin marking a reported false alarm
    // "Audit Adjusted" is enough, so the note shows for that alone.
    if ((!rel.length && !bad.length) || (ckHidden(s) && !bad.length)) return '';
    const sc = s.scan || {};
    const n = rel.reduce((a, r) => a + r.items.length, 0);
    // A corrected check leads, because it is the difference between "you're missing something" and
    // "what you're looking at is wrong". The additions stay below it.
    const head = bad.length
      ? `<b>⚠ ${bad.length} item${bad.length === 1 ? '' : 's'} on this website came from a check that has since been corrected.</b>
         <div class="small" style="margin-top:3px">${fixedWhy(s).map(esc).join(' ')}
         <b>Don't work through them</b> — rescan and they go, along with anything else the correction affects. The rescan keeps everything you have already marked <b>False alarm</b> or <b>On hold</b>, with its number and its comments; <b>Done</b> stays Done unless the rescan still finds it.</div>
         ${n ? `<div class="small" style="margin-top:6px">The same rescan also picks up <b>${n} new check${n === 1 ? '' : 's'}</b> added since ${esc(fmtFull(sc.finishedAt))}.</div>` : ''}`
      : `<b>✨ ${n} new audit check${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} been added since this website was scanned.</b>
         <div class="small" style="margin-top:3px">This audit still shows what the scan found on ${esc(fmtFull(sc.finishedAt))}, and it stays that way until someone rescans it.
         A rescan keeps every item you already have, with its number and its comments — anything marked <b>False alarm</b> or <b>On hold</b> stays as it is, and <b>Done</b> stays Done unless the rescan still finds it — and simply adds whatever the new checks find as new <b>Open</b> items. None of them are critical.</div>`;
    return `<div class="note ${bad.length ? 'fixed-checks' : 'new-checks'}" id="ckBanner">
      <div class="row-between" style="align-items:flex-start;gap:12px">
        <div class="grow">${head}</div>
        <div style="white-space:nowrap"><button class="btn sm primary" id="ckRescan" ${state.scanning[s.id] || otherClaim(s.id) ? 'disabled' : ''}>${bad.length ? 'Rescan to clear them' : 'Rescan now'}</button>${bad.length ? '' : ` <button class="btn sm ghost" id="ckLater" title="Hide this note on this website, for you">Not now</button>`}</div>
      </div>
      ${rel.length ? `<details style="margin-top:8px"><summary class="small">${bad.length ? 'What changed' : 'See what was added'}</summary>
        ${rel.map((r) => `<div class="small" style="margin-top:8px"><b>${esc(r.title)}</b> <span class="faint">· ${r.fixes && r.fixes.length ? 'corrected' : 'added'} ${esc(fmtDate(r.date))}</span>
          <ul class="ck-list">${r.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}
      </details>` : ''}</div>`;
  }
  function bindNewChecks(body, s) {
    bindStale(body);
    const later = $('#ckLater', body); const go = $('#ckRescan', body);
    if (later) later.onclick = () => { try { localStorage.setItem(ckKey(s), '1'); } catch (e) { /* private window */ } const b = $('#ckBanner', body); if (b) b.remove(); };
    if (go) go.onclick = () => requestScan([s.id]);
  }

  // =====================================================================
  // FONTS USED ON THE WEBSITE  (Reference data → second tab)
  // Reference, like Business Info: this is what the website's design says its fonts are. Anything
  // that ended up in something else is an audit item, not a line in here.
  // =====================================================================
  const FONT_LEVELS = [['body', 'Body text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6']];
  /**
   * What the picture check looked at, and what it deliberately left alone.
   *
   * The hard part of this check is not finding repeats, it is not shouting about patterns, icons and
   * logos. So the reasoning is shown rather than hidden: every picture set aside is listed with why.
   * If something here looks wrong, that is a False alarm report waiting to be filed.
   */
  const photoCount = (s) => (s.findings || []).filter((f) => f.code === 'IMAGE_DUPLICATE' && !['done', 'false'].includes(f.status)).length;
  function photosReference(s) {
    const ph = s.photos;
    if (!ph) return `<div class="panel panel-pad"><h2>Pictures on the website</h2><p class="muted small">Read on the next scan of this website.</p></div>`;
    const dup = photoCount(s);
    const skipped = ph.skipped || [];
    const byWhy = {};
    skipped.forEach((x) => { (byWhy[x.why] = byWhy[x.why] || []).push(x); });
    const name = (u) => { try { return decodeURIComponent(String(u).split('?')[0].split('/').pop() || u); } catch (e) { return u; } };
    return `<div class="panel panel-pad">
      <div><h2 style="margin:0">Pictures on the website</h2>
        <div class="small muted">Every picture is fingerprinted from its own pixels, so the same photo counts as the same photo even when it was uploaded twice under different names. Design elements are deliberately left out — here is what was set aside and why.</div></div>
      <div class="chips" style="margin-top:12px">
        <span class="chipbtn"><b>${ph.total}</b> pictures</span>
        <span class="chipbtn"><b>${ph.photos}</b> judged photographs</span>
        <span class="chipbtn"><b>${skipped.length}</b> left alone</span>
        ${dup ? `<span class="chipbtn"><b>${dup}</b> used more than once</span>` : ''}
      </div>
      ${Object.keys(byWhy).length ? Object.entries(byWhy).map(([why, list]) => `<div style="margin-top:14px"><div class="k">Left alone — ${esc(why)} <span class="faint">(${list.length})</span></div>
        <div class="small muted">${list.slice(0, 14).map((x) => `<span class="mono">${esc(name(x.url))}</span>`).join(' · ')}${list.length > 14 ? ` <span class="faint">…and ${list.length - 14} more</span>` : ''}</div></div>`).join('')
        : '<p class="small muted" style="margin-top:12px">Nothing was set aside — every picture on this website reads as a photograph.</p>'}
      <p class="small" style="margin:12px 0 0">${dup ? `<b>${dup} audit item${dup === 1 ? '' : 's'}</b> name the photos used in more than one place, and every place they are used. ` : 'No photo is used in more than one place. '}<button class="linkbtn" id="photoToItems">Show them in Audit items ↓</button></p>
      <p class="small muted" style="margin:8px 0 0">A photo that is <i>meant</i> to repeat can be approved under <b>Business Info → ＋ Add or exclude a value → Picture</b>, and it stops being flagged on this website.</p>
    </div>`;
  }

  const offFonts = (s) => ((s.fonts && s.fonts.all) || []).filter((x) => !x.theme);
  const fontCount = (s) => (s.findings || []).filter((f) => /^FONT_/.test(f.code) && !['done', 'false'].includes(f.status)).length;

  function fontsReference(s) {
    const f = s.fonts;
    if (!f) return `<div class="panel panel-pad"><h2>Fonts used on the website</h2><p class="muted small">Read on the next scan of this website.</p></div>`;
    const theme = f.roles || {};
    const off = offFonts(s);
    const open = fontCount(s);
    const srcOf = (name) => (f.all || []).find((x) => x.name === name) || {};
    // The design may set each heading level in a different WEIGHT of the same typeface. That is one
    // typeface, so the card is per typeface and the levels are listed on it.
    const groups = [];
    FONT_LEVELS.filter(([k]) => theme[k]).forEach(([k, label]) => {
      const fam = A.fontBase(theme[k]) || theme[k];
      const g = groups.find((x) => x.fam === fam);
      if (g) g.levels.push(label); else groups.push({ fam, levels: [label] });
    });
    const card = (fam, lines, bad) => {
      const src = srcOf(fam);
      const w = (src.weights || []).filter(Boolean);
      return `<div class="font-card${bad ? ' off' : ''}">
        <div class="font-name">${esc(fam)}</div>
        <div class="small muted">${esc(lines)}</div>
        ${w.length ? `<div class="small faint">Weights: ${esc(w.join(', '))}</div>` : ''}
        <div class="small faint">${src.loaded ? `Loaded from ${esc(src.src || 'the website')}` : '<span class="v-still-t">Not loaded by the website</span>'}${!bad && src.n ? ` · ${src.n} place${src.n === 1 ? '' : 's'}` : ''}</div>
      </div>`;
    };
    return `<div class="panel panel-pad">
      <div class="row-between" style="align-items:flex-start">
        <div><h2 style="margin:0">Fonts used on the website ${f.fromTheme ? '<span class="badge scan-complete">From the design settings</span>' : '<span class="badge sev-warning">From the home page</span>'}</h2>
          <div class="small muted">${f.fromTheme ? "The font this website sets for its body text and for each heading level. Anything else that turned up on the pages is listed as an audit item." : "This website has no global font settings to read, so the home page decides: its H1 sets the font for titles, its paragraphs set the font for body text."}</div></div>
      </div>
      ${correctedItems(s).some((x) => /^FONT_/.test(x.code)) ? `<div class="note fixed-checks" style="margin:10px 0 0"><b>⚠ This was read by a font check that has since been corrected.</b>
        <div class="small" style="margin-top:3px">What you see below is what the old check made of the website. <b>Rescan</b> and it is read again properly.</div></div>` : ''}
      <div class="font-groups">${groups.map((g) => card(g.fam, g.levels.join(' · '))).join('') || '<div class="empty small">No font settings found.</div>'}</div>
      ${off.length ? `<div class="k" style="margin-top:16px">Not part of the design <span class="faint">(${off.length} font${off.length === 1 ? '' : 's'})</span></div>
        <div class="font-groups">${off.map((x) => card(x.name, `${x.n} place${x.n === 1 ? '' : 's'} on the website`, true)).join('')}</div>
        <p class="small" style="margin:10px 0 0">${open ? `<b>${open} audit item${open === 1 ? '' : 's'}</b> name the exact text to fix. ` : 'The places using them are listed as audit items. '}<button class="linkbtn" id="fontToItems">Show them in Audit items ↓</button></p>`
        : `<p class="small" style="margin:12px 0 0">✓ Every piece of text on this website uses the fonts above.</p>`}
    </div>`;
  }

  const FF_DEFAULTS = { q: '', sev: '', cat: '', dev: '', st: 'active', who: '', loc: '', cmt: false };
  /** The filters currently narrowing the list, named the way the person chose them. */
  function activeFilters(ff) {
    const on = [];
    if (ff.sev) on.push({ critical: 'Critical', outdated: 'Outdated', warning: 'Warning', info: 'Info' }[ff.sev] || ff.sev);
    if (ff.st && ff.st !== 'active') on.push(FLABEL[ff.st] || 'All statuses');
    if (ff.cat) on.push(ff.cat === '__ai' ? 'AI-reviewed' : ff.cat);
    if (ff.loc) on.push(ff.loc);
    if (ff.dev) on.push(ff.dev === 'hidden' ? 'Hidden on all devices' : 'Visible on ' + A.DEVICE_LABEL[ff.dev]);
    if (ff.who) on.push(ff.who === '_mine' ? 'Assigned to me' : ff.who === '_none' ? 'Unassigned' : nameOf(ff.who));
    if (ff.q) on.push(`"${ff.q}"`);
    if (ff.cmt) on.push('Discussed only');
    return on;
  }
  const clearFilters = () => { Object.assign(state.ff, FF_DEFAULTS); };

  // =====================================================================
  // OUR ADDITIONS AND EXCEPTIONS
  //
  // Duda's Business Info is never edited here. What Duda says is what the page shows, and a rescan
  // takes it fresh every time — an editable copy would quietly become a second source of truth and
  // force a "yours or Duda's?" decision on every scan.
  //
  // This is the layer beside it, owned by the team and never touched by a rescan. It runs both ways:
  //   · correct for this website — a second phone, an owner's personal email, a font chosen on purpose
  //   · NOT correct — an agency address sitting in a client's Business Info, a retired number
  // =====================================================================
  const ALLOW_TYPES = [
    { v: 'phone', label: 'Phone number', ph: '(302) 317-2793' },
    { v: 'email', label: 'Email address', ph: 'sales@theirshop.com' },
    { v: 'name', label: 'Business name', ph: 'Shore Detailing LLC' },
    { v: 'social', label: 'Social link', ph: 'https://facebook.com/theirpage' },
    { v: 'font', label: 'Typeface', ph: 'Magistral-Medium' },
    { v: 'image', label: 'Picture (meant to repeat)', ph: 'workshop-front.jpg' },
  ];
  const typeLabel = (t) => (ALLOW_TYPES.find((x) => x.v === t) || {}).label || t;
  const denied = (s, type, value) => (s.allow || []).find((a) => a.mode === 'deny' && a.type === type && a.key === A.allowKey(type, value));

  /** Duda's values, with anything the team has struck out shown as struck out rather than hidden. */
  function vals(s, type, list, fmt) {
    if (!list.length) return '—';
    return list.map((v) => {
      const d = denied(s, type, v);
      return d ? `<span class="bi-was" title="${esc('Not correct for this website' + (d.reason ? ' — ' + d.reason : ''))}">${esc(fmt(v))}</span>` : esc(fmt(v));
    }).join(', ');
  }

  /** Open items that would stop being issues if this value were approved. */
  const affectedBy = (s, key) => (s.findings || []).filter((f) => !['done', 'false'].includes(f.status) && (A.allowValueOf(f) || {}).key === key);

  function ourLayer(s) {
    const list = (s.allow || []).slice().sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.value).localeCompare(String(b.value)));
    const ok = list.filter((a) => a.mode !== 'deny');
    const no = list.filter((a) => a.mode === 'deny');
    const row = (a) => `<li>
      <b>${esc(a.value)}</b> <span class="badge subtle">${esc(typeLabel(a.type))}</span>
      <span class="faint small">${esc(a.byName || nameOf(a.by))}, ${esc(fmtDate(a.at))}${a.item ? ` · from #${a.item}` : ''}</span>
      ${a.reason ? `<div class="small muted">${esc(a.reason)}</div>` : ''}
      ${a.stale ? `<div class="note unk small" style="margin:4px 0 0">This was in Business Info when it was approved, but Duda changed it on <b>${esc(fmtDate(a.stale))}</b>. Worth checking whether it's still correct.</div>` : ''}
      ${(a.history || []).length ? `<details class="small"><summary class="faint">Changed ${a.history.length} time${a.history.length === 1 ? '' : 's'}</summary>
        <ul class="allow-hist">${a.history.slice().reverse().map((h) => `<li>${esc(fmtDate(h.at))} · ${esc(h.byName || nameOf(h.by))} — ${h.from !== h.to ? `${esc(h.from === 'deny' ? 'not correct' : 'correct')} → <b>${esc(h.to === 'deny' ? 'not correct' : 'correct')}</b>` : 'note changed'}${h.note ? `: ${esc(h.note)}` : ''}</li>`).join('')}</ul></details>` : ''}
      <span class="allow-acts"><button class="linkbtn small" data-allow-edit="${esc(a.key)}">Edit</button>
        <button class="linkbtn danger small" data-unallow="${esc(a.key)}" title="Check this value normally again from the next scan">Remove</button></span>
    </li>`;
    return `<div class="k" style="margin-top:14px">Our additions and exceptions
        <span class="faint">(kept through every rescan — Duda's copy above is never edited)</span></div>
      ${ok.length ? `<div class="small muted" style="margin:6px 0 2px">Correct for this website — never flagged</div><ul class="allow-list">${ok.map(row).join('')}</ul>` : ''}
      ${no.length ? `<div class="small muted" style="margin:10px 0 2px">Not correct for this website — flagged if it turns up, even though Duda lists it</div><ul class="allow-list deny">${no.map(row).join('')}</ul>` : ''}
      ${!list.length ? `<p class="small muted" style="margin:6px 0 0">Nothing yet. Add a value the client really uses that Duda doesn't carry, or strike out one of Duda's that shouldn't appear on their website.</p>` : ''}
      <p style="margin:10px 0 0"><button class="btn sm" id="allowAdd">＋ Add or exclude a value</button></p>
      ${(s.allowRetired || []).length ? `<details style="margin-top:10px"><summary class="small faint">Approvals that retired themselves (${s.allowRetired.length})</summary>
        <ul class="allow-list small">${s.allowRetired.slice().reverse().map((a) => `<li><b>${esc(a.value)}</b> <span class="faint">— became the official ${esc(typeLabel(a.type).toLowerCase())} in Business Info on ${esc(fmtDate(a.retiredAt))}, so the approval was no longer needed. Approved by ${esc(a.byName || nameOf(a.by))}, ${esc(fmtDate(a.at))}.</span></li>`).join('')}</ul></details>` : ''}`;
  }

  function openAllowEditor(s, existing) {
    const a = existing || null;
    modal(`<header><h2>${a ? 'Edit' : 'Add or exclude a value'}</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <div class="grid-2" style="grid-template-columns:1fr 1fr">
          <label class="field">What is it
            <select id="alType" ${a ? 'disabled' : ''}>${ALLOW_TYPES.map((t) => `<option value="${t.v}" ${a && a.type === t.v ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
          <label class="field">Value
            <input id="alValue" value="${esc(a ? a.value : '')}" ${a ? 'disabled' : ''} placeholder="${esc(ALLOW_TYPES[0].ph)}"></label>
        </div>
        <div class="k" style="margin-top:10px">Which is it?</div>
        <label class="check-row"><input type="radio" name="alMode" value="allow" ${!a || a.mode !== 'deny' ? 'checked' : ''}>
          <span><b>Correct for this website.</b> Never flag it, even though Business Info doesn't carry it.</span></label>
        <label class="check-row"><input type="radio" name="alMode" value="deny" ${a && a.mode === 'deny' ? 'checked' : ''}>
          <span><b>Not correct for this website.</b> Flag it if it turns up, even though Business Info does carry it — an agency address, a retired number.</span></label>
        <label class="field" style="margin-top:10px">Why <span class="faint">(the next person will want to know)</span>
          <textarea id="alReason" rows="2" placeholder="e.g. Second shop line, confirmed with the owner on 12 Sep">${esc(a ? a.reason || '' : '')}</textarea></label>
        <div id="alHit" class="small" style="margin-top:8px"></div>
      </div>
      <footer><button class="btn" data-close>Cancel</button><span class="spacer"></span><button class="btn primary" id="alSave">${a ? 'Save' : 'Add it'}</button></footer>`, { wide: true });

    const typeEl = $('#alType'); const valEl = $('#alValue'); const hit = $('#alHit');
    const mode = () => ($$('input[name="alMode"]').find((r) => r.checked) || {}).value || 'allow';
    const preview = () => {
      const key = A.allowKey(typeEl.value, valEl.value);
      if (!key) { hit.innerHTML = valEl.value.trim() ? '<span class="v-still-t">That doesn\'t look like a valid ' + esc(typeLabel(typeEl.value).toLowerCase()) + '.</span>' : ''; return; }
      if (mode() === 'deny') { hit.innerHTML = '<span class="faint">It will be flagged from the next scan if it appears on the website.</span>'; return; }
      const n = affectedBy(s, key).length;
      hit.innerHTML = n ? `<b>${n} open audit item${n === 1 ? '' : 's'}</b> flagged this. Saving closes ${n === 1 ? 'it' : 'them'} as a False alarm, with your reason on the item. <button class="linkbtn" id="alShow">Show ${n === 1 ? 'it' : 'them'}</button>`
        : '<span class="faint">Nothing open flags this at the moment.</span>';
      const sh = $('#alShow');
      if (sh) sh.onclick = () => { hit.innerHTML += `<ul class="allow-list small">${affectedBy(s, key).map((f) => `<li>#${f.num} — ${esc(f.message)}</li>`).join('')}</ul>`; };
    };
    typeEl.onchange = () => { valEl.placeholder = (ALLOW_TYPES.find((t) => t.v === typeEl.value) || {}).ph || ''; preview(); };
    valEl.oninput = preview;
    $$('input[name="alMode"]').forEach((r) => (r.onchange = preview));
    preview();
    setTimeout(() => valEl.focus(), 50);

    $('#alSave').onclick = async () => {
      const type = a ? a.type : typeEl.value;
      const value = a ? a.value : valEl.value.trim();
      const key = A.allowKey(type, value);
      if (!key) return toast(`That doesn't look like a valid ${typeLabel(type).toLowerCase()}`);
      const reason = $('#alReason').value.trim();
      const chosen = mode();                      // read before the dialog goes: the radios go with it
      const closeIds = chosen === 'allow' ? affectedBy(s, key).map((f) => f.id) : [];
      closeModal();
      try {
        const r = await store({ op: a ? 'allowEdit' : 'allowAdd', id: s.id, type, value, key, mode: chosen, reason, closeIds });
        upsertSummary(r);
        toast(r.closed ? `Saved · ${r.closed} audit item${r.closed === 1 ? '' : 's'} closed` : 'Saved');
        await loadSite(s.id); renderSite();
      } catch (e) { toast(e.message); }
    };
    $$('[data-close]', $('.modal')).forEach((b) => b.addEventListener('click', () => renderSite()));
  }

  // =====================================================================
  // BUSINESS INFO HISTORY  (Reference data → third tab)
  // Business Info is not a fact, it is a fact as of a date. Every scan compares what Duda says now
  // against what it said last time, so the app can tell "a number we don't recognise" from "the old
  // one, still up" — and say when it changed.
  // =====================================================================
  const BI_LABEL = { names: 'Business name', phones: 'Phone', emails: 'Email', addresses: 'Address', domain: 'Domain' };
  const biChanges = (s) => (s.biHistory || []).filter((h) => (h.changes || []).length).length;

  function biReference(s) {
    const hist = s.biHistory || [];
    const changed = hist.filter((h) => (h.changes || []).length);
    const retired = s.retired || {};
    const stale = ['names', 'phones', 'emails', 'addresses'].reduce((a, k) => a + ((retired[k] || []).length), 0);
    const val = (k, v) => (k === 'phones' ? A.fmtPhone(v) : v);
    return `<div class="panel panel-pad">
      <div class="row-between" style="align-items:flex-start">
        <div><h2 style="margin:0">Business Info history</h2>
          <div class="small muted">What Duda said, and when it changed. Recorded on every scan, so the audit can tell an unknown detail from one that simply went out of date.</div></div>
        ${stale ? `<span class="badge sev-outdated" title="Values this website used to publish">${stale} retired value${stale === 1 ? '' : 's'}</span>` : ''}
      </div>
      ${changed.length ? `<ul class="bi-log">${changed.map((h) => `<li>
          <div class="bi-when">${esc(fmtFull(h.at))} <span class="faint small">${esc(ago(h.at))}${h.byName ? ' · seen by ' + esc(h.byName) : ''}</span></div>
          ${(h.changes || []).map((c) => `<div class="bi-change"><span class="k">${esc(BI_LABEL[c.field] || c.field)}</span>
            ${c.added.map((v) => `<span class="bi-now">${esc(val(c.field, v))}</span>`).join(' ')}
            ${c.removed.map((v) => `<span class="bi-was" title="No longer in Business Info">${esc(val(c.field, v))}</span>`).join(' ')}</div>`).join('')}
        </li>`).join('')}</ul>`
        : `<p class="small" style="margin:12px 0 0">Business Info hasn't changed since ${hist.length ? `the first scan on <b>${esc(fmtDate(hist[hist.length - 1].at))}</b>` : 'this website was added'}. Once it does, the change is listed here with its date.</p>`}
      ${stale ? `<div class="k" style="margin-top:16px">No longer in Business Info</div>
        <div class="small muted">Anything on the website still using one of these reads as <span class="badge sev-outdated">outdated</span> rather than wrong.</div>
        <ul class="allow-list small">${['names', 'phones', 'emails', 'addresses'].flatMap((k) => (retired[k] || []).map((r) =>
          `<li><b>${esc(val(k, r.value))}</b> <span class="faint">— ${esc((BI_LABEL[k] || k).toLowerCase())}, until ${esc(fmtDate(r.since))}</span></li>`)).join('')}</ul>` : ''}
    </div>`;
  }

  function renderFindingsTab(body, s, { cnt, sc, live }) {
    const t = s.truth || {};
    const ff = state.ff;
    const findings = s.findings || [];
    const cats = [...new Set(findings.map((f) => f.category))].sort();
    const locs = [...new Set(findings.map((f) => f.location))].sort();
    const shown = filteredFindings(s);
    // Ticked rows belong to one website and only ever cover rows on screen: changing the filters or
    // the website drops anything that is no longer visible, so an action never reaches a hidden item.
    if (pick.site !== s.id) { pick.site = s.id; pick.ids = new Set(); }
    { const vis = new Set(shown.map((f) => f.id)); [...pick.ids].forEach((id) => { if (!vis.has(id)) pick.ids.delete(id); }); }
    const picked = shown.filter((f) => pick.ids.has(f.id));
    const pickedRe = picked.filter(canRecheck);
    const allPicked = shown.length > 0 && picked.length === shown.length;
    const socials = Object.entries(t.socials || {}).map(([k, v]) => {
      const links = (t.socialLinks || {})[k] || [];
      const items = v.map((h, i) => { const u = A.socialUrl(k, links[i] || h); const label = k === 'google_my_business' ? (A.placeNameFromUrl(u) || h) : (h || links[i]); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : esc(label); });
      return `${esc(k.replace('google_my_business', 'Google Business'))}: ${items.join(', ')}`;
    }).join('<br>');
    // The chips count what clicking them would actually show — everything else that's filtering
    // still applies. A "Critical 5" that opens an empty list is worse than no number at all.
    const activeCount = filteredFindings(s, 'sev');
    const sevCount = (sev) => activeCount.filter((f) => f.severity === sev).length;
    body.innerHTML = `
      ${(() => {
        const st = dudaState(s.siteId);
        if (st === 'draft') return `<div class="note dom-banner"><b>Not published yet.</b> This website is in Duda as a draft, which is normal when the audit is being done before launch. Everything on this page works as usual; only <b>Verify on live site</b> needs it published first.</div>`;
        if (st === 'gone') return `<div class="note unk dom-banner"><b>Not found in Duda.</b> Duda lists this website neither as published nor as a draft, so it looks deleted or moved to another account. The audit is kept for reference.</div>`;
        const lx = liveOf(s.siteId);
        return lx && domProblem(lx.dom) ? `<div class="note bad dom-banner"><b>🌐 Domain problem: ${esc(lx.domain)} · ${esc(lx.dom.label)}.</b> ${esc(lx.dom.detail)} <span class="faint">Checked ${esc(ago(new Date(lx.dom.checkedAt).toISOString()))}.</span> This needs the customer (domain / DNS), so fix it before auditing the site.</div>` : ''; })()}
      ${staleBanner()}${newChecksBanner(s)}${stillBanner(s)}
      ${t.fromBrief ? `<div class="note" style="margin-bottom:12px"><b>Checked against the client’s brief.</b>
        <div class="small" style="margin-top:3px">The business details on this website’s project come from the document the client supplied, so they are what every item below is measured against. Duda’s own Business Info is still accepted — nothing is flagged for using a value Duda holds.</div></div>` : ''}
      ${sc.state === 'complete' ? verifyPanel(s) : ''}
      <div class="panel panel-pad" style="margin-bottom:16px"><div class="row-between" style="align-items:flex-start"><div class="grow">${scanBadge(s)}${state.scanning[s.id] || otherClaim(s.id) ? `<div class="small muted" style="margin-top:6px">${esc(doneNote())} It's sent to whoever added this website and whoever it's assigned to.</div>` : ''}</div><div id="aiCredits">${aiCreditsHtml()}</div></div>
        ${sc.state === 'complete' ? `<span class="small muted" style="margin-left:8px">3 devices each · ${sc.externalLinks || 0} external links · ${sc.images || 0} images checked · ${Math.round((sc.durationMs || 0) / 1000)}s${sc.by ? ' · by ' + esc(nameOf(sc.by)) : ''}</span>` : ''}
        ${sc.ai ? `<div class="small" style="margin-top:6px">✨ AI reviewed <b>${sc.ai.checked}</b> alt texts${sc.ai.cached ? ` (${sc.ai.cached} from cache)` : ''}: <b>${sc.ai.flagged}</b> flagged${sc.ai.softened ? `, ${sc.ai.softened} logo warning(s) softened` : ''}.
            ${sc.ai.text ? ` Page text: <b>${sc.ai.text.blocks}</b> of ${sc.ai.text.of} blocks read${sc.ai.text.skipped ? ` (${sc.ai.text.skipped} plain ones skipped)` : ''}${sc.ai.text.truncated ? ', the rest left for later' : ''}, <b>${sc.ai.text.flagged}</b> flagged.` : ''}
            ${sc.ai.aliases && state.ai && state.ai.owner ? `<span class="faint">Answered by ${esc(sc.ai.aliases)}</span>` : ''} <a href="javascript:void 0" class="small" data-ai-status>AI Status ↗</a></div>
            ${sc.ai.paused && (s.findings || []).some((x) => /^AI_PENDING/.test(x.code) && x.status !== 'done' && x.status !== 'false') ? `<div class="note unk" style="margin-top:6px"><b>AI check paused</b>: the AI ran out of credits for today during this scan. The unchecked pages are listed as <b>AI check pending</b> audit items.
              ${aiResumeAt(sc.ai.paused.retryAt) ? `They resume automatically after <b>${esc(fmtWhen(aiResumeAt(sc.ai.paused.retryAt)))}</b> (in ${countdown(aiResumeAt(sc.ai.paused.retryAt))}).` : 'AI credits are available again, so they resume automatically within a minute.'}
              Check them by hand and mark them <b>Done</b> if you can't wait. <a href="#/ai">AI Status ↗</a></div>` : ''}`
          : state.ai && !state.ai.enabled && can('members.manage') && sc.state === 'complete' ? `<div class="small faint" style="margin-top:6px">✨ AI checks are off.${state.superAdmin ? ' Add the AI keys (see the README) to turn them on.' : ''}</div>` : ''}
        ${sc.error ? `<div class="note bad">${esc(sc.error)}</div>` : ''}
        ${(sc.log || []).length ? `<details style="margin-top:8px"><summary class="small">Scan notes (${sc.log.length})</summary>${sc.log.map((l) => `<div class="note unk">${esc(l)}</div>`).join('')}</details>` : ''}
      </div>
      <details class="ref-details" open>
        <summary class="small muted">Reference data</summary>
        <div class="ref-tabs"><span class="chips">
          <button class="chipbtn ${state.refTab === 'info' || !state.refTab ? 'active' : ''}" data-ref="info">Business Info</button>
          <button class="chipbtn ${state.refTab === 'fonts' ? 'active' : ''}" data-ref="fonts">Fonts used on the website${s.fonts && fontCount(s) ? ` <span class="tcount">${fontCount(s)}</span>` : ''}</button>
          ${s.photos ? `<button class="chipbtn ${state.refTab === 'photos' ? 'active' : ''}" data-ref="photos">Pictures on the website${photoCount(s) ? ` <span class="tcount">${photoCount(s)}</span>` : ''}</button>` : ''}
          ${(s.biHistory || []).length ? `<button class="chipbtn ${state.refTab === 'history' ? 'active' : ''}" data-ref="history">Business Info history${biChanges(s) ? ` <span class="tcount">${biChanges(s)}</span>` : ''}</button>` : ''}
        </span></div>
        <div class="grid-2" ${state.refTab === 'info' || !state.refTab ? '' : 'hidden'}>
          <div class="panel panel-pad">
            <h2>Reference: Business Info <span class="badge ${/^api|brief/.test(t.source || '') ? 'scan-complete' : 'sev-warning'}">${t.source === 'api' ? 'From Duda API' : /brief/.test(t.source || '') ? 'Client\u2019s brief + Duda' : t.source === 'schema' ? 'Fallback: site schema' : 'Not loaded yet'}</span></h2>
            <div class="truth">
              <div><div class="k">Business name</div><div class="v">${vals(s, 'name', t.names || [], (x) => x)}</div></div>
              <div><div class="k">Phone</div><div class="v">${vals(s, 'phone', t.phones || [], A.fmtPhone)}</div></div>
              <div><div class="k">Email</div><div class="v">${vals(s, 'email', t.emails || [], (x) => x)}</div></div>
              <div><div class="k">Address</div><div class="v">${(t.addresses || []).length ? esc(t.addresses.map((a) => [a.street, a.city, a.region, a.zip].filter(Boolean).join(', ')).join(' | ')) + (t.addresses.every((a) => !a.street && !a.zip) ? '<div class="small faint">Town only \u2014 no street or ZIP in Business Info, so address checks that need one are skipped.</div>' : '')
                : `\u2014<div class="small faint">${!('addressSeen' in t) ? 'Business Info may have only a town, which earlier scans didn\u2019t read. Rescan to see exactly what Duda has.' : t.addressSeen ? `Duda sent: ${esc(t.addressSeen)}` : /api/.test(t.source || '') ? 'Business Info in Duda has no address filled in (common for businesses that serve an area). Add one in Duda, or here under Our additions, to check addresses.' : 'Rescan to read the address from Duda.'}</div>`}</div></div>
              <div><div class="k">Domain</div><div class="v">${esc(t.domain || '—')}</div></div>
              <div><div class="k">Social (Business Info)</div><div class="v small">${socials || '—'}</div></div>
            </div>
            ${ourLayer(s)}
          </div>
          <div class="panel panel-pad">
            <h2>Facebook / Google Business check</h2>
            ${s.profiles ? (s.profiles.items || []).map((p) => `<div class="note ${p.result === 'match' ? 'good' : p.result === 'mismatch' ? 'bad' : 'unk'}"><b>${esc(p.net)}</b>: ${esc(p.text)} <a href="${esc(A.socialUrl(p.net === 'Google Business' ? 'google_my_business' : String(p.net).toLowerCase(), p.url))}" target="_blank" rel="noopener">open ↗</a></div>`).join('') + (s.profiles.note ? `<div class="note unk">${esc(s.profiles.note)}</div>` : '') : '<p class="muted small">Runs with each scan.</p>'}
            <p class="small faint" style="margin:8px 0 0">General note only. Facebook and Google often block automated reads, so verify anything marked yellow by hand.</p>
          </div>
        </div>
        <div ${state.refTab === 'fonts' ? '' : 'hidden'}>${fontsReference(s)}</div>
        <div ${state.refTab === 'photos' ? '' : 'hidden'}>${photosReference(s)}</div>
        <div ${state.refTab === 'history' ? '' : 'hidden'}>${biReference(s)}</div>
      </details>
      <div class="panel">
        <div class="toolbar">
          <span class="chips" id="ffSev">
            <button class="chipbtn ${ff.sev === '' ? 'active' : ''}" data-sev="">All ${activeCount.length}</button>
            <button class="chipbtn ${ff.sev === 'critical' ? 'active' : ''}" data-sev="critical">Critical ${sevCount('critical')}</button>
            ${sevCount('outdated') || ff.sev === 'outdated' ? `<button class="chipbtn ${ff.sev === 'outdated' ? 'active' : ''}" data-sev="outdated" title="The website is still showing something that used to be in Business Info">Outdated ${sevCount('outdated')}</button>` : ''}
            <button class="chipbtn ${ff.sev === 'warning' ? 'active' : ''}" data-sev="warning">Warning ${sevCount('warning')}</button>
            <button class="chipbtn ${ff.sev === 'info' ? 'active' : ''}" data-sev="info">Info ${sevCount('info')}</button>
            ${(() => { const n = filteredFindings(s, 'cmt').filter((f) => f.comments).length; return n || ff.cmt
              ? `<button class="chipbtn ${ff.cmt ? 'active' : ''}" id="ffCmt" title="Only the audit items somebody has commented on">💬 Discussed ${n}</button>` : ''; })()}
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
          ${can('item.add') ? '<button class="btn sm" id="ffAdd" title="Write an audit item the scan cannot see — a layout or design problem">+ Add item</button>' : ''}
        </div>
        ${shown.length && activeFilters(ff).length ? `<div class="small muted filter-line">Showing <b>${shown.length}</b> of ${findings.length} audit item${findings.length === 1 ? '' : 's'} · filtered by <b>${esc(activeFilters(ff).join(', '))}</b> <button class="linkbtn" id="ffClear2">Clear filters</button></div>` : ''}
        ${!findings.length ? `<div class="empty">${sc.state === 'complete' ? 'No issues found.' : live ? 'Scanning… results appear here when it finishes.' : 'Not scanned yet.'}</div>` : !shown.length ? `<div class="empty">
          <div><b>No audit items match these filters.</b></div>
          <div class="small muted" style="margin:6px 0 10px">This website has ${findings.length} audit item${findings.length === 1 ? '' : 's'}${activeFilters(ff).length ? `, hidden by: <b>${esc(activeFilters(ff).join(', '))}</b>` : ''}.</div>
          <button class="btn sm primary" id="ffClear">Clear filters</button></div>` : `
        ${picked.length ? `<div class="bulkbar" id="bulkBar">
          <b>${picked.length} selected</b>
          ${can('item.status') ? `<select id="bulkSt" title="Set the status of every selected item"><option value="">Set status…</option>${FSTATUS.map((x) => `<option value="${x.v}">${x.label}</option>`).join('')}</select>` : ''}
          ${can('item.assign') ? `<select id="bulkWho" title="Assign every selected item"><option value="__">Assign to…</option>${userOptions('__none', 'Unassigned')}</select>` : ''}
          ${can('item.status') ? `<button class="btn sm" id="bulkRe" ${pickedRe.length ? '' : 'disabled'} title="${pickedRe.length ? 'Rescan only the pages these items are on, and check whether they are still there' : 'None of the selected items can be rechecked on their own'}">⟳ Recheck ${pickedRe.length}${pickedRe.length < picked.length ? ` of ${picked.length}` : ''}</button>` : ''}
          <span class="spacer"></span><button class="linkbtn" id="bulkClear">Clear selection</button>
        </div>` : ''}
        <div class="table-wrap"><table class="grid findings">
          <thead><tr><th class="pick-col"><input type="checkbox" id="pickAll" ${allPicked ? 'checked' : ''} title="Select every item shown"></th><th>ID</th><th>Status</th><th>Severity</th><th>Page / path</th><th>Where</th><th>Unique CSS selector</th><th>Finding</th><th title="Comments">💬</th><th>Assignee</th></tr></thead>
          <tbody>${shown.map((f) => {
            const dev = (f.visibleOn && f.visibleOn[0]) || (f.devices && f.devices[0]) || 'desktop';
            const closed = f.status === 'done' || f.status === 'false';
            return `<tr class="row-link ${closed ? 'done' : ''} ${pick.ids.has(f.id) ? 'picked' : ''}" data-item="${f.num}">
              <td class="pick-col" data-stop><input type="checkbox" data-pick="${esc(f.id)}" ${pick.ids.has(f.id) ? 'checked' : ''} aria-label="Select #${f.num}"></td>
              <td><a class="item-id" href="#/site/${esc(s.id)}/item/${f.num}">#${f.num}</a></td>
              <td data-stop>${statusSelect(f, 'data-fst')}${can('item.status') && canRecheck(f) ? `<div><button class="linkbtn recheck-btn" data-recheck="${esc(f.id)}" title="Rescan only ${recheckPages(f).length === 1 ? 'this page' : 'these ' + recheckPages(f).length + ' pages'} and check whether this item is still there">⟳ Recheck</button></div>` : ''}</td>
              <td><span class="badge sev-${f.severity}">${esc(f.severity)}</span><div class="small faint" style="margin-top:4px">${esc(f.category)}</div></td>
              <td style="max-width:200px" data-stop><a href="${esc(previewUrl(s, f.path, dev))}" target="_blank" rel="noopener" class="mono small" title="Open ${esc(A.DEVICE_LABEL[dev])} preview">${esc(f.path)}</a>
                ${f.pages && f.pages.length > 1 ? `<div class="small muted">+${f.pages.length - 1} more pages</div>` : ''}</td>
              <td><div class="loc">${esc(f.location)}</div>${devChips(f)}</td>
              <td class="cell-sel" data-stop>${f.selector && f.selector !== '(page)' ? `<code class="sel inspect" data-inspect="${esc(f.id)}" title="Click to open the page with this element highlighted">${esc(f.selector)}</code>
                <div class="sel-actions"><button class="linkbtn" data-inspect="${esc(f.id)}">👁 Show on page</button><button class="linkbtn" data-copy="${esc(f.selector)}">Copy</button></div>
                <div class="sel-actions">${selLinks(f)}</div>` : '<span class="faint">(whole page)</span>'}</td>
              <td style="min-width:240px">${goneBadge(f)}${correctedBadge(s, f)}${reportChip(f)}<div class="finding-msg">${esc(f.message)}</div>
                ${f.found ? `<div class="kv"><b>Found:</b> ${esc(f.found)}</div>` : ''}
                ${f.expected ? `<div class="kv"><b>Expected:</b> ${esc(f.expected)}</div>` : ''}${dupWhereRow(f)}${aiNote(f, false)}${aiPendingHtml(f, false)}${verifyBadge(s, f) ? `<div style="margin-top:4px">${verifyBadge(s, f)}</div>` : ''}${recheckBadge(f) ? `<div style="margin-top:4px">${recheckBadge(f)}</div>` : ''}</td>
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
    if ($('#ffCmt', body)) $('#ffCmt', body).onclick = () => { ff.cmt = !ff.cmt; renderSite(); };
    runHint();
    $('#ffq') && ($('#ffq').oninput = (e) => { ff.q = e.target.value; const p = e.target.selectionStart; renderSite(); const i = $('#ffq'); i.focus(); i.setSelectionRange(p, p); });
    [['#ffst', 'st'], ['#ffcat', 'cat'], ['#ffloc', 'loc'], ['#ffdev', 'dev'], ['#ffwho', 'who']].forEach(([sel, k]) => { const el = $(sel, body); if (el) el.onchange = (e) => { ff[k] = e.target.value; renderSite(); }; });
    $$('[data-copy]', body).forEach((c) => (c.onclick = () => copy(c.dataset.copy, 'Selector copied')));
    $$('[data-inspect]', body).forEach((c) => (c.onclick = () => { const f = s.findings.find((x) => x.id === c.dataset.inspect); if (f) openInspector(s, f); }));
    // Each place a repeated photo turns up opens on its own element and its own page, from the row.
    $$('[data-dupsel]', body).forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const f = s.findings.find((x) => x.id === b.dataset.dupfid); if (!f) return;
      const place = (f.dupPlaces || []).find((x) => x.selector === b.dataset.dupsel) || {};
      openInspector(s, Object.assign({}, f, { selector: b.dataset.dupsel, path: b.dataset.duppath, pages: f.placesKind === 'link' ? [b.dataset.duppath] : (place.paths || [b.dataset.duppath]), location: place.location || f.location }, place.devices && place.devices.length ? { visibleOn: place.devices } : {}));
    }));
    bindSelLinks(body, s);
    bindVerify(body, s);
    bindNewChecks(body, s);
    $$('[data-ref]', body).forEach((b) => (b.onclick = () => { state.refTab = b.dataset.ref; renderSite(); }));
    if ($('#fontToItems', body)) $('#fontToItems', body).onclick = () => { state.ff.cat = 'Design'; state.ff.q = ''; state.ff.sev = ''; renderSite(); };
    if ($('#photoToItems', body)) $('#photoToItems', body).onclick = () => { state.ff.cat = 'Images / Alt'; state.ff.q = ''; state.ff.sev = ''; renderSite(); };
    $$('[data-unallow]', body).forEach((b) => (b.onclick = async () => {
      const a = (s.allow || []).find((x) => x.key === b.dataset.unallow) || {};
      if (!confirm(`Remove this ${a.mode === 'deny' ? 'exception' : 'approval'} for ${a.value}?\n\nIt goes back to being checked normally from the next scan.`)) return;
      try { upsertSummary(await store({ op: 'allowRemove', id: s.id, key: b.dataset.unallow })); await loadSite(s.id); renderSite(); } catch (e) { toast(e.message); }
    }));
    $$('[data-allow-edit]', body).forEach((b) => (b.onclick = () => openAllowEditor(s, (s.allow || []).find((x) => x.key === b.dataset.allowEdit))));
    if ($('#allowAdd', body)) $('#allowAdd', body).onclick = () => openAllowEditor(s, null);
    $$('tr[data-item]', body).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('[data-stop], a, select, button')) return; location.hash = `#/site/${s.id}/item/${tr.dataset.item}`; }));
    $$('[data-fst]', body).forEach((sel) => (sel.onchange = () => setFinding(s, [sel.dataset.fst], { status: sel.value })));
    $$('[data-fwho]', body).forEach((sel) => (sel.onchange = () => setFinding(s, [sel.dataset.fwho], { assignee: sel.value })));
    // Several at once. Each goes through setFinding like a single change, so False alarm still asks for
    // one reason (applied to every selected item) and For clarification still asks its one question.
    $$('[data-pick]', body).forEach((cb) => (cb.onchange = () => { if (cb.checked) pick.ids.add(cb.dataset.pick); else pick.ids.delete(cb.dataset.pick); renderSite(); }));
    if ($('#pickAll', body)) $('#pickAll', body).onchange = (e) => { if (e.target.checked) shown.forEach((f) => pick.ids.add(f.id)); else pick.ids.clear(); renderSite(); };
    if ($('#bulkClear', body)) $('#bulkClear', body).onclick = () => { pick.ids.clear(); renderSite(); };
    if ($('#bulkSt', body)) $('#bulkSt', body).onchange = async (e) => {
      const v = e.target.value; if (!v) return;
      const ids = picked.filter((f) => f.status !== v).map((f) => f.id);
      if (!ids.length) { toast(`Already ${FLABEL[v]}`); e.target.value = ''; return; }
      // Plain statuses save straight away; False alarm and For clarification open their dialog first.
      if (v !== 'false' && v !== 'clarification') pick.ids.clear();
      await setFinding(s, ids, { status: v });
    };
    if ($('#bulkWho', body)) $('#bulkWho', body).onchange = async (e) => {
      const v = e.target.value; if (v === '__') return;
      const ids = picked.filter((f) => (f.assignee || '') !== v).map((f) => f.id);
      if (!ids.length) { toast('Already assigned'); e.target.value = '__'; return; }
      pick.ids.clear();
      await setFinding(s, ids, { assignee: v });
    };
    if ($('#bulkRe', body)) $('#bulkRe', body).onclick = () => recheckItems(s, picked.map((f) => f.id));
    $$('[data-recheck]', body).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); recheckItems(s, [b.dataset.recheck]); }));
    if ($('#ffAdd', body)) $('#ffAdd', body).onclick = () => openAddItem(s);
    if ($('#ffClear', body)) $('#ffClear', body).onclick = () => { clearFilters(); renderSite(); };
    // A filtered list that doesn't say it is filtered is how "critical is empty, but there's 5"
    // happens. Now it says so whether the result is empty or not.
    if ($('#ffClear2', body)) $('#ffClear2', body).onclick = () => { clearFilters(); renderSite(); };
    // A filter that is on should look on, so an empty list is never a mystery.
    [['#ffcat', ff.cat], ['#ffloc', ff.loc], ['#ffdev', ff.dev], ['#ffwho', ff.who], ['#ffst', ff.st !== 'active' ? ff.st : '']]
      .forEach(([sel, on]) => { const el = $(sel, body); if (el) el.classList.toggle('filter-on', !!on); });
  }
  async function setFinding(s, ids, changes) {
    // "For clarification" means somebody is waiting on an answer. An item parked there without
    // saying what the question is, or who can answer it, just leaves the work stuck quietly — so
    // the question is asked here, posted as a comment on the item, and the people tagged are told.
    if (changes.status === 'clarification' && changes.asked === undefined) {
      const picked = (s.findings || []).filter((x) => ids.includes(x.id));
      const one = picked.length === 1 ? picked[0] : null;
      const admins = activeUsers().filter((u) => u.role === 'admin');
      modal(`<header><h2>What needs clarifying?</h2><button class="btn ghost" data-close>✕</button></header>
        <div class="body">
          <div class="small muted" style="margin-bottom:10px">${one ? `<b>#${one.num}</b> ${esc(one.message)}${one.found ? ` <span class="faint">— ${esc(one.found)}</span>` : ''}` : `${picked.length} audit items`}</div>
          <div class="k">Your question</div>
          <div id="clarBox"></div>
          <div class="small faint" style="margin-top:8px">Type <b>@</b> to tag someone${admins.length ? `, or <b>@Admins</b> to reach all ${admins.length} of them at once` : ''}. Everyone tagged gets it on the bell, on their desktop and in Slack.</div>
        </div>
        <footer><button class="btn" data-close>Cancel</button><span class="spacer"></span><span class="small faint" id="clarHint">A question is needed — that's the whole point of this status.</span></footer>`);
      const host = $('#clarBox');
      composer(host, {
        site: s, placeholder: 'e.g. @[Euch|euch@example.com] is this second number the new shop line, or a leftover?',
        submitLabel: 'Ask and set For clarification',
        onSubmit: async (pl) => {
          if (!pl.text.trim()) { toast('Write the question first'); throw new Error('empty'); }
          closeModal();
          // The question goes on the first item as a comment, so the answer has somewhere to land.
          try { await store({ op: 'comment', siteId: s.id, target: ids[0], text: pl.text, images: pl.images, mentions: pl.mentions }); }
          catch (e) { toast('Could not post the question: ' + e.message); }
          await setFinding(s, ids, Object.assign({}, changes, { asked: true }));
          toast(pl.mentions.length ? 'Asked — the people you tagged have been told' : 'Marked For clarification');
        },
      });
      $$('[data-close]', $('.modal')).forEach((b) => b.addEventListener('click', () => renderSite()));
      setTimeout(() => { const ta = $('#clarBox textarea'); if (ta) ta.focus(); }, 50);
      return;
    }
    if (changes.status === 'false' && changes.note === undefined) {
      // Ask why (optional): this goes to the admins' False alarms list and helps fix the checks
      const picked = (s.findings || []).filter((x) => ids.includes(x.id));
      const av = picked.map((x) => A.allowValueOf(x)).filter(Boolean);
      const one = av.length && av.every((a) => a.key === av[0].key) ? av[0] : null;
      const same = one ? (s.findings || []).filter((x) => !ids.includes(x.id) && !CLOSED(x) && (A.allowValueOf(x) || {}).key === one.key) : [];
      const TYPE = { email: 'email address', phone: 'phone number', social: 'social link', name: 'business name' };
      modal(`<header><h2>Mark as False alarm</h2><button class="btn ghost" data-close>✕</button></header>
        <div class="body"><label class="field">What's wrong with this finding? <span class="faint">(optional, helps improve the checks)</span>
          <textarea id="faReason" rows="3" placeholder="e.g. This is a partner logo, the alt text is correct"></textarea></label>
          ${one ? `<label class="check-row allow-row"><input type="checkbox" id="faAllow" checked> <span><b>${esc(one.value)}</b> is the correct ${TYPE[one.type]} for this website. Don't flag it again (every page, future scans)${same.length ? `, and also close the <b>${same.length}</b> other open item(s) with it: ${same.map((x) => '#' + x.num).join(', ')}` : ''}.</span></label>` : ''}</div>
        <footer><button class="btn" data-close>Cancel</button><span class="spacer"></span><button class="btn" id="faSkip">Skip</button><button class="btn primary" id="faSave">Mark False alarm</button></footer>`);
      const go = async (note) => {
        const allow = one && $('#faAllow') && $('#faAllow').checked;
        closeModal();
        if (allow) {
          try { await store({ op: 'allowAdd', id: s.id, type: one.type, value: one.value, key: one.key, reason: note, item: picked[0] && picked[0].num }); toast(`${one.value} approved for this website`); } catch (e) { toast(e.message); }
          ids = ids.concat(same.map((x) => x.id));
        }
        setFinding(s, ids, Object.assign({}, changes, { note }));
      };
      $('#faSave').onclick = () => go($('#faReason').value.trim());
      $('#faSkip').onclick = () => go('');
      $$('[data-close]', $('.modal')).forEach((b) => b.addEventListener('click', () => renderSite()));
      setTimeout(() => $('#faReason') && $('#faReason').focus(), 50);
      return;
    }
    const send = Object.assign({}, changes); delete send.asked;
    try { upsertSummary(await store({ op: 'patchFinding', siteId: s.id, findingIds: ids, changes: send })); await loadSite(s.id); renderSite(); if (changes.status && !changes.asked) toast(`Marked ${FLABEL[changes.status]}`); }
    catch (e) { toast('Save failed: ' + e.message); }
  }

  function renderCommentsTab(body, s) {
    const scope = state.commentScope;
    const list = (s.comments || []).filter((c) => scope === 'all' || c.target === 'site');
    body.innerHTML = `<div class="panel panel-pad comments-panel">
      <div class="row-between" style="margin-bottom:10px"><h2 style="margin:0">Discussion</h2>
        <span class="chips" id="cmtScope"><button class="chipbtn ${scope === 'general' ? 'active' : ''}" data-scope="general">General ${(s.comments || []).filter((c) => c.target === 'site' && !c.deleted).length}</button><button class="chipbtn ${scope === 'all' ? 'active' : ''}" data-scope="all">Include audit-item comments ${(s.comments || []).filter((c) => !c.deleted).length}</button></span></div>
      ${(() => { const n = (s.findings || []).filter((f) => f.comments).length; return n
        ? `<p class="small muted" style="margin:-2px 0 10px">${n} audit item${n === 1 ? ' has' : 's have'} their own discussion. <button class="linkbtn" id="cmtToItems">Show the discussed audit items ↓</button></p>` : ''; })()}
      <div class="c-list">${list.length ? list.map((c) => renderComment(c, s, { showTarget: true })).join('') : '<div class="empty small">No comments yet. Start the discussion below. Tip: type #12 to link audit item 12.</div>'}</div>
      <div id="siteComposer"></div></div>`;
    $$('[data-scope]', body).forEach((b) => (b.onclick = () => { state.commentScope = b.dataset.scope; renderSite(); }));
    // The other direction: from the discussion to the items being discussed, flagging the filter
    // that does it so it can be reached straight from the list next time.
    if ($('#cmtToItems', body)) $('#cmtToItems', body).onclick = () => {
      Object.assign(state.ff, { cmt: true, sev: '', q: '', cat: '', st: 'all' });
      ffSite = s.id; hintNext('#ffCmt');
      location.hash = '#/site/' + s.id;
    };
    runHint();
    if (pendingHint === '#cmtScope') setTimeout(() => { const l = $$('.c-list .comment'); if (l.length) l[l.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 260);
    siteComposer = composer($('#siteComposer'), { site: s, target: 'site', onPosted: async () => { await loadSite(s.id); renderSite(); setTimeout(() => { const l = $$('.c-list .comment'); if (l.length) l[l.length - 1].scrollIntoView({ block: 'center' }); }, 50); } });
    bindComments(body, s, siteComposer);
  }

  const ACT_ICON = { slack: '💬', bi: '🏷', verify: '🌐', rename: '✏️', disable: '🚫', enable: '✅', allow: '👍', maintenance: '🧹', ai: '✨', 'scan-start': '▶', 'site-add': '＋', 'site-delete': '🗑', signup: '🙋', approve: '✅', reject: '⛔', remove: '⛔', role: '🛡', reset: '🔑', site: '＋', scan: '⟳', status: '●', assign: '👤', 'item-status': '✓', 'item-assign': '👤', comment: '💬', reply: '↩', 'item-comment': '💬', 'comment-delete': '🗑', 'fa-status': '🐞', 'fa-note': '🐞' };
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
  /**
   * What the team already knows about this value: a client who asked about it in the Duda editor,
   * or the same value marked a False alarm before. Shown on the item rather than left for someone
   * to remember — and, when a client asked, saying why the item was moved out of the default list.
   */
  /** An item closed because the reference moved, not because anybody judged the check wrong. */
  const autoNote = (f) => (f.auto && f.auto.why === 'reference-changed' && f.auto.note
    ? `<div class="note known-note"><div class="small">${esc(f.auto.note)}. The item is kept so it can be reopened if that turns out to be wrong.</div></div>` : '');

  /**
   * "You reported this as a false alarm — here is where it got to."
   * The triage used to happen in an admin-only queue the reporter never saw, so a check they knew
   * was wrong either got fixed silently or didn't, and they never found out which.
   */
  function reportNote(f) {
    const r = f.report; if (!r) return '';
    const meta = FA.find((x) => x.v === r.status) || {};
    const mine = r.by === state.me.email;
    return `<div class="note report-note">
      <div class="row-between" style="align-items:center;gap:8px">
        <div class="small"><b>${mine ? 'You reported this as a false alarm' : `${esc(r.byName || 'Someone')} reported this as a false alarm`}</b>${r.at ? ` <span class="faint">· ${esc(ago(r.at))}</span>` : ''}${r.active ? '' : ' <span class="faint">· since changed back</span>'}</div>
        <span class="pill fa-${esc(r.status)}" title="${esc(meta.hint || '')}">${esc(FAL[r.status] || r.status)}</span>
      </div>
      ${r.reason ? `<div class="small" style="margin-top:6px">“${esc(r.reason)}”</div>` : ''}
      ${r.verdict ? `<div class="fa-verdict"><b>${esc(FAL[r.verdict.status] || '')}</b> — ${esc(r.verdict.note)} <span class="faint small">— ${esc(r.verdict.by)}, ${esc(ago(r.verdict.at))}</span></div>`
        : `<div class="small faint" style="margin-top:6px">${r.status === 'new' ? 'Waiting for an admin to look at it.' : 'No note from the admins yet.'}</div>`}
      ${mine || can('fa.manage') ? `<div class="small" style="margin-top:6px"><a href="#/suggestions/false-alarms">${can('fa.manage') === 'admin' ? 'Open in False alarms' : 'See all my reports'} ↗</a>${r.notes ? ` <span class="faint">· ${r.notes} note${r.notes === 1 ? '' : 's'}</span>` : ''}</div>` : ''}
    </div>`;
  }
  const reportChip = (f) => (f.report
    ? `<div style="margin-bottom:4px"><span class="badge fa-chip fa-${esc(f.report.status)}" title="${esc((FA.find((x) => x.v === f.report.status) || {}).hint || '')}${f.report.verdict ? ' — ' + esc(f.report.verdict.note) : ''}">Reported: ${esc(FAL[f.report.status] || f.report.status)}</span></div>` : '');

  function knownNote(f, s) {
    const k = f.known;
    const auto = f.auto && f.auto.why === 'client-comment';
    if (!k && !auto) return '';
    const cmts = (k && k.comments) || [];
    const fas = (k && k.falseAlarms) || [];
    if (!cmts.length && !fas.length) return '';
    return `<div class="note known-note">
      ${auto ? `<div class="small"><b>Set to For clarification automatically</b> — a client asked about this value. Nobody had touched the item, so it's out of the default list until someone answers.</div>` : ''}
      ${cmts.length ? `<div class="k" style="margin-top:${auto ? 8 : 0}px">${cmts.length === 1 ? 'A comment mentions this' : `${cmts.length} comments mention this`}</div>
        ${cmts.map((c) => `<div class="known-row"><span class="badge ${c.client ? 'sev-critical' : 'subtle'}">${c.client ? 'Client' : 'Team'}</span>
          <span class="small">${esc(c.text)}</span>
          <span class="faint small">— ${esc(c.by || 'someone')}${c.at ? ', ' + esc(ago(c.at)) : ''}${c.num ? ` · conversation #${c.num}` : ''}</span>
          <a class="small" href="#/comments/${esc(s.siteId)}">open ↗</a></div>`).join('')}` : ''}
      ${fas.length ? `<div class="k" style="margin-top:8px">Marked a False alarm before</div>
        ${fas.map((x) => `<div class="known-row"><span class="small">${esc(x.siteName || x.siteRef || 'another website')}${x.path ? ` · ${esc(x.path)}` : ''}</span>
          ${x.reason ? `<span class="small muted">"${esc(x.reason)}"</span>` : '<span class="faint small">no reason given</span>'}
          <span class="faint small">— ${esc(x.by || 'someone')}${x.at ? ', ' + esc(ago(x.at)) : ''}</span></div>`).join('')}` : ''}
    </div>`;
  }

  /**
   * An audit item somebody writes themselves.
   *
   * The scanner is blind to anything that needs an eye — spacing, hierarchy, a logo at the wrong
   * size, copy that reads badly. Those used to live in a chat message and get lost. A screenshot is
   * the whole point: "the hero looks wrong" is an argument, and a picture of it is a finding.
   */
  function openAddItem(s) {
    const paths = [...new Set((s.pages || []).map((p) => p.path).concat((s.findings || []).map((f) => f.path)).filter(Boolean))].sort();
    modal(`<header><h2>Add an audit item</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <div class="small muted">For anything a scan cannot see. It gets a number like any other item, can be assigned and marked Done, and survives rescans.</div>
        <label class="field">What is wrong<input type="text" id="aiMsg" maxlength="300" placeholder="Hero image is stretched on mobile"></label>
        <div class="two-up">
          <label class="field">How serious
            <select id="aiSev"><option value="critical">Critical</option><option value="warning" selected>Warning</option><option value="info">Info</option></select></label>
          <label class="field">Page
            <input type="text" id="aiPath" list="aiPaths" value="/" placeholder="/">
            <datalist id="aiPaths">${paths.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
        </div>
        <label class="field">Device
          <select id="aiDev"><option value="">Any</option>${A.DEVICES.map((d) => `<option value="${d}">${esc(A.DEVICE_LABEL[d])}</option>`).join('')}</select></label>
        <div class="field"><span>More detail</span><div id="aiRich"></div></div>
      </div>
      <footer><span class="spacer"></span><button class="btn primary" id="aiGo">Add item</button></footer>`);
    // The detail is rich text: links, lists, and screenshots pasted (and marked up) in place,
    // instead of save-to-disk, find, upload.
    const ed = richEditor($('#aiRich'), { placeholder: 'What it should look like, and anything the developer needs to know. Paste screenshots here.' });
    $('#aiGo').onclick = async () => {
      const message = $('#aiMsg').value.trim();
      if (!message) return toast('Say what is wrong.');
      if (ed.busy()) return toast('Wait for the picture to finish uploading');
      $('#aiGo').disabled = true;
      try {
        const r = await store({
          op: 'addItem', siteId: s.id, message, severity: $('#aiSev').value, path: $('#aiPath').value.trim() || '/',
          device: $('#aiDev').value, detail: ed.text(), detailHtml: ed.html(),
        });
        closeModal(); toast(`Added as #${r.num}`);
        state.sitesVer = ''; await loadSites().catch(() => {});
        await loadSite(s.id).catch(() => {}); renderSite();
      } catch (e) { toast(e.message); $('#aiGo').disabled = false; }
    };
  }

  /**
   * Disagreeing with a call somebody already made.
   *
   * The reason is required, and it is required because of who reads it: the person who closed this
   * item gets told, by name, that it was reopened. "Reopened" on its own starts an argument; "the
   * phone number on the footer is still the old one" ends it.
   */
  function openChallenge(s, f) {
    const was = f.status === 'done' ? 'done' : 'false';
    modal(`<header><h2>Reopen #${f.num}</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <div class="note"><b>${was === 'done' ? 'Marked Done, but it is still wrong.' : 'Called a False alarm, but it is a real problem.'}</b>
          <div class="small" style="margin-top:3px">${f.statusBy ? `<b>${esc(nameOf(f.statusBy))}</b> will be told, with what you write below.` : 'Nobody is recorded as having closed it, so nobody will be told.'}</div></div>
        <div class="kv" style="margin:8px 0"><b>The item:</b> ${esc(f.message)}</div>
        <label class="field">What is still wrong<textarea id="chWhy" rows="4" placeholder="${was === 'done' ? 'The footer still shows the old number on mobile.' : 'It is a real finding — the alt text really is the file name.'}"></textarea></label>
      </div>
      <footer><span class="spacer"></span><button class="btn primary" id="chGo">Reopen it</button></footer>`);
    $('#chGo').onclick = async () => {
      const why = $('#chWhy').value.trim();
      if (!why) return toast('Say what is still wrong.');
      $('#chGo').disabled = true;
      try {
        await store({ op: 'challenge', siteId: s.id, findingId: f.id, why });
        closeModal(); toast('Reopened'); state.sitesVer = ''; await loadSite(s.id).catch(() => {}); renderSite();
      } catch (e) { toast(e.message); $('#chGo').disabled = false; }
    };
  }

  /** A screenshot the size of a screenshot, not the size of a camera roll. */
  function shrinkImage(file, maxW, quality) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, maxW / img.width);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
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
        ${f.gone ? `<div class="note ${f.gone.why === 'check-corrected' ? 'known-note' : 'good'}" style="margin:8px 0"><b>${f.gone.why === 'check-corrected' ? 'Closed: the check that raised this was changed' : '\u2713 Fixed \u2014 no longer on the website'}</b>
          <div class="small">${f.gone.why === 'check-corrected' ? 'The check that raised it was changed, so this item was closed. If it still needs fixing, the changed check raises it again, possibly as one new item instead of several.' : 'It was there on the previous scan and gone on this one, so it was closed as Done.'} ${esc(f.gone.byName || nameOf(f.gone.by))} rescanned ${esc(fmtWhen(Date.parse(f.gone.at)))}.</div></div>` : ''}
        ${!f.gone && f.auto && f.auto.why === 'still-there' ? `<div class="note unk" style="margin:8px 0"><b>\u26A0 Marked Done, but still on the website</b><div class="small">${esc(nameOf(f.auto.ref, 'Someone'))} marked this Done${f.auto.at ? ' on ' + esc(fmtWhen(Date.parse(f.auto.at))) : ''}. ${esc(nameOf(f.statusBy, 'The next rescan'))} rescanned${f.statusAt ? ' on ' + esc(fmtWhen(Date.parse(f.statusAt))) : ''} and it was still there, so it was reopened. If the scan is wrong about it, mark it <b>False alarm</b> instead.</div></div>` : ''}
        ${!f.gone && f.auto && f.auto.why === 'came-back' ? `<div class="note unk" style="margin:8px 0"><b>\u21BA Back on the website</b><div class="small">This was closed as Done on an earlier rescan, then the latest scan found it again, so it was reopened.</div></div>` : ''}
        ${f.manual ? `<div class="small faint">Written by ${esc(nameOf(f.by, f.byName))} · ${esc(fmtWhen(Date.parse(f.at)))}${f.device ? ' · ' + esc(A.DEVICE_LABEL[f.device] || f.device) : ''}</div>` : ''}
        ${f.detailHtml ? `<div class="dr-detail rich">${cleanRich(f.detailHtml)}</div>` : f.detail ? `<div class="dr-detail">${esc(f.detail)}</div>` : ''}
        ${f.shot ? `<a href="${f.shot}" target="_blank" rel="noopener" title="Open the full size"><img src="${f.shot}" class="dr-shot" alt="Screenshot added with this item"></a>` : ''}
        ${f.challenge ? `<div class="note bad" style="margin-top:10px"><b>Reopened by ${esc(f.challenge.byName || f.challenge.by)}</b> — ${f.challenge.was === 'done' ? 'was marked Done, but it is still wrong' : 'was called a False alarm, but it is real'}
          <div class="pj-note">${esc(f.challenge.why)}</div>
          <div class="small faint">${esc(fmtWhen(Date.parse(f.challenge.at)))}${f.challenge.of ? ` · ${esc(nameOf(f.challenge.of))} was told` : ''}</div></div>` : ''}
        ${f.found ? `<div class="kv"><b>Found:</b> ${esc(f.found)}</div>` : ''}
        ${f.expected ? `<div class="kv"><b>Expected:</b> ${esc(f.expected)}</div>` : ''}
        ${f.snippet && f.snippet !== f.found ? `<div class="snip">${esc(f.snippet)}</div>` : ''}
        ${isCorrected(s, f) ? `<div class="note fixed-checks" style="margin-top:10px"><b>⚠ The check that produced this item has since been corrected.</b>
          <div class="small" style="margin-top:3px">It may not be a real problem at all. Don't spend time on it — <b>rescan the website</b> and it is replaced with what the corrected check finds. Your Done, False alarm and On hold items are untouched by a rescan.</div></div>` : ''}
        ${aiNote(f, true)}${aiPendingHtml(f, true)}${autoNote(f)}${dupPlaces(f)}${reportNote(f)}${knownNote(f, s)}
        <div class="dr-meta">
          <div><div class="k">Page</div><a href="${esc(previewUrl(s, f.path, dev))}" target="_blank" rel="noopener" class="mono small">${esc(f.path)} ↗</a>${f.pages && f.pages.length > 1 ? `<details class="small"><summary class="muted">+${f.pages.length - 1} more pages</summary><div class="mono faint">${f.pages.slice(1).map(esc).join('<br>')}</div></details>` : ''}</div>
          <div><div class="k">Where</div><div class="loc">${esc(f.location)}</div>${devChips(f)}${f.hiddenOn && f.hiddenOn.length ? `<div class="small faint">Hidden: ${esc(f.hiddenOn.join(', '))}</div>` : ''}</div>
          <div class="span2"><div class="k">Unique CSS selector</div>${f.selector && f.selector !== '(page)' ? `<code class="sel inspect" id="drInspect2" title="Click to open the page with this element highlighted">${esc(f.selector)}</code>
            <button class="btn sm primary" id="drInspect">👁 Show on page</button> <button class="btn sm ghost" data-copy="${esc(f.selector)}">Copy selector</button>
            <button class="btn sm ghost" id="drSnip" title="Copy a console snippet that scrolls to and highlights this element">⌖ Console snippet</button>
            <div class="sel-actions dr-open">${selLinks(f)}</div>` : '<span class="faint">(whole page)</span>'}</div>
        </div>
        ${aiPendingList(f)}
        <div class="k" style="margin-top:14px">Status</div>
        <div class="status-btns">${FSTATUS.map((x) => `<button class="sbtn fs-${x.v} ${f.status === x.v ? 'on' : ''}" data-set="${x.v}">${x.label}</button>`).join('')}</div>
        ${f.statusBy ? `<div class="small faint" style="margin-top:4px">Last changed by ${esc(nameOf(f.statusBy))} · ${esc(fmtFull(f.statusAt))}</div>` : ''}
        ${recheckBadge(f) ? `<div style="margin-top:6px">${recheckBadge(f)}</div>` : ''}
        ${can('item.status') ? (canRecheck(f)
          ? `<div style="margin-top:8px"><button class="btn sm" id="drRecheck" title="Rescan only ${recheckPages(f).length === 1 ? 'this page' : 'these ' + recheckPages(f).length + ' pages'} (Desktop, Tablet and Mobile) and check whether this item is still there">⟳ Recheck this item</button>
              <span class="small faint">Fixed it in the editor? Checks ${recheckPages(f).length === 1 ? 'just this page' : 'just these ' + recheckPages(f).length + ' pages'}, not the whole website.</span></div>`
          : `<div class="small faint" style="margin-top:8px">Can't be rechecked on its own: ${esc(recheckWhyNot(f))}.</div>`) : ''}
        ${['done', 'false'].includes(f.status || '') && can('item.status') ? `<button class="linkbtn" id="drChallenge" style="margin-top:6px"
          title="Reopen it and tell whoever closed it why">↺ This is not ${f.status === 'done' ? 'done' : 'a false alarm'} — reopen it</button>` : ''}
        ${f.manual && (f.by === state.me.email || can('item.add')) ? `<button class="linkbtn danger" id="drRmItem" style="margin-top:6px;margin-left:10px">Remove this item</button>` : ''}
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
    bindSelLinks(d, s, [f]);
    $$('.dr-detail.rich img', d).forEach((im) => (im.onclick = () => window.open(im.src, '_blank')));
    $$('[data-pshow]', d).forEach((b) => (b.onclick = () => { const x = f.aiPending.items[Number(b.dataset.pshow)]; openInspector(s, Object.assign({}, f, { selector: x.selector, path: (x.pages || [f.path])[0], pages: x.pages || [f.path], devices: x.devices || f.devices, visibleOn: x.visibleOn || f.visibleOn, location: x.location })); }));
    // Each place a repeated photo turns up opens on its own element and its own page.
    $$('[data-dupsel]', d).forEach((b) => (b.onclick = () => {
      const place = (f.dupPlaces || []).find((x) => x.selector === b.dataset.dupsel) || {};
      openInspector(s, Object.assign({}, f, { selector: b.dataset.dupsel, path: b.dataset.duppath, pages: f.placesKind === 'link' ? [b.dataset.duppath] : (place.paths || [b.dataset.duppath]), location: place.location || f.location }, place.devices && place.devices.length ? { visibleOn: place.devices } : {}));
    }));
    if ($('#drAiNow')) $('#drAiNow').onclick = () => aiResume(s.id, true);
    if ($('#drSnip')) $('#drSnip').onclick = () => {
      const snip = `(s=>{const e=document.querySelector(s);if(!e)return console.warn('Not found on this device view:',s);let p=e;while(p){if(p.id==='hamburger-drawer'){console.log('This element is inside the side panel (hamburger menu), so open it to see.');}p=p.parentElement;}e.scrollIntoView({block:'center'});e.style.outline='4px solid #e11d48';e.style.outlineOffset='2px';console.log(e);})(${JSON.stringify(f.selector)})`;
      copy(snip, `Snippet copied. Paste it in the ${A.DEVICE_LABEL[dev]} preview's console.`);
    };
    $$('[data-set]', d).forEach((b) => (b.onclick = () => { if (b.dataset.set !== f.status) setFinding(s, [f.id], { status: b.dataset.set }); }));
    if ($('#drChallenge', d)) $('#drChallenge', d).onclick = () => openChallenge(s, f);
    if ($('#drRecheck', d)) $('#drRecheck', d).onclick = () => recheckItems(s, [f.id]);
    if ($('#drRmItem', d)) $('#drRmItem', d).onclick = async () => {
      if (!confirm('Remove this item? It was written by hand, so nothing will bring it back.')) return;
      try { await store({ op: 'removeItem', siteId: s.id, findingId: f.id }); closeDrawer(true); state.sitesVer = ''; await loadSite(s.id).catch(() => {}); renderSite(); }
      catch (e) { toast(e.message); }
    };
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
  // SCREENSHOT ANNOTATOR
  // =====================================================================
  /*
   * Paste a screenshot, mark it up with boxes, circles, arrows and text, then copy the picture or
   * drop it straight into what you were writing. Shapes stay shapes until the end — click one to
   * move it, drag a corner to resize it, Delete to remove it — so a misplaced arrow is a drag, not
   * a redo. The picture is only flattened when it leaves.
   *
   * openAnnotator({ src, onDone(blob), doneLabel })
   */
  const ANNO_COLORS = ['#e11d48', '#f59e0b', '#16a34a', '#2563eb', '#ffffff', '#111827'];
  function openAnnotator(opts = {}) {
    const root = document.createElement('div');
    root.className = 'anno-back';
    root.innerHTML = `<div class="anno" role="dialog" aria-label="Annotate a screenshot">
      <div class="anno-bar">
        <div class="anno-group">
          <button type="button" class="anno-tool" data-tool="select" title="Move and resize (V)">↖ Move</button>
          <button type="button" class="anno-tool" data-tool="rect" title="Rectangle (R)">▭ Box</button>
          <button type="button" class="anno-tool" data-tool="ellipse" title="Circle (O)">◯ Circle</button>
          <button type="button" class="anno-tool" data-tool="arrow" title="Arrow (A)">↗ Arrow</button>
          <button type="button" class="anno-tool" data-tool="text" title="Text (T)">T Text</button>
        </div>
        <div class="anno-group">${ANNO_COLORS.map((c) => `<button type="button" class="anno-color" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
        <div class="anno-group"><select class="anno-size" title="Line thickness"><option value="1">Thin</option><option value="2" selected>Medium</option><option value="3">Thick</option></select></div>
        <div class="anno-group">
          <button type="button" class="btn sm ghost" data-act="undo" title="Undo (Cmd/Ctrl+Z)">↶ Undo</button>
          <button type="button" class="btn sm ghost" data-act="del" title="Delete the selected shape (Delete)">Delete</button>
          <button type="button" class="btn sm ghost" data-act="clear" title="Remove every shape">Clear</button>
        </div>
        <span class="spacer"></span>
        <div class="anno-group">
          <label class="btn sm ghost" title="Open a picture from your computer">Open…<input type="file" accept="image/*" hidden></label>
          <button type="button" class="btn sm" data-act="copy" title="Copy the marked-up picture, then paste it anywhere">⧉ Copy picture</button>
          <button type="button" class="btn sm ghost" data-act="download">Download</button>
          ${opts.onDone ? `<button type="button" class="btn sm primary" data-act="done">${esc(opts.doneLabel || 'Use it')}</button>` : ''}
          <button type="button" class="btn sm ghost" data-act="close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="anno-stage">
        <div class="anno-empty"><b>Paste a screenshot</b> (Cmd/Ctrl+V), drop one here, or use <b>Open…</b><div class="small faint">Take the screenshot to the clipboard first: Cmd+Ctrl+Shift+4 on a Mac, Win+Shift+S on Windows.</div></div>
        <canvas hidden></canvas>
        <input type="text" class="anno-text-in" hidden placeholder="Type, then Enter">
      </div>
      <div class="anno-foot small faint">Draw with a tool, then <b>↖ Move</b> to drag shapes or their corners. Delete removes the selected one.</div>
    </div>`;
    document.body.appendChild(root);
    const cv = $('canvas', root), cx = cv.getContext('2d'), stage = $('.anno-stage', root), empty = $('.anno-empty', root), tin = $('.anno-text-in', root);
    let img = null, shapes = [], sel = -1, tool = 'rect', color = ANNO_COLORS[0], size = 2;
    const hist = [];
    const snap = () => { hist.push(JSON.stringify(shapes)); if (hist.length > 60) hist.shift(); };
    const base = () => Math.max(2, Math.round(Math.max(cv.width, cv.height) / 450));
    const lw = (sh) => base() * (sh.size === 1 ? 0.7 : sh.size === 3 ? 1.8 : 1.1);
    const fontPx = (sh) => Math.round(base() * (sh.size === 1 ? 6 : sh.size === 3 ? 12 : 8.5));

    function setTool(t) { tool = t; $$('.anno-tool', root).forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); cv.style.cursor = t === 'select' ? 'default' : 'crosshair'; }
    function setColor(c) { color = c; $$('.anno-color', root).forEach((b) => b.classList.toggle('on', b.dataset.color === c)); if (sel >= 0) { snap(); shapes[sel].color = c; draw(); } }
    setTool('rect'); setColor(color);

    function load(src) {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
        cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
        img = im; shapes = []; sel = -1; hist.length = 0;
        cv.hidden = false; empty.hidden = true; draw();
      };
      im.onerror = () => toast('That picture could not be opened');
      im.crossOrigin = 'anonymous';
      im.src = src;
    }
    const loadBlob = (b) => { if (b && /^image\//.test(b.type)) load(URL.createObjectURL(b)); };
    if (opts.src) load(opts.src);

    function bbox(sh) {
      if (sh.type === 'text') { cx.font = `bold ${fontPx(sh)}px system-ui, sans-serif`; const w = cx.measureText(sh.text).width; const h = fontPx(sh); return { x: sh.x1, y: sh.y1 - h, w, h: h * 1.25 }; }
      return { x: Math.min(sh.x1, sh.x2), y: Math.min(sh.y1, sh.y2), w: Math.abs(sh.x2 - sh.x1), h: Math.abs(sh.y2 - sh.y1) };
    }
    function paint(sh) {
      cx.save(); cx.strokeStyle = sh.color; cx.fillStyle = sh.color; cx.lineWidth = lw(sh); cx.lineCap = 'round'; cx.lineJoin = 'round';
      // A thin dark halo keeps a red box readable on a red website.
      cx.shadowColor = 'rgba(0,0,0,.35)'; cx.shadowBlur = Math.max(2, lw(sh));
      if (sh.type === 'rect') { const b = bbox(sh); cx.strokeRect(b.x, b.y, b.w, b.h); }
      else if (sh.type === 'ellipse') { const b = bbox(sh); cx.beginPath(); cx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(1, b.w / 2), Math.max(1, b.h / 2), 0, 0, Math.PI * 2); cx.stroke(); }
      else if (sh.type === 'arrow') {
        const ang = Math.atan2(sh.y2 - sh.y1, sh.x2 - sh.x1); const head = lw(sh) * 4 + 8;
        cx.beginPath(); cx.moveTo(sh.x1, sh.y1); cx.lineTo(sh.x2 - Math.cos(ang) * head * 0.6, sh.y2 - Math.sin(ang) * head * 0.6); cx.stroke();
        cx.beginPath(); cx.moveTo(sh.x2, sh.y2);
        cx.lineTo(sh.x2 - head * Math.cos(ang - 0.45), sh.y2 - head * Math.sin(ang - 0.45));
        cx.lineTo(sh.x2 - head * Math.cos(ang + 0.45), sh.y2 - head * Math.sin(ang + 0.45));
        cx.closePath(); cx.fill();
      } else if (sh.type === 'text') {
        cx.font = `bold ${fontPx(sh)}px system-ui, sans-serif`; cx.shadowBlur = 0;
        cx.lineWidth = Math.max(3, fontPx(sh) / 6); cx.strokeStyle = sh.color === '#ffffff' ? '#111827' : '#ffffff';
        cx.strokeText(sh.text, sh.x1, sh.y1); cx.fillText(sh.text, sh.x1, sh.y1);
      }
      cx.restore();
    }
    function handles(sh) {
      if (sh.type === 'arrow') return [[sh.x1, sh.y1, 'p1'], [sh.x2, sh.y2, 'p2']];
      if (sh.type === 'text') return [];
      return [[sh.x1, sh.y1, 'p1'], [sh.x2, sh.y1, 'x2y1'], [sh.x1, sh.y2, 'x1y2'], [sh.x2, sh.y2, 'p2']];
    }
    function draw(clean) {
      if (!img) return;
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      shapes.forEach(paint);
      if (!clean && sel >= 0 && shapes[sel]) {
        const sh = shapes[sel]; const b = bbox(sh); const pad = base() * 3;
        cx.save(); cx.setLineDash([base() * 3, base() * 2]); cx.strokeStyle = '#60a5fa'; cx.lineWidth = Math.max(1, base() / 2);
        cx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2); cx.restore();
        const hs = base() * 3.5;
        handles(sh).forEach(([x, y]) => { cx.fillStyle = '#fff'; cx.strokeStyle = '#2563eb'; cx.lineWidth = Math.max(1, base() / 2); cx.fillRect(x - hs, y - hs, hs * 2, hs * 2); cx.strokeRect(x - hs, y - hs, hs * 2, hs * 2); });
      }
    }
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; };
    const distSeg = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy || 1; let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); };
    function hit(p) {
      const tol = base() * 5;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const sh = shapes[i];
        if (sh.type === 'arrow') { if (distSeg(p, { x: sh.x1, y: sh.y1 }, { x: sh.x2, y: sh.y2 }) <= tol) return i; continue; }
        const b = bbox(sh);
        if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return i;
      }
      return -1;
    }
    function hitHandle(p) {
      if (sel < 0) return null; const hs = base() * 5;
      const h = handles(shapes[sel]).find(([x, y]) => Math.abs(p.x - x) <= hs && Math.abs(p.y - y) <= hs);
      return h ? h[2] : null;
    }
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      if (!img) return;
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      const p = pt(e);
      if (tool === 'text') return startText(p);
      if (tool === 'select') {
        const h = hitHandle(p);
        if (h) { snap(); drag = { mode: 'resize', h, last: p }; return; }
        sel = hit(p);
        if (sel >= 0) { snap(); drag = { mode: 'move', last: p }; }
        draw(); return;
      }
      snap();
      shapes.push({ type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, size });
      sel = shapes.length - 1; drag = { mode: 'new', last: p }; draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!img) return;
      const p = pt(e);
      if (!drag) { if (tool === 'select') cv.style.cursor = hitHandle(p) ? 'nwse-resize' : hit(p) >= 0 ? 'move' : 'default'; return; }
      const sh = shapes[sel]; if (!sh) return;
      if (drag.mode === 'new') { sh.x2 = p.x; sh.y2 = p.y; if (e.shiftKey && sh.type !== 'arrow') { const d = Math.max(Math.abs(sh.x2 - sh.x1), Math.abs(sh.y2 - sh.y1)); sh.x2 = sh.x1 + Math.sign(sh.x2 - sh.x1 || 1) * d; sh.y2 = sh.y1 + Math.sign(sh.y2 - sh.y1 || 1) * d; } }
      else if (drag.mode === 'move') { const dx = p.x - drag.last.x, dy = p.y - drag.last.y; sh.x1 += dx; sh.y1 += dy; if (sh.type !== 'text') { sh.x2 += dx; sh.y2 += dy; } drag.last = p; }
      else if (drag.mode === 'resize') {
        if (drag.h === 'p1') { sh.x1 = p.x; sh.y1 = p.y; } else if (drag.h === 'p2') { sh.x2 = p.x; sh.y2 = p.y; }
        else if (drag.h === 'x2y1') { sh.x2 = p.x; sh.y1 = p.y; } else if (drag.h === 'x1y2') { sh.x1 = p.x; sh.y2 = p.y; }
      }
      draw();
    });
    const endDrag = () => {
      if (drag && drag.mode === 'new') {
        const sh = shapes[sel];
        // A click without a drag is not a shape.
        if (sh && Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1) < base() * 3) { shapes.pop(); hist.pop(); sel = -1; }
      }
      drag = null; draw();
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    function startText(p) {
      const r = cv.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      tin.hidden = false; tin.value = '';
      tin.style.left = (r.left - sr.left + stage.scrollLeft + p.x * (r.width / cv.width)) + 'px';
      tin.style.top = (r.top - sr.top + stage.scrollTop + p.y * (r.height / cv.height) - 18) + 'px';
      tin.style.color = color; tin.dataset.x = p.x; tin.dataset.y = p.y;
      setTimeout(() => tin.focus(), 0);
    }
    const commitText = () => {
      if (tin.hidden) return;
      const v = tin.value.trim(); tin.hidden = true;
      if (!v) return;
      snap(); shapes.push({ type: 'text', text: v.slice(0, 120), x1: Number(tin.dataset.x), y1: Number(tin.dataset.y) + fontPx({ size }) * 0.8, color, size });
      sel = shapes.length - 1; setTool('select'); draw();
    };
    tin.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') commitText(); if (e.key === 'Escape') { tin.hidden = true; } });
    tin.addEventListener('blur', commitText);

    const toBlob = () => new Promise((resolve) => { draw(true); cv.toBlob((b) => { draw(); resolve(b); }, 'image/png'); });
    function close() { document.removeEventListener('paste', onPaste, true); document.removeEventListener('keydown', onKey, true); root.remove(); }
    async function copyPicture() {
      if (!img) return toast('Paste a screenshot first');
      try {
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no clipboard');
        // The promise form keeps Safari happy: the write has to start inside the click.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob() })]);
        toast('Picture copied — paste it into the item or a comment');
      } catch (e) { toast('This browser can’t copy pictures. Use Download instead.'); }
    }
    function onPaste(e) {
      if (!tin.hidden) return;
      const f = Array.from((e.clipboardData || {}).items || []).filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile())[0];
      if (!f) return;
      e.preventDefault(); e.stopPropagation();
      if (img && shapes.length && !confirm('Replace this picture and its markings with the one you pasted?')) return;
      loadBlob(f);
    }
    function onKey(e) {
      if (!tin.hidden) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { e.preventDefault(); snap(); shapes.splice(sel, 1); sel = -1; draw(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (hist.length) { shapes = JSON.parse(hist.pop()); sel = -1; draw(); } return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && img) { e.preventDefault(); copyPicture(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (sel >= 0) { sel = -1; draw(); } else close(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = { v: 'select', r: 'rect', o: 'ellipse', a: 'arrow', t: 'text' }[e.key.toLowerCase()];
      if (k) { setTool(k); e.preventDefault(); }
    }
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('keydown', onKey, true);
    stage.addEventListener('dragover', (e) => e.preventDefault());
    stage.addEventListener('drop', (e) => { e.preventDefault(); loadBlob((e.dataTransfer.files || [])[0]); });
    $('input[type=file]', root).onchange = (e) => { loadBlob(e.target.files[0]); e.target.value = ''; };
    $$('.anno-tool', root).forEach((b) => (b.onclick = () => { setTool(b.dataset.tool); if (b.dataset.tool !== 'select') { sel = -1; draw(); } }));
    $$('.anno-color', root).forEach((b) => (b.onclick = () => setColor(b.dataset.color)));
    $('.anno-size', root).onchange = (e) => { size = Number(e.target.value); if (sel >= 0) { snap(); shapes[sel].size = size; draw(); } };
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') return close();
      if (act === 'undo') { if (hist.length) { shapes = JSON.parse(hist.pop()); sel = -1; draw(); } return; }
      if (act === 'del') { if (sel >= 0) { snap(); shapes.splice(sel, 1); sel = -1; draw(); } return; }
      if (act === 'clear') { if (shapes.length) { snap(); shapes = []; sel = -1; draw(); } return; }
      if (act === 'copy') return copyPicture();
      if (!img) return toast('Paste a screenshot first');
      if (act === 'download') { const bl = await toBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'screenshot-annotated.png'; a.click(); return; }
      if (act === 'done') { b.disabled = true; const bl = await toBlob(); close(); opts.onDone(bl); }
    });
    return { close };
  }

  // =====================================================================
  // RICH TEXT (audit item detail)
  // =====================================================================
  /** What a written-up item may contain: text formatting, lists, links, and our own uploaded pictures. */
  const RICH_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'A', 'IMG']);
  function cleanRich(html) {
    const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) return;
        if (n.nodeType !== 1) { n.remove(); return; }
        if (!RICH_TAGS.has(n.tagName)) {
          if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|META|LINK)$/.test(n.tagName)) { n.remove(); return; }
          walk(n); n.replaceWith(...n.childNodes); return;
        }
        const keep = {};
        if (n.tagName === 'A') { const h = n.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(h)) keep.href = h; }
        if (n.tagName === 'IMG') { const s2 = n.getAttribute('src') || ''; if (/^\/api\/img\?id=[\w-]+$/.test(s2)) keep.src = s2; else { n.remove(); return; } }
        [...n.attributes].forEach((a) => n.removeAttribute(a.name));
        Object.entries(keep).forEach(([k, v]) => n.setAttribute(k, v));
        if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
        walk(n);
      });
    };
    const root = doc.body.firstChild; walk(root);
    return root.innerHTML;
  }
  /** Turn the plain-text parts of rich HTML into text, for search, CSV and notifications. */
  const richText = (html) => { const d = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html'); d.querySelectorAll('br,p,div,li').forEach((n) => n.append('\n')); return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };
  /**
   * A small rich-text box: bold, italic, lists, links, and screenshots pasted straight in. Clicking a
   * picture in it opens the annotator on that picture.
   */
  function richEditor(host, { placeholder } = {}) {
    host.innerHTML = `<div class="rte">
      <div class="rte-bar">
        <button type="button" data-cmd="bold" title="Bold (Cmd/Ctrl+B)"><b>B</b></button>
        <button type="button" data-cmd="italic" title="Italic (Cmd/Ctrl+I)"><i>I</i></button>
        <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
        <button type="button" data-cmd="link" title="Link the selected text">🔗 Link</button>
        <span class="rte-sep"></span>
        <button type="button" data-cmd="shot" title="Paste or open a screenshot and mark it up">✏️ Screenshot</button>
        <label class="rte-file" title="Add a picture from your computer">📎 Picture<input type="file" accept="image/*" hidden></label>
      </div>
      <div class="rte-body" contenteditable="true" data-ph="${esc(placeholder || '')}"></div>
      <div class="rte-hint small faint">Paste screenshots straight in (Cmd/Ctrl+V). Click a picture to mark it up.</div>
    </div>`;
    const body = $('.rte-body', host);
    let uploading = 0; let range = null;
    const keepRange = () => { const s2 = window.getSelection(); if (s2.rangeCount && body.contains(s2.anchorNode)) range = s2.getRangeAt(0).cloneRange(); };
    body.addEventListener('keyup', keepRange); body.addEventListener('mouseup', keepRange); body.addEventListener('input', keepRange);
    const restore = () => { body.focus(); if (range) { const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(range); } };
    async function insertImage(blob, replace) {
      const ph = replace || document.createElement('img');
      ph.className = 'rte-uploading'; ph.alt = 'Uploading…';
      if (!replace) { restore(); const s2 = window.getSelection(); if (s2.rangeCount && body.contains(s2.anchorNode)) { const r = s2.getRangeAt(0); r.collapse(false); r.insertNode(ph); r.setStartAfter(ph); } else body.appendChild(ph); }
      uploading++;
      try { const { data, type } = await compressImage(blob); const r = await post('/api/img', { data, type }); ph.src = r.url; ph.className = ''; ph.alt = ''; }
      catch (e) { ph.remove(); toast('Picture upload failed: ' + e.message); }
      uploading--;
    }
    body.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData || {}).items || []).filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile());
      if (files.length) { e.preventDefault(); keepRange(); files.forEach((f) => insertImage(f)); return; }
      // Text from elsewhere comes in as text: someone else's styling has no place in an audit item.
      const html = e.clipboardData && e.clipboardData.getData('text/html');
      if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanRich(html)); }
    });
    body.addEventListener('drop', (e) => { const f = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((x) => /^image\//.test(x.type)); if (f.length) { e.preventDefault(); f.forEach((x) => insertImage(x)); } });
    body.addEventListener('click', (e) => {
      const im = e.target.closest('img'); if (!im || !im.src || im.classList.contains('rte-uploading')) return;
      openAnnotator({ src: im.src, doneLabel: 'Replace picture', onDone: (bl) => insertImage(bl, im) });
    });
    $('input[type=file]', host).onchange = (e) => { [...e.target.files].forEach((f) => insertImage(f)); e.target.value = ''; };
    $$('[data-cmd]', host).forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    $$('[data-cmd]', host).forEach((b) => (b.onclick = () => {
      const c = b.dataset.cmd;
      if (c === 'shot') { keepRange(); return openAnnotator({ doneLabel: 'Add to item', onDone: (bl) => insertImage(bl) }); }
      restore();
      if (c === 'link') {
        const url = prompt('Link to (https://…)', 'https://');
        if (!url || !/^(https?:\/\/|mailto:)\S+$/i.test(url.trim())) return;
        const s2 = window.getSelection();
        if (s2.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url.trim())}">${esc(url.trim())}</a>`);
        else document.execCommand('createLink', false, url.trim());
        return;
      }
      document.execCommand(c);
    }));
    return {
      html: () => cleanRich(body.innerHTML.replace(/<img[^>]*class="rte-uploading"[^>]*>/g, '')),
      text: () => richText(body.innerHTML),
      busy: () => uploading > 0,
      focus: () => body.focus(),
    };
  }

  // =====================================================================
  // AUDIT SUMMARY — a note for the group chat
  // =====================================================================
  /*
   * What happened on one audit, in words a reader outside the app understands: what was looked at,
   * what was found and fixed (critical items one by one, the rest counted), and how each contact
   * detail was checked — against Business Info, the client's brief and the client's own comments.
   * Plain text with *bold*, which reads the same in Slack and Google Chat.
   */
  const SUM_NAME = /^(TEXT_OTHER_BUSINESS|COPYRIGHT_NAME|SCHEMA_NAME|MAP_OTHER_BUSINESS|MAP_LABEL_OLD|AI_TEXT_OTHER_BUSINESS)$/;
  const SUM_PHONE = /^(TEL_|PHONE_|SMS_|SCHEMA_PHONE)/;
  const SUM_EMAIL = /^(MAILTO_(MISMATCH|TEXT_MISMATCH)|EMAIL_|SCHEMA_EMAIL)/;
  const SUM_ADDR = /^(SCHEMA_ADDRESS|MAP_ADDRESS|ADDRESS_)/;
  const SUM_CROSS = /^(TEL_|PHONE_|SMS_|SCHEMA_PHONE|MAILTO_(MISMATCH|TEXT_MISMATCH)|EMAIL_|SCHEMA_EMAIL|SCHEMA_ADDRESS|MAP_ADDRESS|ADDRESS_|TEXT_OTHER_BUSINESS|COPYRIGHT_NAME|SCHEMA_NAME|MAP_OTHER_BUSINESS|MAP_LABEL_OLD|NAME_SPELLING|AI_TEXT_OTHER_BUSINESS|AI_TEXT_NAME_VARIANT)/;
  const sumPhone = (x) => { const m = String(x || '').match(/(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}/); if (!m) return ''; const d = m[0].replace(/\D/g, '').slice(-10); return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
  const sumFmt10 = (d) => (String(d).length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(d));
  const sumEmail = (x) => (String(x || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
  const sumCut = (x, n) => { const t = String(x || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const sumAnd = (list) => (list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]);
  /** A copyright line is mostly not the name: "© 2025 Sample Auto Spa. All rights reserved." → "Sample Auto Spa". */
  const sumBareName = (f) => f.foreignName || sumCut(String(f.found || '').replace(/^"|"$/g, '').replace(/©|\(c\)|copyright/gi, '').replace(/\b(19|20)\d{2}\b/g, '').replace(/all rights reserved\.?/i, '').replace(/^[\s.,|–—-]+|[\s.,|–—-]+$/g, ''), 60);
  /** Where on a page an item sits, in words a client would use. */
  function sumSpot(f) {
    const sel = String(f.selector || ''); const code = String(f.code || '');
    if (/meta\[name="description"\]/.test(sel)) return 'meta description';
    if (/(twitter|og):description/.test(sel)) return 'social share description';
    if (/(twitter|og):title/.test(sel)) return 'social share title';
    if (/(^|\s|>)title\b/.test(sel) && /head/.test(sel)) return 'page title';
    if (f.category === 'Schema' || /^SCHEMA_/.test(code)) return 'structured data Google reads';
    if (/^(TEL_|SMS_)/.test(code)) return 'click-to-call links';
    if (/^MAILTO_/.test(code)) return 'email links';
    if (/^MAP_/.test(code)) return 'map';
    if (/^COPYRIGHT_/.test(code)) return 'copyright line';
    if (f.location === 'Footer') return 'footer';
    if (f.location === 'Header') return 'header';
    if (/side panel|hamburger/i.test(f.location || '')) return 'side menu';
    return 'page text';
  }
  /** What an item is ABOUT, so the same problem in many places becomes one entry in the report. */
  function sumTopic(s, f) {
    const code = String(f.code || ''); const t = s.truth || {};
    const bn = (t.names && t.names[0]) || t.businessName || s.businessName || '';
    if (code === 'NAME_SPELLING' || code === 'AI_TEXT_NAME_VARIANT') {
      let v = code === 'NAME_SPELLING' ? f.found : f.variant;
      if (!v && code === 'AI_TEXT_NAME_VARIANT') { const nv = A.nameVariants([{ text: String(f.found || '') }], t)[0]; v = nv && nv.found; }
      if (v) return { key: 'spell:' + v, kind: 'spell', value: v, expected: (code === 'NAME_SPELLING' && f.expected) || bn };
    }
    if (SUM_PHONE.test(code) || (code === 'PLACEHOLDER' && sumPhone(f.found))) { const ph = sumPhone(f.found); if (ph) return { key: 'phone:' + ph, kind: 'phone', value: ph, expected: (t.phones || []).map(sumFmt10) }; }
    if (SUM_EMAIL.test(code)) { const em = sumEmail(f.found); if (em) return { key: 'email:' + em.toLowerCase(), kind: 'email', value: em, expected: t.emails || [] }; }
    if (SUM_NAME.test(code)) { const n = sumBareName(f); return { key: 'name:' + n.toLowerCase(), kind: 'name', value: n, expected: bn }; }
    if (SUM_ADDR.test(code)) return { key: 'addr:' + String(f.found || '').toLowerCase(), kind: 'addr', value: sumCut(f.found, 80), expected: '' };
    if (code === 'MAILTO_SHARE_NO_TO') return { key: 'code:' + code, kind: 'other', value: f.message.replace(/ — .*$/, '') };
    return { key: 'code:' + code + ':' + f.message + ':' + (String(f.found || '').length < 70 ? f.found : ''), kind: 'other', value: f.message, found: String(f.found || '').length < 70 ? f.found : '' };
  }
  /** How a contact value was cross-checked with the client's comments, in a sentence. */
  function sumCross(s, items, kindWord) {
    if (!items.some((f) => SUM_CROSS.test(f.code || ''))) return '';
    const said = items.some((f) => ((f.known && f.known.comments) || []).some((c) => c.fromFound !== false));
    if (said) return `The client mentioned this ${kindWord} in a comment — check it with them.`;
    const n = s.ccSearched || 0;
    return n ? `Not mentioned in any of the ${n} client comment${n === 1 ? '' : 's'} on this website.` : 'There are no client comments on this website to check against.';
  }
  function auditSummary(s, opt = {}) {
    const since = opt.since ? Date.now() - opt.since : 0;
    const maxPages = opt.pages || 3;
    const when = (f) => Date.parse((f.gone && f.gone.at) || f.statusAt || '') || 0;
    const corrected = (f) => (f.gone && f.gone.why === 'check-corrected') || (f.auto && f.auto.why === 'check-corrected');
    const all = (s.findings || []).filter((f) => !/^AI_PENDING/.test(f.code || '') && !corrected(f));
    const live = all.filter((f) => f.status !== 'false');
    const falseAl = all.filter((f) => f.status === 'false' && (!since || when(f) >= since));
    const sc = s.scan || {};
    const pd = (pubInfo[s.id] || {}).d || {};
    const lx = liveOf(s.siteId) || {};
    const domain = pd.domain || lx.domain || (s.verify && s.verify.domain) || '';
    const scans = (s.activity || []).filter((a) => a.type === 'scan' && /completed a scan/.test(a.text || '')).length;
    const brief = /brief/.test((s.truth && s.truth.source) || '');
    const sevRank = { critical: 0, outdated: 1, warning: 2, info: 3 };

    // Group every item by what it is about.
    const groups = new Map();
    live.forEach((f) => {
      const tp = sumTopic(s, f);
      const g = groups.get(tp.key) || Object.assign({ items: [] }, tp);
      g.items.push(f); groups.set(tp.key, g);
    });
    const detailed = []; const smallFixed = []; const smallOpen = [];
    groups.forEach((g) => {
      const sev = Math.min(...g.items.map((f) => sevRank[f.severity] ?? 3));
      g.sev = sev;
      g.done = g.items.filter((f) => f.status === 'done');
      g.places = g.items.reduce((a, f) => a + ((f.pages && f.pages.length) || 1), 0);
      g.pages = [...new Set(g.items.flatMap((f) => (f.pages && f.pages.length ? f.pages : [f.path || '/'])))].sort();
      g.spots = [...new Set(g.items.map(sumSpot))];
      const inRange = !since || g.done.some((f) => when(f) >= since);
      const big = sev <= 1 || g.kind !== 'other';
      if (big) { if (inRange) detailed.push(g); return; }
      g.items.forEach((f) => { if (f.status === 'done') { if (!since || when(f) >= since) smallFixed.push(f); } else if (!f.gone) smallOpen.push(f); });
    });
    detailed.sort((a, b) => (a.sev - b.sev) || (b.places - a.places));

    const L = [];
    L.push(`*Audit summary — ${s.businessName || s.siteId}*${domain ? ' (' + domain + ')' : ''}`);
    L.push(`Audited by ${nameOf(s.assignee || sc.by || s.addedBy, 'the team')}${scans ? ` · ${scans} scan${scans === 1 ? '' : 's'}` : ''}${sc.finishedAt ? ` · last scan ${fmtFull(sc.finishedAt)}` : ''}${since ? ` · fixes in the last ${opt.sinceLabel}` : ''}`);
    L.push('');
    L.push('*What the app checked*');
    if (sc.pages) L.push(`• ${sc.pages} page${sc.pages === 1 ? '' : 's'}, each on desktop, tablet and mobile${sc.externalLinks ? `, plus ${sc.externalLinks} outside links` : ''}${sc.images ? ` and ${sc.images} images` : ''}`);
    L.push(`• Every phone number, email, address and business name on the site — in the page text, the meta descriptions and the hidden code Google reads — compared with ${brief ? 'Business Info and the client’s brief' : 'Business Info in Duda'}, which is the source of truth`);
    L.push(`• Anything that didn’t match was cross-checked against the client’s own comments on this website${s.ccSearched ? ` (${s.ccSearched} comment${s.ccSearched === 1 ? '' : 's'})` : ''} before being called wrong`);
    L.push('• Also: business name spelling, broken links, SEO titles and descriptions, image alt text, fonts, repeated photos, forms and social links');
    L.push('');
    if (detailed.length) {
      const fixedG = detailed.filter((g) => g.done.length === g.items.length).length;
      L.push(`*What was found* — ${detailed.length} issue${detailed.length === 1 ? '' : 's'}${fixedG ? `, ${fixedG === detailed.length ? 'all' : fixedG} fixed` : ''}`);
      detailed.forEach((g, i) => {
        L.push('');
        const where = `in the ${sumAnd(g.spots)}`;
        const exp = Array.isArray(g.expected) ? g.expected.filter(Boolean) : [g.expected].filter(Boolean);
        let head;
        if (g.kind === 'phone') head = `*Wrong phone number.* Found ${g.value} ${where}. ${exp.length ? `The correct number is ${sumAnd(exp)} (Business Info).` : ''}`;
        else if (g.kind === 'email') head = `*Wrong email.* Found ${g.value} ${where}. ${exp.length ? `Business Info has ${sumAnd(exp)}.` : ''}`;
        else if (g.kind === 'name') head = `*Another business’s name.* Found "${g.value}" ${where}. This website is "${exp[0] || s.businessName}".`;
        else if (g.kind === 'spell') head = `*Business name spelled differently.* Found "${g.value}", but Business Info says "${exp[0]}", which is the official spelling. Found ${where}.`;
        else if (g.kind === 'addr') head = `*Wrong address.* Found "${g.value}" ${where}.`;
        else head = `*${g.value}.*${g.found ? ` Found: ${sumCut(g.found, 70)}.` : ''}${g.spots[0] !== 'page text' ? ` In the ${sumAnd(g.spots)}.` : ''}`;
        L.push(`${i + 1}. ${head.trim()}`);
        const cross = sumCross(s, g.items, g.kind === 'phone' ? 'number' : g.kind === 'email' ? 'email' : g.kind === 'addr' ? 'address' : 'name');
        if (cross && g.kind !== 'spell') L.push(`   ${cross}`);
        if (g.pages.length === 1) L.push(`   Page: ${g.pages[0]}${g.places > 1 ? ` (${g.places} places)` : ''}`);
        else {
          L.push(`   Found on these pages${g.places > g.pages.length ? ` (${g.places} places in all)` : ''}:`);
          g.pages.slice(0, maxPages).forEach((pg, k) => L.push(`   ${String.fromCharCode(97 + k)}. ${pg}`));
          if (g.pages.length > maxPages) L.push(`   …and ${g.pages.length - maxPages} more page${g.pages.length - maxPages === 1 ? '' : 's'}`);
        }
        const n = g.items.length; const d = g.done.length;
        const confirmed = d && g.done.every((f) => f.gone && f.gone.why === 'gone');
        const clar = g.items.filter((f) => f.status === 'clarification').length;
        if (d === n) L.push(`   ✅ Fixed${g.places > 1 ? ` — all ${g.places} places` : ''}${confirmed ? ', confirmed by a rescan' : ''}`);
        else if (d) L.push(`   ⚠️ ${d} of ${n} fixed so far`);
        else if (clar) L.push('   ❓ Waiting on the client to confirm');
        else L.push('   ⏳ Still to fix');
      });
    } else L.push(since ? '*What was found* — nothing fixed in this period' : '*What was found* — no contact, name or critical problems ✅');
    if (smallFixed.length) {
      const by = {}; smallFixed.forEach((f) => { by[f.category || 'Other'] = (by[f.category || 'Other'] || 0) + 1; });
      L.push('');
      L.push(`*Smaller fixes* — ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ')}`);
    }
    if (falseAl.length) {
      L.push('');
      L.push(`*Checked and ruled out* — ${falseAl.length} item${falseAl.length === 1 ? '' : 's'} looked wrong but were confirmed correct for this client`);
    }
    if (smallOpen.length) {
      const by = {}; smallOpen.forEach((f) => { by[f.category || 'Other'] = (by[f.category || 'Other'] || 0) + 1; });
      L.push('');
      L.push(`*Still to do (minor)* — ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ')}`);
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function openSummary(s) {
    const ranges = [['', 'Whole audit', 0], ['1d', 'Last 24 hours', 86400000], ['7d', 'Last 7 days', 7 * 86400000]];
    modal(`<header><h2>Summary for the group chat</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <div class="small muted">What was checked, what was fixed and what is left, in plain words. Edit anything before copying.</div>
        <div class="two-up" style="margin-top:8px">
          <label class="field">Fixes from<select id="smRange">${ranges.map((r) => `<option value="${r[0]}">${r[1]}</option>`).join('')}</select></label>
          <label class="field">Pages listed per issue<select id="smMax"><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option><option value="999">All</option></select></label>
        </div>
        <textarea id="smText" rows="18" class="mono small" style="width:100%"></textarea>
      </div>
      <footer><span class="small faint" id="smNote"></span><span class="spacer"></span><button class="btn primary" id="smCopy">Copy</button></footer>`);
    const draw = () => {
      const r = ranges.find((x) => x[0] === $('#smRange').value) || ranges[0];
      $('#smText').value = auditSummary(s, { since: r[2], sinceLabel: r[1].replace(/^Last /, '').toLowerCase(), pages: Number($('#smMax').value) });
    };
    $('#smRange').onchange = draw; $('#smMax').onchange = draw; draw();
    $('#smCopy').onclick = async () => {
      try { await navigator.clipboard.writeText($('#smText').value); toast('Copied — paste it in the group chat'); }
      catch (e) { $('#smText').select(); document.execCommand('copy'); toast('Copied'); }
    };
  }

  // =====================================================================
  // GUIDE
  // =====================================================================
  // =====================================================================
  // ADMIN: GLOBAL ACTIVITY LOG
  // =====================================================================
  const GFILTERS = [{ v: '', label: 'Everything' }, { v: 'site-add', label: 'Websites added' }, { v: 'site-delete', label: 'Websites deleted' }, { v: 'accounts', label: 'Accounts & approvals' }];


  // ---------- Comments left in the Duda editor, across the whole account ----------
  /**
   * These arrive on their own from Duda — every website in the account, published or not, whether
   * or not it is on the Audits list. Most client comments land on a draft before a site is ever
   * published, which is why this is its own page rather than a tab on an audit.
   */
  const cmt = { sites: null, loading: false, error: '', q: '', filter: 'has', site: null, threads: null, tloading: false, showDone: false, tq: '' };
  let cmtLoading = null;
  function loadCommentSites(quiet) {
    // Anyone asking while a load is already running waits for THAT one, instead of getting a
    // promise that resolves before the list exists.
    if (cmtLoading) return cmtLoading;
    cmtLoading = loadCommentSitesNow(quiet).finally(() => { cmtLoading = null; });
    return cmtLoading;
  }
  async function loadCommentSitesNow(quiet) {
    cmt.loading = true; cmt.error = '';
    if (!quiet) renderComments();
    try { const r = await api('/api/comments?op=sites'); cmt.sites = r.sites || []; cmt.at = Date.now(); state.cmtVer = r.ver || '0'; }
    catch (e) { cmt.error = e.message; }
    finally { cmt.loading = false; if (route().name === 'comments') renderComments(); renderTop(); }
  }
  async function openCommentSite(id, flash) {
    // Already showing (or fetching) this website: leave it alone. A second call would re-read the
    // new-comment count after opening has already cleared it, and wipe the highlight.
    if (cmt.site === id && (cmt.threads || cmt.tloading)) return;
    cmt.flash = !!flash;
    cmt.site = id; cmt.threads = null; cmt.tloading = true; cmt.tq = ''; renderComments();
    try {
      const r = await api('/api/comments?op=threads&site=' + encodeURIComponent(id));
      cmt.threads = r.threads || [];
      // Which ones were new is settled here, once. Opening marks them read and the list refreshes
      // itself in the background, so recomputing later would always come back empty.
      cmt.flashIds = new Set(flash ? cmt.threads.filter((t) => t.unread).map((t) => t.uuid) : []);
    } catch (e) { cmt.threads = []; cmt.flashIds = new Set(); toast(e.message); }
    finally {
      cmt.tloading = false; renderComments();
      store2('/api/comments', { op: 'seen', site: id }).then(() => {
        const s = (cmt.sites || []).find((x) => x.id === id); if (s) s.unread = 0; renderComments(); renderTop();
      }).catch(() => {});
    }
  }
  const store2 = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  /** New comments arrived: update the list, and the open conversation if one is being read. */
  async function refreshComments() {
    if (cmt.loading) return;
    await loadCommentSites(true).catch(() => {});
    if (cmt.site && route().name === 'comments') {
      try { const r = await api('/api/comments?op=threads&site=' + encodeURIComponent(cmt.site)); cmt.threads = r.threads || []; renderComments(); }
      catch (e) { /* the list is already up to date */ }
    }
  }
  let cmtFlashTimer = null;
  // The dot in the top bar follows the same rule as the list: a note the team left itself is not a
  // reason to make the navigation shout.
  const cmtUnread = () => (cmt.sites || []).reduce((a, s) => a + (s.newClient !== undefined || s.newTeam !== undefined ? (s.newClient || 0) : (s.unread || 0)), 0);
  const cmtWaiting = () => (cmt.sites || []).reduce((a, s) => a + (s.waiting || 0), 0);


  /**
   * Switching the Duda connection on. Duda lets us subscribe through its own API with the
   * credentials the app already has, so this is a button rather than a support ticket.
   */
  /**
   * Who is one of us, taken from Slack.
   *
   * Deciding by email domain breaks the moment a teammate comments from a personal address, and it
   * is exactly those comments that then look like a client waiting for an answer. Slack already
   * knows the answer, so the workspace is read once and kept.
   */
  async function openSlackTeam() {
    modal(`<header><h2>Who is on the team</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body" id="stBody"><div class="empty small">Checking…</div></div>
      <footer><button class="btn" data-close>Close</button></footer>`, { wide: true });
    const draw = async (data) => {
      let d = data;
      if (!d) { try { d = await api('/api/comments?op=slack'); } catch (e) { $('#stBody').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; } }
      const r = d.roster;
      $('#stBody').innerHTML = `
        <div class="panel panel-pad" style="margin-bottom:12px">
          <h3 style="margin:0 0 4px">Ask Duda</h3>
          <div class="small muted">Duda knows exactly who is staff and who is a customer, and it is the best answer there is — but it has no way to list everyone, only to answer about one person at a time. So this asks about <b>every address that has ever left a comment</b>, which is the same thing arrived at from the other end.</div>
          <div id="dpOut" class="small" style="margin-top:8px"></div>
          <p style="margin:10px 0 0"><button class="btn primary" id="dpGo">Ask Duda about everyone who has commented</button></p>
        </div>
        ${!d.slack ? `<div class="note unk"><b>Slack isn't connected to this app yet.</b> Once it is, this reads the workspace and uses it to tell your team's comments from the client's.</div>`
        : `<div class="panel panel-pad" style="margin-bottom:12px">
            <h3 style="margin:0 0 4px">${r ? `✅ ${r.count} teammate${r.count === 1 ? '' : 's'} from Slack` : '○ Not read yet'}</h3>
            <div class="small muted">${r ? `Read by ${esc(r.byName || 'an admin')} ${esc(ago(r.at))}.` : 'Nobody has read the Slack workspace yet.'}
              A comment from anyone on this list counts as <b>one of us</b>, whatever address they wrote from${r && r.guests ? `. ${r.guests} Slack guest${r.guests === 1 ? '' : 's'} ${r.guests === 1 ? 'is' : 'are'} deliberately left as <b>${r.guests === 1 ? 'a client' : 'clients'}</b> — a client invited into a shared channel is a Slack member too` : ''}.</div>
            <p style="margin:10px 0 0"><button class="btn primary" id="stSync">${r ? 'Read Slack again' : 'Read the Slack workspace'}</button>
              ${r ? ' <button class="btn ghost danger" id="stForget">Forget it</button>' : ''}</p>
          </div>
          ${r && r.team.length ? `<details ${r.team.length > 12 ? '' : 'open'}><summary class="small">Counted as our team (${r.team.length})</summary>
            <ul class="allow-list small">${r.team.map((u) => `<li><b>${esc(u.name)}</b> <span class="faint">${esc(u.email)}</span></li>`).join('')}</ul></details>` : ''}
          ${r && r.guestList && r.guestList.length ? `<details><summary class="small">Slack guests, treated as clients (${r.guestList.length})</summary>
            <div class="small muted">Guests are usually the clients themselves. If one of these is really a teammate, use <b>not the client?</b> beside their comment instead.</div>
            <ul class="allow-list small">${r.guestList.map((u) => `<li><b>${esc(u.name)}</b> <span class="faint">${esc(u.email)}</span></li>`).join('')}</ul></details>` : ''}
          <p class="small faint" style="margin-top:10px">Anyone you've tagged by hand with <b>not the client?</b> keeps that, whatever Slack says.</p>`}`;
      const dp = $('#dpGo'); const out = $('#dpOut');
      if (dp) dp.onclick = async () => {
        dp.disabled = true;
        let from = 0; let guard = 0;
        try {
          for (;;) {
            const r = await post('/api/comments', { op: 'dudaPeople', from });
            if (r.done) {
              out.innerHTML = `<div class="note good"><b>${r.staff.length} designer${r.staff.length === 1 ? '' : 's'}</b> and <b>${r.customers.length} customer${r.customers.length === 1 ? '' : 's'}</b> out of ${r.total} ${r.total === 1 ? 'person' : 'people'} who have commented.
                ${r.pending ? `<br><span class="faint">${r.pending} still to ask about — click again to carry on, Duda is asked in batches.</span>` : ''}
                ${r.nobody.length ? `<br><span class="faint">${r.nobody.length} ${r.nobody.length === 1 ? 'address has' : 'addresses have'} no Duda account at all; those stay clients unless you say otherwise.</span>` : ''}</div>
                ${r.staff.length ? `<details open style="margin-top:8px"><summary>Duda staff — counted as our team (${r.staff.length})</summary><ul class="allow-list small">${r.staff.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
                ${r.customers.length ? `<details style="margin-top:6px"><summary>Duda customers — counted as clients (${r.customers.length})</summary><ul class="allow-list small">${r.customers.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}`;
              cmt.sites = null; loadCommentSites(false);
              break;
            }
            from = r.next;
            out.innerHTML = `<div class="small faint">Reading comments… ${r.scanned} of ${r.of} websites</div>`;
            if (++guard > 60) break;
          }
        } catch (e) { out.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
        dp.disabled = false; dp.textContent = 'Ask Duda again';
      };
      const sync = $('#stSync');
      if (sync) sync.onclick = async () => {
        sync.disabled = true; sync.textContent = 'Reading Slack…';
        try { const got = await post('/api/comments', { op: 'slackSync' }); toast(`${got.roster.count} teammate${got.roster.count === 1 ? '' : 's'} read from Slack`); await draw(got); cmt.sites = null; loadCommentSites(false); }
        catch (e) { toast(e.message); sync.disabled = false; sync.textContent = 'Try again'; }
      };
      const forget = $('#stForget');
      if (forget) forget.onclick = async () => {
        if (!confirm('Forget the Slack member list? Who counts as one of us goes back to email domains until you read it again.')) return;
        try { await post('/api/comments', { op: 'slackForget' }); await draw({ slack: true, roster: null }); cmt.sites = null; loadCommentSites(false); } catch (e) { toast(e.message); }
      };
    };
    draw();
  }

  async function openDudaConn() {
    modal(`<header><h2>Duda connection</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body" id="dcBody"><div class="empty small">Checking…</div></div>
      <footer><button class="btn" data-close>Close</button></footer>`);
    const draw = async () => {
      let s;
      try { s = await api('/api/dudahook?op=status'); }
      catch (e) { $('#dcBody').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
      const evList = (arr) => arr.map((e) => `<code>${esc(e)}</code>`).join(' ');
      $('#dcBody').innerHTML = `
        ${s.apiError ? `<div class="note bad">Could not ask Duda: ${esc(s.apiError)}</div>` : ''}
        <div class="panel panel-pad" style="margin-bottom:12px">
          <h3>${s.connected ? '✅ Connected' : '○ Not connected yet'}</h3>
          <p class="small muted" style="margin:4px 0 0">${s.connected
            ? 'Duda is sending events for every website in the account. Comments appear on this page by themselves.'
            : 'Once connected, Duda sends comments and publish events for every website in the account — nothing is switched on per website.'}</p>
          ${s.deliveries ? `<p class="small" style="margin:8px 0 0">Last delivery: <b>${esc(fmtFull(s.lastDelivery))}</b> <span class="faint">(${esc(ago(s.lastDelivery))})</span></p>` : '<p class="small faint" style="margin:8px 0 0">Nothing has arrived yet.</p>'}
          ${s.checked ? '<p class="small" style="margin:6px 0 0">Deliveries are signature-checked.</p>' : '<p class="small muted" style="margin:6px 0 0">Deliveries are accepted on the secret in the address. Signature checking is a Duda managed-account feature; it is optional.</p>'}
        </div>

        ${s.hooks.length ? `<div class="panel panel-pad" style="margin-bottom:12px"><h3>Our subscription${s.hooks.length > 1 ? 's' : ''}</h3>
          ${s.hooks.map((h) => `<div class="row-between" style="gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--border)">
            <div class="grow"><div><b>${h.scope === 'ACCOUNT' ? 'Whole account' : 'One website'}</b> · ${h.active ? '<span class="badge sev-ok">on</span>' : '<span class="badge sev-hold">paused</span>'}</div>
              <div class="small faint mono">${esc(h.endpoint)}</div>
              <div class="small muted" style="margin-top:4px">${evList(h.events)}</div></div>
            <div style="white-space:nowrap"><button class="btn sm" data-dcact="${esc(h.id)}" data-on="${h.active ? '0' : '1'}">${h.active ? 'Pause' : 'Resume'}</button>
              <button class="btn sm ghost danger" data-dcdel="${esc(h.id)}">Remove</button></div>
          </div>`).join('')}
          ${s.others ? `<p class="small faint" style="margin:8px 0 0">${s.others} other subscription(s) exist on this Duda account that were not made by this app. They are left alone.</p>` : ''}
        </div>` : ''}

        ${!s.connected ? `<div class="panel panel-pad" style="margin-bottom:12px"><h3>What it will subscribe to</h3>
          <p class="small muted" style="margin:4px 0 8px">For the whole account:</p>
          <div class="small">${evList(s.supported)}</div>
          ${s.unsupported.length ? `<p class="small faint" style="margin:8px 0 0">Not offered by this account, so left out: ${evList(s.unsupported)}</p>` : ''}
          <p style="margin:12px 0 0"><button class="btn primary" id="dcGo">Connect to Duda</button></p>
          <p class="small faint" style="margin:6px 0 0">Nothing to set up first — the app makes its own secret for the listening address.</p>
        </div>` : ''}

        ${s.secretShown && s.endpoint ? `<div class="panel panel-pad"><h3>The address Duda posts to</h3>
          <p class="small muted" style="margin:4px 0 6px">Only you can see this in full — it contains the secret that keeps everyone else out. Don't paste it anywhere public.</p>
          <div class="mono small" style="word-break:break-all;background:var(--panel-2);padding:8px 10px;border-radius:8px">${esc(s.endpoint)}</div>
          <p style="margin:8px 0 0"><button class="btn sm" id="dcCopy">Copy address</button></p></div>` : ''}

        <p class="small faint" style="margin-top:12px">Only comments made after connecting can appear. There is no way to fetch older ones.</p>`;

      const go = $('#dcGo'); if (go) go.onclick = async () => {
        go.disabled = true; go.textContent = 'Connecting…';
        try { const r = await store2('/api/dudahook', { op: 'connect' }); toast(`Connected — Duda will send ${r.events.length} kinds of event.`); draw(); }
        catch (e) { toast(e.message); go.disabled = false; go.textContent = 'Connect to Duda'; }
      };
      const cp = $('#dcCopy'); if (cp) cp.onclick = () => { navigator.clipboard.writeText(s.endpoint).then(() => toast('Address copied.')).catch(() => toast('Could not copy.')); };
      $$('[data-dcact]').forEach((btn) => (btn.onclick = async () => {
        btn.disabled = true;
        try { await store2('/api/dudahook', { op: 'active', id: btn.dataset.dcact, on: btn.dataset.on === '1' }); draw(); }
        catch (e) { toast(e.message); btn.disabled = false; }
      }));
      $$('[data-dcdel]').forEach((btn) => (btn.onclick = async () => {
        if (!confirm('Stop Duda sending events to this app? Comments already here are kept, but nothing new will arrive.')) return;
        btn.disabled = true;
        try { await store2('/api/dudahook', { op: 'remove', id: btn.dataset.dcdel }); toast('Disconnected.'); draw(); }
        catch (e) { toast(e.message); btn.disabled = false; }
      }));
    };
    draw();
  }

  /**
   * How long a client has actually been waiting, in whole days and hours.
   *
   * "2h ago" and "3 days ago" are the same word in the rest of the app, but here the difference is
   * the whole point: on Monday morning the question is who has been waiting longest, and a website
   * sitting on three days has to look worse than one sitting on three hours.
   */
  function waitAge(iso) {
    if (!iso) return '';
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    if (h < 1) return 'under an hour';
    if (h < 72) return `${h}h`;            // hours right up to three days: "31h" lands harder than "1 day"
    return `${Math.floor(h / 24)} days`;
  }
  /**
   * When the clock actually runs out on a client comment.
   *
   * Weekends don't count towards the 24 hours, so a Friday-evening comment is not overdue until
   * Monday — and "70h" on its own reads as three days of neglect. Saying "due in 2h" instead is the
   * difference between a number and an answer.
   */
  function dueIn(dueAt) {
    if (!dueAt) return '';
    const m = Math.round((new Date(dueAt).getTime() - Date.now()) / 60000);
    if (m <= 0) return 'due now';
    if (m < 90) return `due in ${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `due in ${h}h`;
    return `due ${new Date(dueAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
  }
  const dueTitle = (t) => `The client spoke last, so this is ours to answer. It came in ${fmtFull(t.since)} and counts as overdue ${fmtFull(t.dueAt)} — weekends don't count towards the 24 hours.`;

  const waitClass = (iso) => {
    const h = iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : 0;
    return h >= 72 ? 'wait-3' : h >= 48 ? 'wait-2' : 'sev-critical';
  };

  function renderComments() {
    if (!cmt.sites && !cmt.loading && !cmt.error) { loadCommentSites(true); }
    const q = cmt.q.trim().toLowerCase();
    let list = (cmt.sites || []).filter((s) => !q || [s.name, s.id, s.domain].some((v) => String(v || '').toLowerCase().includes(q)));
    // "New to you" means a CLIENT said something you haven't read. A note the team left itself is
    // not news you have to act on, and burying 128 of them in this number is what made it useless.
    if (cmt.filter === 'unread') list = list.filter((s) => s.newClient || (!s.newClient && !s.newTeam && s.unread));
    if (cmt.filter === 'waiting') list = list.filter((s) => s.waiting);
    if (cmt.filter === 'open') list = list.filter((s) => (s.openReal === undefined ? s.open : s.openReal));
    if (cmt.filter === 'notes') list = list.filter((s) => s.notes);
    // Duda tells us about publishes and new sites too, so most websites here have no comments at
    // all. They are only worth showing when somebody deliberately asks for everything.
    if (cmt.filter === 'has') list = list.filter((s) => s.total);
    const audited = new Map(state.sites.map((x) => [String(x.siteId || '').toLowerCase(), x]));
    const auditOf = (id) => audited.get(String(id || '').toLowerCase());
    const all = cmt.sites || [];
    const cur = cmt.site ? all.find((s) => s.id === cmt.site) : null;

    $('#view').innerHTML = `<div class="page-head"><div><h1>Duda comments</h1>
        <div class="muted">Comments left in the <b>Duda editor</b> — by clients on their draft, or by us. Every website in the account, published or not, on the Audits list or not. <a href="#/help/comments-duda">How this works</a></div></div>
        <div style="display:flex;gap:8px">${can('duda.team') ? '<button class="btn" id="cmtTeam" title="Who counts as one of us when a comment arrives">👥 Who is on the team</button><button class="btn" id="cmtConn">⚙ Duda connection</button>' : ''}
        <button class="btn" id="cmtRefresh" ${cmt.loading ? 'disabled' : ''}>${cmt.loading ? 'Loading…' : '↻ Refresh'}</button></div></div>
      ${cmt.error ? `<div class="note bad">${esc(cmt.error)}</div>` : ''}
      ${!all.length && !cmt.loading ? `<div class="panel panel-pad"><h2>Nothing has arrived yet</h2>
        <p class="muted">Comments appear here by themselves once Duda is sending them. Nothing needs to be switched on for each website.</p>
        <p class="small faint">Only comments made from the day this was switched on can appear — there is no way to fetch older ones.</p>
        ${can('duda.setup') ? '<p style="margin:10px 0 0"><button class="btn primary" id="cmtConn2">⚙ Set up the Duda connection</button></p>' : ''}</div>` : `
      ${(() => {
        // Monday morning: how bad is it, and who has been waiting longest. One line, before anything else.
        const w = all.filter((s) => s.waiting);
        if (!w.length) return '';
        const worst = w.slice().sort((a, b) => String(a.oldest).localeCompare(String(b.oldest)))[0];
        const days = worst.oldest ? Math.floor((Date.now() - new Date(worst.oldest).getTime()) / 86400000) : 0;
        const total = w.reduce((n, s) => n + s.waiting, 0);
        return `<div class="note ${days >= 2 ? 'bad' : 'unk'} cmt-triage">
          <b>${total} client comment${total === 1 ? '' : 's'} on ${w.length} website${w.length === 1 ? '' : 's'} ${total === 1 ? 'is' : 'are'} waiting for an answer.</b>
          Longest: <b>${esc(worst.name || worst.id)}</b>, ${esc(waitAge(worst.oldest))} — since ${esc(fmtFull(worst.oldest))}.
          <button class="linkbtn" data-cf="waiting">Work through them, oldest first ↓</button>
        </div>`;
      })()}
      <div class="cmt-wrap">
        <div class="panel cmt-sites">
          <div class="toolbar">
            <input type="search" id="cmtQ" placeholder="Search website or site ID…" value="${esc(cmt.q)}" style="flex:1;min-width:150px">
          </div>
          <div class="chips" style="padding:0 12px 10px">
            ${[
                ['unread', 'New to you', all.filter((s) => s.newClient || (!s.newClient && !s.newTeam && s.unread)).length, 'Websites with client comments you have not read'],
                ['waiting', 'Waiting on us', all.filter((s) => s.waiting).length, 'A client has been waiting longer than a working day'],
                ['open', 'Unresolved', all.filter((s) => (s.openReal === undefined ? s.open : s.openReal)).length, 'Unresolved conversations that a client is part of — notes the team left itself are counted separately'],
                ['notes', 'Team notes', all.filter((s) => s.notes).length, 'Conversations nobody on the client side has ever commented in. Duda leaves these unresolved because nobody resolves their own notes'],
                ['has', 'With comments', all.filter((s) => s.total).length, 'Every website that has any comment at all'],
                ['all', 'Every website', all.length, 'Every website in the Duda account'],
              ].map(([k, lbl, n, tip]) => `<button class="chipbtn ${cmt.filter === k ? 'active' : ''}" data-cf="${k}" title="${esc(tip)}">${lbl} <span class="faint">${n}</span></button>`).join('')}
          </div>
          ${list.length ? `<ul class="cmt-list">${list.map((s) => { const a = auditOf(s.id); return `
            <li><button class="cmt-site ${cmt.site === s.id ? 'active' : ''}" data-cs="${esc(s.id)}">
              <span class="grow">
                <b>${esc(s.name || s.id)}</b>
                <span class="small muted mono">${esc(s.id)}</span>
                <span class="small faint">${a ? 'In Audits' : s.published ? 'Published · not in Audits' : 'Draft · not in Audits'}${s.last ? ' · ' + esc(ago(s.last)) : ''}</span>
              </span>
              <span class="cmt-counts">
                ${s.waiting ? `<span class="badge ${waitClass(s.oldest)}" title="Longest unanswered client comment: ${esc(fmtFull(s.oldest))}">${s.waiting} waiting · ${esc(waitAge(s.oldest))}</span>` : ''}
                ${newChips(s).length ? newChips(s).join(' ') : (s.openReal === undefined ? s.open : s.openReal) ? `<span class="small muted">${s.openReal === undefined ? s.open : s.openReal} open</span>` : s.notes ? `<span class="small faint" title="Conversations nobody on the client side has commented in">${s.notes} team note${s.notes === 1 ? '' : 's'}</span>` : s.total ? `<span class="small faint">${s.total} resolved</span>` : '<span class="small faint">no comments</span>'}
              </span>
            </button></li>`; }).join('')}</ul>` : `<div class="empty small">${cmt.loading ? 'Loading…' : 'Nothing matches.'}</div>`}
          <div class="small faint" style="padding:10px 12px;border-top:1px solid var(--border)">Counted from the day this was switched on.</div>
        </div>

        <div class="panel cmt-thread">
          ${!cur ? '<div class="empty small">Pick a website on the left.</div>' : `
            <div class="toolbar">
              <div class="grow"><b>${esc(cur.name || cur.id)}</b>
                <div class="small muted">${auditOf(cur.id) ? 'On the Audits list' : cur.published ? 'Published, not on the Audits list' : 'Draft, not published yet'} · ${cur.total || 0} conversation(s)</div></div>
              <a class="btn sm ghost" href="https://${esc(linkHost(null))}/home/site/${esc(cur.id)}/home" target="_blank" rel="noopener">Open in Duda editor ↗</a>
              ${auditOf(cur.id) ? `<a class="btn sm" href="#/site/${esc(auditOf(cur.id).id)}">Open audit</a>` : `<button class="btn sm primary" data-cadd="${esc(cur.id)}">Add to Audits</button>`}
            </div>
            ${(() => {
              if (cmt.tloading) return '<div class="empty small">Loading…</div>';
              const all = cmt.threads || [];
              if (!all.length) return `<div class="empty small">No comments on this website yet.<br><span class="faint">It's listed because Duda told us about something else here — a publish, or the site being created.</span></div>`;
              const tq = cmt.tq.trim().toLowerCase();
              const done = all.filter((t) => t.status === 'resolved').length;
              let list = cmt.showDone ? all : all.filter((t) => t.status !== 'resolved');
              if (tq) list = list.filter((t) => t.comments.some((c) => String(c.text || '').toLowerCase().includes(tq) || String(c.by || '').toLowerCase().includes(tq)));
              // What was new when this website was opened. The server tells us on that first read,
              // before opening marks it all as seen.
              const newest = cmt.flash ? (cmt.flashIds || new Set()) : new Set();
              const fresh = newest.size;
              return `
              ${fresh ? `<div class="cmt-newbar">${fresh} new ${fresh === 1 ? 'conversation' : 'conversations'} since you last looked</div>` : ''}
              <div class="toolbar" style="border-bottom:1px solid var(--border)">
                <input type="search" id="cmtTQ" placeholder="Search inside these comments…" value="${esc(cmt.tq)}" style="flex:1;min-width:180px">
                <label class="small muted" style="display:flex;align-items:center;gap:6px;white-space:nowrap"><input type="checkbox" id="cmtDone" ${cmt.showDone ? 'checked' : ''}> Show resolved (${done})</label>
              </div>
              ${!list.length ? `<div class="empty small">${tq ? 'Nothing matches that.' : `Nothing open — all ${done} conversation(s) are resolved.`}</div>` : `
              <ul class="cmt-threads">${list.map((t) => {
                const open = t.comments[0];
                const replies = t.comments.slice(1);
                const who = (c) => `<div class="cmt-by"><b>${esc(c.by || 'Someone')}</b> <span class="badge ${c.side === 'client' ? 'sev-info' : 'sev-hold'}">${c.side}</span> <span class="small faint">${esc(fmtFull(c.at))}</span>${can('duda.team') && c.by ? ` <button class="linkbtn" data-cwho="${esc(c.by)}" data-cas="${c.side === 'client' ? 'team' : 'client'}" title="Correct who this person is">not ${esc(c.side)}?</button>` : ''}</div>`;
                const body = (c) => `<div class="cmt-text">${esc(c.text)}</div>`;
                return `
                <li class="cmt-card ${t.waiting ? 'waiting' : ''} ${t.status === 'resolved' ? 'done' : ''} ${newest.has(t.uuid) ? 'isnew' : ''}">
                  <div class="cmt-head">
                    ${t.num ? `<span class="badge subtle mono">#${t.num}</span>` : ''}
                    <span class="small muted">${t.page ? esc(t.page) : 'Page unknown'}${t.device ? ' · ' + esc(String(t.device).toLowerCase().replace(/^./, (c) => c.toUpperCase())) : ''}</span>
                    <span class="spacer"></span>
                    ${t.waiting ? `<span class="badge ${waitClass(t.since)}" title="No reply since ${esc(fmtFull(t.since))}">waiting on us · ${esc(waitAge(t.since))}</span>`
                      : t.since ? `<span class="badge subtle" title="${esc(dueTitle(t))}">ours to answer · ${esc(dueIn(t.dueAt))}</span>` : ''}
                    <span class="badge ${t.status === 'resolved' ? 'sev-ok' : t.note ? 'subtle' : 'sev-warning'}" ${t.note && t.status !== 'resolved' ? 'title="Nobody on the client side has commented here, so this is a note the team left itself. Duda leaves those unresolved because nobody resolves their own notes."' : ''}>${t.status === 'resolved' ? 'resolved' : t.note ? 'team note' : 'unresolved'}</span>
                  </div>
                  ${t.partial ? '<div class="cmt-partial small">This conversation started before comments were connected, so only what was said since then is here. Open it in the Duda editor to read the whole thread.</div>' : ''}
                  ${open ? `<div class="cmt-msg cmt-open">${who(open)}${body(open)}</div>` : ''}
                  ${replies.length ? `<div class="cmt-replies"><div class="small faint cmt-rcount">${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</div>${replies.map((c) => `<div class="cmt-msg">${who(c)}${body(c)}</div>`).join('')}</div>` : ''}
                </li>`;
              }).join('')}</ul>`}
            <div class="note" style="margin:12px">Reading only — replying and resolving still happen in the Duda editor. When someone resolves one there, it turns green here.</div>`;
            })()}
          `}
        </div>
      </div>`}`;

    const r = $('#cmtRefresh'); if (r) r.onclick = () => loadCommentSites(false);
    const ct = $('#cmtTeam'); if (ct) ct.onclick = openSlackTeam;
    const cc = $('#cmtConn'); if (cc) cc.onclick = openDudaConn;
    const cc2 = $('#cmtConn2'); if (cc2) cc2.onclick = openDudaConn;
    const qi = $('#cmtQ'); if (qi) qi.oninput = () => { const at = qi.selectionStart; cmt.q = qi.value; renderComments(); const n = $('#cmtQ'); if (n) { n.focus(); n.setSelectionRange(at, at); } };
    $$('[data-cf]').forEach((b) => (b.onclick = () => { cmt.filter = b.dataset.cf; renderComments(); }));
    $$('[data-cs]').forEach((b) => (b.onclick = () => { history.replaceState(null, '', '#/comments/' + encodeURIComponent(b.dataset.cs)); openCommentSite(b.dataset.cs); }));
    $$('[data-cadd]').forEach((b) => (b.onclick = () => openAdd(b.dataset.cadd)));
    // The website you arrived for should be visible in the list, not scrolled off somewhere.
    const sel = $('.cmt-site.active');
    if (sel && sel.scrollIntoView) { try { sel.scrollIntoView({ block: 'nearest' }); } catch (e) { sel.scrollIntoView(); } }
    // The pulse on new conversations is a pointer, not a state: it runs once and stops.
    // Only once the conversations are actually on screen — the "Loading…" pass has no cards yet,
    // and clearing the flag there would throw the highlight away before it ever showed.
    if (cmt.flash && !cmt.tloading && cmt.threads) {
      const n = $$('.cmt-card.isnew').length;
      if (n) {
        const first = $('.cmt-card.isnew');
        if (first && first.scrollIntoView) { try { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* older browsers */ } }
        clearTimeout(cmtFlashTimer);
        cmtFlashTimer = setTimeout(() => { cmt.flash = false; cmt.flashIds = new Set(); $$('.cmt-card.isnew').forEach((el) => el.classList.remove('isnew')); const bar = $('.cmt-newbar'); if (bar) bar.remove(); }, 4200);
      } else cmt.flash = false;
    }
    const tq = $('#cmtTQ'); if (tq) tq.oninput = () => { const at = tq.selectionStart; cmt.tq = tq.value; renderComments(); const n = $('#cmtTQ'); if (n) { n.focus(); n.setSelectionRange(at, at); } };
    const dn = $('#cmtDone'); if (dn) dn.onchange = () => { cmt.showDone = dn.checked; renderComments(); };
    $$('[data-cwho]').forEach((b) => (b.onclick = async () => {
      try { await store2('/api/comments', { op: 'who', email: b.dataset.cwho, as: b.dataset.cas }); toast(`${b.dataset.cwho} is now treated as ${b.dataset.cas}.`); openCommentSite(cmt.site); }
      catch (e) { toast(e.message); }
    }));
  }

  // ---------- Removed from Audits: what was taken off the list, by whom and why ----------
  /**
   * Deleting an audit used to leave a hole: months later nobody could say what the
   * website was or why it went. This keeps the card — site ID, name, counts, reason —
   * so it can be looked up, and audited again in one click if the site comes back.
   */
  async function renderRemoved() {
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    let rows = [];
    try { rows = (await api('/api/store?op=removed')).rows || []; } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    let q = '';
    const draw = () => {
      const term = q.trim().toLowerCase();
      const list = !term ? rows : rows.filter((r) => [r.businessName, r.siteId, r.domain, r.reason, r.removedByName, r.addedByName].some((x) => String(x || '').toLowerCase().includes(term)));
      $('#view').innerHTML = `<div class="page-head"><div><h1>Removed from Audits</h1>
          <div class="muted">Audits taken off the <a href="#/">Audits</a> list, with the reason. The websites themselves are untouched in Duda — see them on <a href="#/live">Live DR Sites</a>.</div></div></div>
        <div class="panel"><div class="toolbar"><input id="rmQ" type="search" placeholder="Search name, site ID, reason or person…" value="${esc(q)}" style="flex:1;min-width:220px">
          <span class="spacer"></span><span class="small muted">${list.length} of ${rows.length}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Website</th><th>Audit at the time</th><th>Removed</th><th>Reason</th><th></th></tr></thead><tbody>${list.map((r) => `
          <tr>
            <td><div><b>${esc(r.businessName || r.siteId)}</b></div>
              <div class="small mono faint">${esc(r.siteId)}</div>
              ${r.domain ? `<div class="small faint">${esc(r.domain)}</div>` : ''}</td>
            <td class="small"><div>${r.cleared || 0}/${r.findings || 0} item(s) closed${r.comments ? ` · ${r.comments} comment(s)` : ''}</div>
              <div class="faint">${esc(r.status || 'Not started')}${r.assigneeName ? ` · ${esc(r.assigneeName)}` : ''}</div>
              ${r.addedByName ? `<div class="faint">added by ${esc(r.addedByName)}</div>` : ''}</td>
            <td style="white-space:nowrap"><div class="small">${esc(fmtFull(r.removedAt))}</div>
              <div class="small faint">${esc(ago(r.removedAt))}</div>
              <span class="member-select">${avatar(r.removedBy, 22)}<span class="small">${esc(r.removedByName || nameOf(r.removedBy))}</span></span></td>
            <td class="small">${r.reason ? esc(r.reason) : '<span class="faint">No reason given</span>'}</td>
            <td data-stop style="white-space:nowrap"><button class="btn sm" data-again="${esc(r.siteId)}" title="Add this site ID back to the Audits list and scan it again">Audit again</button></td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${rows.length ? 'Nothing matches that search.' : 'Nothing has been removed from the Audits list.'}</div>`}</div>
        <p class="small faint" style="margin-top:10px">The audit itself (items, comments and activity log) is not kept — “Audit again” starts a fresh scan.</p>`;
      const qi = $('#rmQ'); if (qi) qi.oninput = () => { q = qi.value; const at = qi.selectionStart; draw(); const n = $('#rmQ'); if (n) { n.focus(); n.setSelectionRange(at, at); } };
      $$('[data-again]').forEach((b) => (b.onclick = () => {
        const has = state.sites.find((x) => x.siteId === b.dataset.again);
        if (has) { location.hash = '#/site/' + has.id; return; }
        openAdd(b.dataset.again);
      }));
    };
    draw();
  }

  async function renderGlobalActivity() {
    if (!can('activity.view')) { $('#view').innerHTML = '<div class="empty">Your role does not allow seeing the activity log.</div>'; return; }
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    let items = [];
    try { items = (await api('/api/store?op=gactivity')).items; } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const draw = () => {
      const f = state.gfilter;
      const list = items.filter((e) => !f || (f === 'accounts' ? ['signup', 'approve', 'reject', 'remove', 'role', 'reset'].includes(e.type) : e.type === f));
      $('#view').innerHTML = `<div class="page-head"><div><h1>Activity log</h1><div class="muted">Admin only. Who added or removed audits, and account changes, with date and time. <a href="#/removed">Removed from Audits</a> shows the reasons.</div></div><button class="btn" id="dbOpt" title="Compresses older website records, trims long logs and removes the old AI cache format. Safe to run any time.">🧹 Optimize database</button></div>
        <div class="panel"><div class="toolbar"><span class="chips">${GFILTERS.map((x) => `<button class="chipbtn ${f === x.v ? 'active' : ''}" data-gf="${x.v}">${x.label}</button>`).join('')}</span><span class="spacer"></span><span class="small muted">${list.length} entries</span></div>
        ${list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Date &amp; time</th><th>Who</th><th>What happened</th></tr></thead><tbody>${list.map((e) => {
          const site = e.siteId && state.sites.find((x) => x.id === e.siteId);
          return `<tr><td style="white-space:nowrap"><div>${esc(fmtFull(e.at))}</div><div class="small faint">${esc(ago(e.at))}</div></td>
            <td><span class="member-select">${avatar(e.by, 24)}<b>${esc(e.byName || nameOf(e.by))}</b></span></td>
            <td><span class="a-ic">${ACT_ICON[e.type] || '•'}</span> ${esc(e.text)}${site ? ` · <a href="#/site/${esc(site.id)}">${esc(site.businessName || site.siteId)}</a>` : ''}${e.type === 'site-delete' && e.addedByName ? ` <span class="small faint">(originally added by ${esc(e.addedByName)})</span>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">Nothing here yet.</div>'}</div>`;
      $$('[data-gf]').forEach((b) => (b.onclick = () => { state.gfilter = b.dataset.gf; draw(); }));
      $('#dbOpt').onclick = async () => {
        const btn = $('#dbOpt'); btn.disabled = true; btn.textContent = 'Optimizing…';
        try {
          const r = await store({ op: 'maintenance' });
          const kb = (n) => (n / 1024).toFixed(0) + ' KB';
          toast(`Done: ${r.sitesCompressed} website records compressed (${kb(r.bytesBefore)} → ${kb(r.bytesAfter)}), ${r.oldKeysRemoved} old cache entries removed${r.totalKeys ? `, ${r.totalKeys} keys in total` : ''}.`);
          await loadSites(); items = (await api('/api/store?op=gactivity')).items; draw();
        } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '🧹 Optimize database'; }
      };
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
  // ---------- False alarms (admin only): audit items the team marked as wrong, to improve the checks ----------
  // A false alarm is a bug report against a check, so the statuses say what happened to the CHECK.
  const FA = [
    { v: 'new', label: 'New', hint: 'Nobody has looked at this yet' },
    { v: 'checking', label: 'Checking', hint: 'Being investigated right now' },
    { v: 'adjusted', label: 'Audit Adjusted', hint: 'The check was wrong and has been fixed — every website scanned before now is flagged for a rescan' },
    { v: 'true', label: 'True False Alarm', hint: 'The check was right to look, but this website is a legitimate exception. The check stays as it is' },
    { v: 'wont', label: "Won't change", hint: 'Noted, and deliberately leaving the check alone' },
    { v: 'notfa', label: 'Not a false alarm', hint: 'The check was right and this is real work — the audit item goes back to Open' },
  ];
  const FAL = Object.fromEntries(FA.map((x) => [x.v, x.label]));
  // Records written before these statuses existed are read through this, so nothing had to be migrated.
  const FA_OLD = { ongoing: 'checking', done: 'adjusted', skip: 'wont' };
  const faSt = (v) => { const x = FA_OLD[v] || v; return FAL[x] ? x : 'new'; };
  const faOpen = (i) => ['new', 'checking'].includes(faSt(i.status));
  // The admins want the untriaged ones; the person who reported them wants all of theirs, and
  // especially the ones that have been answered.
  const fa = { filter: '', code: '', q: '' };
  async function renderFalseAlarms() {
    $('#view').innerHTML = sugTabs('fa', state.faNew) + '<div class="empty">Loading…</div>';
    let items = [];
    try { items = (await api('/api/store?op=falseAlarms')).items || []; } catch (e) { $('#view').innerHTML = sugTabs('fa') + `<div class="empty">${esc(e.message)}</div>`; return; }
    items.forEach((i) => { i.status = faSt(i.status); });
    const mine = !can('fa.seeall');
    if (!fa.filter) fa.filter = mine ? 'all' : 'open';
    // Arriving from a notification: find the one report it is about. The key is normally the
    // record's own key; older notifications carry "<siteId>#<item number>" instead.
    const want = route().key || '';
    let target = '';
    if (want) {
      const hash = want.indexOf('#');
      const found = hash > 0
        ? items.find((i) => i.siteId === want.slice(0, hash) && String(i.num) === want.slice(hash + 1))
        : items.find((i) => i.key === want);
      if (found) {
        target = found.key;
        // A filter that hides the report you were sent to is worse than no filter at all.
        const visible = fa.filter === 'all' || (fa.filter === 'open' ? faOpen(found) : fa.filter === found.status);
        if (!visible) fa.filter = 'all';
        if (fa.code && fa.code !== found.code) fa.code = '';
        if (fa.q) fa.q = '';
      } else {
        toast('That false alarm is no longer in the list');
      }
    }
    state.faNew = can('fa.manage') ? items.filter((i) => i.status === 'new' && i.active !== false).length : 0;
    const draw = () => {
      const count = (v) => items.filter((i) => i.status === v).length;
      const openItems = items.filter(faOpen);
      const byCode = {}; openItems.forEach((i) => { byCode[i.code] = (byCode[i.code] || 0) + 1; });
      const codes = Object.keys(byCode).sort((a, b) => byCode[b] - byCode[a]);
      const q = fa.q.trim().toLowerCase();
      const list = items.filter((i) => (fa.filter === 'all' || (fa.filter === 'open' ? faOpen(i) : i.status === fa.filter))
        && (!fa.code || i.code === fa.code) && (!q || [i.siteName, i.siteRef, i.message, i.found, i.reason, i.code].some((v) => String(v || '').toLowerCase().includes(q))));
      $('#view').innerHTML = sugTabs('fa', state.faNew) + `<div class="page-head"><div><h1>${mine ? 'My false alarm reports' : 'False alarms'}</h1>
          <div class="muted">${mine
            ? 'Audit items you marked <b>False alarm</b>, and what the admins decided about each one. You\u2019ll be told when one moves \u2014 and you can answer back on any of them.'
            : 'Audit items the team marked <b>False alarm</b>. Each one is a bug report against a check: work out whether the check was wrong, say so in the note, and the person who reported it is told. <b>Audit Adjusted</b> flags every website scanned before now for a rescan.'}</div></div>
          ${mine ? '' : '<button class="btn" id="faCopy" title="Copies the open false alarms as plain text, ready to paste to whoever updates the app">\u{1F4CB} Copy open items as text</button>'}</div>
        ${codes.length ? `<div class="panel panel-pad" style="margin-bottom:12px"><div class="k">Most reported checks (open)</div><div class="chips" style="margin-top:6px">${codes.slice(0, 12).map((c) => `<button class="chipbtn ${fa.code === c ? 'active' : ''}" data-facode="${esc(c)}"><span class="mono">${esc(c)}</span> <span class="faint">${byCode[c]}</span></button>`).join('')}${fa.code ? '<button class="chipbtn" data-facode="">Clear</button>' : ''}</div></div>` : ''}
        <div class="panel"><div class="toolbar"><span class="chips">
          <button class="chipbtn ${fa.filter === 'open' ? 'active' : ''}" data-faf="open">New + Checking ${count('new') + count('checking')}</button>
          ${FA.map((x) => `<button class="chipbtn ${fa.filter === x.v ? 'active' : ''}" data-faf="${x.v}" title="${esc(x.hint)}">${x.label} ${count(x.v)}</button>`).join('')}
          <button class="chipbtn ${fa.filter === 'all' ? 'active' : ''}" data-faf="all">All ${items.length}</button></span>
          <input type="search" id="faQ" placeholder="Search website, finding or reason…" value="${esc(fa.q)}" style="flex:1;min-width:200px"></div>
        <div class="sg-list">${list.length ? list.map((i) => `<div class="sg-card fa-card" id="fa-${esc(i.key)}">
          <div class="row-between" style="align-items:flex-start"><div class="grow">
            <div class="small"><span class="badge sev-${esc(i.severity || 'info')}">${esc(i.severity || '')}</span> <span class="mono faint">${esc(i.code || '')}</span> · ${esc(i.category || '')}</div>
            <div class="sg-title" style="margin-top:4px">${esc(i.message || '')}</div>
            <div class="small muted"><b>${esc(i.siteName || i.siteRef)}</b> · #${esc(String(i.num || ''))} · <span class="mono">${esc(i.path || '')}</span>${i.location ? ' · ' + esc(i.location) : ''}</div></div>
            ${mine ? `<span class="pill fa-${esc(i.status)}" title="${esc((FA.find((x) => x.v === i.status) || {}).hint || '')}">${esc(FAL[i.status] || i.status)}</span>`
              : `<select class="pill fa-${esc(i.status)}" data-fast="${esc(i.key)}">${FA.map((x) => `<option value="${x.v}" ${x.v === i.status ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`}</div>
          ${i.found ? `<div class="kv" style="margin-top:8px"><b>Found:</b> ${esc(i.found)}</div>` : ''}${i.expected ? `<div class="kv"><b>Expected:</b> ${esc(i.expected)}</div>` : ''}
          ${i.ai ? `<div class="small muted">✨ AI said: ${esc(AI_LABEL[i.ai.verdict] || i.ai.verdict)}${i.ai.reason ? ' · ' + esc(i.ai.reason) : ''}</div>` : ''}
          ${i.reason ? `<div class="fa-reason">“${esc(i.reason)}”</div>` : ''}
          ${i.verdict ? `<div class="fa-verdict"><b>${esc(FAL[i.verdict.status] || i.verdict.status)}</b> — ${esc(i.verdict.note)} <span class="faint small">\u2014 ${esc(i.verdict.by)}, ${esc(ago(i.verdict.at))}</span></div>` : ''}
          <div class="small faint" style="margin-top:6px">Marked False alarm by ${esc(i.markedByName || '')} · ${esc(fmtFull(i.markedAt))}${i.active === false ? ` · <span class="badge">Changed back by ${esc(i.unmarkedBy || '')}</span>` : ''}${(i.history || []).length ? ` · last update: ${esc(i.history[i.history.length - 1].by)} \u2192 ${esc(FAL[faSt(i.history[i.history.length - 1].to)] || '')}` : ''}</div>
          ${(i.history || []).length ? `<details class="small" style="margin-top:4px"><summary class="muted">History (${i.history.length})</summary>${i.history.map((h) => `<div class="small faint">${esc(fmtFull(h.at))} \u00b7 ${esc(h.by)}: ${esc(FAL[faSt(h.from)] || h.from)} \u2192 <b>${esc(FAL[faSt(h.to)] || h.to)}</b>${h.note ? ` \u2014 ${esc(h.note)}` : ''}</div>`).join('')}</details>` : ''}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><a class="btn sm primary" href="#/site/${encodeURIComponent(i.siteId)}/item/${esc(String(i.num || ''))}">Open audit item \u2197</a>${mine ? '' : `<button class="btn sm ghost" data-fadel="${esc(i.key)}" title="Remove from this list">Remove</button>`}</div>
          <details class="sg-disc" ${(i.comments || []).length ? 'open' : ''}><summary class="small">Notes (${(i.comments || []).length})</summary>
            <div class="c-list">${(i.comments || []).map((c) => `<div class="comment"><div class="c-head">${avatar(c.by, 22)} <b>${esc(c.byName)}</b> <span class="small faint">${esc(fmtFull(c.at))}</span></div><div class="c-body">${esc(c.text)}</div></div>`).join('')}</div>
            <div class="fa-add"><textarea rows="2" placeholder="${mine ? 'Answer back \u2014 the admins are told' : 'e.g. Fixed: brand logos in a logo row are no longer flagged'}" data-fatext="${esc(i.key)}"></textarea><button class="btn sm" data-facmt="${esc(i.key)}">${mine ? 'Reply' : 'Add note'}</button></div></details>
        </div>`).join('') : `<div class="empty">${items.length ? 'Nothing with this filter.' : (mine ? 'You haven\u2019t reported any false alarms. When you mark an audit item as False alarm, it shows up here with what the admins decided.' : 'No false alarms yet. When someone marks an audit item as False alarm, it shows up here.')}</div>`}</div></div>`;
      $$('[data-faf]').forEach((b) => (b.onclick = () => { fa.filter = b.dataset.faf; draw(); }));
      if ($('#faCopy')) $('#faCopy').onclick = () => {
        const open = items.filter(faOpen);
        if (!open.length) return toast('No open false alarms');
        const txt = `False alarms to fix (${open.length}), exported ${new Date().toLocaleString()}\n\n` + open.map((i, k) => [
          `${k + 1}. [${i.code}] ${i.message}`, `   Website: ${i.siteName} (${i.siteRef}) · item #${i.num} · page ${i.path} · ${i.location || ''}`,
          i.found ? `   Found: ${i.found}` : '', i.expected ? `   Expected: ${i.expected}` : '', i.selector ? `   Selector: ${i.selector}` : '',
          i.ai ? `   AI verdict: ${i.ai.verdict}${i.ai.reason ? ' (' + i.ai.reason + ')' : ''}` : '', i.reason ? `   Why it's wrong: ${i.reason}` : '',
          ...(i.comments || []).map((c) => `   Note (${c.byName}): ${c.text}`)].filter(Boolean).join('\n')).join('\n\n');
        copy(txt, `Copied ${open.length} false alarm(s)`);
      };
      $$('[data-facode]').forEach((b) => (b.onclick = () => { fa.code = b.dataset.facode; draw(); }));
      const qi = $('#faQ'); qi.oninput = (e) => { fa.q = e.target.value; const pos = e.target.selectionStart; draw(); const n = $('#faQ'); n.focus(); n.setSelectionRange(pos, pos); };
      // A verdict with no reason is the thing this whole feature exists to stop: the person who
      // reported it hears "True False Alarm" and learns nothing. So the note is asked for here, and
      // it goes to them, onto the audit item, and into the history.
      $$('[data-fast]').forEach((sel) => (sel.onchange = async () => {
        const key = sel.dataset.fast; const status = sel.value;
        const rec0 = items.find((x) => x.key === key) || {};
        const was = rec0.status;
        const meta = FA.find((x) => x.v === status) || {};
        const save = async (note) => {
          try {
            const rec = await store({ op: 'faUpdate', key, status, note });
            rec.status = faSt(rec.status);
            Object.assign(items.find((x) => x.key === rec.key), rec);
            state.faNew = items.filter((x) => x.status === 'new' && x.active !== false).length;
            // Audit Adjusted changes what every OTHER website should be saying about itself, so the
            // list is reloaded now rather than on the next poll — the person who just did it is
            // usually the one about to go and look.
            if (status === 'adjusted') { state.sitesVer = ''; await loadSites().catch(() => {}); }
            // Reopening changes the audit itself, so its counts are stale from this moment.
            if (status === 'notfa') { state.sitesVer = ''; await loadSites().catch(() => {}); }
            toast(status === 'notfa' ? `#${rec0.num} is Open again — ${rec0.markedByName || 'the reporter'} has been told why` : `${FAL[status]} — ${rec0.markedByName || 'the reporter'} has been told`);
            draw();
          } catch (e) { toast(e.message); sel.value = was; }
        };
        if (status === 'new') return save('');
        modal(`<header><h2>${esc(FAL[status])}</h2><button class="btn ghost" data-close>✕</button></header>
          <div class="body">
            <div class="small muted" style="margin-bottom:8px">${esc(meta.hint || '')}</div>
            <div class="small" style="margin-bottom:10px"><b>${esc(rec0.siteName || '')}</b> · #${esc(String(rec0.num || ''))} · <span class="mono faint">${esc(rec0.code || '')}</span><div class="small muted">${esc(rec0.message || '')}</div></div>
            <div class="k">What should ${esc(rec0.markedByName || 'the reporter')} know?</div>
            <textarea id="faVerdict" rows="3" placeholder="${status === 'adjusted' ? 'e.g. The check was matching the wrong phone field. Fixed — rescan and it goes.'
              : status === 'true' ? 'e.g. You were right, it isn\u2019t a problem. The check stays as it is because it catches real ones elsewhere.'
              : status === 'notfa' ? 'e.g. The link really does go to youtube.com with no channel on the end \u2014 this one needs fixing on the website.'
              : status === 'checking' ? 'e.g. Looking at this now \u2014 what made you think the check was wrong?'
              : 'e.g. Leaving this one \u2014 changing the check would hide genuine issues.'}"></textarea>
            ${status === 'adjusted' ? `<div class="note fixed-checks" style="margin-top:10px"><div class="small">Every website scanned before now that carries <span class="mono">${esc(rec0.code || '')}</span> items will show <b>\u26a0 A check was corrected \u2014 rescan</b>, and those items will be marked. Nothing is deleted.</div></div>` : ''}
            ${status === 'notfa' ? `<div class="note fixed-checks" style="margin-top:10px"><div class="small">Audit item <b>#${esc(String(rec0.num || ''))}</b> goes back to <b>Open</b> on ${esc(rec0.siteName || 'that website')}, and ${esc((rec0.markedByName || 'they').split(' ')[0])} is told why. Your note is written on the item, so nobody re-closes it for the same reason.</div></div>` : ''}
          </div>
          <footer><button class="btn" data-close>Cancel</button><span class="spacer"></span><button class="btn primary" id="faVerdictGo">Save and tell ${esc((rec0.markedByName || 'them').split(' ')[0])}</button></footer>`);
        $$('[data-close]', $('.modal')).forEach((b) => b.addEventListener('click', () => { sel.value = was; }));
        setTimeout(() => { const t = $('#faVerdict'); if (t) t.focus(); }, 50);
        $('#faVerdictGo').onclick = async () => {
          const note = $('#faVerdict').value.trim();
          if (!note) return toast('Write what they should know');
          closeModal(); await save(note);
        };
      }));
      $$('[data-facmt]').forEach((b) => (b.onclick = async () => {
        const ta = $(`[data-fatext="${CSS.escape(b.dataset.facmt)}"]`); const text = ta.value.trim(); if (!text) return;
        try { const rec = await store({ op: 'faComment', key: b.dataset.facmt, text }); Object.assign(items.find((x) => x.key === rec.key), rec); draw(); } catch (e) { toast(e.message); }
      }));
      $$('[data-fadel]').forEach((b) => (b.onclick = async () => {
        if (!confirm('Remove this from the False alarms list? (The audit item itself is not changed.)')) return;
        try { await store({ op: 'faDelete', key: b.dataset.fadel }); items = items.filter((x) => x.key !== b.dataset.fadel); draw(); } catch (e) { toast(e.message); }
      }));
      if (target) {
        const card = $(`#fa-${CSS.escape(target)}`);
        if (card) {
          card.classList.add('fa-target');
          card.scrollIntoView({ block: 'center', behavior: 'smooth' });
          const d = $('details.sg-disc', card); if (d) d.open = true;
        }
        // Once only: changing a filter afterwards should not yank the page back.
        target = '';
      }
    };
    draw();
  }
  // Everyone gets the two tabs now: admins triage every false alarm, everyone else follows their own.
  const sugTabs = (active, faNew) => `<div class="tabs" style="margin-bottom:14px"><a href="#/suggestions" class="${active === 'ideas' ? 'on' : ''}">${can('fa.manage') ? 'Feature suggestions' : 'My suggestions'}</a><a href="#/suggestions/false-alarms" class="${active === 'fa' ? 'on' : ''}">${can('fa.manage') ? 'False alarms' : 'My false alarms'}${faNew ? ` <span class="badge sev-warning">${faNew} new</span>` : ''}</a></div>`;
  async function renderSuggestions() {
    if (route().tab === 'fa') return renderFalseAlarms();
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    let data;
    try { data = await api('/api/suggest'); } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const owner = data.owner;
    const counts = Object.fromEntries(SUG.map((x) => [x.v, data.items.filter((i) => i.status === x.v).length]));
    const f = state.sfilter;
    const list = data.items.filter((i) => f === 'all' || (f === 'open' ? ['new', 'ongoing'].includes(i.status) : i.status === f));
    $('#view').innerHTML = sugTabs('ideas', state.faNew) + `<div class="page-head"><div><h1>${owner ? 'Feature suggestions' : 'My suggestions'}</h1>
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
  // =====================================================================
  // HELP: the full guide + an assistant that answers from it
  // =====================================================================
  const help = { sections: null, assistant: false, q: '', chat: [], busy: false, loading: false };
  /** Tiny, safe markdown: escapes everything, then **bold**, `code`, lists and line breaks. */
  function mdLite(t) {
    const lines = esc(String(t || '')).split(/\n/);
    let out = '', list = '';
    const inline = (x) => x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const raw of lines) {
      const l = raw.trim(); const ol = l.match(/^\d+[.)]\s+(.*)/); const ul = l.match(/^[-*•]\s+(.*)/);
      if (ol || ul) { const tag = ol ? 'ol' : 'ul'; if (list !== tag) { if (list) out += `</${list}>`; out += `<${tag}>`; list = tag; } out += `<li>${inline((ol || ul)[1])}</li>`; continue; }
      if (list) { out += `</${list}>`; list = ''; }
      if (l) out += `<p>${inline(l)}</p>`;
    }
    if (list) out += `</${list}>`;
    return out;
  }
  async function renderHelp(section) {
    if (!help.sections && !help.loading) {
      help.loading = true; $('#view').innerHTML = '<div class="empty">Loading the guide…</div>';
      try { const r = await api('/api/ai?op=help'); help.sections = r.sections; help.assistant = r.assistant; } catch (e) { help.sections = []; toast(e.message); }
      help.loading = false;
    }
    if (route().name !== 'help') return;
    const secs = help.sections || [];
    const groups = [...new Set(secs.map((x) => x.group))];
    const q = help.q.trim().toLowerCase();
    const match = (x) => !q || (x.title + ' ' + x.html.replace(/<[^>]+>/g, ' ')).toLowerCase().includes(q);
    const shown = secs.filter(match);
    $('#view').innerHTML = `<div class="help-wrap">
      <div class="page-head"><div><h1>Help</h1><div class="muted">Everything about the app: your account, audits, audit items and statuses, Live DR Sites, and more.</div></div></div>
      ${help.assistant ? `<div class="panel panel-pad help-ask"><h2 style="margin:0 0 6px">💬 Ask the Help assistant</h2>
        <div class="help-chat" id="helpChat">${help.chat.length ? help.chat.map((m) => `<div class="hc-msg ${m.role}">${m.role === 'user' ? esc(m.text) : mdLite(m.text) + (m.sections && m.sections.length ? `<div class="small hc-links">Read more: ${m.sections.map((id) => { const x = secs.find((y) => y.id === id); return x ? `<a href="#/help/${esc(id)}">${esc(x.title)}</a>` : ''; }).filter(Boolean).join(' · ')}</div>` : '')}</div>`).join('') : '<div class="small muted">For example: "What\'s the difference between For clarification and On hold?" or "How do I check that fixes are live?"</div>'}${help.busy ? '<div class="hc-msg assistant faint">Thinking…</div>' : ''}</div>
        <form id="helpForm" class="help-form"><input type="text" id="helpQ" maxlength="600" placeholder="Ask how to do something in the app…" autocomplete="off" ${help.busy ? 'disabled' : ''}><button class="btn primary" ${help.busy ? 'disabled' : ''}>Ask</button>${help.chat.length ? '<button type="button" class="btn ghost" id="helpClear">Clear</button>' : ''}</form>
        <div class="small faint" style="margin-top:6px">Answers come from this guide. The assistant can make mistakes; the sections below are the reference.</div></div>` : ''}
      <div class="help-grid">
        <nav class="help-toc panel">
          <input type="search" id="helpSearch" placeholder="Search the guide…" value="${esc(help.q)}">
          ${groups.map((g) => { const items = secs.filter((x) => x.group === g && match(x)); return items.length ? `<div class="k">${esc(g)}</div>${items.map((x) => `<a href="#/help/${esc(x.id)}" class="${section === x.id ? 'on' : ''}">${esc(x.title)}</a>`).join('')}` : ''; }).join('')}
        </nav>
        <div class="help-body">${shown.length ? shown.map((x) => `<section class="panel panel-pad help-sec" id="help-${esc(x.id)}"><div class="k">${esc(x.group)}</div><h2>${esc(x.title)}</h2>${x.html}</section>`).join('') : '<div class="empty">Nothing in the guide matches that. Try the assistant above.</div>'}</div>
      </div></div>`;
    const sIn = $('#helpSearch');
    sIn.oninput = () => { help.q = sIn.value; const pos = sIn.selectionStart; renderHelp(section).then(() => { const i = $('#helpSearch'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }); };
    if (section) { const el = document.getElementById('help-' + section); if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
    const chat = $('#helpChat'); if (chat) chat.scrollTop = chat.scrollHeight;
    if ($('#helpClear')) $('#helpClear').onclick = () => { help.chat = []; renderHelp(''); };
    if ($('#helpForm')) $('#helpForm').onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#helpQ').value.trim(); if (!text || help.busy) return;
      const history = help.chat.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      help.chat.push({ role: 'user', text }); help.busy = true; renderHelp('');
      try { const r = await post('/api/ai', { op: 'help', question: text, history }); help.chat.push({ role: 'assistant', text: r.answer || "Sorry, I don't have an answer for that.", sections: r.sections || [] }); }
      catch (err) { help.chat.push({ role: 'assistant', text: err.message || "The assistant couldn't answer right now." }); }
      help.busy = false; if (route().name === 'help') { renderHelp(''); const i = $('#helpQ'); if (i) i.focus(); }
    };
    if (!section && $('#helpQ') && help.chat.length) $('#helpQ').focus();
  }

  function renderAbout() {
    $('#view').innerHTML = `<div class="guide">
      <div class="page-head"><div><h1>About Duda Site Auditor</h1><div class="muted">A team tool for checking Duda websites before and after launch, so no client ends up with someone else's details.</div></div>
        <button class="btn" id="abSuggest">💡 Suggest a feature</button></div>
      <div class="panel panel-pad"><h2>What it does</h2>
        <p>Paste a Duda editor link and it reads every page on <b>Desktop, Tablet and Mobile</b>, including side panels, popups and elements hidden on some devices. Everything is compared against the site's <b>Business Info</b> from the Duda API:</p>
        <ul>
          <li><b>Contact info:</b> phone numbers, emails, phone buttons that show one number but dial another, map embeds and social links</li>
          <li><b>Other-client leftovers:</b> names, logos, links and copyright lines from a different business</li>
          <li><b>Business name spelling:</b> every mention compared letter for letter with Business Info</li>
          <li><b>Cross-checked with the client:</b> before a phone, email, address or name is called wrong, the client\u2019s own comments in Duda are searched for it</li>
          <li><b>Links and images:</b> broken pages, broken links and images, alt text</li>
          <li><b>SEO basics:</b> titles, descriptions, H1s, noindex, placeholder text</li>
          <li><b>Design:</b> text set in a typeface that isn't one of the website's own fonts — read from the design settings, and counting every weight of a font as the same font</li>
          <li><b>Pictures:</b> the same photo used in more than one place, matched on its pixels so a re-upload counts too — patterns, icons and logos are left alone</li>
        </ul></div>
      <ol class="steps" style="margin-top:14px">
        <li class="panel"><h3>Add websites</h3><p>Click <b>+ Add website</b>, paste editor links (one per line) and assign someone. Keep the tab open while it scans.</p></li>
        <li class="panel"><h3>Work through audit items</h3><p>Each item has an ID like <b>#12</b>. Click it to set the status (Open, For clarification, Done, On hold, False alarm), reassign it, comment and paste screenshots.</p></li>
        <li class="panel"><h3>Backed up first</h3><p>Before an audit\u2019s first scan, the website is backed up in Duda (e.g. <span class="mono">R8RR_b4_audit_20261007_0930</span>), so a fix that goes wrong can be undone from <b>Site History</b> in the editor.</p></li>
        <li class="panel"><h3>Report back</h3><p><b>📋 Summary</b> on any audit writes a short note for the group chat: what was checked, every critical fix in plain words and how it was verified, and what is left.</p></li>
        <li class="panel"><h3>Talk it through</h3><p>Use a website's <b>Comments</b> tab. Type <b>@</b> to tag a teammate and <b>#12</b> to link an item. Click <b>Reply</b> to quote someone.</p></li>
        <li class="panel"><h3>Hear from the client</h3><p>Comments left in the <b>Duda editor</b> arrive on their own, for every website in the account — published or not, on the Audits list or not. See them under <b>Duda comments</b> in the top menu. Nothing notifies you about them, except when a client has been waiting 24 hours for an answer.</p></li>
        <li class="panel"><h3>See who did what</h3><p>Each website has an <b>Activity log</b> (scans, rescans, statuses and comments, with date and time). Admins also get an app-wide <b>Activity</b> page. The dots at the top right show who's online: green is active, grey is idle for an hour or more.</p></li>
        <li class="panel"><h3>Details change — the audit keeps up</h3><p>Every scan records what Business Info said and what changed since last time. A website still showing an old phone number or email reads <b>"Still using the old …"</b> with the date it changed, at an <b>Outdated</b> severity of its own rather than looking like a detail nobody recognises. Approvals retire themselves once Duda catches up. The dates are under <b>Reference data → Business Info history</b>.</p></li>
        <li class="panel"><h3>Tell it when it's wrong</h3><p>Marking an item <b>False alarm</b> is a bug report against the check that raised it. Your reason lands on the item as a comment, you can follow the report under <b>My false alarms</b>, and you're told — with their note — when an admin decides. If they agree the check was wrong, every website scanned with the old version flags itself for a rescan.</p></li>
        <li class="panel"><h3>Keep up as the checks grow</h3><p>New checks get added over time. A finished audit is never changed behind your back — it keeps its items until somebody rescans it. Instead, a website scanned before the newest checks shows a note at the top of its <b>Audit items</b> saying what was added, so you can decide whether it's worth a rescan. Rescanning keeps everything you've already marked and only adds new Open items.</p></li>
        <li class="panel"><h3>Your work stays yours</h3><p>Finish a website and it shows <b>✓ Marked Complete by you</b>. If anyone rescans, reopens or reassigns it, you're told what happened and who did it — and they're asked for a reason first. <b>Members → 📊 Team stats</b> shows what each person has closed. Taking an audit off the list also asks for a reason and keeps a card under <b>Removed from Audits</b> — the website itself is never touched in Duda.</p></li>
      </ol>
      <div class="panel panel-pad" style="margin-top:14px"><h2>Audit item statuses</h2>
        <table class="help-table"><tbody>
          <tr><td><b>Open</b></td><td>Needs fixing (default).</td></tr>
          <tr><td><b>For clarification</b></td><td>"I have a question before I can fix this." Picking it asks you what the question is and who can answer — type <b>@</b> for a person or <b>@Admins</b> for all of them. Stays in the default list.</td></tr>
          <tr><td><b>Done</b></td><td>Fixed in the Duda editor. A rescan closes fixed items by itself and reopens anything marked Done that is still there. Confirmed later with <b>Verify on live site</b>.</td></tr>
          <tr><td><b>On hold</b></td><td>"We know what to do, but it can't be done yet." Waiting on something outside the team (client, domain, approval). Leaves the default list.</td></tr>
          <tr><td><b>False alarm</b></td><td>Not actually a problem. Add a reason to help improve the checks. Skipped by the live check.</td></tr>
        </tbody></table>
        <p class="small muted" style="margin:8px 0 0">Rule of thumb: someone <i>inside</i> the team can answer → For clarification. Waiting on someone <i>outside</i> → On hold. Only Done and False alarm count as cleared.</p></div>
      <p class="small faint" style="margin-top:14px">Still review by hand: business hours, prices, service areas, form recipients, and text inside images.</p>
      <p style="margin-top:10px"><a class="btn" href="#/help">📘 Open the full Help guide</a> <button class="btn" id="abNews" type="button">✨ What's New</button></p>
      <p class="small faint">The light bulb (top left) glows when there's an update you haven't read: it opens About, AI Status, Help, What's New and today's AI credits.</p></div>`;
    $('#abSuggest').onclick = openSuggest;
    $('#abNews').onclick = () => openNews();
  }

  // =====================================================================
  // BOOT
  // =====================================================================
  async function boot2() {
    document.body.classList.remove('auth-mode');
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    // A client account never loads any of the team's data — not the website list, not the members,
    // not the AI status. Those endpoints would refuse it anyway; not calling them is the point.
    if (state.me.role === 'client') { if (!location.hash.startsWith('#/my/')) location.hash = '#/my/'; return render(); }
    await Promise.all([loadUsers(), loadSites(), loadRoles(), api('/api/ai').then((r) => { state.ai = r; if (r.now) state.aiSkew = r.now - Date.now(); }).catch(() => { state.ai = { enabled: false }; })]);
    if (!state.rtChannel) { try { const m = await api('/api/auth?op=me'); state.rtChannel = m.rtChannel || ''; state.superAdmin = !!m.superAdmin; state.perms = m.perms || []; state.myRole = m.role || null; state.previewOf = m.preview || null; state.accessVer = m.accessVer || ''; } catch (e) { /* ignore */ } }
    renderTop();
    loadNews();
    loadCommentSites(true).catch(() => {});
    pulse();
    render();
    setTimeout(roomTick, 1500);
    resumeAfterReload();
    listenPersonal();
    setTimeout(offerDesktop, 4000);
    // Started after everything else and deliberately late: catching up on form-submission history
    // is the least urgent thing the app does and must never slow down opening it.
    setTimeout(startQueue, 6000);
  }
  window.addEventListener('hashchange', () => {
    if (state.me && clientMode()) return render();
    if (state.me && Date.now() - lastPulse > 5000) setTimeout(pulse, 1500);
    setTimeout(roomTick, 600);
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
    try { state.viewRole = JSON.parse(sessionStorage.getItem('dsa-viewas') || 'null'); } catch (e) { state.viewRole = null; }
    try { state.config = await api('/api/auth?op=config'); const r = await api('/api/auth?op=me'); state.me = r.user; state.rtChannel = r.rtChannel || ''; state.superAdmin = !!r.superAdmin; state.perms = r.perms || []; state.myRole = r.role || null; state.previewOf = r.preview || null; state.accessVer = r.accessVer || ''; }
    catch (e) { $('#view').innerHTML = `<div class="empty">Could not start the app: ${esc(e.message)}</div>`; return; }
    if (!state.me) return renderAuth();
    if (state.me.status !== 'active') { state.auth.mode = state.me.status === 'disabled' ? 'disabled' : 'pending'; state.me = null; return renderAuth(); }
    await boot2();
    // Keep data fresh so teammates' changes show up
    // Every 90 s normally; every 30 s while a teammate has a website queued or scanning, so its Rescan button frees up sooner
    let lastPoll = Date.now();
    setInterval(async () => {
      if (!state.me || document.hidden || modalOpts) return;
      const othersBusy = Object.keys(state.claims).some((id) => otherClaim(id)) || (state.current && state.current.claim && otherClaim(state.current.id));
      if (Date.now() - lastPoll < (othersBusy ? 29000 : 89000)) return;
      lastPoll = Date.now();
      try {
        const r = route();
        // Ask "anything new?" first (one tiny read); only reload when something changed
        if (r.name === 'sites') { if (await loadSites(true)) renderSites(); }
        else if (r.name === 'live') { if (await loadSites(true)) renderLive(); }
        else if (r.name === 'site' && state.current && !state.scanning[state.current.id]) {
          const busy = (siteComposer && document.body.contains($('#siteComposer')) && siteComposer.busy()) || (drawerComposer && drawerComposer.busy()) || document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
          if (!busy && await refreshSite(state.current.id)) renderSite();
        }
      } catch (e) { /* ignore */ }
    }, 30000);
    // Heartbeat: every 2 min while the tab is visible, every 5 min in the background
    setInterval(() => { if (Date.now() - lastPulse > beatMs() - 5000) pulse(); }, 30000);
  })();
})();
