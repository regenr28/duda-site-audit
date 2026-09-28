// Comments left in the Duda editor — on every website in the account, audited or not.
//
// GET  /api/comments?op=sites              → every site we have heard from, with counts and what is new to you
// GET  /api/comments?op=threads&site=<id>  → the conversations on one site, newest first
// POST /api/comments { op: 'seen', site }              → mark that site read, for you
// POST /api/comments { op: 'who', email, as }          → say whether an author is the client or one of us
//
// Comments arrive through /api/hook and are stored against the Duda site ID, so a website does NOT
// have to be on the Audits list to be read here. Most client comments happen on drafts, before a
// site is ever published, which is exactly why this is kept separate from the Audits list.
//
// Replying and resolving still happen in the Duda editor — there is no API to write a comment.
// When somebody resolves one there, Duda tells us and it turns green here.
import { redis, P, requireUser, readBody, jparse, now, listUsers, notifyUser, fetchWithTimeout, unescapeHtml, savedEditorHost, slackMembers, slackRoster, slackBotEnabled, globalLog } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const WAIT_HOURS = Number(process.env.COMMENT_WAIT_HOURS || 24);
const NAME_LOOKUPS = 8;   // Duda calls per request, so a first load never crawls
const DUDA_LOOKUPS = 10;  // account-type lookups per request, same reason

function pairs(arr, json) {
  const o = {};
  for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = json ? jparse(arr[i + 1], {}) : arr[i + 1];
  return o;
}
async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up yet.');
  const r = await fetchWithTimeout(DUDA + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 12000);
  const t = await r.text();
  if (!r.ok) throw new Error(`Duda API ${r.status}`);
  try { return JSON.parse(t); } catch (e) { return null; }
}

/** The shared business-name cache holds {"n": name, "p": last published} — not a bare name. */
function cachedName(v) {
  if (!v) return '';
  const j = String(v).startsWith('{') ? jparse(v) : null;
  const n = j ? j.n : v;
  return n && n !== '-' ? String(n) : '';
}
const nameEntry = (name, published) => JSON.stringify({ n: name || '-', p: published || '' });

/**
 * Is this email a Duda STAFF account, or a customer?
 *
 * Duda has no endpoint that lists everyone in the account — you can only look up one account at a
 * time — but the answer it gives is the authoritative one: account_type is STAFF for the people who
 * build sites and CUSTOMER for the people who own them. That is precisely the line the comments
 * page needs to draw, so every email we meet gets asked about once and the answer is kept.
 *
 * Cached for a month, and a "no such account" is cached for a day so an unknown address does not
 * cost a Duda call on every page load.
 */
async function dudaAccountType(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return '';
  const key = P + 'dudaacct:' + e;
  try { const [hit] = await redis(['GET', key]); if (hit) return hit === '-' ? '' : hit; } catch (x) { /* ask Duda instead */ }
  let type = '';
  try {
    const a = await duda('/accounts/' + encodeURIComponent(e));
    type = String((a && a.account_type) || '').toUpperCase();
  } catch (x) {
    if (!/ 404/.test(String(x.message || ''))) return '';        // a real failure: don't cache a guess
  }
  try { await redis(['SET', key, type || '-', 'EX', type ? 30 * 86400 : 86400]); } catch (x) { /* fine */ }
  return type;
}

/**
 * Ask Duda about the addresses we have not asked about yet, a few at a time so a page load never
 * turns into a crawl. Everything already known comes back from the cache for free.
 */
export async function dudaTypes(emails, budget = DUDA_LOOKUPS) {
  const out = {};
  const todo = [];
  for (const raw of [...new Set(emails.filter(Boolean).map((x) => String(x).toLowerCase().trim()))]) {
    try { const [hit] = await redis(['GET', P + 'dudaacct:' + raw]); if (hit) { out[raw] = hit === '-' ? '' : hit; continue; } } catch (x) { /* ask */ }
    todo.push(raw);
  }
  for (const e of todo.slice(0, budget)) out[e] = await dudaAccountType(e);
  return out;
}

const domainsOf = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

/**
 * Is this comment one of ours, or the client's? Duda tells us the author's email but not which side
 * they are on, so: anyone with an account here, or an address at one of the agency's domains, is us.
 * Anyone else is the client. An admin can correct any address, and the correction wins.
 */
export function sideTest(users, overrides, roster, dudaType) {
  const mine = new Set(users.map((u) => String(u.email || '').toLowerCase()));
  const doms = [...domainsOf(process.env.ALLOWED_EMAIL_DOMAINS), ...domainsOf(process.env.AGENCY_EMAIL_DOMAINS)];
  // Anyone in the Slack workspace is one of us, whatever address they comment from. Slack guests are
  // deliberately NOT team — a client invited into a shared channel is a member too.
  const slack = new Set(((roster && roster.team) || []).map((x) => String(x.email || '').toLowerCase()));
  const types = dudaType || {};
  // Best answer first, guess last:
  //   1. what a person told us      2. they have an account here      3. Duda says STAFF or CUSTOMER
  //   4. they are in our Slack      5. the address looks like ours
  return (email) => {
    const e = String(email || '').toLowerCase().trim();
    if (!e) return 'team';
    if (overrides[e]) return overrides[e] === 'team' ? 'team' : 'client';
    if (mine.has(e)) return 'team';
    if (types[e] === 'STAFF') return 'team';
    if (types[e] === 'CUSTOMER') return 'client';     // Duda is certain, so stop guessing
    if (slack.has(e)) return 'team';
    return doms.includes(e.split('@')[1] || '') ? 'team' : 'client';
  };
}

/**
 * Has this conversation got anything left in it?
 *
 * Duda sends a NEW_CONVERSATION before any words are typed, and a comment can be deleted afterwards.
 * Either way what is left is a card with nothing on it — and, worse, something that counts towards
 * "6 waiting" and can raise an alert nobody can act on. `live` is written by the webhook; rows that
 * predate it are judged by whether the last comment left any text behind.
 */
const hasContent = (r) => (r && r.live !== undefined ? r.live > 0 : !!String((r && r.tx) || '').trim());

/** 24 hours from the comment, but never landing on a Saturday or Sunday when nobody is there. */
function answerDueAt(atISO, hours = WAIT_HOURS) {
  let t = Date.parse(atISO || '') || Date.now();
  t += hours * 3600000;
  for (let i = 0; i < 3; i++) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) t += 86400000; else break;
  }
  return t;
}

/**
 * The one notification this feature sends: clients are waiting and nobody has answered.
 *
 * One message per WEBSITE, not per comment. A client who leaves twenty comments in a sitting is
 * doing one thing, and twenty Slack messages about it is the fastest way to teach everyone to
 * ignore Slack. The message lists what is overdue, oldest first, so the worst one is the first
 * thing read.
 *
 * After the first message a website goes quiet. It speaks again only when the situation is
 * genuinely worse — more comments overdue than last time, or the oldest has crossed another day —
 * and at most once a day. The thinking is simple: whoever picks up the 48-hour comment is looking
 * at the others anyway, so repeating them is noise. If the website is answered and later falls
 * behind again, it starts fresh.
 */
const ALERT_KEY = P + 'cmtalert';       // dudaSiteId → { at, n, oldest } for the last thing we said
const DIGEST_LINES = 5;                 // listed in full; the rest are counted
const ROLLUP_SITES = 5;                 // more websites than this in one go and it becomes one message
export const QUIET_HOURS = 20;                 // never more than one message a day about the same website

export const hoursSince = (iso) => Math.max(0, Math.round((Date.now() - (Date.parse(iso) || Date.now())) / 3600000));
const overdueDays = (iso) => Math.floor(hoursSince(iso) / 24);

/** Is this website worse off than the last time we said anything about it? */
export function worthSaying(prev, now_) {
  if (!prev) return true;                                            // nothing said yet
  if (now_.n > (prev.n || 0)) return true;                           // more of them are waiting
  if (overdueDays(now_.oldest) > overdueDays(prev.oldest || now_.oldest)) return true;  // another day has passed
  return false;
}

async function alertStale(rows, isClient, nameOf) {
  // Only when the CLIENT spoke last. A teammate's own note — a worklog, "this has been updated,
  // let us know" — is us holding the ball, not the client waiting, so it never rings.
  const late = Object.entries(rows).filter(([, r]) => r && hasContent(r) && r.st !== 'resolved' && r.lb && isClient(r.lb) === 'client' && Date.now() > answerDueAt(r.la));
  const [prevRaw] = await redis(['HGETALL', ALERT_KEY]);
  const prev = pairs(prevRaw, true);

  // Group by website, worst first.
  const bySite = {};
  late.forEach(([uuid, r]) => {
    const g = bySite[r.s] || (bySite[r.s] = { site: r.s, items: [], oldest: '', n: 0, seen: '' });
    g.items.push({ uuid, num: r.n || 0, at: r.la, device: r.d || '', text: unescapeHtml(r.tx || '') });
    g.n++;
    if (!g.oldest || r.la < g.oldest) g.oldest = r.la;
    if (r.al && r.al > g.seen) g.seen = r.al;        // what the old per-comment alerts already said
  });
  Object.values(bySite).forEach((g) => g.items.sort((a, b) => String(a.at).localeCompare(String(b.at))));

  // A website that has been answered since should start fresh next time it falls behind.
  const clear = Object.keys(prev).filter((id) => !bySite[id]);

  const due = Object.values(bySite).filter((g) => {
    // Upgrading from the old per-comment alerts: if those already went out, treat that as the last
    // thing said, so nobody gets a fresh wall of messages about a backlog they already know about.
    const was = prev[g.site] || (g.seen ? { at: g.seen, n: g.n, oldest: g.oldest } : null);
    if (was && hoursSince(was.at) < QUIET_HOURS) return false;
    return worthSaying(was, g);
  });
  if (!due.length && !clear.length) return 0;

  const cmds = [];
  clear.forEach((id) => cmds.push(['HDEL', ALERT_KEY, id]));
  if (!due.length) { if (cmds.length) await redis(...cmds); return 0; }

  const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
  if (!admins.length) return 0;
  const host = await savedEditorHost().catch(() => '');
  const editor = (id) => (host ? `https://${host}/home/site/${encodeURIComponent(id)}/home` : '');
  const line = (it, i) => `${i + 1}. *#${it.num || '?'}* · ${hoursSince(it.at)}h${it.device ? ' · ' + String(it.device).toLowerCase() : ''} — ${String(it.text || '').replace(/\s+/g, ' ').slice(0, 120)}`;
  due.sort((a, b) => String(a.oldest).localeCompare(String(b.oldest)));

  if (due.length > ROLLUP_SITES) {
    // A Monday-morning backlog: one message about all of it beats a message per website.
    const lines = due.slice(0, 10).map((g, i) => `${i + 1}. *${nameOf(g.site) || g.site}* — ${g.n} waiting, longest ${hoursSince(g.oldest)}h`);
    if (due.length > 10) lines.push(`…and ${due.length - 10} more websites`);
    await Promise.all(admins.map((a) => notifyUser(a.email, {
      kind: 'comment-waiting', by: '', byName: `${due.length} websites`, siteId: '', siteName: '',
      headline: `*Comments waiting* — ${due.length} websites, longest ${hoursSince(due[0].oldest)}h`,
      count: due.reduce((n, g) => n + g.n, 0), sites: due.length, oldestHours: hoursSince(due[0].oldest),
      lines, text: lines.join('\n'), dudaSite: '',
    })));
  } else {
    for (const g of due) {
      const name = nameOf(g.site) || g.site;
      const lines = g.items.slice(0, DIGEST_LINES).map(line);
      if (g.items.length > DIGEST_LINES) lines.push(`…and ${g.items.length - DIGEST_LINES} more`);
      await Promise.all(admins.map((a) => notifyUser(a.email, {
        kind: 'comment-waiting', by: '', byName: name, siteId: '', siteName: '',
        headline: `*Comments waiting* — *${name}*\n${g.n} client comment${g.n === 1 ? '' : 's'} *overdue*, longest *${hoursSince(g.oldest)}h*`,
        count: g.n, oldestHours: hoursSince(g.oldest),
        lines, text: lines.join('\n'),
        dudaSite: g.site, editorUrl: editor(g.site),
      })));
    }
  }

  due.forEach((g) => cmds.push(['HSET', ALERT_KEY, g.site, JSON.stringify({ at: now(), n: g.n, oldest: g.oldest })]));
  await redis(...cmds);
  return due.length;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'sites';

      if (op === 'sites') {
        const [watch, idx, seen, over, names, ver] = await redis(
          ['HGETALL', P + 'watch'], ['HGETALL', P + 'convidx'], ['HGETALL', P + 'cmtseen:' + me.email],
          ['HGETALL', P + 'cmtwho'], ['HGETALL', P + 'dudanames'], ['GET', P + 'ver:cmt']);
        const sites = pairs(watch, true); const rows = pairs(idx, true);
        const mySeen = pairs(seen); const nameMap = pairs(names);
        // Who last spoke on each website decides whether anyone is waiting, so those are the
        // addresses worth asking Duda about.
        const lastBys = Object.values(rows).map((r) => r && r.lb).filter(Boolean);
        const isClient = sideTest(await listUsers(), pairs(over), await slackRoster(), await dudaTypes(lastBys));
        const nameOf = (id) => (sites[id] && sites[id].name) || cachedName(nameMap[id]);

        // Fill in a few missing business names from Duda, so the list reads as names not IDs.
        const unknown = Object.keys(sites).filter((id) => !nameOf(id)).slice(0, NAME_LOOKUPS);
        if (unknown.length) {
          const got = await Promise.allSettled(unknown.map((id) => duda(`/sites/multiscreen/${id}`)));
          const cmds = [];
          got.forEach((g, k) => {
            const id = unknown[k];
            const d = g.status === 'fulfilled' ? g.value : null;
            const nm = (d && ((d.site_business_info && d.site_business_info.business_name) || d.site_alternate_name)) || '';
            const w = Object.assign({}, sites[id], { name: nm, needName: false,
              published: (d && d.last_published_date) || (sites[id] || {}).published || '',
              domain: String((d && d.site_domain) || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') });
            if (d === null && g.status !== 'fulfilled') w.gone = true;
            sites[id] = w;
            cmds.push(['HSET', P + 'watch', id, JSON.stringify(w)]);
            if (nm) cmds.push(['HSET', P + 'dudanames', id, nameEntry(nm, w.published)]);
          });
          if (cmds.length) await redis(...cmds);
        }

        await alertStale(rows, isClient, nameOf);

        const per = {};
        Object.values(rows).forEach((r) => {
          if (!r || !r.s || !hasContent(r)) return;    // an empty conversation is not a conversation
          const p = per[r.s] || (per[r.s] = { total: 0, open: 0, unread: 0, waiting: 0, last: '', oldest: '' });
          p.total++;
          if (r.st !== 'resolved') p.open++;
          if (r.la > (mySeen[r.s] || '')) p.unread++;
          if (r.st !== 'resolved' && r.lb && isClient(r.lb) === 'client' && Date.now() > answerDueAt(r.la)) {
            p.waiting++;
            // The oldest unanswered client comment is what decides where this website sits in the
            // queue: on Monday morning the question is "who has been waiting longest", not "what
            // came in last".
            if (!p.oldest || r.la < p.oldest) p.oldest = r.la;
          }
          if (r.la > p.last) p.last = r.la;
        });

        const out = Object.values(sites).map((w) => Object.assign({
          id: w.id, name: nameOf(w.id), published: w.published || '', domain: w.domain || '',
          firstSeen: w.firstSeen || '', lastEvent: w.lastEvent || '', gone: !!w.gone,
        }, per[w.id] || { total: 0, open: 0, unread: 0, waiting: 0, last: '', oldest: '' }));
        // Anybody waiting comes first, longest wait at the top. Everything else by what moved last.
        out.sort((a, b) => (b.waiting ? 1 : 0) - (a.waiting ? 1 : 0)
          || (a.waiting && b.waiting ? String(a.oldest).localeCompare(String(b.oldest)) : 0)
          || String(b.last || b.lastEvent).localeCompare(String(a.last || a.lastEvent)));
        return res.status(200).json({ sites: out, ver: String(ver || 0), waitHours: WAIT_HOURS });
      }

      if (op === 'threads') {
        const siteId = String(req.query.site || '').trim();
        if (!siteId) return res.status(400).json({ error: 'site required' });
        const [conv, pg, over, seen] = await redis(['HGETALL', P + 'conv:' + siteId], ['HGETALL', P + 'pages:' + siteId], ['HGETALL', P + 'cmtwho'], ['HGETALL', P + 'cmtseen:' + me.email]);
        const threads = Object.values(pairs(conv, true));
        let pages = pairs(pg);
        // Page IDs mean nothing to a person: swap them for real page paths, fetched once per site.
        if (threads.some((t) => t.page && !pages[t.page])) {
          try {
            const j = await duda(`/sites/multiscreen/${siteId}/pages`);
            const arr = Array.isArray(j) ? j : (j && (j.results || j.pages)) || [];
            const cmds = [];
            arr.forEach((p) => {
              const u = String(p.uuid || p.page_uuid || p.id || '');
              const path = '/' + String(p.path || p.page_path || '').replace(/^\/+/, '');
              if (u) { pages[u] = p.title || path; cmds.push(['HSET', P + 'pages:' + siteId, u, pages[u]]); }
            });
            if (cmds.length) await redis(...cmds);
          } catch (e) { /* names are a nicety, the comments still read fine */ }
        }
        const authors = [];
        threads.forEach((t) => (t.comments || []).forEach((c) => { if (c.by) authors.push(c.by); }));
        const isClient = sideTest(await listUsers(), pairs(over), await slackRoster(), await dudaTypes(authors));
        const since = pairs(seen)[siteId] || '';
        const out = threads.map((t) => {
          // A deleted comment is gone, not blank: it is dropped, and a conversation with nothing
          // left in it is dropped with it rather than shown as an empty card that counts as waiting.
          const live = (t.comments || []).filter((c) => !c.deleted && String(c.text || '').trim());
          if (!live.length) return null;
          const tail = live[live.length - 1];
          const lastAt = tail.at || t.last || t.at;
          const owed = t.status !== 'resolved' && tail.by && isClient(tail.by) === 'client';
          return {
            uuid: t.u, num: t.num || 0, device: t.device || '', status: t.status || 'open', partial: !!t.partial,
            page: pages[t.page] || (t.page ? 'Page ' + String(t.page).slice(0, 6) : ''),
            startedAt: t.at, lastAt,
            unread: lastAt > since,
            waiting: owed && Date.now() > answerDueAt(lastAt),
            // How long they have actually been waiting, so a thread can say so itself rather than
            // leaving it to be worked out from a date — and when the clock actually runs out, since
            // weekends don't count and "70h" on its own reads like nobody has looked at it.
            since: owed ? lastAt : '',
            dueAt: owed ? new Date(answerDueAt(lastAt)).toISOString() : '',
            comments: live.map((c) => ({ text: unescapeHtml(c.text), by: c.by, at: c.at, side: isClient(c.by), edited: c.edited || '' })),
          };
        }).filter(Boolean)
          .sort((a, b) => (b.waiting ? 1 : 0) - (a.waiting ? 1 : 0)
            || (a.waiting && b.waiting ? String(a.since).localeCompare(String(b.since)) : 0)
            || String(b.lastAt).localeCompare(String(a.lastAt)));
        return res.status(200).json({ site: siteId, threads: out, waitHours: WAIT_HOURS });
      }

      if (op === 'slack') {
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        return res.status(200).json(slim(await slackRoster()));
      }
      if (op === 'log') {
        // Owner-only: did anything actually arrive? Useful while Duda is being set up.
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        const [list] = await redis(['LRANGE', P + 'hooklog', 0, 49]);
        return res.status(200).json({ items: (list || []).map((x) => jparse(x)).filter(Boolean), listening: !!process.env.DUDA_HOOK_KEY, checked: !!process.env.DUDA_HOOK_SECRET });
      }
      return res.status(400).json({ error: 'Unknown op' });
    }

    const b = readBody(req);
    if (b.op === 'seen') {
      const siteId = String(b.site || '').trim();
      if (!siteId) return res.status(400).json({ error: 'site required' });
      await redis(['HSET', P + 'cmtseen:' + me.email, siteId, now()]);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'who') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const email = String(b.email || '').toLowerCase().trim();
      const as = b.as === 'team' ? 'team' : b.as === 'client' ? 'client' : '';
      if (!email) return res.status(400).json({ error: 'email required' });
      if (as) await redis(['HSET', P + 'cmtwho', email, as]);
      else await redis(['HDEL', P + 'cmtwho', email]);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'slackSync') {
      // Read the Slack workspace once and keep the result. From then on, a comment from a teammate
      // is recognised by who they are rather than by which domain their address happens to use.
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      if (!slackBotEnabled()) return res.status(400).json({ error: 'Slack is not connected yet.' });
      const r = await slackMembers();
      if (!r.ok) {
        const why = r.error === 'missing_scope' ? 'Slack needs two more permissions before it can list people: users:read and users:read.email. Add them to the app and reinstall it to the workspace.'
          : r.error === 'not_configured' ? 'Slack is not connected yet.'
          : `Slack said: ${r.error}`;
        return res.status(400).json({ error: why });
      }
      const rec = { at: now(), by: me.email, byName: me.name, team: r.team, guests: r.guests };
      await redis(['SET', P + 'slackroster', JSON.stringify(rec)]);
      await globalLog({ type: 'slack', by: me.email, byName: me.name, text: `read the Slack workspace: ${r.team.length} teammate${r.team.length === 1 ? '' : 's'}${r.guests.length ? `, ${r.guests.length} guest${r.guests.length === 1 ? '' : 's'} left as clients` : ''}` });
      return res.status(200).json(slim(rec));
    }
    if (b.op === 'dudaPeople') {
      // Who actually works in this Duda account.
      //
      // Duda has no endpoint that lists the people in an account — you can only ask about one at a
      // time — so the list of who to ask about comes from who has turned up: every address that has
      // ever left a comment. Each one is asked about once, Duda says STAFF or CUSTOMER, and that is
      // the answer from then on. Older comments predate the author index, so the first run also
      // walks the conversations, a page of websites at a time.
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const from = Math.max(0, Number(b.from) || 0);
      const PAGE = 120;
      const [watch] = await redis(['HGETALL', P + 'watch']);
      const siteIds = []; for (let i = 0; watch && i < watch.length; i += 2) siteIds.push(watch[i]);
      const slice = siteIds.slice(from, from + PAGE);
      const found = [];
      if (slice.length) {
        const convs = await redis(...slice.map((id) => ['HGETALL', P + 'conv:' + id]));
        convs.forEach((rows) => {
          for (let i = 1; rows && i < rows.length; i += 2) {
            const t = jparse(rows[i]);
            (t && t.comments || []).forEach((c) => { if (c.by) found.push(String(c.by).toLowerCase()); });
          }
        });
      }
      if (found.length) await redis(['HSET', P + 'cmtauthors', ...[...new Set(found)].flatMap((e) => [e, now()])]);
      const done = from + PAGE >= siteIds.length;
      if (!done) return res.status(200).json({ done: false, next: from + PAGE, of: siteIds.length, scanned: from + slice.length });

      // Everyone we know of, asked about in batches so one click never stalls on hundreds of calls.
      const [authors] = await redis(['HGETALL', P + 'cmtauthors']);
      const emails = []; for (let i = 0; authors && i < authors.length; i += 2) emails.push(authors[i]);
      const types = await dudaTypes(emails, 40);
      const unknown = emails.filter((e) => types[e] === undefined);
      const staff = emails.filter((e) => types[e] === 'STAFF');
      const customers = emails.filter((e) => types[e] === 'CUSTOMER');
      const nobody = emails.filter((e) => types[e] === '');
      await globalLog({ type: 'slack', by: me.email, byName: me.name, text: `asked Duda about ${emails.length - unknown.length} comment author${emails.length - unknown.length === 1 ? '' : 's'}: ${staff.length} staff, ${customers.length} customers` });
      return res.status(200).json({ done: true, total: emails.length, staff, customers, nobody, pending: unknown.length });
    }
    if (b.op === 'slackForget') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      await redis(['DEL', P + 'slackroster']);
      await globalLog({ type: 'slack', by: me.email, byName: me.name, text: 'cleared the Slack member list' });
      return res.status(200).json({ ok: true, roster: null });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

/** The roster as the page needs it: who and how many, not a copy of the workspace. */
function slim(rec) {
  if (!rec) return { roster: null, slack: slackBotEnabled() };
  return { slack: true, roster: { at: rec.at, byName: rec.byName || '', count: (rec.team || []).length, guests: (rec.guests || []).length,
    team: (rec.team || []).slice(0, 200).map((x) => ({ email: x.email, name: x.name })),
    guestList: (rec.guests || []).slice(0, 60).map((x) => ({ email: x.email, name: x.name })) } };
}
