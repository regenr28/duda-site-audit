// System health, for whoever runs the app.
//
// The point is not a wall of numbers. It is to answer three questions before they become problems:
// is anything about to run out, is anything that should be arriving not arriving, and how long have
// we got. Everything here is either read cheaply on every load, or measured on demand and kept.
//
// Owner only. It names the services the app is built on, which nothing else in the app does.
import {
  redis, redisRaw, P, requireUser, readBody, jparse, OWNER_EMAIL, unpackJSON, now,
  emailEnabled, slackBotEnabled, listUsers,
} from './_lib.js';
import { sqlReady, rows as sqlRows, ensureSchema } from './_sql.js';
import { _test as ai } from './ai.js';
import { queueState, alertOwner, recentAlerts } from './_queue.js';
import { lastRuns } from './leadq.js';

// What the free allowances are. Kept here, in one place, so a figure that changes is changed once.
const LIMITS = {
  kvBytes: 256 * 1024 * 1024,     // key-value store: total data
  kvCmds: 500000,                 // key-value store: commands a month
  sqlBytes: 5 * 1024 * 1024 * 1024, // analysis database: total data
  sqlWrites: 10000000,            // analysis database: rows written a month
};
const MONTH = () => new Date().toISOString().slice(0, 7);

/** "2 hours ago" — the only form of a timestamp that answers "is this stale" at a glance. */
function ago(t) {
  const ms = Date.now() - (typeof t === 'number' ? t : Date.parse(t));
  if (!(ms >= 0)) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Healthy / watch / act, with a word rather than only a colour. */
function band(pct) {
  if (pct >= 85) return { state: 'critical', label: 'Act now' };
  if (pct >= 70) return { state: 'serious', label: 'Watch closely' };
  if (pct >= 50) return { state: 'warning', label: 'Keep an eye on it' };
  return { state: 'good', label: 'Healthy' };
}
const pctOf = (used, limit) => (limit ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0);

/**
 * Measure how much the key-value store actually holds.
 *
 * There is no one command that answers this, so the keys that could be large are measured and the
 * rest estimated from a sample. It costs a few hundred commands, so it runs when somebody asks and
 * the answer is kept — on the page it is a button, not something every page load pays for.
 */
async function measureKv() {
  const [keys] = await redisRaw(['DBSIZE']);
  const [idx] = await redisRaw(['HGETALL', P + 'index']);
  const flat = {};
  if (Array.isArray(idx)) { for (let i = 0; i < idx.length; i += 2) flat[idx[i]] = idx[i + 1]; }
  else if (idx && typeof idx === 'object') Object.assign(flat, idx);
  const ids = Object.keys(flat);
  let bytes = Object.values(flat).reduce((a, v) => a + String(v || '').length, 0);
  const big = [];
  ids.forEach((id) => { big.push(P + 'site:' + id, P + 'cmt:' + id, P + 'act:' + id); });
  for (let i = 0; i < big.length; i += 100) {
    const lens = await redisRaw(...big.slice(i, i + 100).map((k) => ['STRLEN', k]));
    lens.forEach((n) => { bytes += Number(n) || 0; });
  }
  // Everything else — sessions, notifications, fingerprints, lead buckets — is many small keys.
  // A per-key average from what we measured is closer than pretending they are free.
  const measured = ids.length * 3 + 1;
  // A floor, because reporting 0 B while holding keys is simply wrong — and a ceiling, because one
  // enormous audit record must not be taken as the typical size of a session key.
  const avg = measured ? bytes / measured : 0;
  const rest = Math.max(0, Number(keys || 0) - measured);
  const total = Math.round(bytes + rest * Math.min(Math.max(avg, 64), 2048));
  const snap = { at: now(), bytes: total, keys: Number(keys || 0), sites: ids.length };
  await redisRaw(['SET', P + 'health:kv', JSON.stringify(snap)],
    ['LPUSH', P + 'health:kvlog', JSON.stringify({ at: snap.at, bytes: total })],
    ['LTRIM', P + 'health:kvlog', 0, 23]);
  return snap;
}

/** The analysis database measures itself exactly, and cheaply. */
async function measureSql() {
  // This page can be the FIRST thing to touch the analysis database — before a single enquiry has
  // been imported. Without this it reports "no such table" and reads like a broken connection.
  await ensureSchema();
  // NOTE the shapes: three of these want one row, the last wants all of them.
  // The size question is asked separately and allowed to fail: if the provider ever stops answering
  // it, the counts are still worth having, and an unknown size is better than a blank page.
  const [[counts], [written], months] = await Promise.all([
    sqlRows(`SELECT COUNT(*) AS leads, COUNT(DISTINCT site) AS sites,
      SUM(CASE WHEN verdict = 'junk' THEN 1 ELSE 0 END) AS junk,
      SUM(CASE WHEN verdict = 'unsure' THEN 1 ELSE 0 END) AS unsure, MIN(at) AS oldest FROM leads`),
    sqlRows("SELECT COUNT(*) AS n FROM leads WHERE substr(created,1,7) = ?", MONTH()),
    sqlRows(`SELECT substr(at,1,7) AS m, COUNT(*) AS n FROM leads
      WHERE at > datetime('now','-12 months') GROUP BY m ORDER BY m`),
  ]);
  let bytes = 0;
  try {
    const [size] = await sqlRows('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()');
    bytes = Number(size && size.bytes) || 0;
  } catch (e) { bytes = 0; }
  return { bytes, ...counts, writtenThisMonth: Number(written.n) || 0, months: months || [] };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  // Deliberately the owner alone: this page names what the app is built on.
  if (me.email !== OWNER_EMAIL) return res.status(403).json({ error: 'Not available on this account' });

  try {
    if (req.method === 'POST' && readBody(req).op === 'measure') {
      const kv = await measureKv();
      return res.status(200).json({ kv });
    }

    const [cmds, kvSnapRaw, kvLogRaw, hookLogRaw, idxRaw, dudaRaw, cmtVer] = await redisRaw(
      ['GET', P + 'usage:cmd:' + MONTH()],
      ['GET', P + 'health:kv'],
      ['LRANGE', P + 'health:kvlog', 0, 23],
      ['LRANGE', P + 'hooklog', 0, 4],
      ['HGETALL', P + 'index'],
      ['GET', P + 'dudasites'],
      ['GET', P + 'ver:cmt'],
    );
    const kvSnap = jparse(kvSnapRaw) || null;
    const kvLog = (kvLogRaw || []).map((x) => jparse(x)).filter(Boolean);
    const hooks = (hookLogRaw || []).map((x) => jparse(x)).filter(Boolean);
    const flat = {};
    if (Array.isArray(idxRaw)) { for (let i = 0; i < idxRaw.length; i += 2) flat[idxRaw[i]] = idxRaw[i + 1]; }
    else if (idxRaw && typeof idxRaw === 'object') Object.assign(flat, idxRaw);
    const sites = Object.values(flat).map((v) => (typeof v === 'string' ? jparse(v) : v)).filter(Boolean);
    const duda = unpackJSON(dudaRaw);

    // ---- storage ----
    const kvUsed = kvSnap ? kvSnap.bytes : 0;
    const kvPct = pctOf(kvUsed, LIMITS.kvBytes);
    // How fast it is growing, from the measurements themselves rather than a guess.
    let kvPerDay = 0;
    if (kvLog.length >= 2) {
      const first = kvLog[kvLog.length - 1], last = kvLog[0];
      const days = (Date.parse(last.at) - Date.parse(first.at)) / 86400000;
      if (days > 0.5) kvPerDay = (last.bytes - first.bytes) / days;
    }

    let sqlInfo = null;
    if (sqlReady()) {
      try { sqlInfo = await measureSql(); } catch (e) { sqlInfo = { error: String(e.message || e).slice(0, 160) }; }
    }

    // ---- commands this month, and where that lands by month end ----
    const used = Number(cmds || 0);
    const d = new Date();
    const dayOfMonth = d.getUTCDate();
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const projected = Math.round((used / Math.max(dayOfMonth, 1)) * daysInMonth);

    // ---- is everything that should be arriving, arriving ----
    const lastHook = hooks[0] ? hooks[0].at : '';
    const users = (await listUsers()).filter((u) => u.status === 'active');
    const scanned7 = sites.filter((s) => s.scan && s.scan.at && Date.now() - Date.parse(s.scan.at) < 7 * 86400000).length;
    // How many AI services are set up — a count, never which ones.
    let aiCount = 0;
    try { aiCount = ai.providers().length; } catch (e) { aiCount = 0; }

    const connections = [
      { key: 'duda', label: 'Duda API', ok: !!(process.env.DUDA_API_USERNAME && process.env.DUDA_API_PASSWORD),
        // Same reasoning as the webhook: a list that has never been pulled, or stopped being pulled,
        // looks from inside the app exactly like an account with nothing new in it.
        note: duda && duda.at ? `${duda.count || 0} websites, last pulled ${ago(duda.at)}` : 'The website list has never been pulled',
        stale: !(duda && duda.at) || Date.now() - Number(duda.at) > 3 * 86400000 },
      { key: 'hook', label: 'Duda webhook', ok: !!process.env.DUDA_HOOK_KEY,
        // Nothing having ever arrived is worth flagging: it usually means the webhook was never
        // registered at Duda's end, which looks exactly like "a quiet week" from inside the app.
        note: lastHook ? `Last delivery ${ago(lastHook)}` : 'Nothing has ever arrived — check it is registered',
        stale: !lastHook || Date.now() - Date.parse(lastHook) > 3 * 86400000 },
      { key: 'sql', label: 'Analysis database', ok: sqlReady(),
        note: !sqlReady() ? 'Not connected — enquiries are stored in the key-value store instead'
          : sqlInfo && sqlInfo.error ? sqlInfo.error : `${(sqlInfo && sqlInfo.leads) || 0} enquiries`,
        stale: !!(sqlInfo && sqlInfo.error) },
      { key: 'email', label: 'Email', ok: emailEnabled(), note: emailEnabled() ? 'Sending' : 'Not set up — sign-in codes cannot be sent' },
      { key: 'slack', label: 'Slack', ok: slackBotEnabled(), note: slackBotEnabled() ? 'Connected' : 'Not set up' },
      { key: 'realtime', label: 'Live updates', ok: !!(process.env.ABLY_API_KEY || '').includes(':'),
        note: (process.env.ABLY_API_KEY || '').includes(':') ? 'Connected' : 'Not set up — the app falls back to its heartbeat' },
      { key: 'ai', label: 'AI checks', ok: aiCount > 0,
        note: aiCount ? `${aiCount} service${aiCount === 1 ? '' : 's'} configured — the AI page has the daily room left` : 'None configured — the AI checks are skipped' },
    ];

    // ---- the backfill queue, and what was last run by hand ----
    const queue = await queueState().catch(() => ({ pending: 0, running: false, last: null }));
    const runs = await lastRuns(['pull', 'domains', 'leads']).catch(() => ({}));
    const sent = await recentAlerts(10).catch(() => []);

    // ---- what needs doing, in plain words ----
    const alerts = [];
    const sqlPct = sqlInfo && !sqlInfo.error ? pctOf(sqlInfo.bytes, LIMITS.sqlBytes) : 0;
    if (!kvSnap) alerts.push({ level: 'warning', text: 'The key-value store has never been measured. Press Measure now to find out where it stands.' });
    if (kvPct >= 70) alerts.push({ level: kvPct >= 85 ? 'critical' : 'serious', text: `The key-value store is ${kvPct}% full. When it fills, the whole app stops writing — not just one feature.` });
    if (projected > LIMITS.kvCmds * 0.85) alerts.push({ level: 'serious', text: `At this rate the month ends at about ${projected.toLocaleString()} commands, against an allowance of ${LIMITS.kvCmds.toLocaleString()}.` });
    if (sqlPct >= 70) alerts.push({ level: sqlPct >= 85 ? 'critical' : 'serious', text: `The analysis database is ${sqlPct}% full.` });
    // The note is written to stand alone, so it may already name the thing — don't say it twice.
    const say = (c) => (c.note.toLowerCase().startsWith(c.label.toLowerCase()) ? c.note : `${c.label}: ${c.note}`);
    connections.filter((c) => c.ok && c.stale).forEach((c) => alerts.push({ level: 'warning', text: `${say(c)}. Something that should be arriving may not be.` }));
    connections.filter((c) => !c.ok && ['email', 'hook'].includes(c.key)).forEach((c) => alerts.push({ level: 'warning', text: `${c.label} is not set up. ${say(c)}` }));
    if (sqlInfo && sqlInfo.unsure > 50) alerts.push({ level: 'info', text: `${sqlInfo.unsure} enquiries are still unsorted. Lead analysis can have the AI look at them.` });

    // ---- and the ones the owner should be told about away from this page ----
    // Only the things that are actually about to cost something: a page nobody has open is no use
    // when an allowance runs out at 3am. Each is deduplicated by kind for hours, so this can run on
    // every load without ever becoming noise.
    if (kvPct >= 85) await alertOwner('kv-full', `The main database is ${kvPct}% full. When it fills the app stops saving anything — not just one feature.`, { cooldownMs: 6 * 3600 * 1000 }).catch(() => {});
    else if (kvPct >= 70) await alertOwner('kv-high', `The main database is ${kvPct}% full and still growing.`, { cooldownMs: 24 * 3600 * 1000 }).catch(() => {});
    if (projected > LIMITS.kvCmds * 0.85) await alertOwner('cmd-high', `At the current rate this month will use about ${projected.toLocaleString()} database commands against an allowance of ${LIMITS.kvCmds.toLocaleString()}.`, { cooldownMs: 24 * 3600 * 1000 }).catch(() => {});
    if (sqlPct >= 85) await alertOwner('sql-full', `The analysis database is ${sqlPct}% full.`, { cooldownMs: 12 * 3600 * 1000 }).catch(() => {});
    const hookConn = connections.find((c) => c.key === 'hook');
    if (hookConn && hookConn.ok && hookConn.stale) await alertOwner('hook-quiet', `No form submission or comment has arrived from Duda for over three days. If that is not simply a quiet week, the webhook may have stopped — new enquiries would not be reaching the app.`, { cooldownMs: 24 * 3600 * 1000 }).catch(() => {});

    return res.status(200).json({
      at: now(),
      queue: { pending: queue.pending, running: queue.running, last: queue.last },
      runs,
      sentAlerts: sent,
      kv: {
        used: kvUsed, limit: LIMITS.kvBytes, pct: kvPct, ...band(kvPct),
        keys: kvSnap ? kvSnap.keys : 0, measuredAt: kvSnap ? kvSnap.at : '',
        perDay: Math.round(kvPerDay), history: kvLog.slice().reverse(),
        daysLeft: kvPerDay > 0 ? Math.round((LIMITS.kvBytes * 0.85 - kvUsed) / kvPerDay) : null,
      },
      commands: {
        used, limit: LIMITS.kvCmds, pct: pctOf(used, LIMITS.kvCmds), ...band(pctOf(projected, LIMITS.kvCmds)),
        projected, dayOfMonth, daysInMonth,
      },
      sql: sqlReady() ? (sqlInfo && sqlInfo.error ? { error: sqlInfo.error } : {
        used: sqlInfo.bytes, limit: LIMITS.sqlBytes, pct: sqlPct, ...band(sqlPct),
        sizeKnown: sqlInfo.bytes > 0 || !sqlInfo.leads,
        leads: sqlInfo.leads, sites: sqlInfo.sites, junk: sqlInfo.junk, unsure: sqlInfo.unsure,
        oldest: sqlInfo.oldest, writtenThisMonth: sqlInfo.writtenThisMonth, writeLimit: LIMITS.sqlWrites,
        months: sqlInfo.months,
        // At the rate enquiries are arriving, how long until it is 85% full.
        monthsLeft: (() => {
          const per = (sqlInfo.months || []).slice(-3);
          const avg = per.length ? per.reduce((a, m) => a + m.n, 0) / per.length : 0;
          if (!avg || !sqlInfo.leads) return null;
          const perLead = sqlInfo.bytes / sqlInfo.leads;
          return Math.round((LIMITS.sqlBytes * 0.85 - sqlInfo.bytes) / (avg * perLead));
        })(),
      }) : null,
      app: {
        websites: sites.length,
        scanned7,
        complete: sites.filter((s) => (s.status || '') === 'Complete').length,
        openCritical: sites.reduce((a, s) => a + ((s.counts && s.counts.critical) || 0), 0),
        users: users.filter((u) => u.role !== 'client').length,
        clients: users.filter((u) => u.role === 'client').length,
        comments: Number(cmtVer || 0),
      },
      connections, alerts,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
