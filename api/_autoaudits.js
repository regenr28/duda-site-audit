// Settings → Auto audits: every check that runs by itself on every website, in one place, each with
// what it checks, when it runs, and how (and whom) it tells.
//
// Each auto audit keeps its own settings in P+'aacfg:<id>' (only what somebody changed; the rest are
// the defaults below) and its last run in P+'aarun:<id>'. The jobs themselves stay where they were
// (_watch.js, _domains.js, _leadkv.js, _presence.js); they ask aaCfg() what to do and aaSend() to tell.
import { redis, P, jparse, listUsers, notifyUser, appUrl } from './_lib.js';

const DAY = 86400000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// The daily runs Vercel starts (vercel.json crons), in UTC.
const CRON = { watch: [22, 20], sweep: [21, 50] };

/**
 * The auto audits. `checks` is the tree shown with checkboxes (a group's children are the specific
 * checks); `fields` are the extra settings; `notify.vars` are the words a message template may use.
 */
export const AA = [
  {
    id: 'bizinfo', icon: '🔎', title: 'Business Info check (live websites)', cron: 'watch',
    desc: 'Every published website is read like a visitor reads it and compared with its Business Info: another business’s phone, email, address, name or social account anywhere on it. A website is read again as soon as it is published, and every few weeks regardless.',
    checks: [
      { k: 'contact', label: 'Contact details', kids: [
        { k: 'phone', label: 'Phone numbers that are not in Business Info (tap-to-call links, the text, Google business data)' },
        { k: 'email', label: 'Email addresses that are not in Business Info (mailto links and the text)' },
        { k: 'address.street', label: 'Street addresses that are not theirs' },
        { k: 'address.town', label: 'A town and ZIP that are not theirs (to check: it may be an area they serve)' },
        { k: 'address.map', label: 'A Google map showing an address that is not theirs' },
      ] },
      { k: 'name', label: 'Business name', kids: [
        { k: 'name.copyright', label: 'Copyright line naming a different business' },
        { k: 'name.schema', label: 'Google business data (schema) naming a different business' },
      ] },
      { k: 'social', label: 'Social accounts', kids: [
        { k: 'social.account', label: 'Links to a social account that is not theirs' },
        { k: 'social.video', label: 'YouTube videos on another business’s channel' },
      ] },
      { k: 'schema', label: 'Google business data', kids: [
        { k: 'schema.local', label: 'Local Business Schema not turned on (home page)' },
        { k: 'schema.ownname', label: 'Their own business data with the page title as the name' },
      ] },
    ],
    fields: [
      { k: 'recheckDays', label: 'Read every website again after (days), even when it was not published', type: 'number', min: 7, max: 90, def: 30 },
      { k: 'maxPages', label: 'Pages read per website, at most', type: 'number', min: 10, max: 300, def: 100 },
      { k: 'pace', label: 'Reading speed (every website is on Duda\u2019s servers, which refuse connections when asked too fast)', type: 'select', def: 'gentle',
        options: [['gentle', 'Gentle: 2 pages at a time, a short pause between websites (recommended)'], ['slow', 'Slow: 1 page at a time, a longer pause (if it keeps taking breaks)'], ['normal', 'Fast: 4 pages at a time (may be refused and take breaks)']] },
      { k: 'toAudits', label: 'Add what it finds as audit items on the Audits tab', type: 'select', def: 'auto',
        options: [['auto', 'Only to audits made by an auto audit (SEO websites), never to audits scanned by hand'], ['all', 'To every audit of the website'], ['none', 'Never: keep it on DR Websites only']] },
    ],
    notify: {
      instant: 'At once, when a website is published with a serious problem', daily: 'One daily report of every website with new serious problems',
      vars: { websites: 'how many websites', name: 'the website', domain: 'its address', problems: 'what was found, one per line', link: 'link to its audit items', date: 'today’s date' },
      headline: '🚨 *CRITICAL ERRORS FOUND!*{multi}', line: '*{name}*\nError found:\n{problems}\n{link}',
    },
  },
  {
    id: 'editorial', icon: '📷', title: 'Editorial stock photos', cron: 'watch', with: 'bizinfo',
    desc: 'Every published website is checked for Shutterstock photos licensed for editorial use only (Settings → Editorial photos). It runs in the same reading as the Business Info check, so it costs no extra visits. Turning it on reads every website once more.',
    checks: [
      { k: 'stock', label: 'Editorial photos', kids: [
        { k: 'stock.name', label: 'By the Shutterstock ID in the file name' },
        { k: 'stock.look', label: 'By how the photo looks (renamed copies), using the fingerprints made when the website was audited' },
        { k: 'stock.data', label: 'Every slide of a slider, gallery pictures and backgrounds of hidden sections' },
      ] },
    ],
    fields: [],
    notify: {
      instant: 'At once, when a website is published with an editorial photo', daily: 'One daily report of every website with new editorial photos',
      vars: { websites: 'how many websites', name: 'the website', domain: 'its address', problems: 'the photos found, one per line', link: 'link to its audit items', date: 'today’s date' },
      headline: '📷 *Editorial stock photos found*{multi}', line: '*{name}*\n{problems}\n{link}',
    },
  },
  {
    id: 'domains', icon: '🌐', title: 'Domain monitoring', cron: 'sweep',
    desc: 'Every live custom domain is opened once a day: does it still show the website, and when does its registration run out. (Security certificates are Duda’s job and are not reported.)',
    checks: [
      { k: 'dom', label: 'Domains', kids: [
        { k: 'down', label: 'The website does not open' },
        { k: 'redirect', label: 'The domain shows another website' },
        { k: 'expiring', label: 'Registration runs out within 30 days' },
        { k: 'expired', label: 'Registration has expired' },
        { k: 'up', label: 'Working again after a problem' },
      ] },
    ],
    fields: [],
    notify: {
      instant: 'At once, when a domain stops working, starts working again, or is about to run out', daily: 'One daily report of everything still open',
      vars: { websites: 'how many websites', name: 'the website', domain: 'its address', problems: 'what is wrong', link: 'link to the website', date: 'today’s date' },
      headline: '*Domain check*{multi}', line: '*{name}* ({domain}): {problems}',
    },
  },
  {
    id: 'quiet', icon: '📭', title: 'Forms gone quiet', cron: 'watch',
    desc: 'Websites that usually get enquiries through their forms and have suddenly had none: often a broken form or website. Each website is reported once per silence.',
    checks: [
      { k: 'q', label: 'Reported with', kids: [
        { k: 'q.domain', label: 'The domain’s state when it is not working' },
        { k: 'q.form', label: '“No contact form found on the live website”' },
      ] },
    ],
    fields: [
      { k: 'min', label: 'Only websites with at least this many enquiries in a year', type: 'number', min: 1, max: 100, def: 6 },
      { k: 'gaps', label: 'Quiet after this many of its usual gaps between enquiries', type: 'number', min: 2, max: 10, def: 3 },
      { k: 'minDays', label: '…and at least this many days', type: 'number', min: 7, max: 120, def: 21 },
    ],
    notify: {
      daily: 'One daily message with the websites that have just gone quiet',
      vars: { websites: 'how many websites', name: 'the website', domain: 'its address', days: 'days without an enquiry', usual: 'enquiries a month, usually', problems: 'what else is wrong', date: 'today’s date' },
      headline: '📭 *Forms gone quiet*{multi}', line: '{name}: no enquiry for {days} days (usually {usual} a month){problems}',
    },
  },
  {
    id: 'presence', icon: '📣', title: 'Online presence', cron: 'watch',
    desc: 'Compares what each business’s Google Business Profile, Facebook and its other profiles show with Business Info, about once a month per website. Uses AI web searches.',
    checks: [
      { k: 'pl', label: 'Profiles compared', kids: [
        { k: 'pl.google', label: 'Google Business Profile' }, { k: 'pl.facebook', label: 'Facebook' },
        { k: 'pl.instagram', label: 'Instagram (when Business Info lists it)' }, { k: 'pl.youtube', label: 'YouTube (when Business Info lists it)' }, { k: 'pl.yelp', label: 'Yelp (when Business Info lists it)' },
      ] },
    ],
    fields: [
      { k: 'perDay', label: 'Websites a day, at most', type: 'number', min: 1, max: 200, def: 20 },
      { k: 'clientDefault', label: 'Show the suggestions to customers in their portal', type: 'bool', def: false },
    ],
    notify: null,
  },
  {
    id: 'seo', icon: '🔍', title: 'SEO websites', cron: null,
    desc: 'Websites with the Duda label \u201cSEO Customer\u201d (the SEO company works on them) get a full audit, like a Rescan, some hours after each publish, one at a time, in the team\u2019s scan line. Their audits are on the Audits tab, marked as auto audited.',
    checks: [
      { k: 'seo', label: 'Each audit (every check of a full scan, the same as Rescan), plus', kids: [
        { k: 'seo.pages', label: 'List the pages the SEO company created (Duda\u2019s activity log)' },
      ] },
    ],
    fields: [
      { k: 'delayH', label: 'Audit this many hours after the last publish (a burst of publishes is audited once)', type: 'number', min: 0, max: 72, def: 4 },
      { k: 'priority', label: 'While websites are still waiting for the editorial photo / Business Info check', type: 'select', def: 'interleave',
        options: [['interleave', 'Mix them in: one SEO website after every few websites read (below)'], ['after', 'Wait: no SEO website until every website has been read'], ['first', 'SEO websites first: do not wait']] },
      { k: 'everyN', label: 'One SEO website after every this many websites read', type: 'number', min: 1, max: 100, def: 5 },
    ],
    notify: null,
  },
];
export const aaDef = (id) => AA.find((x) => x.id === id) || null;
const KEY = (id) => P + 'aacfg:' + id;
const RUN = (id) => P + 'aarun:' + id;

const allKeys = (def) => def.checks.flatMap((g) => g.kids.map((c) => c.k));
function defaults(def) {
  const f = {}; (def.fields || []).forEach((x) => { f[x.k] = x.def; });
  return { on: def.id !== 'presence', days: ALL_DAYS.slice(), checks: {}, fields: f,
    notify: def.notify ? { on: true, instant: !!def.notify.instant, daily: !!def.notify.daily, to: 'admins', people: [], headline: '', line: '', footer: '', links: true } : null };
}
/** One auto audit's settings: the defaults with whatever somebody changed on top. */
export async function aaCfg(id, raw) {
  const def = aaDef(id); if (!def) return null;
  let saved = raw;
  if (saved === undefined) [saved] = await redis(['GET', KEY(id)]);
  const s = jparse(saved) || {};
  const d = defaults(def);
  const out = Object.assign({}, d, s, { fields: Object.assign({}, d.fields, s.fields || {}), checks: Object.assign({}, s.checks || {}),
    notify: d.notify ? Object.assign({}, d.notify, s.notify || {}) : null });
  // Online presence keeps its own switch where it always was.
  if (id === 'presence') {
    const { presenceCfg } = await import('./_presence.js');
    const pc = await presenceCfg();
    out.on = !!pc.auto; out.fields.perDay = pc.perDay; out.fields.clientDefault = !!pc.clientDefault;
  }
  return out;
}
/** Is this check (a key from the tree) on? Everything is on unless somebody unticked it. */
export const aaOn = (cfg, k) => !cfg || !cfg.checks || cfg.checks[k] !== false;
/** Does it run today (UTC day of the cron)? */
export const aaToday = (cfg, at = Date.now()) => !!cfg && cfg.on && (cfg.days || ALL_DAYS).includes(new Date(at).getUTCDay());

/** Save settings (admins). Only known keys are kept. */
export async function aaSave(id, body, me) {
  const def = aaDef(id); if (!def) throw Object.assign(new Error('Unknown auto audit'), { status: 400 });
  const cur = await aaCfg(id);
  const keys = new Set(allKeys(def));
  const checks = {}; Object.entries((body && body.checks) || {}).forEach(([k, v]) => { if (keys.has(k) && v === false) checks[k] = false; });
  const fields = {};
  (def.fields || []).forEach((f) => {
    const v = body && body.fields ? body.fields[f.k] : undefined;
    if (v === undefined) { fields[f.k] = cur.fields[f.k]; return; }
    fields[f.k] = f.type === 'bool' ? !!v : f.type === 'select' ? ((f.options || []).some(([k]) => k === v) ? v : f.def) : Math.max(f.min, Math.min(f.max, Math.round(Number(v)) || (Number(v) === 0 && f.min === 0 ? 0 : f.def)));
  });
  const days = Array.isArray(body.days) ? [...new Set(body.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : cur.days;
  let notify = null;
  if (def.notify) {
    const n = Object.assign({}, cur.notify, body.notify || {});
    const users = await listUsers();
    const okPeople = new Set(users.filter((u) => u.status === 'active' && u.role !== 'client').map((u) => u.email));
    notify = { on: !!n.on, instant: !!def.notify.instant && !!n.instant, daily: !!def.notify.daily && !!n.daily, to: n.to === 'people' ? 'people' : 'admins',
      people: [].concat(n.people || []).map(String).filter((e) => okPeople.has(e)).slice(0, 50),
      headline: String(n.headline || '').slice(0, 300), line: String(n.line || '').slice(0, 600), footer: String(n.footer || '').slice(0, 300), links: n.links !== false };
  }
  const next = { on: body.on === undefined ? cur.on : !!body.on, days: days.length ? days : ALL_DAYS.slice(), checks, fields, notify, by: me.name || me.email, at: Date.now() };
  if (id === 'presence') {
    const { PCFG, presenceCfg } = await import('./_presence.js');
    const pc = await presenceCfg();
    const p = Object.assign({}, pc, { auto: next.on, perDay: fields.perDay, clientDefault: !!fields.clientDefault, by: me.name, at: Date.now() });
    await redis(['SET', PCFG, JSON.stringify(p)], p.auto ? ['SET', P + 'presence:due', '1', 'EX', 86400] : ['DEL', P + 'presence:due']);
  }
  await redis(['SET', KEY(id), JSON.stringify(next)]);
  // Editorial photos switched on, or a check widened: every website is read once more.
  if (id === 'editorial' && next.on && (!cur.on || Object.keys(cur.checks || {}).some((k) => cur.checks[k] === false && checks[k] !== false))) await bumpStockVer();
  return aaCfg(id);
}

/** Every website is read once more for editorial photos (it starts at 1: never read for them yet). */
export async function bumpStockVer() {
  const [v] = await redis(['GET', P + 'stock:ver']);
  await redis(['SET', P + 'stock:ver', String((Number(v) || 1) + 1)]);
}
/** Remember a run: when, by whom, the last website, and a one-line note. */
export async function aaMark(id, info) {
  await redis(['SET', RUN(id), JSON.stringify(Object.assign({ at: Date.now() }, info || {}))]).catch(() => {});
}

// ---------- telling people ----------
/** Fill a template: {name}, {problems}… Unknown words are left as they are. */
export function aaFill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}
async function recipients(cfg) {
  const users = (await listUsers()).filter((u) => u.status === 'active' && u.role !== 'client');
  if (cfg.notify && cfg.notify.to === 'people') { const want = new Set(cfg.notify.people || []); return users.filter((u) => want.has(u.email)); }
  return users.filter((u) => u.role === 'admin');
}
/**
 * Build the message from the auto audit's templates (or the defaults) and send it to its people.
 * `when` is 'instant' or 'daily'; `items` are the websites, each with the words its template uses.
 * Returns how many people were told (0 when its notifications are off for that moment).
 */
export async function aaSend(id, when, base, items, opts = {}) {
  const def = aaDef(id); const cfg = await aaCfg(id);
  if (!def || !def.notify || !cfg.notify || !cfg.notify.on || !cfg.notify[when]) return 0;
  const m = aaMessage(def, cfg, base, items, opts);
  const people = await recipients(cfg);
  await Promise.all(people.map((u) => notifyUser(u.email, m).catch(() => {})));
  return people.length;
}
/** The message itself (also used for the preview and "Send me a test"). */
export function aaMessage(def, cfg, base, items, opts = {}) {
  const n = cfg.notify || {};
  const date = new Date().toISOString().slice(0, 10);
  // A job may bring its own standard headline (worked out from what it found); a custom one always wins.
  const head = aaFill(n.headline || (base && base.headlineDefault) || def.notify.headline, { websites: items.length, multi: items.length > 1 ? ` (${items.length} websites)` : '', date });
  const max = opts.max || 12;
  const blocks = items.slice(0, max).map((it) => {
    const vars = Object.assign({ date, websites: items.length }, it, { link: n.links !== false && it.link ? it.link : '' });
    return aaFill(n.line || def.notify.line, vars).replace(/\s*\(\s*\)/g, '').replace(/\n{2,}/g, '\n').replace(/\n$/, '').trim();
  });
  if (items.length > max) blocks.push(`and ${items.length - max} more`);
  const footer = n.footer ? aaFill(n.footer, { websites: items.length, date }) : '';
  // The one-line version (pop-ups, email): the website's own short summary when the standard wording is used.
  const lines = blocks.map((b, i) => (!n.line && items[i] && items[i].plain ? items[i].plain : b.replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/[*_]/g, '').replace(/\n/g, ' · ')));
  const b = Object.assign({}, base); delete b.headlineDefault;
  return Object.assign({ by: '', byName: def.title, siteName: '', dudaSite: '', count: items.length }, b, {
    headline: head, sections: blocks.concat(footer ? [footer] : []), lines: lines.concat(footer ? [footer.replace(/[*_]/g, '')] : []), text: lines.join('\n') + (footer ? '\n' + footer : '') });
}
/** A Slack link to a page of this app. */
export function aaLink(path, label) { const base = appUrl(); return base ? `<${base}${path}|${label}>` : ''; }

// ---------- the list on Settings → Auto audits ----------
function nextRun(def, cfg, at = Date.now()) {
  if (!cfg.on || !def.cron) return 0;
  const [h, m] = CRON[def.cron] || CRON.watch;
  for (let i = 0; i < 8; i++) {
    const d = new Date(at + i * DAY);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m);
    if (t > at && (cfg.days || ALL_DAYS).includes(new Date(t).getUTCDay())) return t;
  }
  return 0;
}
/** Every auto audit with its state: on, last run, last website, next run, and a short summary. */
export async function aaList() {
  const ids = AA.map((x) => x.id);
  const rows = await redis(...ids.map((id) => ['GET', KEY(id)]), ...ids.map((id) => ['GET', RUN(id)]));
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const def = AA[i]; const cfg = await aaCfg(def.id, rows[i]);
    out.push({ id: def.id, icon: def.icon, title: def.title, desc: def.desc, on: cfg.on, days: cfg.days, last: jparse(rows[ids.length + i]) || null, next: nextRun(def, cfg),
      notify: cfg.notify ? { on: cfg.notify.on, instant: cfg.notify.instant, daily: cfg.notify.daily, to: cfg.notify.to, people: (cfg.notify.people || []).length } : null, by: cfg.by || '', changedAt: cfg.at || 0 });
  }
  // What each one is doing, from the records the jobs already keep.
  const [wl, wsum, doms, sweepAt, recent] = await redis(['GET', P + 'cwlastrun'], ['HGETALL', P + 'cwsum'], ['HGETALL', P + 'domstat'], ['GET', P + 'domsweep'], ['LRANGE', P + 'cwrecent', 0, 0]);
  const sums = []; for (let k = 0; wsum && k < wsum.length; k += 2) sums.push(jparse(wsum[k + 1]) || {});
  const lastRun = jparse(wl); const lastSite = jparse((recent || [])[0]);
  const [pauseRaw] = await redis(['GET', P + 'cwcfg']); const pause = jparse(pauseRaw) || {};
  const biz = out.find((x) => x.id === 'bizinfo'); const ed = out.find((x) => x.id === 'editorial');
  [biz, ed].forEach((r) => {
    if (pause.off) r.paused = { by: pause.by || '', at: pause.at || 0 };
    if (!r.last && lastRun) r.last = { at: lastRun.at, by: lastRun.by, done: lastRun.done };
    if (lastSite && r.last && !r.last.site) r.last.site = { id: lastSite.id, name: lastSite.name || lastSite.domain || '' };
  });
  // What the reading is doing right now: the "Next run" column alone made it look stopped.
  const [nowRaw, waitRaw, lockRaw, statRaw] = await redis(['GET', P + 'cwnow'], ['GET', P + 'cwwait'], ['GET', P + 'cwlock'], ['GET', P + 'cwstat']);
  const nowR = jparse(nowRaw); const wait = jparse(waitRaw) || {}; const stat = jparse(statRaw) || {};
  const live = { pending: stat.pending || 0, reading: nowR ? (nowR.name || nowR.domain || '') : '', running: !!lockRaw,
    waitUntil: wait.until > Date.now() ? wait.until : 0, waitWhy: wait.until > Date.now() ? wait.why || '' : '' };
  [biz, ed].forEach((r) => { r.live = live; });
  const read = sums.filter((s) => s.at && !s.err);
  biz.summary = `${read.length} websites read · ${read.filter((s) => s.c && (!s.t || Object.keys(s.t).some((t) => t !== 'stock'))).length} with serious problems`;
  const [ver] = await redis(['GET', P + 'stock:ver']);
  const withStock = read.filter((s) => s.t && s.t.stock).length;
  const checked = read.filter((s) => (s.sv || 0) >= (Number(ver) || 1)).length;
  ed.summary = `${checked} of ${read.length} websites checked for editorial photos · ${withStock} with editorial photos`;
  const dm = out.find((x) => x.id === 'domains');
  let dn = 0, bad = 0, lastDom = null;
  for (let k = 0; doms && k < doms.length; k += 2) { const v = jparse(doms[k + 1]); if (!v || !v.domain) continue; dn++; if (v.status && !/^(ok|nodomain)$/.test(v.status)) bad++; if (!lastDom || (v.checkedAt || 0) > (lastDom.checkedAt || 0)) lastDom = Object.assign({ id: doms[k] }, v); }
  if (!dm.last && sweepAt) dm.last = { at: Date.parse(sweepAt) || 0, by: 'cron' };
  if (dm.last && lastDom && !dm.last.site) dm.last.site = { id: lastDom.id, name: lastDom.domain };
  dm.summary = `${dn} domains watched · ${bad} not working right`;
  const q = out.find((x) => x.id === 'quiet');
  q.summary = q.last && q.last.quiet !== undefined ? `${q.last.quiet} websites quiet · ${q.last.fresh || 0} newly reported last time` : 'Runs with the daily report';
  const so = out.find((x) => x.id === 'seo');
  try {
    const [runs, stat, since] = await redis(['HGETALL', P + 'seoauto'], ['GET', P + 'cwstat'], ['GET', P + 'aa:sinceSeo']);
    let latest = null; for (let k = 0; runs && k < runs.length; k += 2) { const v = jparse(runs[k + 1]); if (v && (!latest || String(v.at) > String(latest.at))) latest = Object.assign({ id: runs[k] }, v); }
    if (!so.last && latest) so.last = { at: Date.parse(latest.at) || 0, by: latest.by || '', site: { id: latest.id, name: latest.name || latest.id } };
    const cfgS = await aaCfg('seo'); const pend = (jparse(stat) || {}).pending || 0;
    so.summary = !so.on ? 'Off' : pend && cfgS.fields.priority === 'after' ? `Waiting: ${pend} websites still to read first` : pend && cfgS.fields.priority === 'interleave' ? `One SEO website after every ${cfgS.fields.everyN} websites read (${Number(since) || 0} read since the last)` : `Audited ${cfgS.fields.delayH} hours after each publish`;
    so.nextText = `${cfgS.fields.delayH} hours after each publish`;
  } catch (e) { so.summary = ''; }
  const pr = out.find((x) => x.id === 'presence');
  pr.summary = pr.on ? 'About once a month per website' : 'Off: runs only when somebody checks a website';
  return out;
}
/** One auto audit's full settings, its tree and fields, and the people who may be told. */
export async function aaDetail(id) {
  const def = aaDef(id); if (!def) return null;
  const cfg = await aaCfg(id);
  const users = (await listUsers()).filter((u) => u.status === 'active' && u.role !== 'client').map((u) => ({ email: u.email, name: u.name || u.email, admin: u.role === 'admin' }));
  const row = (await aaList()).find((x) => x.id === id) || {};
  return { def, cfg, users, last: row.last || null, next: nextRun(def, cfg), nextText: row.nextText || '', summary: row.summary || '', paused: row.paused || null, cronUtc: CRON[def.cron] || CRON.watch };
}
/** A made-up example for the preview and "Send me a test". */
export function aaSample(id) {
  const ex = {
    bizinfo: [{ name: 'Harker Heights Ceramic Coatings', domain: 'example-detail.com', problems: '• 2 phone numbers incorrect\n• 1 incorrect business name found', link: aaLink('/#/live', 'Audit items') }],
    editorial: [{ name: 'Harker Heights Ceramic Coatings', domain: 'example-detail.com', problems: '• Shutterstock 2639635421 (shutterstock_2639635421.jpg) on /gallery', link: aaLink('/#/live', 'Audit items') }],
    domains: [{ name: 'Harker Heights Ceramic Coatings', domain: 'example-detail.com', problems: 'shows another website', link: '' }],
    quiet: [{ name: 'Harker Heights Ceramic Coatings', domain: 'example-detail.com', days: 34, usual: 4.5, problems: ' · no contact form found on the live website' }],
  };
  return ex[id] || [];
}
