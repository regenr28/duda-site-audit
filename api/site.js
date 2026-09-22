// GET /api/site?editor=<editor link>
// Returns the Business Info "truth" source data from the Duda API (site details, Content Library, pages list).
import { requireUser, parseEditorLink, allowedHost, fetchWithTimeout, redis, P, learnEditorHost } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';

async function duda(path) {
  const user = process.env.DUDA_API_USERNAME;
  const pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up yet. Please contact the app owner.');
  const r = await fetchWithTimeout(DUDA + path, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' },
  }, 15000);
  const text = await r.text();
  if (!r.ok) throw new Error(`Duda API ${r.status} on ${path}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch (e) { return text; }
}

export default async function handler(req, res) {
  if (!(await requireUser(req, res))) return;
  const { host, siteId } = parseEditorLink(req.query.editor || req.query.site || '');
  if (!siteId) return res.status(400).json({ error: 'Could not find a site ID in that link. Paste the editor link, e.g. https://…/home/site/f981a954/home' });
  if (!host || !allowedHost(host)) return res.status(400).json({ error: `Editor address "${host}" is not allowed yet. Ask the app owner to add it.` });

  // ?light=1 → only publish status + live domain (used by "Verify on live site"). Remembers the domain for an hour
  // so /api/fetch?live=1 may open that domain (and nothing else).
  if (req.query.light) {
    try {
      const d = await duda(`/sites/multiscreen/${siteId}`);
      await learnEditorHost(d.preview_site_url || '');
      const domain = String(d.site_domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
      if (domain) await redis(['SET', P + 'livedom:' + siteId, domain, 'EX', 3600]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ siteId, domain, publishStatus: d.publish_status || '', publishedAt: d.last_published_date || '', firstPublishedAt: d.first_published_date || '' });
    } catch (e) { return res.status(502).json({ error: String(e.message || e) }); }
  }
  const [site, content, pages] = await Promise.allSettled([
    duda(`/sites/multiscreen/${siteId}`),
    duda(`/sites/multiscreen/${siteId}/content`),
    duda(`/sites/multiscreen/${siteId}/pages`),
  ]);
  const errors = [];
  const val = (p, label) => { if (p.status === 'fulfilled') return p.value; errors.push(`${label}: ${p.reason && p.reason.message}`); return null; };
  const siteJson = val(site, 'Site details');
  if (siteJson && siteJson.preview_site_url) await learnEditorHost(siteJson.preview_site_url);
  const contentJson = val(content, 'Business Info (Content Library)');
  const pagesJson = val(pages, 'Pages');

  let pageList = [];
  const arr = Array.isArray(pagesJson) ? pagesJson : (pagesJson && (pagesJson.results || pagesJson.pages)) || [];
  pageList = arr.map((p) => ({
    path: '/' + String(p.path || p.page_path || p.url || '').replace(/^\/+/, ''),
    uuid: String(p.uuid || p.page_uuid || p.id || '').slice(0, 64),
    title: p.title || p.page_title || '',
    noIndex: !!((p.seo && (p.seo.no_index || p.seo.noIndex)) || p.no_index),
    seoTitle: (p.seo && p.seo.title) || '',
    seoDescription: (p.seo && p.seo.description) || '',
    hidden: p.header_html === undefined ? undefined : undefined,
  })).filter((p) => p.path);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ host, siteId, site: siteJson, content: contentJson, pages: pageList, errors });
}
