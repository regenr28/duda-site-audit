// Form submissions, as rows you can ask questions of.
//
// Everything here is a query with an index behind it. The loops this replaces — reading twelve
// monthly buckets, concatenating, sorting and filtering in JavaScript — are gone, and so is the
// reason they existed.
import { leadSig, realPage, clusterDupes, SAME_WINDOW_MS } from './_leadid.js';
import { sql, rows, row, run, ensureSchema, sqlReady } from './_sql.js';
import { judgeByRules, fingerprint, bodyOf } from './_judge.js';

const ISO = (v) => { const d = new Date(v); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
const day = (v) => ISO(v).slice(0, 10);

/** One submission, in the shape the table holds. */
export function toRow(siteId, lead) {
  const f = lead.f || lead.fields || {};
  const [source, medium] = String(lead.src || '').split('/');
  return {
    // Keyed by WEBSITE and id together. Duda's submission ids are only unique within one website —
    // two clients can both have submission "7" — so an id alone would quietly drop the second one.
    id: String(siteId) + ':' + String(lead.id), site: String(siteId), at: ISO(lead.at),
    name: lead.n || '', email: lead.e || '', phone: lead.p || '',
    page: realPage(lead.pg) ? lead.pg : '', form: lead.fm || '', source: source || '', medium: medium || '', campaign: lead.campaign || '',
    fields: JSON.stringify(f), body: bodyOf({ fields: f }).slice(0, 4000),
    fp: fingerprint({ fields: f }), via: lead.via || 'hook', created: new Date().toISOString(),
    sig: lead.sig || leadSig({ n: lead.n, e: lead.e, p: lead.p, f }),
  };
}
/** …and back, so everything that already reads leads keeps working unchanged. */
export const fromRow = (r) => ({
  id: r.id, at: r.at, n: r.name || '', e: r.email || '', p: r.phone || '',
  f: (() => { try { return JSON.parse(r.fields || '{}'); } catch (e) { return {}; } })(),
  pg: realPage(r.page) ? r.page : '', fm: r.form || '', src: [r.source, r.medium].filter(Boolean).join('/'),
  verdict: r.verdict, why: r.why || '', decidedBy: r.decided_by || '', via: r.via || '', sig: r.sig || '',
});

/**
 * Store submissions, skipping any already held, and judge each one on the way in.
 *
 * Judging here rather than at read time means a verdict is decided once per enquiry rather than
 * once per person who looks at it — and it is what lets the counts be a query instead of a scan.
 */
export async function addLeadsSql(siteId, leads, opts = {}) {
  if (!leads.length) return 0;
  await ensureSchema();
  let prepared = leads.map((l) => toRow(siteId, l));
  // Already held under a different id — typically the live copy, which knows its page. Matched by
  // what it said and when; the index on (site, sig) keeps this a lookup rather than a scan.
  const sigs = [...new Set(prepared.map((r) => r.sig))];
  const held = [];
  for (let i = 0; i < sigs.length; i += 200) {
    const part = sigs.slice(i, i + 200);
    held.push(...await rows(`SELECT id, at, sig, page FROM leads WHERE site = ? AND sig IN (${part.map(() => '?').join(',')})`, String(siteId), ...part));
  }
  if (held.length) {
    const pageFixes = [];
    prepared = prepared.filter((r) => {
      // Same id included: with no id from Duda, both copies can derive the very same one, and then
      // the plain insert is ignored — so the page has to be handed across here or not at all.
      const twin = held.find((h) => h.sig === r.sig && Math.abs(Date.parse(h.at) - Date.parse(r.at)) <= SAME_WINDOW_MS);
      if (!twin) return true;
      // A late live copy knows the page the imported copy never could. Hand it across.
      if (realPage(r.page) && !realPage(twin.page)) pageFixes.push(['UPDATE leads SET page = ? WHERE id = ?', r.page, twin.id]);
      return twin.id === r.id && opts.repair;   // a repair still rewrites its own row; anything else is a copy
    });
    if (pageFixes.length) await sql(...pageFixes);
    if (!prepared.length) return 0;
  }
  // How widely each message has been sent already, across every client. The strongest signal there
  // is, and the one only an agency holding 800 websites can see.
  const fps = [...new Set(prepared.map((r) => r.fp).filter(Boolean))];
  const spread = {};
  if (fps.length) {
    const marks = fps.map(() => '?').join(',');
    (await rows(`SELECT fp, COUNT(DISTINCT site) AS n FROM leads WHERE fp IN (${marks}) GROUP BY fp`, ...fps))
      .forEach((r) => { spread[r.fp] = r.n; });
  }
  // Within this batch too, so a blast imported in one go is caught on its first pass.
  const batch = {};
  prepared.forEach((r) => { if (r.fp) (batch[r.fp] = batch[r.fp] || new Set()).add(r.site); });

  const taught = await learned();
  let added = 0;
  for (let i = 0; i < prepared.length; i += 50) {
    const chunk = prepared.slice(i, i + 50);
    const stmts = chunk.map((r) => {
      const across = Math.max(spread[r.fp] || 0, (batch[r.fp] || { size: 0 }).size || 0);
      const j = decide(r, across, taught);
      // Repair re-reads an enquiry from Duda's own copy and rewrites what we parsed from it, so a
      // parsing fix reaches the history and not only what arrives next. A verdict a PERSON set is
      // never touched — `decided_by IS NULL` is the whole guard — and `created` stays as it was so
      // the monthly write count does not jump every time a repair is run.
      if (!opts.repair) {
        return [`INSERT OR IGNORE INTO leads
          (id, site, at, name, email, phone, page, form, source, medium, campaign, fields, body, fp, verdict, why, via, created, sig)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        r.id, r.site, r.at, r.name, r.email, r.phone, r.page, r.form, r.source, r.medium, r.campaign,
        r.fields, r.body, r.fp, j.verdict, j.why, r.via, r.created, r.sig];
      }
      return [`INSERT INTO leads
        (id, site, at, name, email, phone, page, form, source, medium, campaign, fields, body, fp, verdict, why, via, created, sig)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          at = excluded.at, name = excluded.name, email = excluded.email, phone = excluded.phone, sig = excluded.sig,
          -- The history endpoint never knows the page. A repair must not wipe one a live delivery recorded.
          page = CASE WHEN excluded.page <> '' THEN excluded.page ELSE leads.page END,
          form = excluded.form, source = excluded.source,
          medium = excluded.medium, campaign = excluded.campaign,
          fields = excluded.fields, body = excluded.body, fp = excluded.fp,
          verdict = CASE WHEN leads.decided_by IS NULL THEN excluded.verdict ELSE leads.verdict END,
          why = CASE WHEN leads.decided_by IS NULL THEN excluded.why ELSE leads.why END`,
      r.id, r.site, r.at, r.name, r.email, r.phone, r.page, r.form, r.source, r.medium, r.campaign,
      r.fields, r.body, r.fp, j.verdict, j.why, r.via, r.created, r.sig];
    });
    (await sql(...stmts)).forEach((x) => { added += x.changed; });
  }
  if (added) await rebuildDays(siteId);
  return added;
}

/**
 * Merge copies of the same submission already stored for one website, and clear invented pages.
 * One read of the website's rows, then only the writes that change something.
 */
export async function tidySql(siteId) {
  await ensureSchema();
  const all = await rows('SELECT id, site, at, name, email, phone, fields, page, form, via, verdict, why, decided_by, sig FROM leads WHERE site = ?', String(siteId));
  if (!all.length) return 0;
  const { keep, drop } = clusterDupes(all.map(fromRow));
  const before = new Map(all.map((r) => [r.id, r]));
  const stmts = [];
  drop.forEach((d) => stmts.push(['DELETE FROM leads WHERE id = ?', d.id]));
  keep.forEach((k) => {
    const was = before.get(k.id) || {};
    const page = realPage(k.pg) ? k.pg : '';
    if (was.sig === k.sig && (was.page || '') === page && (was.decided_by || '') === (k.decidedBy || '') && (was.form || '') === (k.fm || '')) return;
    stmts.push(['UPDATE leads SET sig = ?, page = ?, form = ?, verdict = ?, why = ?, decided_by = ? WHERE id = ?',
      k.sig, page, k.fm || '', k.verdict || was.verdict || 'unsure', k.why || was.why || '', k.decidedBy || null, k.id]);
  });
  for (let i = 0; i < stmts.length; i += 100) await sql(...stmts.slice(i, i + 100));
  if (stmts.length) await rebuildDays(siteId);
  return drop.length;
}

/** The team's own rulings, which always win over the rules. */
async function learned() {
  const out = { phrase: [], email: new Map(), fp: new Map() };
  for (const r of await rows('SELECT kind, value, verdict FROM lead_rules')) {
    if (r.kind === 'phrase') out.phrase.push([String(r.value).toLowerCase(), r.verdict]);
    else if (r.kind === 'email') out.email.set(String(r.value).toLowerCase(), r.verdict);
    else if (r.kind === 'fp') out.fp.set(r.value, r.verdict);
  }
  return out;
}
function decide(r, across, taught) {
  if (r.fp && taught.fp.has(r.fp)) return { verdict: taught.fp.get(r.fp), why: 'The team has ruled on this message before' };
  if (r.email && taught.email.has(r.email.toLowerCase())) return { verdict: taught.email.get(r.email.toLowerCase()), why: 'The team has ruled on this sender before' };
  const body = String(r.body || '').toLowerCase();
  for (const [phrase, verdict] of taught.phrase) if (phrase && body.includes(phrase)) return { verdict, why: `The team marked "${phrase}" as ${verdict === 'junk' ? 'junk' : 'real'}` };
  return judgeByRules({ fields: JSON.parse(r.fields || '{}'), phone: r.phone }, { sameAcross: across });
}

/** The per-day counts the charts read. Rebuilt from the leads, never trusted as the truth. */
export async function rebuildDays(siteId) {
  await sql(
    ['DELETE FROM lead_days WHERE site = ?', siteId],
    [`INSERT INTO lead_days (site, day, real, junk)
      SELECT site, substr(at,1,10),
             SUM(CASE WHEN verdict <> 'junk' THEN 1 ELSE 0 END),
             SUM(CASE WHEN verdict = 'junk' THEN 1 ELSE 0 END)
      FROM leads WHERE site = ? GROUP BY site, substr(at,1,10)`, siteId],
  );
}

// ---------- reading ----------
const WHEN = (months) => `-${Math.max(1, Math.min(Number(months) || 12, 36))} months`;

export async function leadsFor(siteId, { months = 12, page, form, source, verdict, limit = 500 } = {}) {
  await ensureSchema();
  const where = ['site = ?', "at > datetime('now', ?)"]; const args = [siteId, WHEN(months)];
  if (page) { where.push('page = ?'); args.push(page); }
  if (form) { where.push('form = ?'); args.push(form); }
  if (source) { where.push('source = ?'); args.push(source); }
  if (verdict === 'junk') where.push("verdict = 'junk'");
  else if (verdict === 'real') where.push("verdict <> 'junk'");
  const w = where.join(' AND ');
  const [list, counts, byPage, bySource, byForm] = await sql(
    [`SELECT * FROM leads WHERE ${w} ORDER BY at DESC LIMIT ?`, ...args, Math.min(limit, 1000)],
    [`SELECT SUM(CASE WHEN verdict <> 'junk' THEN 1 ELSE 0 END) AS real, SUM(CASE WHEN verdict = 'junk' THEN 1 ELSE 0 END) AS junk,
             COUNT(*) AS total FROM leads WHERE site = ? AND at > datetime('now', ?)`, siteId, WHEN(months)],
    [`SELECT CASE WHEN page IN ('', '/') THEN '' ELSE page END AS k, COUNT(*) AS n FROM leads WHERE ${w} GROUP BY k ORDER BY n DESC LIMIT 40`, ...args],
    [`SELECT CASE WHEN source = '' THEN '(direct)' ELSE source END AS k, COUNT(*) AS n FROM leads WHERE ${w} GROUP BY k ORDER BY n DESC LIMIT 40`, ...args],
    [`SELECT form AS k, COUNT(*) AS n FROM leads WHERE ${w} AND form <> '' GROUP BY form ORDER BY n DESC LIMIT 40`, ...args],
  );
  return {
    leads: list.rows.map(fromRow),
    counts: counts.rows[0] || { real: 0, junk: 0, total: 0 },
    groups: { pages: byPage.rows, sources: bySource.rows, forms: byForm.rows },
  };
}

/** Enquiries per month for one website, real and junk apart. */
export async function seriesFor(siteId, months = 12) {
  await ensureSchema();
  return rows(`SELECT substr(day,1,7) AS m, SUM(real) AS real, SUM(junk) AS junk
    FROM lead_days WHERE site = ? AND day > date('now', ?) GROUP BY m ORDER BY m`, siteId, WHEN(months));
}
/** When people actually get in touch — by day of the week and by hour. */
export async function whenFor(siteId, months = 12) {
  await ensureSchema();
  const [dow, hour] = await sql(
    [`SELECT CAST(strftime('%w', at) AS INTEGER) AS k, COUNT(*) AS n FROM leads
      WHERE site = ? AND verdict <> 'junk' AND at > datetime('now', ?) GROUP BY k`, siteId, WHEN(months)],
    [`SELECT CAST(strftime('%H', at) AS INTEGER) AS k, COUNT(*) AS n FROM leads
      WHERE site = ? AND verdict <> 'junk' AND at > datetime('now', ?) GROUP BY k`, siteId, WHEN(months)],
  );
  const fill = (list, n) => { const a = Array(n).fill(0); list.rows.forEach((r) => { a[r.k] = r.n; }); return a; };
  return { dow: fill(dow, 7), hour: fill(hour, 24) };
}

/** The small numbers the lists show, for many websites in one query. */
export async function summariesFor(siteIds) {
  if (!siteIds.length) return {};
  await ensureSchema();
  const marks = siteIds.map(() => '?').join(',');
  const list = await rows(`SELECT site,
      COUNT(*) AS total,
      SUM(CASE WHEN verdict <> 'junk' THEN 1 ELSE 0 END) AS real,
      SUM(CASE WHEN verdict = 'junk' THEN 1 ELSE 0 END) AS junk,
      MAX(at) AS last,
      SUM(CASE WHEN verdict <> 'junk' AND at > datetime('now','-30 days') THEN 1 ELSE 0 END) AS d30
    FROM leads WHERE site IN (${marks}) GROUP BY site`, ...siteIds);
  const out = {};
  siteIds.forEach((id) => { out[id] = { total: 0, real: 0, junk: 0, d30: 0, last: '' }; });
  list.forEach((r) => { out[r.site] = { total: r.total, real: r.real, junk: r.junk, d30: r.d30, last: r.last || '' }; });
  return out;
}

/**
 * Websites whose forms have gone quiet.
 *
 * The baseline counts REAL enquiries only. On a site where a third of submissions are junk, a raw
 * count hides the thing worth knowing: spam carries on while the customers stop.
 */
export async function quietSites({ minHistory = 6, since = 21 } = {}) {
  await ensureSchema();
  return rows(`
    WITH per AS (
      SELECT site,
             SUM(real) AS total_real,
             MAX(CASE WHEN real > 0 THEN day END) AS last_real,
             COUNT(DISTINCT substr(day,1,7)) AS months
      FROM lead_days WHERE day > date('now','-13 months') GROUP BY site
    )
    SELECT site, total_real, last_real, months,
           ROUND(CAST(total_real AS REAL) / months, 1) AS per_month,
           CAST(julianday('now') - julianday(last_real) AS INTEGER) AS quiet_days
    FROM per
    WHERE total_real >= ? AND months >= 2
      AND (last_real IS NULL OR julianday('now') - julianday(last_real) > ?)
    ORDER BY per_month DESC, quiet_days DESC
    LIMIT 100`, minHistory, since);
}

/** Which sources and pages produce work, for one website. */
export async function marketingFor(siteId, months = 12) {
  await ensureSchema();
  const [bySource, byMonth, byCampaign, byPage] = await sql(
    [`SELECT CASE WHEN source = '' THEN '(direct)' ELSE source END AS source,
             CASE WHEN medium = '' THEN '—' ELSE medium END AS medium,
             COUNT(*) AS n, MAX(at) AS last
      FROM leads WHERE site = ? AND verdict <> 'junk' AND at > datetime('now', ?)
      GROUP BY source, medium ORDER BY n DESC LIMIT 25`, siteId, WHEN(months)],
    [`SELECT substr(at,1,7) AS m, CASE WHEN source = '' THEN '(direct)' ELSE source END AS source, COUNT(*) AS n
      FROM leads WHERE site = ? AND verdict <> 'junk' AND at > datetime('now', ?)
      GROUP BY m, source ORDER BY m`, siteId, WHEN(months)],
    [`SELECT campaign, COUNT(*) AS n FROM leads
      WHERE site = ? AND verdict <> 'junk' AND campaign <> '' AND at > datetime('now', ?)
      GROUP BY campaign ORDER BY n DESC LIMIT 20`, siteId, WHEN(months)],
    [`SELECT page, COUNT(*) AS n FROM leads
      WHERE site = ? AND verdict <> 'junk' AND at > datetime('now', ?) AND page NOT IN ('', '/')
      GROUP BY page ORDER BY n DESC LIMIT 20`, siteId, WHEN(months)],
  );
  return { sources: bySource.rows, months: byMonth.rows, campaigns: byCampaign.rows, pages: byPage.rows };
}

/**
 * What the busy websites do differently.
 *
 * Counts only, across the whole client base, with no client named — the point is the pattern, not
 * any one shop. A row needs several websites behind it before it is shown at all, or it is a story
 * about one site dressed up as a trend.
 */
export async function benchmarks({ months = 12, minSites = 3 } = {}) {
  await ensureSchema();
  const [overall, pages, sources, hours, dows, spam] = await sql(
    [`SELECT COUNT(DISTINCT site) AS sites, COUNT(*) AS total,
             SUM(CASE WHEN verdict <> 'junk' THEN 1 ELSE 0 END) AS real,
             SUM(CASE WHEN verdict = 'junk' THEN 1 ELSE 0 END) AS junk
      FROM leads WHERE at > datetime('now', ?)`, WHEN(months)],
    // Which kinds of page produce enquiries, across everybody.
    [`SELECT page, COUNT(DISTINCT site) AS sites, COUNT(*) AS n,
             ROUND(CAST(COUNT(*) AS REAL) / COUNT(DISTINCT site), 1) AS per_site
      FROM leads WHERE verdict <> 'junk' AND at > datetime('now', ?) AND page NOT IN ('', '/')
      GROUP BY page HAVING COUNT(DISTINCT site) >= ? ORDER BY per_site DESC LIMIT 25`, WHEN(months), minSites],
    [`SELECT CASE WHEN source = '' THEN '(direct)' ELSE source END AS source,
             COUNT(DISTINCT site) AS sites, COUNT(*) AS n,
             ROUND(CAST(COUNT(*) AS REAL) / COUNT(DISTINCT site), 1) AS per_site
      FROM leads WHERE verdict <> 'junk' AND at > datetime('now', ?)
      GROUP BY source HAVING COUNT(DISTINCT site) >= ? ORDER BY n DESC LIMIT 20`, WHEN(months), minSites],
    [`SELECT CAST(strftime('%H', at) AS INTEGER) AS hour, COUNT(*) AS n
      FROM leads WHERE verdict <> 'junk' AND at > datetime('now', ?) GROUP BY hour ORDER BY hour`, WHEN(months)],
    [`SELECT CAST(strftime('%w', at) AS INTEGER) AS dow, COUNT(*) AS n
      FROM leads WHERE verdict <> 'junk' AND at > datetime('now', ?) GROUP BY dow ORDER BY dow`, WHEN(months)],
    // The blasts: one message, many clients.
    [`SELECT fp, COUNT(DISTINCT site) AS sites, COUNT(*) AS n, MAX(at) AS last,
             MIN(substr(body,1,120)) AS sample
      FROM leads WHERE fp <> '' AND at > datetime('now', ?)
      GROUP BY fp HAVING COUNT(DISTINCT site) >= 2 ORDER BY sites DESC, n DESC LIMIT 20`, WHEN(months)],
  );
  return {
    overall: overall.rows[0] || { sites: 0, total: 0, real: 0, junk: 0 },
    pages: pages.rows, sources: sources.rows,
    hours: hours.rows, dows: dows.rows, blasts: spam.rows,
  };
}

/** Everything that still needs a human or the AI to look at it. */
export async function unsureLeads(limit = 40) {
  await ensureSchema();
  return rows(`SELECT * FROM leads WHERE verdict = 'unsure' ORDER BY at DESC LIMIT ?`, limit);
}

/** A person disagreeing with the verdict — and teaching it, if they want to. */
export async function setVerdict(id, verdict, who, { teachPhrase, teachSender, teachMessage } = {}) {
  await ensureSchema();
  const lead = await row('SELECT * FROM leads WHERE id = ?', id);
  if (!lead) return null;
  const stmts = [['UPDATE leads SET verdict = ?, why = ?, decided_by = ? WHERE id = ?', verdict, `${who} marked this ${verdict === 'junk' ? 'junk' : 'real'}`, who, id]];
  const teach = (kind, value) => stmts.push(['INSERT OR REPLACE INTO lead_rules (kind, value, verdict, by, at) VALUES (?,?,?,?,?)',
    kind, value, verdict, who, new Date().toISOString()]);
  if (teachPhrase) teach('phrase', String(teachPhrase).toLowerCase().slice(0, 80));
  if (teachSender && lead.email) teach('email', lead.email.toLowerCase());
  if (teachMessage && lead.fp) teach('fp', lead.fp);
  await sql(...stmts);
  await rebuildDays(lead.site);
  return { ...lead, verdict };
}

/** Re-judge everything a website holds — after the team has taught it something new. */
export async function rejudge(siteId) {
  await ensureSchema();
  const taught = await learned();
  const list = await rows('SELECT * FROM leads WHERE site = ? AND decided_by IS NULL', siteId);
  if (!list.length) return 0;
  const fps = [...new Set(list.map((r) => r.fp).filter(Boolean))];
  const spread = {};
  if (fps.length) {
    const marks = fps.map(() => '?').join(',');
    (await rows(`SELECT fp, COUNT(DISTINCT site) AS n FROM leads WHERE fp IN (${marks}) GROUP BY fp`, ...fps))
      .forEach((r) => { spread[r.fp] = r.n; });
  }
  let changed = 0;
  for (let i = 0; i < list.length; i += 50) {
    const stmts = list.slice(i, i + 50).map((r) => {
      const j = decide(r, spread[r.fp] || 0, taught);
      return ['UPDATE leads SET verdict = ?, why = ? WHERE id = ? AND decided_by IS NULL', j.verdict, j.why, r.id];
    });
    (await sql(...stmts)).forEach((x) => { changed += x.changed; });
  }
  await rebuildDays(siteId);
  return changed;
}

export { sqlReady };
