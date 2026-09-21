/* Duda Site Auditor — front-end app (vanilla JS, no build step) */
(function () {
  'use strict';
  const A = window.DudaAudit;
  const STATUSES = ['Not started', 'In progress', 'Complete with query', 'Complete', 'On hold'];
  const COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669'];
  const LS_KEY = 'dsa-local-v1';
  const PW_KEY = 'dsa-pw';
  const SCAN_CONCURRENCY_SITES = 2;

  const state = {
    mode: 'kv', members: [], sites: [], // summaries
    current: null, // full site on detail view
    scanning: {}, // id -> {done,total,message}
    queue: [], running: 0,
    filters: { q: '', status: '', assignee: '' },
    ff: { q: '', sev: '', cat: '', dev: '', done: 'open', who: '', loc: '' },
  };

  // ---------- utils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z]+/g, '-');
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const fmtDate = (d) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const member = (id) => state.members.find((m) => m.id === id);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Browser storage is full — connect Upstash Redis (see Setup guide)'); return false; } };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast(label || 'Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(label || 'Copied'); }
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const pw = lsGet(PW_KEY, '');
    if (pw) headers['x-app-password'] = pw;
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    if (r.status === 401) { await askPassword(); return api(path, opts); }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  }
  let pwPromise = null;
  function askPassword() {
    if (pwPromise) return pwPromise;
    pwPromise = new Promise((resolve) => {
      modal(`<header><h2>Team password</h2></header>
        <div class="body"><p class="muted" style="margin:0">This app is protected. Enter the APP_PASSWORD you set in Vercel.</p>
        <input type="password" id="pwIn" placeholder="Password" autofocus></div>
        <footer><button class="btn primary" id="pwOk">Unlock</button></footer>`, { onClose: () => {} , sticky: true });
      const go = () => { lsSet(PW_KEY, $('#pwIn').value); closeModal(); pwPromise = null; resolve(); };
      $('#pwOk').onclick = go; $('#pwIn').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
    return pwPromise;
  }

  // ---------- Storage adapter (Upstash KV via /api/store, or this browser) ----------
  const Store = {
    local() { return lsGet(LS_KEY, { members: [], sites: {} }); },
    saveLocal(d) { return lsSet(LS_KEY, d); },
    summary(s) {
      const c = { critical: 0, warning: 0, info: 0, done: 0, total: 0 };
      (s.findings || []).forEach((f) => { c.total++; if (f.done) c.done++; else c[f.severity]++; });
      return { id: s.id, siteId: s.siteId, host: s.host, editorUrl: s.editorUrl, businessName: s.businessName || '', assignee: s.assignee || '', status: s.status || 'Not started', scan: s.scan || {}, createdAt: s.createdAt, updatedAt: s.updatedAt, counts: c };
    },
    async init() {
      let r;
      try { r = await api('/api/store?op=list'); } catch (e) { r = { mode: 'local', message: e.message }; }
      if (r.mode === 'kv') { state.mode = 'kv'; state.members = r.members || []; state.sites = r.sites || []; }
      else { state.mode = 'local'; const d = this.local(); state.members = d.members || []; state.sites = Object.values(d.sites || {}).map((s) => this.summary(s)); }
      const b = $('#storeBadge');
      b.textContent = state.mode === 'kv' ? '● Team storage' : '● This browser only';
      b.title = state.mode === 'kv' ? 'Saved in Upstash Redis — shared with everyone who uses this app' : 'No Upstash Redis connected — data is saved only in this browser. See Setup guide step 4.';
      b.style.color = state.mode === 'kv' ? 'var(--ok)' : 'var(--warn)';
    },
    async getSite(id) {
      if (state.mode === 'kv') return api('/api/store?op=site&id=' + encodeURIComponent(id));
      return (this.local().sites || {})[id] || null;
    },
    async saveSite(site) {
      site.updatedAt = new Date().toISOString();
      let sum;
      if (state.mode === 'kv') sum = await api('/api/store', { method: 'POST', body: JSON.stringify({ op: 'saveSite', site }) });
      else { const d = this.local(); d.sites = d.sites || {}; d.sites[site.id] = site; this.saveLocal(d); sum = this.summary(site); }
      const i = state.sites.findIndex((s) => s.id === site.id);
      if (i >= 0) state.sites[i] = sum; else state.sites.push(sum);
      return sum;
    },
    async deleteSite(id) {
      if (state.mode === 'kv') await api('/api/store', { method: 'POST', body: JSON.stringify({ op: 'deleteSite', id }) });
      else { const d = this.local(); delete d.sites[id]; this.saveLocal(d); }
      state.sites = state.sites.filter((s) => s.id !== id);
    },
    async saveMembers(members) {
      state.members = members;
      if (state.mode === 'kv') await api('/api/store', { method: 'POST', body: JSON.stringify({ op: 'saveMembers', members }) });
      else { const d = this.local(); d.members = members; this.saveLocal(d); }
    },
    async patchSite(id, changes) {
      if (state.mode === 'kv') {
        const sum = await api('/api/store', { method: 'POST', body: JSON.stringify({ op: 'patchSite', id, changes }) });
        const i = state.sites.findIndex((s) => s.id === id); if (i >= 0) state.sites[i] = sum;
      } else {
        const d = this.local(); const s = d.sites[id]; if (!s) return; Object.assign(s, changes); this.saveLocal(d);
        const i = state.sites.findIndex((x) => x.id === id); if (i >= 0) state.sites[i] = this.summary(s);
      }
      if (state.current && state.current.id === id) Object.assign(state.current, changes);
    },
    async patchFinding(siteId, findingIds, changes) {
      if (state.mode === 'kv') {
        const sum = await api('/api/store', { method: 'POST', body: JSON.stringify({ op: 'patchFinding', siteId, findingId: findingIds, changes }) });
        const i = state.sites.findIndex((s) => s.id === siteId); if (i >= 0) state.sites[i] = sum;
      } else {
        const d = this.local(); const s = d.sites[siteId]; if (!s) return;
        s.findings.forEach((f) => { if (findingIds.includes(f.id)) Object.assign(f, changes, 'done' in changes ? { doneAt: changes.done ? new Date().toISOString() : null } : {}); });
        this.saveLocal(d);
        const i = state.sites.findIndex((x) => x.id === siteId); if (i >= 0) state.sites[i] = this.summary(s);
      }
    },
  };

  // ---------- Modal ----------
  let modalOpts = null;
  function modal(html, opts = {}) {
    modalOpts = opts;
    $('#modalRoot').innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const back = $('.modal-back');
    back.addEventListener('mousedown', (e) => { if (e.target === back && !opts.sticky) closeModal(); });
    const f = back.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; if (modalOpts && modalOpts.onClose) modalOpts.onClose(); modalOpts = null; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpts && !modalOpts.sticky) closeModal(); });

  function memberOptions(selected, emptyLabel) {
    return `<option value="">${esc(emptyLabel || 'Unassigned')}</option>` + state.members.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  }
  function avatar(id) {
    const m = member(id);
    return m ? `<span class="av" style="background:${esc(m.color)}" title="${esc(m.name)}">${esc(initials(m.name))}</span>` : '';
  }

  // ---------- Add website ----------
  function openAdd() {
    modal(`<header><h2>Add website(s)</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body">
        <label class="field">Duda editor link(s) — one per line
          <textarea id="addLinks" rows="5" autofocus placeholder="https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home"></textarea>
        </label>
        <label class="field">Assign to
          <select id="addWho">${memberOptions('', 'Unassigned')}</select>
        </label>
        <p class="small muted" style="margin:0">Each site is scanned on Desktop, Tablet and Mobile (including side panels, popups and hidden elements) and compared to its Duda Business Info. Keep this tab open while scans run — up to ${SCAN_CONCURRENCY_SITES} sites scan at the same time.</p>
      </div>
      <footer><button class="btn" data-close>Cancel</button><button class="btn primary" id="addGo">Add &amp; start audit</button></footer>`);
    $('#modalRoot').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
    $('#addGo').onclick = async () => {
      const lines = $('#addLinks').value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return toast('Paste at least one editor link');
      const who = $('#addWho').value;
      let added = 0, dup = 0, bad = 0;
      for (const link of lines) {
        const p = parseLink(link);
        if (!p.siteId) { bad++; continue; }
        if (state.sites.some((s) => s.siteId === p.siteId)) { dup++; continue; }
        const site = { id: uid(), siteId: p.siteId, host: p.host, editorUrl: link, businessName: '', assignee: who, status: 'Not started', createdAt: new Date().toISOString(), findings: [], scan: { state: 'queued' } };
        await Store.saveSite(site);
        enqueue(site.id); added++;
      }
      closeModal();
      toast(`${added} added${dup ? ` · ${dup} already in list` : ''}${bad ? ` · ${bad} invalid link(s)` : ''}`);
      render();
    };
  }
  function parseLink(input) {
    try {
      const u = new URL(input.trim());
      const m = u.pathname.match(/\/(?:site|preview|editor\/direct|editor)\/([A-Za-z0-9_-]{4,})/);
      return { host: u.hostname, siteId: m ? m[1] : '' };
    } catch (e) { return { host: '', siteId: /^[A-Za-z0-9_-]{6,}$/.test(input) ? input : '' }; }
  }

  // ---------- Members ----------
  function openMembers() {
    const draw = () => {
      $('#memList').innerHTML = state.members.length ? state.members.map((m) => `
        <div class="member-row"><span class="av" style="background:${esc(m.color)}">${esc(initials(m.name))}</span>
        <span style="flex:1;font-weight:600">${esc(m.name)}</span>
        <span class="small muted">${state.sites.filter((s) => s.assignee === m.id).length} sites</span>
        <button class="btn sm danger" data-del="${esc(m.id)}">Remove</button></div>`).join('') : '<p class="muted">No members yet.</p>';
      $('#memList').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
        if (!confirm('Remove this member? Their assignments become unassigned.')) return;
        await Store.saveMembers(state.members.filter((m) => m.id !== b.dataset.del)); draw(); render();
      }));
    };
    modal(`<header><h2>Team members</h2><button class="btn ghost" data-close>✕</button></header>
      <div class="body"><div id="memList"></div>
      <div style="display:flex;gap:8px"><input type="text" id="memName" placeholder="Name, e.g. Cler" style="flex:1" autofocus><button class="btn primary" id="memAdd">Add member</button></div></div>
      <footer><button class="btn" data-close>Done</button></footer>`);
    $('#modalRoot').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
    const add = async () => {
      const name = $('#memName').value.trim(); if (!name) return;
      $('#memName').value = '';
      if (state.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return toast(name + ' is already a member');
      await Store.saveMembers(state.members.concat({ id: uid(), name, color: COLORS[state.members.length % COLORS.length] }));
      draw(); render();
    };
    $('#memAdd').onclick = add; $('#memName').onkeydown = (e) => { if (e.key === 'Enter') add(); };
    draw();
  }

  // ---------- Scanning ----------
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
    let site = await Store.getSite(id);
    if (!site) return;
    const t0 = Date.now();
    state.scanning[id] = { done: 0, total: 0, message: 'Reading Business Info…' };
    site.scan = Object.assign({}, site.scan, { state: 'scanning', startedAt: new Date().toISOString(), error: '' });
    await Store.saveSite(site); render();
    const log = [];
    try {
      // 1) Business Info (truth) + pages from the Duda API
      let meta = null;
      try { meta = await api('/api/site?editor=' + encodeURIComponent(site.editorUrl)); }
      catch (e) { log.push('Duda API call failed: ' + e.message); }
      if (meta) { site.host = meta.host || site.host; (meta.errors || []).forEach((x) => log.push(x)); }
      let truth = meta ? A.buildTruth({ site: meta.site, content: meta.content }) : null;
      if (truth && truth.source === 'none') truth = null;
      const pagesMeta = {};
      ((meta && meta.pages) || []).forEach((p) => { pagesMeta[A.normalizePath(p.path)] = p; });

      // 2) Crawl every page on desktop / tablet / mobile
      const res = await A.runScan({
        siteId: site.siteId, host: site.host, truth, pagesMeta,
        seedPaths: Object.keys(pagesMeta),
        concurrency: 4,
        fetchPage: async (path, device) => {
          const q = new URLSearchParams({ host: site.host, site: site.siteId, path, device });
          for (let attempt = 0; attempt < 3; attempt++) {
            try { const r = await api('/api/fetch?' + q); if (r.status || attempt === 2) return r; } catch (e) { if (attempt === 2) return { status: 0, html: '', error: e.message }; }
            await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
          }
        },
        checkUrls: (urls) => api('/api/check', { method: 'POST', body: JSON.stringify({ urls }) }),
        onProgress: (p) => { state.scanning[id] = p; renderProgress(id); },
      });
      log.push(...res.log);

      // 3) Facebook / Google Business profile comparison (general notes)
      const profiles = await checkProfiles(res.truth, site);

      // 4) Keep checkbox / assignee / notes from the previous scan
      const prev = new Map((site.findings || []).map((f) => [f.id, f]));
      let kept = 0;
      res.findings.forEach((f) => { const o = prev.get(f.id); if (o) { f.done = !!o.done; f.doneAt = o.doneAt || null; f.doneBy = o.doneBy || ''; f.assignee = o.assignee || ''; f.note = o.note || ''; kept++; } });
      const resolved = (site.findings || []).filter((f) => !res.findings.some((n) => n.id === f.id)).length;

      site = Object.assign(await Store.getSite(id) || site, {
        host: site.host,
        businessName: res.truth.businessName || site.businessName,
        truth: res.truth, profiles, findings: res.findings, pages: res.pages,
        scan: { state: 'complete', startedAt: site.scan.startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, pages: res.pages.length, externalLinks: res.externalLinks, images: res.images, counts: res.counts, log, resolvedSinceLast: site.scan && site.scan.finishedAt ? resolved : 0 },
      });
      if (site.status === 'Not started') site.status = 'In progress';
      await Store.saveSite(site);
      toast(`Scan complete: ${site.businessName || site.siteId} — ${res.counts.critical} critical`);
    } catch (e) {
      console.error(e);
      site.scan = Object.assign({}, site.scan, { state: 'failed', error: String(e.message || e), finishedAt: new Date().toISOString(), log });
      await Store.saveSite(site);
      toast('Scan failed: ' + (e.message || e));
    }
    if (state.current && state.current.id === id) state.current = await Store.getSite(id);
  }

  async function checkProfiles(truth, site) {
    const urls = [];
    const add = (net, u) => { if (u && !urls.some((x) => x.url === u)) urls.push({ net, url: u }); };
    const links = truth.socialLinks || {};
    (links.facebook || truth.socials.facebook || []).forEach((h) => add('Facebook', /^https?:/i.test(h) ? h : 'https://www.facebook.com/' + String(h).replace(/^\/+/, '')));
    (links.google_my_business || []).forEach((h) => { if (/^https?:/i.test(h)) add('Google Business', h); else if (/\./.test(h)) add('Google Business', 'https://' + h); });
    if (!urls.length) return { checked: false, items: [], note: 'No Facebook or Google Business profile in Business Info.' };
    let out = [];
    try { out = await api('/api/social', { method: 'POST', body: JSON.stringify({ urls: urls.map((u) => u.url) }) }); } catch (e) { return { checked: false, items: [], note: 'Profile check failed: ' + e.message }; }
    const items = out.map((r, i) => {
      const net = urls[i].net;
      if (!r.ok) return { net, url: r.url, result: 'unverified', text: `Could not read the ${net} page automatically (${r.error || 'login wall / blocked'}). Open it and compare name, phone and email manually.` };
      const issues = [];
      if (r.title && truth.businessName && !A.matchesBusiness(r.title, truth)) issues.push(`Name on ${net} is "${r.title}" (Business Info: "${truth.businessName}")`);
      (r.phones || []).forEach((p) => { if (truth.phones.length && !truth.phones.includes(p.slice(-10))) issues.push(`${net} shows phone ${A.fmtPhone(p)} (Business Info: ${truth.phones.map(A.fmtPhone).join(', ')})`); });
      (r.emails || []).forEach((e) => { if (truth.emails.length && !truth.emails.includes(e)) issues.push(`${net} shows email ${e} (Business Info: ${truth.emails.join(', ')})`); });
      return { net, url: r.url, title: r.title, result: issues.length ? 'mismatch' : 'match', text: issues.length ? issues.join(' · ') : `${net} profile "${r.title}" matches the business name${(r.phones || []).length ? ' and phone' : ''}.` };
    });
    return { checked: true, items };
  }

  // ---------- Views ----------
  function route() {
    const h = location.hash.replace(/^#/, '') || '/';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', (h.startsWith('/guide') && a.dataset.nav === 'guide') || (!h.startsWith('/guide') && a.dataset.nav === 'sites')));
    if (h.startsWith('/site/')) return { name: 'site', id: decodeURIComponent(h.split('/')[2] || '') };
    if (h.startsWith('/guide')) return { name: 'guide' };
    return { name: 'sites' };
  }

  async function render() {
    const r = route();
    if (r.name === 'site') {
      if (!state.current || state.current.id !== r.id || (!state.scanning[r.id] && state.current.scan && state.current.scan.state === 'scanning')) {
        state.current = await Store.getSite(r.id);
      }
      return renderSite();
    }
    state.current = null;
    if (r.name === 'guide') return renderGuide();
    return renderSites();
  }

  function scanBadge(s) {
    const live = state.scanning[s.id];
    if (live) {
      if (live.queued) return `<span class="badge scan-queued">Queued</span>`;
      const pct = live.total ? Math.round((live.done / live.total) * 100) : 3;
      return `<span class="badge scan-scanning">Scanning ${live.total ? `${live.done}/${live.total}` : '…'}</span><div class="progress"><i id="pg-${esc(s.id)}" style="width:${pct}%"></i></div><div class="small faint" id="pm-${esc(s.id)}">${esc(live.message || '')}</div>`;
    }
    const sc = s.scan || {};
    if (sc.state === 'complete') return `<span class="badge scan-complete">✓ Scan complete</span><div class="small faint">${esc(fmtDate(sc.finishedAt))} · ${sc.pages || 0} pages</div>`;
    if (sc.state === 'failed') return `<span class="badge scan-failed" title="${esc(sc.error)}">Scan failed</span>`;
    if (sc.state === 'scanning' || sc.state === 'queued') {
      const age = Date.now() - new Date(sc.startedAt || s.createdAt || 0).getTime();
      return age > 20 * 60000 || sc.state === 'queued' ? `<span class="badge scan-interrupted" title="The tab running this scan was closed">Interrupted — rescan</span>` : `<span class="badge scan-scanning">Scanning (another tab)</span>`;
    }
    return `<span class="badge scan-none">Not scanned</span>`;
  }
  function renderProgress(id) {
    const live = state.scanning[id]; if (!live) return;
    const bar = document.getElementById('pg-' + id); const msg = document.getElementById('pm-' + id);
    if (!bar) return render();
    bar.style.width = (live.total ? Math.round((live.done / live.total) * 100) : 3) + '%';
    if (msg) msg.textContent = live.message || '';
    const b = bar.parentElement.previousElementSibling; if (b) b.textContent = `Scanning ${live.done}/${live.total}`;
  }

  function renderSites() {
    const f = state.filters;
    const list = state.sites.filter((s) => (!f.status || s.status === f.status) && (!f.assignee || (f.assignee === '_none' ? !s.assignee : s.assignee === f.assignee)) &&
      (!f.q || (s.businessName + ' ' + s.siteId + ' ' + s.editorUrl).toLowerCase().includes(f.q.toLowerCase())))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const tot = { sites: state.sites.length, crit: 0, done: 0, complete: 0, scanned: 0 };
    state.sites.forEach((s) => { tot.crit += (s.counts && s.counts.critical) || 0; if (s.status === 'Complete') tot.complete++; if (s.scan && s.scan.state === 'complete') tot.scanned++; });
    $('#view').innerHTML = `
      <div class="page-head"><div><h1>Websites</h1><div class="muted">Audit Duda sites against their Business Info on every device.</div></div></div>
      <div class="stats">
        <div class="panel stat"><div class="n">${tot.sites}</div><div class="l">Websites</div></div>
        <div class="panel stat"><div class="n">${tot.scanned}</div><div class="l">Scan complete</div></div>
        <div class="panel stat"><div class="n" style="color:var(--crit)">${tot.crit}</div><div class="l">Open critical issues</div></div>
        <div class="panel stat"><div class="n" style="color:var(--ok)">${tot.complete}</div><div class="l">Marked Complete</div></div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <input type="search" id="fq" placeholder="Search business name or site ID…" value="${esc(f.q)}">
          <select id="fstatus"><option value="">All statuses</option>${STATUSES.map((s) => `<option ${s === f.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <select id="fwho"><option value="">Everyone</option><option value="_none" ${f.assignee === '_none' ? 'selected' : ''}>Unassigned</option>${state.members.map((m) => `<option value="${esc(m.id)}" ${m.id === f.assignee ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
          <span class="spacer"></span>
          <button class="btn sm" id="rescanAll" title="Rescan every website in this filtered list">Rescan all shown</button>
        </div>
        ${list.length ? `<div class="table-wrap"><table class="grid">
          <thead><tr><th>Website</th><th>Assigned</th><th>Status</th><th>Scan</th><th>Open issues</th><th>Checked off</th><th></th></tr></thead>
          <tbody>${list.map((s) => {
            const c = s.counts || {};
            const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
            return `<tr class="row-link" data-open="${esc(s.id)}">
              <td><div class="site-name">${esc(s.businessName || 'Not scanned yet')}</div><div class="small muted mono">${esc(s.siteId)} · ${esc(s.host)}</div></td>
              <td data-stop><span class="member-select">${avatar(s.assignee)}<select data-assign="${esc(s.id)}">${memberOptions(s.assignee)}</select></span></td>
              <td data-stop><select class="pill st-${slug(s.status)}" data-status="${esc(s.id)}">${STATUSES.map((x) => `<option ${x === s.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
              <td>${scanBadge(s)}</td>
              <td><span class="chips">${c.critical ? `<span class="badge sev-critical">${c.critical} critical</span>` : ''}${c.warning ? `<span class="badge sev-warning">${c.warning} warning</span>` : ''}${c.info ? `<span class="badge sev-info">${c.info} info</span>` : ''}${!c.total && s.scan && s.scan.state === 'complete' ? '<span class="badge scan-complete">No issues</span>' : ''}</span></td>
              <td style="min-width:120px"><div class="small">${c.done || 0}/${c.total || 0}</div><div class="progress"><i style="width:${pct}%;background:var(--ok)"></i></div></td>
              <td data-stop style="white-space:nowrap"><button class="btn sm" data-rescan="${esc(s.id)}" ${state.scanning[s.id] ? 'disabled' : ''}>Rescan</button> <button class="btn sm ghost danger" data-delete="${esc(s.id)}" title="Delete">✕</button></td>
            </tr>`;
          }).join('')}</tbody></table></div>` : `<div class="empty">${state.sites.length ? 'No websites match these filters.' : 'No websites yet. Click <b>+ Add website</b> and paste a Duda editor link.'}</div>`}
      </div>`;
    const v = $('#view');
    $('#fq').oninput = (e) => { f.q = e.target.value; renderSitesKeepFocus(); };
    $('#fstatus').onchange = (e) => { f.status = e.target.value; render(); };
    $('#fwho').onchange = (e) => { f.assignee = e.target.value; render(); };
    $('#rescanAll').onclick = () => { if (!list.length) return; if (confirm(`Rescan ${list.length} website(s)?`)) list.forEach((s) => enqueue(s.id)); render(); };
    v.querySelectorAll('[data-open]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) return; location.hash = '#/site/' + tr.dataset.open; }));
    v.querySelectorAll('[data-assign]').forEach((sel) => (sel.onchange = async () => { await Store.patchSite(sel.dataset.assign, { assignee: sel.value }); render(); }));
    v.querySelectorAll('[data-status]').forEach((sel) => (sel.onchange = async () => { await Store.patchSite(sel.dataset.status, { status: sel.value }); render(); }));
    v.querySelectorAll('[data-rescan]').forEach((b) => (b.onclick = () => { enqueue(b.dataset.rescan); render(); }));
    v.querySelectorAll('[data-delete]').forEach((b) => (b.onclick = async () => { if (!confirm('Delete this website and its audit?')) return; await Store.deleteSite(b.dataset.delete); render(); }));
  }
  function renderSitesKeepFocus() { const pos = $('#fq').selectionStart; renderSites(); const i = $('#fq'); i.focus(); i.setSelectionRange(pos, pos); }

  // ---------- Site detail ----------
  function devChips(f) {
    return A.DEVICES.map((d) => {
      const on = (f.visibleOn || []).includes(d);
      const present = (f.devices || []).includes(d);
      if (!present) return '';
      return `<span class="dev ${on ? 'on' : 'hidden'}" title="${on ? 'Visible on ' + A.DEVICE_LABEL[d] : 'In the HTML but hidden on ' + A.DEVICE_LABEL[d]}">${A.DEVICE_LABEL[d]}${on ? '' : ' (hidden)'}</span>`;
    }).join('');
  }
  function previewUrl(site, path, device) {
    return `https://${site.host}/site/${site.siteId}${path === '/' ? '' : path}?preview=true&insitepreview=true&dm_device=${device || 'desktop'}`;
  }

  function renderSite() {
    const s = state.current;
    if (!s) { $('#view').innerHTML = `<div class="empty">Website not found. <a href="#/">Back to list</a></div>`; return; }
    const live = state.scanning[s.id];
    const t = s.truth || {};
    const ff = state.ff;
    const findings = s.findings || [];
    const cats = [...new Set(findings.map((f) => f.category))].sort();
    const locs = [...new Set(findings.map((f) => f.location))].sort();
    const effWho = (f) => f.assignee || s.assignee || '';
    const shown = findings.filter((f) => {
      if (ff.done === 'open' && f.done) return false;
      if (ff.done === 'done' && !f.done) return false;
      if (ff.sev && f.severity !== ff.sev) return false;
      if (ff.cat && f.category !== ff.cat) return false;
      if (ff.loc && f.location !== ff.loc) return false;
      if (ff.dev === 'hidden' && (f.visibleOn || []).length) return false;
      if (ff.dev && ff.dev !== 'hidden' && !(f.visibleOn || []).includes(ff.dev)) return false;
      if (ff.who && (ff.who === '_none' ? effWho(f) : effWho(f) !== ff.who)) return false;
      if (ff.q && ![f.message, f.found, f.expected, f.path, f.selector, f.location].join(' ').toLowerCase().includes(ff.q.toLowerCase())) return false;
      return true;
    });
    const cnt = (sev) => findings.filter((f) => f.severity === sev && !f.done).length;
    const done = findings.filter((f) => f.done).length;
    const sc = s.scan || {};
    const socials = Object.entries(t.socials || {}).map(([k, v]) => `${esc(k.replace('google_my_business', 'Google Business'))}: ${esc(v.join(', '))}`).join('<br>');

    $('#view').innerHTML = `
      <div class="page-head">
        <div><div class="small"><a href="#/">← All websites</a></div>
          <h1>${esc(s.businessName || s.siteId)}</h1>
          <div class="muted mono small">${esc(s.siteId)} · ${esc(s.host)}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="member-select">${avatar(s.assignee)}<select id="sAssign">${memberOptions(s.assignee)}</select></span>
          <select class="pill st-${slug(s.status)}" id="sStatus">${STATUSES.map((x) => `<option ${x === s.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <a class="btn" href="${esc(s.editorUrl)}" target="_blank" rel="noopener">Open editor ↗</a>
          <a class="btn" href="https://${esc(s.host)}/preview/${esc(s.siteId)}" target="_blank" rel="noopener">Preview ↗</a>
          <button class="btn" id="sCsv" ${findings.length ? '' : 'disabled'}>Export CSV</button>
          <button class="btn primary" id="sRescan" ${live ? 'disabled' : ''}>${live ? 'Scanning…' : 'Rescan'}</button>
        </div>
      </div>

      <div class="panel panel-pad" style="margin-bottom:16px">${scanBadge(s)}
        ${sc.state === 'complete' ? `<span class="small muted" style="margin-left:8px">3 devices each · ${sc.externalLinks || 0} external links · ${sc.images || 0} images checked · ${Math.round((sc.durationMs || 0) / 1000)}s${sc.resolvedSinceLast ? ` · ${sc.resolvedSinceLast} issue(s) resolved since last scan` : ''}</span>` : ''}
        ${sc.error ? `<div class="note bad">${esc(sc.error)}</div>` : ''}
        ${(sc.log || []).length ? `<details style="margin-top:8px"><summary class="small">Scan notes (${sc.log.length})</summary>${sc.log.map((l) => `<div class="note unk">${esc(l)}</div>`).join('')}</details>` : ''}
      </div>

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
          ${s.profiles ? (s.profiles.items || []).map((p) => `<div class="note ${p.result === 'match' ? 'good' : p.result === 'mismatch' ? 'bad' : 'unk'}"><b>${esc(p.net)}</b> — ${esc(p.text)} <a href="${esc(p.url)}" target="_blank" rel="noopener">open ↗</a></div>`).join('') + (s.profiles.note ? `<div class="note unk">${esc(s.profiles.note)}</div>` : '') : '<p class="muted small">Runs with each scan.</p>'}
          <p class="small faint" style="margin:8px 0 0">General note only. Facebook and Google often block automated reads, so verify anything marked yellow by hand.</p>
        </div>
      </div>

      <div class="panel">
        <div class="toolbar">
          <span class="chips">
            <button class="chipbtn ${ff.sev === '' ? 'active' : ''}" data-sev="">All open ${findings.length - done}</button>
            <button class="chipbtn ${ff.sev === 'critical' ? 'active' : ''}" data-sev="critical">Critical ${cnt('critical')}</button>
            <button class="chipbtn ${ff.sev === 'warning' ? 'active' : ''}" data-sev="warning">Warning ${cnt('warning')}</button>
            <button class="chipbtn ${ff.sev === 'info' ? 'active' : ''}" data-sev="info">Info ${cnt('info')}</button>
          </span>
          <input type="search" id="ffq" placeholder="Search findings, paths, selectors…" value="${esc(ff.q)}">
          <select id="ffcat"><option value="">All categories</option>${cats.map((c) => `<option ${c === ff.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="ffloc"><option value="">All locations</option>${locs.map((c) => `<option ${c === ff.loc ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="ffdev"><option value="">All devices</option>${A.DEVICES.map((d) => `<option value="${d}" ${ff.dev === d ? 'selected' : ''}>Visible on ${A.DEVICE_LABEL[d]}</option>`).join('')}<option value="hidden" ${ff.dev === 'hidden' ? 'selected' : ''}>Hidden on all devices</option></select>
          <select id="ffwho"><option value="">Anyone</option><option value="_none" ${ff.who === '_none' ? 'selected' : ''}>Unassigned</option>${state.members.map((m) => `<option value="${esc(m.id)}" ${ff.who === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
          <select id="ffdone"><option value="open" ${ff.done === 'open' ? 'selected' : ''}>Open</option><option value="done" ${ff.done === 'done' ? 'selected' : ''}>Checked off (${done})</option><option value="all" ${ff.done === 'all' ? 'selected' : ''}>All</option></select>
        </div>
        ${!findings.length ? `<div class="empty">${sc.state === 'complete' ? 'No issues found.' : live ? 'Scanning… results appear here when it finishes.' : 'Not scanned yet.'}</div>` : !shown.length ? '<div class="empty">No findings match these filters.</div>' : `
        <div class="table-wrap"><table class="grid">
          <thead><tr><th style="width:34px">✓</th><th>Severity</th><th>Page / path</th><th>Where</th><th>Unique CSS selector</th><th>Finding</th><th>Assignee</th></tr></thead>
          <tbody>${shown.map((f) => {
            const dev = (f.visibleOn && f.visibleOn[0]) || (f.devices && f.devices[0]) || 'desktop';
            const who = f.assignee || '';
            return `<tr class="${f.done ? 'done' : ''}">
              <td><input type="checkbox" class="check" data-done="${esc(f.id)}" ${f.done ? 'checked' : ''} title="${f.done ? 'Checked off ' + esc(fmtDate(f.doneAt)) : 'Mark as fixed'}"></td>
              <td><span class="badge sev-${f.severity}">${esc(f.severity)}</span><div class="small faint" style="margin-top:4px">${esc(f.category)}</div></td>
              <td style="max-width:220px"><a href="${esc(previewUrl(s, f.path, dev))}" target="_blank" rel="noopener" class="mono" title="Open ${esc(A.DEVICE_LABEL[dev])} preview">${esc(f.path)}</a>
                ${f.pages && f.pages.length > 1 ? `<details class="small"><summary class="muted" style="font-weight:500">+${f.pages.length - 1} more pages</summary><div class="mono faint" style="max-height:140px;overflow:auto">${f.pages.slice(1).map(esc).join('<br>')}</div></details>` : ''}</td>
              <td><div class="loc">${esc(f.location)}</div>${devChips(f)}</td>
              <td class="cell-sel">${f.selector && f.selector !== '(page)' ? `<code class="sel" data-copy="${esc(f.selector)}" title="Click to copy selector">${esc(f.selector)}</code><button class="btn sm ghost" data-snippet="${esc(f.selector)}" data-dev="${esc(dev)}" title="Copy a console snippet that scrolls to and highlights this element">⌖ highlight snippet</button>` : '<span class="faint">(whole page)</span>'}</td>
              <td style="min-width:260px"><div class="finding-msg">${esc(f.message)}</div>
                ${f.found ? `<div class="kv"><b>Found:</b> ${esc(f.found)}</div>` : ''}
                ${f.expected ? `<div class="kv"><b>Expected:</b> ${esc(f.expected)}</div>` : ''}
                ${f.snippet && f.snippet !== f.found ? `<div class="snip">${esc(f.snippet)}</div>` : ''}
                ${f.hiddenOn && f.hiddenOn.length ? `<div class="small faint">Hidden: ${esc(f.hiddenOn.join(', '))}</div>` : ''}</td>
              <td><span class="member-select">${avatar(who || s.assignee)}<select data-fwho="${esc(f.id)}">${memberOptions(who, s.assignee && member(s.assignee) ? `${member(s.assignee).name} (site default)` : 'Unassigned')}</select></span></td>
            </tr>`;
          }).join('')}</tbody></table></div>`}
      </div>
      ${s.pages && s.pages.length ? `<details class="panel panel-pad" style="margin-top:16px"><summary>Pages scanned (${s.pages.length})</summary>
        <div class="table-wrap" style="margin-top:10px"><table class="grid"><thead><tr><th>Path</th><th>SEO title</th><th>Devices</th><th>Status</th></tr></thead><tbody>
        ${s.pages.map((p) => `<tr><td class="mono"><a href="${esc(previewUrl(s, p.path, 'desktop'))}" target="_blank" rel="noopener">${esc(p.path)}</a></td><td>${esc(p.title)}</td><td>${(p.devices || []).map((d) => `<span class="dev on">${A.DEVICE_LABEL[d]}</span>`).join('')}</td><td>${p.notFound ? '<span class="badge sev-critical">404</span>' : p.error ? `<span class="badge sev-warning">${esc(p.error)}</span>` : '<span class="badge scan-complete">OK</span>'}</td></tr>`).join('')}
        </tbody></table></div></details>` : ''}`;

    const v = $('#view');
    $('#sAssign').onchange = async (e) => { await Store.patchSite(s.id, { assignee: e.target.value }); renderSite(); };
    $('#sStatus').onchange = async (e) => { await Store.patchSite(s.id, { status: e.target.value }); renderSite(); };
    $('#sRescan').onclick = () => { enqueue(s.id); renderSite(); };
    $('#sCsv').onclick = () => {
      const rows = findings.map((f) => Object.assign({}, f, { assigneeName: (member(f.assignee || s.assignee) || {}).name || '' }));
      const blob = new Blob([A.toCSV(rows, s.businessName || s.siteId)], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `audit-${slug(s.businessName || s.siteId)}.csv`; a.click();
    };
    v.querySelectorAll('[data-sev]').forEach((b) => (b.onclick = () => { ff.sev = b.dataset.sev; if (ff.done === 'done') ff.done = 'open'; renderSite(); }));
    $('#ffq') && ($('#ffq').oninput = (e) => { ff.q = e.target.value; const p = e.target.selectionStart; renderSite(); const i = $('#ffq'); i.focus(); i.setSelectionRange(p, p); });
    [['#ffcat', 'cat'], ['#ffloc', 'loc'], ['#ffdev', 'dev'], ['#ffwho', 'who'], ['#ffdone', 'done']].forEach(([sel, k]) => { const el = $(sel); if (el) el.onchange = (e) => { ff[k] = e.target.value; renderSite(); }; });
    v.querySelectorAll('[data-copy]').forEach((c) => (c.onclick = () => copy(c.dataset.copy, 'Selector copied')));
    v.querySelectorAll('[data-snippet]').forEach((b) => (b.onclick = () => {
      const sel = JSON.stringify(b.dataset.snippet);
      const snip = `(s=>{const e=document.querySelector(s);if(!e)return console.warn('Not found on this device view:',s);let p=e;while(p){if(p.id==='hamburger-drawer'){console.log('This element is inside the side panel (hamburger menu) — open it to see.');}p=p.parentElement;}e.scrollIntoView({block:'center'});e.style.outline='4px solid #e11d48';e.style.outlineOffset='2px';console.log(e);})(${sel})`;
      copy(snip, `Snippet copied — paste it in the ${A.DEVICE_LABEL[b.dataset.dev]} preview's console`);
    }));
    v.querySelectorAll('[data-done]').forEach((c) => (c.onchange = async () => {
      const f = findings.find((x) => x.id === c.dataset.done); f.done = c.checked; f.doneAt = c.checked ? new Date().toISOString() : null;
      c.closest('tr').classList.toggle('done', c.checked);
      try { await Store.patchFinding(s.id, [f.id], { done: c.checked }); } catch (e) { toast('Save failed: ' + e.message); }
      setTimeout(() => { if (ff.done !== 'all') renderSite(); }, 350);
    }));
    v.querySelectorAll('[data-fwho]').forEach((sel) => (sel.onchange = async () => {
      const f = findings.find((x) => x.id === sel.dataset.fwho); f.assignee = sel.value;
      try { await Store.patchFinding(s.id, [f.id], { assignee: sel.value }); } catch (e) { toast('Save failed: ' + e.message); }
      renderSite();
    }));
  }

  // ---------- Guide ----------
  function renderGuide() {
    $('#view').innerHTML = `<div class="guide">
      <div class="page-head"><div><h1>Setup guide</h1><div class="muted">From zero to a live team app on Vercel in about 15 minutes. No coding needed.</div></div></div>
      <ol class="steps">
        <li class="panel"><h3>Get the project files</h3>
          <p>Unzip <code>duda-site-auditor.zip</code>. You should see <code>api/</code>, <code>public/</code>, <code>package.json</code>, <code>vercel.json</code> and <code>README.md</code>.</p></li>
        <li class="panel"><h3>Put it on GitHub</h3>
          <ul><li>Go to <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>, name it <code>duda-site-auditor</code>, choose <b>Private</b>, then click <b>Create repository</b>.</li>
          <li>On the new repo page click <b>uploading an existing file</b>, drag in <b>everything inside</b> the unzipped folder (not the folder itself), then click <b>Commit changes</b>.</li></ul>
          <p class="small muted">Prefer the terminal? <code>npm i -g vercel</code>, then run <code>vercel</code> inside the folder and skip step 3.</p></li>
        <li class="panel"><h3>Import into Vercel</h3>
          <ul><li>Open <a href="https://vercel.com/new" target="_blank" rel="noopener">vercel.com/new</a> → <b>Import</b> your <code>duda-site-auditor</code> repo.</li>
          <li>Framework preset: <b>Other</b>. Leave the build and output settings empty. Don't click Deploy yet. Add the variables in step 4 first.</li></ul></li>
        <li class="panel"><h3>Add environment variables (Settings → Environment Variables)</h3>
          <table><tr><th>Name</th><th>Value</th><th></th></tr>
          <tr><td><code>DUDA_API_USERNAME</code></td><td>Your Duda API user</td><td>Required</td></tr>
          <tr><td><code>DUDA_API_PASSWORD</code></td><td>Your Duda API password</td><td>Required. Tick <b>Sensitive</b></td></tr>
          <tr><td><code>APP_PASSWORD</code></td><td>A team password you choose</td><td>Strongly recommended. It locks the app.</td></tr>
          <tr><td><code>ALLOWED_EDITOR_HOSTS</code></td><td><code>responsivesiteeditor.com</code></td><td>Optional. Add your white-label editor domain if it's different.</td></tr></table>
          <p><b>Shared team storage (so members, statuses and checkboxes sync for everyone):</b> in your Vercel project open <b>Storage → Create Database → Upstash for Redis (free)</b> → <b>Connect to project</b>. It adds <code>KV_REST_API_URL</code> and <code>KV_REST_API_TOKEN</code> for you. If you skip this, the app still works but saves data only in your own browser.</p></li>
        <li class="panel"><h3>Deploy</h3>
          <p>Click <b>Deploy</b> (or <b>Deployments → Redeploy</b> after changing variables). Vercel gives you a URL like <code>duda-site-auditor.vercel.app</code>. Open it, enter your APP_PASSWORD, and share the URL and password with your team.</p></li>
        <li class="panel"><h3>Audit a website</h3>
          <ul><li>Click <b>Members</b> and add your team.</li>
          <li>Click <b>+ Add website</b>, paste one or more editor links (one per line) like <code>https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home</code>, pick an assignee and click <b>Add &amp; start audit</b>.</li>
          <li>Keep the tab open while it scans. Each site shows <b>Scanning 40/120</b>, then <b>✓ Scan complete</b>.</li>
          <li>Open a site to see the findings table: <b>page path · where (header/footer/side panel/popup + devices) · unique CSS selector · finding</b>. Tick the checkbox when an item is fixed, and reassign a tricky item to someone else if needed.</li>
          <li>Set the website status: <b>In progress → Complete with query / Complete / On hold</b>. Click <b>Rescan</b> after fixes. Checkboxes and assignees carry over for issues that still exist.</li></ul></li>
        <li class="panel"><h3>Jump to an element fast</h3>
          <p>Click a selector to copy it, or click <b>⌖ highlight snippet</b>. Then open the page's device preview (click the path), open DevTools (<code>Cmd+Option+J</code> / <code>Ctrl+Shift+J</code>) and paste. The element scrolls into view with a red outline. Items marked <b>Side panel</b> are inside the hamburger menu, so open it first.</p></li>
      </ol>
      <div class="panel panel-pad" style="margin-top:16px"><h2>What gets checked</h2>
        <ul>
          <li><b>Contact info vs Business Info:</b> every phone and email in text, buttons, tel:/mailto:/sms: links, alt/title/aria attributes, meta tags and schema. Also buttons that <i>show</i> one number but <i>dial</i> another.</li>
          <li><b>Leftovers from other clients:</b> social links, Google Maps embeds and links, logo alt text and copyright lines that name a different business, plus a text search for those names on every page. Also links to other Duda sites or editor/preview URLs.</li>
          <li><b>Every device:</b> Desktop, Tablet and Mobile are fetched separately, including side panels (hamburger drawers), popups and elements hidden on some devices. Each finding shows where it's visible.</li>
          <li><b>Links:</b> broken internal pages (404), broken external links and images, empty buttons, insecure http links.</li>
          <li><b>Images:</b> missing, empty, generic or filename alt text.</li>
          <li><b>Meta / SEO:</b> missing/long/duplicate titles and descriptions, noindex pages, missing H1, canonical domain, og:image.</li>
          <li><b>Content:</b> lorem ipsum, template placeholders, 555 numbers, {{unresolved}} fields, outdated copyright year.</li>
          <li><b>Facebook / Google Business:</b> best-effort comparison of name/phone/email (general note).</li>
        </ul>
        <p class="small muted">Always review manually: business hours, prices, service areas, form recipient emails (not visible in page HTML) and anything shown only inside images.</p>
      </div>
    </div>`;
  }

  // ---------- boot ----------
  $('#btnAdd').onclick = openAdd;
  $('#btnMembers').onclick = openMembers;
  window.addEventListener('hashchange', render);
  (async () => {
    $('#view').innerHTML = '<div class="empty">Loading…</div>';
    await Store.init();
    render();
    // Refresh the list from team storage every 30s so teammates' changes show up
    setInterval(async () => {
      if (state.mode !== 'kv' || modalOpts || document.hidden) return;
      try { const r = await api('/api/store?op=list'); state.members = r.members || state.members; state.sites = r.sites || state.sites; if (route().name === 'sites') renderSites(); } catch (e) { /* ignore */ }
    }, 30000);
  })();
})();
