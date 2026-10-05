// The SQL side of the app: form submissions and everything we ask of them.
//
// Enquiries stopped being records we fetch by id and became rows we ask questions of — which pages
// produce work, which sources, which forms have gone quiet, what the busy websites do differently.
// Those are queries, and they were being written by hand as loops in JavaScript. They live here now.
//
// Everything else stays where it was. Sessions with expiry, presence, scan claims, the version
// counters behind the heartbeat and the rate limiter are all key-value with a lifetime, which is
// what the other store is good at and SQL is poor at.
//
// Needs LEADS_DB_URL (https://<db>.turso.io) and LEADS_DB_TOKEN. With neither, the app carries on
// exactly as before: the lead store falls back to the key-value version, nothing breaks, and the
// analysis pages say what is missing instead of erroring.
import { fetchWithTimeout } from './_lib.js';

const URL_ENV = () => String(process.env.LEADS_DB_URL || '').replace(/\/+$/, '').replace(/^libsql:/, 'https:');
const TOKEN = () => process.env.LEADS_DB_TOKEN || '';
/** Is the SQL database set up for this installation? */
export const sqlReady = () => !!(URL_ENV() && TOKEN());

/** One value, in the shape the wire format wants. Dates and ids are text; counts are integers. */
function arg(v) {
  if (v === null || v === undefined) return { type: 'null', value: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  return { type: 'text', value: String(v) };
}
const unwrap = (c) => {
  if (!c || c.type === 'null') return null;
  if (c.type === 'integer') return Number(c.value);
  if (c.type === 'float') return Number(c.value);
  return c.value;
};

/**
 * Run statements against the database, in order, over one request.
 *
 * Several statements share a round trip, which matters on a serverless function: the connection
 * cost is paid once rather than per statement. Each entry is a string or [sql, ...args].
 */
export async function sql(...statements) {
  if (!sqlReady()) throw new Error('The analysis database is not connected. Please contact the app owner.');
  const requests = statements.map((s) => {
    const [text, ...args] = Array.isArray(s) ? s : [s];
    return { type: 'execute', stmt: { sql: text, args: args.map(arg) } };
  });
  requests.push({ type: 'close' });
  const r = await fetchWithTimeout(URL_ENV() + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  }, 20000);
  const text = await r.text();
  if (!r.ok) throw new Error(`Analysis database ${r.status}: ${text.slice(0, 200)}`);
  let body; try { body = JSON.parse(text); } catch (e) { throw new Error('Analysis database sent something unreadable.'); }
  const out = [];
  (body.results || []).forEach((res) => {
    if (res.type === 'error') throw new Error('Analysis database: ' + ((res.error && res.error.message) || 'query failed').slice(0, 200));
    if (!res.response || res.response.type !== 'execute') return;
    const rs = res.response.result || {};
    const cols = (rs.cols || []).map((c) => c.name);
    out.push({
      rows: (rs.rows || []).map((row) => { const o = {}; row.forEach((cell, i) => { o[cols[i]] = unwrap(cell); }); return o; }),
      changed: Number(rs.affected_row_count || 0),
    });
  });
  return out;
}
/** One statement, its rows. */
export const rows = async (text, ...args) => (await sql([text, ...args]))[0].rows;
/** One statement, its first row (or null). */
export const row = async (text, ...args) => (await rows(text, ...args))[0] || null;
/** One statement, how many rows it changed. */
export const run = async (text, ...args) => (await sql([text, ...args]))[0].changed;

/**
 * The tables, and the indexes that keep them cheap.
 *
 * Turso bills rows READ, not queries, so an unindexed query is not slow — it is expensive. Every
 * index below exists because a query in this file would otherwise scan the whole table: by website
 * and date for a client's dashboard, by fingerprint for the same message sent to several clients,
 * by verdict so counting the real enquiries never walks the junk.
 */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
     id TEXT PRIMARY KEY,
     site TEXT NOT NULL,
     at TEXT NOT NULL,
     name TEXT, email TEXT, phone TEXT,
     page TEXT, form TEXT, source TEXT, medium TEXT, campaign TEXT,
     fields TEXT,
     body TEXT,
     fp TEXT,
     verdict TEXT NOT NULL DEFAULT 'unsure',
     why TEXT,
     decided_by TEXT,
     via TEXT,
     created TEXT NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS leads_site_at ON leads (site, at DESC)',
  'CREATE INDEX IF NOT EXISTS leads_at ON leads (at DESC)',
  'CREATE INDEX IF NOT EXISTS leads_fp ON leads (fp)',
  'CREATE INDEX IF NOT EXISTS leads_verdict ON leads (site, verdict, at DESC)',
  'CREATE INDEX IF NOT EXISTS leads_source ON leads (site, source, at DESC)',
  // What the team has taught the classifier: a phrase, or one website's own decision.
  `CREATE TABLE IF NOT EXISTS lead_rules (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     value TEXT NOT NULL,
     verdict TEXT NOT NULL,
     by TEXT, at TEXT
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS lead_rules_u ON lead_rules (kind, value)',
  // One row per website per day of real enquiries, so a chart across 800 websites reads hundreds of
  // rows instead of hundreds of thousands. Rebuilt from the leads themselves, never trusted as truth.
  `CREATE TABLE IF NOT EXISTS lead_days (
     site TEXT NOT NULL, day TEXT NOT NULL,
     real INTEGER NOT NULL DEFAULT 0, junk INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (site, day)
   )`,
  // What a website looks like, so the benchmarks can compare like with like.
  `CREATE TABLE IF NOT EXISTS site_facts (
     site TEXT PRIMARY KEY,
     name TEXT, pages INTEGER, forms INTEGER, fields INTEGER,
     has_location_pages INTEGER, updated TEXT
   )`,
];
let ensured = false;
/** Make sure the tables exist. Runs once per warm instance, and is harmless if it runs again. */
export async function ensureSchema(force) {
  if (ensured && !force) return;
  await sql(...SCHEMA);
  // Added after the first release: what an enquiry said, so a live copy and an imported copy of the
  // same submission can be recognised. ADD COLUMN fails once it exists, which is the signal it does.
  await sql('ALTER TABLE leads ADD COLUMN sig TEXT').catch(() => {});
  await sql('CREATE INDEX IF NOT EXISTS leads_sig ON leads (site, sig)').catch(() => {});
  ensured = true;
}
