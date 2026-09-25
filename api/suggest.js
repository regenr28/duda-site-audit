// Feature suggestions. Private: only the owner (SUGGESTIONS_OWNER, default regencia.reymark28@gmail.com) sees all of them.
// Everyone else only sees the suggestions they submitted themselves (so they can read the owner's replies).
// GET  /api/suggest                      → { owner: bool, items }
// POST /api/suggest { op: create | status | comment, ... }
import { redis, P, readBody, requireUser, jparse, newId, now, sendEmail, emailShell, esc, appUrl, notifyUser, OWNER_EMAIL, plainMentions } from './_lib.js';

const STATUSES = ['new', 'ongoing', 'done', 'nope'];
const LABEL = { new: 'New', ongoing: 'On going', done: 'Done', nope: 'Nope' };
const cleanImgs = (arr) => [].concat(arr || []).filter((u) => /^\/api\/img\?id=[\w-]+$/.test(u)).slice(0, 8);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  const isOwner = me.email === OWNER_EMAIL;
  try {
    const [raw] = await redis(['HGETALL', P + 'sugg']);
    const all = [];
    for (let i = 0; raw && i < raw.length; i += 2) { const s = jparse(raw[i + 1]); if (s) all.push(s); }
    if (req.method === 'GET') {
      const items = (isOwner ? all : all.filter((s) => s.by === me.email)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return res.status(200).json({ owner: isOwner, items });
    }
    const b = readBody(req);
    const link = appUrl(req) + '/#/suggestions';
    if (b.op === 'create') {
      const title = String(b.title || '').trim().slice(0, 140);
      const text = String(b.text || '').trim().slice(0, 5000);
      if (!title) return res.status(400).json({ error: 'Give your suggestion a short title' });
      const s = { id: newId(8), by: me.email, byName: me.name, title, text, images: cleanImgs(b.images), status: 'new', createdAt: now(), updatedAt: now(), comments: [], history: [] };
      await redis(['HSET', P + 'sugg', s.id, JSON.stringify(s)]);
      if (me.email !== OWNER_EMAIL) {
        await notifyUser(OWNER_EMAIL, { by: me.email, byName: me.name, kind: 'suggestion', text: title }).catch(() => {});
        await sendEmail(OWNER_EMAIL, `💡 New feature suggestion from ${me.name}: ${title}`, emailShell('New feature suggestion', `
          <p><b>${esc(me.name)}</b> (${esc(me.email)}) suggested:</p>
          <p style="font-size:16px;font-weight:700;margin:6px 0">${esc(title)}</p>
          ${text ? `<blockquote style="border-left:3px solid #2563eb;margin:0;padding:8px 12px;background:#f1f3f6">${esc(text).replace(/\n/g, '<br>')}</blockquote>` : ''}
          ${s.images.length ? `<p style="color:#5d6572">${s.images.length} screenshot(s) attached. View them in the app.</p>` : ''}
          <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none">Open suggestions</a></p>`)).catch(() => {});
      }
      return res.status(200).json(s);
    }
    const s = all.find((x) => x.id === b.id);
    if (!s) return res.status(404).json({ error: 'Suggestion not found' });
    if (!isOwner && s.by !== me.email) return res.status(403).json({ error: 'Not allowed' });
    if (b.op === 'status') {
      if (!isOwner) return res.status(403).json({ error: 'Only the owner can change the status' });
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Bad status' });
      if (b.status !== s.status) {
        s.history.push({ at: now(), by: me.email, byName: me.name, from: s.status, to: b.status });
        s.status = b.status; s.updatedAt = now();
        await redis(['HSET', P + 'sugg', s.id, JSON.stringify(s)]);
        if (s.by !== me.email) {
          await notifyUser(s.by, { by: me.email, byName: me.name, kind: 'suggestion-status', text: `"${s.title}" is now ${LABEL[s.status]}` }).catch(() => {});
          await sendEmail(s.by, `Your suggestion is now "${LABEL[s.status]}": ${s.title}`, emailShell(`Suggestion update: ${LABEL[s.status]}`, `<p>${esc(me.name)} marked your suggestion <b>${esc(s.title)}</b> as <b>${LABEL[s.status]}</b>.</p><p><a href="${link}">See details and comments</a></p>`)).catch(() => {});
        }
      }
      return res.status(200).json(s);
    }
    if (b.op === 'comment') {
      const text = String(b.text || '').trim().slice(0, 5000);
      const images = cleanImgs(b.images);
      if (!text && !images.length) return res.status(400).json({ error: 'Write something or attach an image' });
      const c = { id: newId(8), by: me.email, byName: me.name, text, images, createdAt: now() };
      if (b.replyTo) { const p = s.comments.find((x) => x.id === b.replyTo); if (p) c.replyTo = { id: p.id, byName: p.byName, excerpt: String(p.text || '[image]').slice(0, 160) }; }
      s.comments.push(c); s.updatedAt = now();
      await redis(['HSET', P + 'sugg', s.id, JSON.stringify(s)]);
      const to = me.email === s.by ? OWNER_EMAIL : s.by;
      if (to !== me.email) {
        await notifyUser(to, { by: me.email, byName: me.name, kind: 'suggestion-comment', text: `On "${s.title}": ${plainMentions(text).slice(0, 150)}` }).catch(() => {});
        await sendEmail(to, `${me.name} commented on the suggestion: ${s.title}`, emailShell('New comment on a suggestion', `<p><b>${esc(me.name)}</b> on <b>${esc(s.title)}</b>:</p><blockquote style="border-left:3px solid #2563eb;margin:0;padding:8px 12px;background:#f1f3f6">${esc(text.slice(0, 600)).replace(/\n/g, '<br>')}</blockquote><p><a href="${link}">Open suggestions</a></p>`)).catch(() => {});
      }
      return res.status(200).json(s);
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
