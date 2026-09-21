// Screenshots / photos attached to comments.
// POST /api/img { data: "<base64>", type: "image/jpeg" } → { id, url }
// GET  /api/img?id=…  → the image (signed-in users only)
import { redis, P, readBody, requireUser, newId, now } from './_lib.js';

const MAX_BYTES = 3 * 1024 * 1024;

export default async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const id = String(req.query.id || '');
      if (!/^[\w-]{8,40}$/.test(id)) return res.status(400).end();
      const [raw] = await redis(['GET', P + 'img:' + id]);
      if (!raw) return res.status(404).end();
      const { type, data } = JSON.parse(raw);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      return res.status(200).end(Buffer.from(data, 'base64'));
    }
    const { data, type } = readBody(req);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type || '') || typeof data !== 'string') return res.status(400).json({ error: 'Only PNG, JPG, WebP or GIF images' });
    if (Buffer.byteLength(data, 'base64') > MAX_BYTES) return res.status(413).json({ error: 'Image is too large (max 3 MB after compression)' });
    const id = newId(12);
    await redis(['SET', P + 'img:' + id, JSON.stringify({ type, data, by: me.email, at: now() })]);
    return res.status(200).json({ id, url: '/api/img?id=' + id });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
