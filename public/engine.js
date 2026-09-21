/*!
 * Duda Site Auditor — audit engine
 * Runs in the browser (app + DevTools console). Parses Duda preview HTML per device
 * (desktop / tablet / mobile) and compares everything against the Business Info "truth".
 */
(function (global) {
  'use strict';

  const DEVICES = ['desktop', 'tablet', 'mobile'];
  const DEVICE_LABEL = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

  // Duda responsive visibility rules (verified against d-css-runtime-desktop-one-pack):
  //  desktop (large):  .showOnMedium, .hide-for-large, [data-hidden-on-desktop] are hidden
  //  tablet  (medium): .showOnLarge,  .hide-for-medium, [data-hidden-on-tablet] are hidden
  //  mobile  (small):  served as separate HTML; .hide-for-small, [data-hidden-on-mobile] hidden
  const HIDE_RULES = {
    desktop: { classes: ['showOnMedium', 'showOnSmall', 'hide-for-large'], attr: 'data-hidden-on-desktop' },
    tablet: { classes: ['showOnLarge', 'showOnSmall', 'hide-for-medium'], attr: 'data-hidden-on-tablet' },
    mobile: { classes: ['showOnLarge', 'showOnMedium', 'hide-for-small'], attr: 'data-hidden-on-mobile' },
  };

  const SEV_RANK = { critical: 0, warning: 1, info: 2 };

  // Words that don't identify a specific business (used for name/handle matching)
  const GENERIC = new Set(('the and of for co company llc inc ltd corp auto autos automotive car cars truck trucks ' +
    'detail details detailing detailers mobile repair repairs service services shop shops garage tint tinting tints ' +
    'window windows ceramic coating coatings body collision tire tires center centre care wash spa pro pros plus ' +
    'motor motors mechanic mechanical express quality premier best top professional solutions group studio works ' +
    'customs custom clean cleaning protection film paint glass wrap wraps performance diesel transmission brake brakes ' +
    'oil lube tech technology fleet vehicle vehicles').split(' '));

  const EDITOR_HOSTS = /(^|\.)(responsivesiteeditor\.com|multiscreensite\.com|dudaone\.com|dudamobile\.com|mobilesitesonline\.com|dudasites\.com)$/i;

  const SOCIAL_HOSTS = [
    { net: 'facebook', re: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i },
    { net: 'instagram', re: /(^|\.)instagram\.com$/i },
    { net: 'youtube', re: /(^|\.)(youtube\.com|youtu\.be)$/i },
    { net: 'tiktok', re: /(^|\.)tiktok\.com$/i },
    { net: 'twitter', re: /(^|\.)(twitter\.com|x\.com)$/i },
    { net: 'linkedin', re: /(^|\.)linkedin\.com$/i },
    { net: 'yelp', re: /(^|\.)yelp\.com$/i },
    { net: 'pinterest', re: /(^|\.)pinterest\.com$/i },
    { net: 'google_my_business', re: /(^|\.)(google\.[a-z.]+|goo\.gl|g\.page|maps\.app\.goo\.gl)$/i, test: (u) => /maps|g\.page|goo\.gl|cid=|\/place\//i.test(u.href) },
  ];

  const PLACEHOLDERS = [
    [/lorem ipsum|dolor sit amet|consectetur adipiscing/i, 'Lorem ipsum placeholder text'],
    [/your (business|company) name|\bbusiness name here\b|\bcompany name\b/i, 'Template placeholder business name'],
    [/yourdomain\.|yourwebsite\.|example\.com|youremail@|email@example|info@domain\./i, 'Template placeholder domain/email'],
    [/\(555\)\s*\d{3}|\b555[-.\s]\d{3}[-.\s]\d{4}\b|\b555[-.\s]\d{4}\b/, 'Placeholder 555 phone number'],
    [/\b123 main st/i, 'Placeholder address (123 Main St)'],
    [/click (here )?to edit|add paragraph text|click [“"]?edit text[”"]?|add your (text|title) here|this is a paragraph/i, 'Duda default placeholder text'],
    [/\[(insert|your|business|name|city|phone|email|address)[^\]]{0,30}\]/i, 'Unfilled [placeholder]'],
    [/\{\{[^}]{1,60}\}\}/, 'Unresolved {{dynamic}} placeholder'],
    [/\bTBD\b|\bXXX+\b|\bTODO\b/, 'TBD / XXX / TODO marker'],
  ];

  const PHONE_RE = /(?<![\d$.,])(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]{0,2}(\d{3})[\s.\-](\d{4})(?![\d])/g;
  const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
  const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IFRAME', 'OBJECT']);

  // ---------- helpers ----------
  const normPhone = (s) => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d; };
  const fmtPhone = (d) => (d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);
  const compact = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n = 140) => { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const isEmailish = (e) => !/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e);
  const cls = (el) => (el && el.getAttribute ? el.getAttribute('class') || '' : '');

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function nameTokens(name) {
    return String(name || '').toLowerCase().replace(/[’'`]/g, '').split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !GENERIC.has(t));
  }

  /** Does a string (handle, place name, text) look like it belongs to the business? */
  function matchesBusiness(str, truth) {
    const c = compact(safeDecode(str));
    if (!c || !truth || !truth.businessName) return true;
    const names = truth.names && truth.names.length ? truth.names : [truth.businessName];
    for (const n of names) {
      const full = compact(n);
      if (full && (c.includes(full) || full.includes(c) && c.length >= 6)) return true;
      const toks = nameTokens(n);
      if (toks.some((t) => c.includes(t))) return true;
      if (!toks.length) {
        const all = String(n).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
        if (all.length && all.filter((t) => c.includes(t)).length >= Math.min(2, all.length)) return true;
      }
    }
    return false;
  }

  // ---------- truth (Business Info reference) ----------
  function pick(obj, ...keys) { for (const k of keys) { if (obj && obj[k] != null && obj[k] !== '') return obj[k]; } return undefined; }

  function normAddress(a) {
    if (!a) return null;
    if (typeof a === 'string') return { street: a, city: '', region: '', zip: (a.match(/\b\d{5}\b/) || [''])[0], country: '' };
    const street = [pick(a, 'streetAddress', 'address_1', 'street', 'address1', 'street_address'), pick(a, 'address_2', 'address2')].filter(Boolean).join(' ');
    return {
      street: street || '',
      city: pick(a, 'city', 'addressLocality', 'locality') || '',
      region: pick(a, 'region', 'addressRegion', 'state') || '',
      zip: String(pick(a, 'postalCode', 'zip_code', 'zip', 'postal_code') || ''),
      country: pick(a, 'country', 'addressCountry') || '',
    };
  }

  function socialHandle(net, value) {
    if (!value) return '';
    let v = String(value).trim();
    if (/^https?:\/\//i.test(v) || /\.(com|be|me|gl|page)\//i.test(v)) {
      try {
        const u = new URL(/^https?:/i.test(v) ? v : 'https://' + v);
        if (net === 'google_my_business') return placeNameFromUrl(u.href) || u.pathname + u.search;
        const segs = u.pathname.split('/').filter(Boolean);
        if (net === 'youtube' && segs[0] && /^(channel|c|user)$/i.test(segs[0])) return segs[1] || '';
        if (net === 'facebook' && segs[0] === 'pages') return segs[1] || '';
        if (net === 'facebook' && /profile\.php/i.test(u.pathname)) return u.searchParams.get('id') || '';
        return (segs[0] || '').replace(/^@/, '');
      } catch (e) { return v; }
    }
    return v.replace(/^@/, '').replace(/\/+$/, '');
  }

  // Duda's Business Info stores social accounts as handles or partial paths
  // (e.g. google_my_business: "Upscale+Detail+Co+LLC/@32.53,-84.95,17z/data=..."). Turn them into full, openable URLs.
  const SOCIAL_BASE = {
    google_my_business: 'https://www.google.com/maps/place/', facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/',
    youtube: 'https://www.youtube.com/', tiktok: 'https://www.tiktok.com/@', twitter: 'https://x.com/', linkedin: 'https://www.linkedin.com/',
    yelp: 'https://www.yelp.com/biz/', pinterest: 'https://www.pinterest.com/', houzz: 'https://www.houzz.com/', tripadvisor: 'https://www.tripadvisor.com/',
  };
  function socialUrl(net, value) {
    let v = String(value || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/^\/\//.test(v)) return 'https:' + v;
    // Already includes a known host (e.g. "facebook.com/xyz", "maps.app.goo.gl/abc", "google.com/maps/place/...")
    if (/^(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(v) && socialNetOf('https://' + v)) return 'https://' + v;
    if (net === 'google_my_business') {
      v = v.replace(/^\/+/, '').replace(/^maps\/place\//i, '');
      return SOCIAL_BASE.google_my_business + v;
    }
    const base = SOCIAL_BASE[net];
    if (!base) return /\./.test(v.split('/')[0]) ? 'https://' + v.replace(/^\/+/, '') : '';
    v = v.replace(/^\/+/, '');
    if (net === 'tiktok') v = v.replace(/^@/, '');
    else if (net !== 'youtube') v = v.replace(/^@/, '');
    return base + v;
  }

  function flatSocials(sa, out) {
    out = out || {};
    Object.keys(sa || {}).forEach((k) => {
      const v = sa[k];
      if (!v) return;
      if (typeof v === 'object' && !Array.isArray(v)) return flatSocials(v, out); // e.g. { socialAccounts: { … } }
      [].concat(v).forEach((x) => { if (x && typeof x !== 'object') (out[k] = out[k] || []).push(String(x)); });
    });
    return out;
  }

  function placeNameFromUrl(href) {
    const m = String(href).match(/\/maps\/place\/([^/@?]+)/i) || String(href).match(/!2s([^!]+)/);
    if (m) return safeDecode(m[1].replace(/\+/g, ' ')).trim();
    try { const u = new URL(href); const q = u.searchParams.get('q') || u.searchParams.get('query'); if (q) return q; } catch (e) { /* ignore */ }
    return '';
  }

  /**
   * Build the reference ("truth") from Duda API responses. `api` = { site, content } (raw API JSON).
   * Falls back to the site's own JSON-LD schema (which Duda generates from Business Info) when the API is unavailable.
   */
  function buildTruth(api, schemaObj) {
    api = api || {};
    const site = api.site || {};
    const content = api.content || {};
    const loc = content.location_data || {};
    const bi = site.site_business_info || {};
    const t = { source: 'none', businessName: '', names: [], phones: [], emails: [], addresses: [], socials: {}, socialLinks: {}, domain: '', siteSeo: site.site_seo || null, notes: [] };

    const addPhone = (p) => { const d = normPhone(p); if (d.length >= 10 && !t.phones.includes(d.slice(-10))) t.phones.push(d.slice(-10)); };
    const addEmail = (e) => { if (e && !t.emails.includes(String(e).toLowerCase().trim())) t.emails.push(String(e).toLowerCase().trim()); };
    const addName = (n) => { if (n && !t.names.some((x) => compact(x) === compact(n))) t.names.push(String(n).trim()); };

    const useLocation = (L) => {
      if (!L) return;
      (L.phones || []).forEach((p) => addPhone(pick(p, 'phoneNumber', 'phone_number', 'number') || p));
      (L.emails || []).forEach((e) => addEmail(pick(e, 'emailAddress', 'email_address', 'email') || e));
      const a = normAddress(L.address); if (a && (a.street || a.zip)) t.addresses.push(a);
      const sa = flatSocials(L.social_accounts || L.socialAccounts || {});
      Object.keys(sa).forEach((k) => {
        const net = /^(google_my_business|google|gmb|google_business|googlemybusiness)$/i.test(k) ? 'google_my_business' : k.toLowerCase();
        sa[k].forEach((val) => {
          const url = socialUrl(net, val);
          t.socials[net] = t.socials[net] || []; t.socials[net].push(socialHandle(net, url || val));
          (t.socialLinks[net] = t.socialLinks[net] || []).push(url || val);
        });
      });
      if (L.label) t.notes.push('Location label: ' + L.label);
    };

    if (content && (content.location_data || content.business_data)) {
      t.source = 'api';
      addName(content.business_data && content.business_data.name);
      useLocation(loc);
      (content.additional_locations || []).forEach(useLocation);
    }
    if (bi && (bi.business_name || bi.phone_number || bi.email)) {
      if (t.source === 'none') t.source = 'api';
      addName(bi.business_name); addPhone(bi.phone_number); addEmail(bi.email);
      const a = normAddress(bi.address); if (a && (a.street || a.zip) && !t.addresses.length) t.addresses.push(a);
    }
    if (site.site_domain) t.domain = String(site.site_domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

    if (t.source === 'none' && schemaObj) {
      t.source = 'schema';
      addName(schemaObj.name); addPhone(schemaObj.telephone); addEmail(schemaObj.email);
      const a = normAddress(schemaObj.address); if (a) t.addresses.push(a);
      [].concat(schemaObj.sameAs || []).forEach((u) => { const net = socialNetOf(u); if (net) { t.socials[net] = t.socials[net] || []; t.socials[net].push(socialHandle(net, u)); (t.socialLinks[net] = t.socialLinks[net] || []).push(u); } });
      if (schemaObj.url) { try { t.domain = new URL(schemaObj.url).hostname.toLowerCase(); } catch (e) { /* ignore */ } }
    }
    t.businessName = t.names[0] || '';
    t.nameTokens = nameTokens(t.businessName);
    return t;
  }

  function socialNetOf(href) {
    try {
      const u = new URL(href, 'https://x.invalid');
      for (const s of SOCIAL_HOSTS) if (s.re.test(u.hostname) && (!s.test || s.test(u))) return s.net;
    } catch (e) { /* ignore */ }
    return null;
  }

  function extractSchema(doc) {
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const j = JSON.parse(s.textContent);
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) return o.forEach(walk);
          if (o['@graph']) walk(o['@graph']);
          if (o.telephone || o.address || (o.name && o['@type'] && !/WebPage|BreadcrumbList|WebSite/i.test(String(o['@type'])))) out.push({ node: s, data: o });
        };
        walk(j);
      } catch (e) { /* invalid JSON-LD handled elsewhere */ }
    });
    return out;
  }

  // ---------- DOM helpers ----------
  function hiddenReason(el, device) {
    const rule = HIDE_RULES[device] || HIDE_RULES.desktop;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.tagName === 'HEAD') return null;
      if (e.hasAttribute(rule.attr)) return `${rule.attr}`;
      if (e.hasAttribute('hidden')) return 'hidden attribute';
      const c = ' ' + cls(e) + ' ';
      for (const k of rule.classes) if (c.includes(' ' + k + ' ')) return '.' + k;
      const st = (e.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
      if (st.includes('display:none') && e.id !== 'dmPopup' && !cls(e).includes('dmPopup')) return 'display:none';
      if (st.includes('visibility:hidden')) return 'visibility:hidden';
    }
    return null;
  }

  function locationOf(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = cls(e);
      if (e.tagName === 'HEAD') return 'Head / Meta';
      if (e.id === 'hamburger-drawer' || /\bhamburger-drawer\b|\blayout-drawer\b/.test(c)) return 'Side panel';
      if (e.id === 'dmPopup' || /\bdmPopup\b|\bpopup\b/i.test(c)) return 'Popup';
      if (e.id === 'fcontainer' || /\bdmFooter\b|\bdmFooterContainer\b/.test(c)) return 'Footer';
      if (e.id === 'hcontainer' || e.id === 'hamburger-header' || e.id === 'hamburger-header-container' || /\bdmHeader\b/.test(c)) return 'Header';
    }
    return 'Body';
  }

  function uniqueSelector(el) {
    const doc = el.ownerDocument;
    const tag = el.tagName.toLowerCase();
    if (tag === 'title') return 'head > title';
    if (tag === 'meta') {
      const n = el.getAttribute('name'); const p = el.getAttribute('property');
      if (n) return `meta[name="${n}"]`; if (p) return `meta[property="${p}"]`;
    }
    if (tag === 'link' && el.getAttribute('rel')) return `link[rel="${el.getAttribute('rel')}"]`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const t = cur.tagName.toLowerCase();
      if (t === 'html') break;
      if (t === 'body' || t === 'head') { parts.unshift(t); break; }
      const id = cur.getAttribute('id');
      if (id && !/["\\\s]/.test(id)) {
        const s = `[id="${id}"]`;
        let n = 0; try { n = doc.querySelectorAll(s).length; } catch (e) { n = 0; }
        if (n === 1) { parts.unshift(s); break; }
      }
      const parent = cur.parentElement;
      let seg = t;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === cur.tagName);
        if (same.length > 1) seg += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(seg);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function snippetOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return `<img alt="${el.getAttribute('alt') ?? '(none)'}" src="${cut(el.getAttribute('src') || el.getAttribute('data-src') || '', 70)}">`;
    if (tag === 'a') return `<a href="${cut(el.getAttribute('href') || '', 70)}">${cut(el.textContent, 50)}</a>`;
    if (tag === 'meta') return `<meta ${el.getAttribute('name') ? 'name' : 'property'}="${el.getAttribute('name') || el.getAttribute('property')}" content="${cut(el.getAttribute('content'), 80)}">`;
    if (tag === 'iframe') return `<iframe src="${cut(el.getAttribute('src'), 90)}">`;
    return cut(el.textContent, 120);
  }

  function textNodes(root) {
    const doc = root.ownerDocument || root;
    const out = [];
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
    let n;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (!p) continue;
      let skip = false;
      for (let e = p; e; e = e.parentElement) { if (SKIP_TEXT_TAGS.has(e.tagName.toUpperCase())) { skip = true; break; } }
      if (skip) continue;
      if (n.nodeValue && n.nodeValue.trim()) out.push(n);
    }
    return out;
  }

  // ---------- page audit ----------
  /**
   * Audit a parsed Duda preview document for one device.
   * ctx: { device, path, pageUrl, truth, siteId, host, noIndex }
   */
  function auditDocument(doc, ctx) {
    const truth = ctx.truth || {};
    const device = ctx.device || 'desktop';
    const findings = [];
    const internal = new Set();
    const external = new Map(); // url -> {selector,...}
    const images = new Map();
    const altList = [];
    const textIndex = [];
    const seen = new Set();
    const now = new Date();

    const add = (el, f) => {
      const selector = el ? uniqueSelector(el) : '(page)';
      const key = [f.code, selector, f.found || ''].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      const hid = el ? hiddenReason(el, device) : null;
      findings.push(Object.assign({
        path: ctx.path, device, selector,
        location: el ? locationOf(el) : 'Page',
        visible: !hid, hiddenBy: hid || '',
        snippet: el ? snippetOf(el) : '',
      }, f));
    };

    const alias = doc.body && doc.body.getAttribute('data-page-alias');
    if (alias === 'dmPageNotFound') {
      return { notFound: true, findings: [], internal: [], external: [], images: [], textIndex: [], meta: {} };
    }

    const phoneOk = (d) => !truth.phones || !truth.phones.length || truth.phones.includes(d.slice(-10));
    const emailOk = (e) => !truth.emails || !truth.emails.length || truth.emails.includes(String(e).toLowerCase());
    const expectedPhones = (truth.phones || []).map(fmtPhone).join(', ') || '(no phone in Business Info)';
    const expectedEmails = (truth.emails || []).join(', ') || '(no email in Business Info)';

    // --- Meta ---
    const titleEl = doc.querySelector('head > title') || doc.querySelector('title');
    const title = clean(titleEl && titleEl.textContent);
    const descEl = doc.querySelector('meta[name="description"]');
    const desc = clean(descEl && descEl.getAttribute('content'));
    if (!title) add(titleEl, { code: 'META_TITLE_MISSING', severity: 'warning', category: 'Meta / SEO', message: 'Page has no SEO title' });
    else {
      if (title.length > 65) add(titleEl, { code: 'META_TITLE_LONG', severity: 'info', category: 'Meta / SEO', message: `SEO title is ${title.length} chars (Google shows ~60)`, found: title });
      if (title.length < 15) add(titleEl, { code: 'META_TITLE_SHORT', severity: 'info', category: 'Meta / SEO', message: 'SEO title is very short', found: title });
      if (ctx.path === '/' && truth.businessName && !matchesBusiness(title, truth)) add(titleEl, { code: 'META_TITLE_NO_NAME', severity: 'info', category: 'Meta / SEO', message: "Home page SEO title doesn't mention the business name", found: title, expected: truth.businessName });
    }
    if (!desc) add(descEl || titleEl, { code: 'META_DESC_MISSING', severity: 'warning', category: 'Meta / SEO', message: 'Page has no meta description' });
    else if (desc.length > 165) add(descEl, { code: 'META_DESC_LONG', severity: 'info', category: 'Meta / SEO', message: `Meta description is ${desc.length} chars (Google shows ~155)`, found: cut(desc, 200) });
    else if (desc.length < 50) add(descEl, { code: 'META_DESC_SHORT', severity: 'info', category: 'Meta / SEO', message: 'Meta description is very short', found: desc });
    if (ctx.noIndex) add(titleEl, { code: 'META_NOINDEX', severity: 'critical', category: 'Meta / SEO', message: 'Page is set to "noindex" in Duda SEO settings — Google will not index it' });
    if (!doc.querySelector('meta[property="og:image"]')) add(titleEl, { code: 'META_OG_IMAGE', severity: 'info', category: 'Meta / SEO', message: 'No social share image (og:image)' });
    const canon = doc.querySelector('link[rel="canonical"]');
    if (canon && truth.domain) {
      try {
        const h = new URL(canon.getAttribute('href')).hostname.toLowerCase().replace(/^www\./, '');
        if (h !== truth.domain.replace(/^www\./, '')) add(canon, { code: 'META_CANONICAL_DOMAIN', severity: 'warning', category: 'Meta / SEO', message: 'Canonical URL uses a different domain than the site domain', found: h, expected: truth.domain });
      } catch (e) { /* ignore */ }
    }

    // meta contents: phone/email/name
    doc.querySelectorAll('head title, head meta[name="description"], head meta[property^="og:"], head meta[name^="twitter:"]').forEach((m) => {
      const val = m.tagName === 'TITLE' ? m.textContent : m.getAttribute('content') || '';
      scanValue(m, val, 'Meta / SEO');
    });

    // --- Schema (JSON-LD) ---
    const schemas = extractSchema(doc);
    if (truth.source === 'api') {
      schemas.forEach(({ node, data }) => {
        const tel = data.telephone && normPhone(data.telephone);
        if (tel && tel.length >= 10 && !phoneOk(tel)) add(node, { code: 'SCHEMA_PHONE', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) phone differs from Business Info', found: data.telephone, expected: expectedPhones });
        if (data.email && !emailOk(data.email)) add(node, { code: 'SCHEMA_EMAIL', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) email differs from Business Info', found: data.email, expected: expectedEmails });
        if (data.name && truth.businessName && !matchesBusiness(data.name, truth)) add(node, { code: 'SCHEMA_NAME', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) business name differs from Business Info', found: data.name, expected: truth.businessName });
        const a = normAddress(data.address);
        if (a && a.zip && truth.addresses.length && !truth.addresses.some((x) => x.zip && x.zip === a.zip)) add(node, { code: 'SCHEMA_ADDRESS', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) ZIP differs from Business Info', found: [a.street, a.city, a.zip].filter(Boolean).join(', '), expected: truth.addresses.map((x) => [x.street, x.city, x.zip].filter(Boolean).join(', ')).join(' | ') });
      });
    }
    schemas.forEach(({ node, data }) => {
      [].concat(data.sameAs || []).forEach((u) => checkSocial(node, u, 'Schema sameAs'));
    });

    // --- Text nodes: phones, emails, placeholders, copyright ---
    const body = doc.body;
    const tn = body ? textNodes(body) : [];
    const perEl = new Map();
    tn.forEach((n) => { const p = n.parentElement; perEl.set(p, (perEl.get(p) || '') + n.nodeValue); });
    perEl.forEach((text, el) => {
      const t = clean(text);
      if (t.length >= 3) textIndex.push({ el, text: t });
      if (el.closest && el.closest('a[href^="tel:"], a[href^="mailto:"]')) {
        // handled in link checks, but still scan for foreign emails/phones inside other text
      } else {
        scanValue(el, t, 'Contact info');
      }
      for (const [re, label] of PLACEHOLDERS) {
        const m = t.match(re);
        if (m) add(el, { code: 'PLACEHOLDER', severity: 'critical', category: 'Content', message: label, found: cut(t, 160) });
      }
      const cm = t.match(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})\s*(.{0,70})/i);
      if (cm) {
        const yr = parseInt(cm[1], 10);
        if (yr < now.getFullYear() && yr > 1990) add(el, { code: 'COPYRIGHT_YEAR', severity: 'warning', category: 'Content', message: `Copyright year is ${yr}`, found: cut(cm[0], 90), expected: String(now.getFullYear()) });
        const tail = cm[2].replace(/all rights reserved.*$/i, '').replace(/^[\s|.,:–-]*(by)?/i, '').trim();
        if (tail && /[a-z]{3}/i.test(tail) && truth.businessName && !matchesBusiness(tail, truth) && !/powered|design|website|built|developed|created|marketing|privacy|terms/i.test(tail)) {
          add(el, { code: 'COPYRIGHT_NAME', severity: 'critical', category: 'Business name', message: 'Copyright line names a different business', found: cut(cm[0], 90), expected: truth.businessName });
        }
      }
      const dw = t.match(/\b([a-z]{3,})\s+\1\b/i);
      if (dw && !/^(that|had|very|bye|ha|no|so)$/i.test(dw[1])) add(el, { code: 'REPEATED_WORD', severity: 'info', category: 'Content', message: 'Repeated word (possible typo)', found: `"${dw[0]}" in: ${cut(t, 100)}` });
    });

    // attribute-level scan (alt/title/aria-label/placeholder/data-*)
    doc.querySelectorAll('body *').forEach((el) => {
      if (SKIP_TEXT_TAGS.has(el.tagName.toUpperCase()) && el.tagName !== 'IFRAME') return;
      for (const a of el.attributes) {
        const n = a.name;
        if (n === 'alt' || n === 'title' || n === 'aria-label' || n === 'placeholder' || (n.startsWith('data-') && a.value.length < 200 && !/^data-(src|bg|image|img|dm-image|anim|layout|element|display|link|rss|widget|video|type)/.test(n))) {
          if (a.value && /\d{3}|@/.test(a.value)) scanValue(el, a.value, 'Contact info', n);
        }
      }
    });

    function scanValue(el, val, category, attrName) {
      if (!val) return;
      const where = attrName ? ` (in ${attrName} attribute)` : '';
      PHONE_RE.lastIndex = 0;
      let m;
      while ((m = PHONE_RE.exec(val))) {
        const d = m[1] + m[2] + m[3];
        if (!phoneOk(d)) add(el, { code: 'PHONE_MISMATCH', severity: 'critical', category, message: `Phone number not in Business Info${where}`, found: fmtPhone(d), expected: expectedPhones });
      }
      const emails = val.match(EMAIL_RE) || [];
      emails.filter(isEmailish).forEach((e) => {
        if (!emailOk(e)) add(el, { code: 'EMAIL_MISMATCH', severity: 'critical', category, message: `Email not in Business Info${where}`, found: e, expected: expectedEmails });
      });
    }

    // --- Links ---
    doc.querySelectorAll('a').forEach((a) => {
      const raw = a.getAttribute('href');
      const text = clean(a.textContent);
      const isButton = /\bdmButtonLink\b/.test(cls(a));
      const hasPopup = Array.prototype.some.call(a.attributes, (x) => /popup/i.test(x.name) || /popup/i.test(x.value) && x.name !== 'class');
      if (raw == null || raw.trim() === '' || raw.trim() === '#' || /^javascript:/i.test(raw.trim())) {
        if (isButton && !hasPopup) add(a, { code: 'BUTTON_NO_LINK', severity: 'warning', category: 'Links', message: 'Button has no link (href is empty, # or javascript:)', found: text || '(no text)' });
        return;
      }
      const href = raw.trim();

      if (/^tel:/i.test(href)) {
        const d = normPhone(safeDecode(href.slice(4)));
        if (d.length !== 10) add(a, { code: 'TEL_INVALID', severity: 'critical', category: 'Contact info', message: 'Phone link has an invalid number', found: href });
        else if (!phoneOk(d)) add(a, { code: 'TEL_MISMATCH', severity: 'critical', category: 'Contact info', message: 'Phone link (tel:) dials a number that is not in Business Info', found: fmtPhone(d), expected: expectedPhones });
        PHONE_RE.lastIndex = 0;
        const shown = PHONE_RE.exec(text);
        if (shown) {
          const sd = shown[1] + shown[2] + shown[3];
          if (d.length === 10 && sd !== d) add(a, { code: 'TEL_TEXT_MISMATCH', severity: 'critical', category: 'Contact info', message: 'Phone button shows one number but dials another', found: `Shows ${fmtPhone(sd)} → dials ${fmtPhone(d)}`, expected: expectedPhones });
        }
        return;
      }
      if (/^mailto:/i.test(href)) {
        const e = safeDecode(href.slice(7).split('?')[0]).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) add(a, { code: 'MAILTO_INVALID', severity: 'critical', category: 'Contact info', message: 'Email link has an invalid address', found: href });
        else if (!emailOk(e)) add(a, { code: 'MAILTO_MISMATCH', severity: 'critical', category: 'Contact info', message: 'Email link (mailto:) goes to an address not in Business Info', found: e, expected: expectedEmails });
        const shownE = (text.match(EMAIL_RE) || [])[0];
        if (shownE && shownE.toLowerCase() !== e) add(a, { code: 'MAILTO_TEXT_MISMATCH', severity: 'critical', category: 'Contact info', message: 'Email link shows one address but opens another', found: `Shows ${shownE} → opens ${e}` });
        return;
      }
      if (/^(sms|whatsapp):/i.test(href)) {
        const d = normPhone(href.replace(/^[a-z]+:/i, '').split('?')[0]);
        if (d.length >= 10 && !phoneOk(d)) add(a, { code: 'SMS_MISMATCH', severity: 'critical', category: 'Contact info', message: 'Text/SMS link number not in Business Info', found: fmtPhone(d), expected: expectedPhones });
        return;
      }
      if (href.startsWith('#')) return;

      let u;
      try { u = new URL(href, ctx.pageUrl); } catch (e) { add(a, { code: 'LINK_MALFORMED', severity: 'warning', category: 'Links', message: 'Malformed link URL', found: href }); return; }
      if (!/^https?:$/.test(u.protocol)) return;

      const siteMatch = u.pathname.match(/^\/site\/([^/?#]+)(\/[^?#]*)?/);
      const isAbs = /^https?:\/\//i.test(href) || href.startsWith('//');
      const sameHost = u.hostname === ctx.host;
      if (siteMatch && (sameHost || EDITOR_HOSTS.test(u.hostname))) {
        if (siteMatch[1] !== ctx.siteId) {
          add(a, { code: 'LINK_OTHER_SITE', severity: 'critical', category: 'Links', message: 'Link points to a DIFFERENT Duda site (likely copied from another client)', found: href });
          return;
        }
        if (isAbs && !sameHost) add(a, { code: 'LINK_EDITOR_URL', severity: 'critical', category: 'Links', message: 'Link points to the Duda editor/preview URL instead of the live site', found: href });
        internal.add(normalizePath(siteMatch[2] || '/'));
        return;
      }
      if (EDITOR_HOSTS.test(u.hostname) || (isAbs && sameHost)) {
        add(a, { code: 'LINK_EDITOR_URL', severity: 'critical', category: 'Links', message: 'Link points to a Duda editor/preview domain', found: href });
        return;
      }
      const hostNoWww = u.hostname.toLowerCase().replace(/^www\./, '');
      if (truth.domain && hostNoWww === truth.domain.replace(/^www\./, '')) {
        internal.add(normalizePath(u.pathname));
        return;
      }
      const net = socialNetOf(u.href);
      if (net) { checkSocial(a, u.href, 'Link'); return; }
      if (u.protocol === 'http:') add(a, { code: 'LINK_HTTP', severity: 'info', category: 'Links', message: 'External link uses insecure http://', found: href });
      if (!external.has(u.href)) external.set(u.href, { el: a });
      if (!text && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')) add(a, { code: 'LINK_NO_TEXT', severity: 'info', category: 'Accessibility', message: 'Link has no readable text or aria-label', found: href });
    });

    function checkSocial(el, href, via) {
      const net = socialNetOf(href);
      if (!net) return;
      let u; try { u = new URL(href); } catch (e) { return; }
      const handle = socialHandle(net, u.href);
      const label = net === 'google_my_business' ? 'Google Business/Maps' : net[0].toUpperCase() + net.slice(1);
      if (!handle || handle === '/' || /^(home|login|sharer|share|intent|watch|results)$/i.test(handle)) {
        if (!/sharer|share|intent/i.test(u.href)) add(el, { code: 'SOCIAL_GENERIC', severity: 'warning', category: 'Social', message: `${label} link doesn't point to a specific profile`, found: u.href });
        return;
      }
      const expected = (truth.socials && truth.socials[net]) || [];
      const hc = compact(handle);
      if (expected.length) {
        const ok = expected.some((x) => { const xc = compact(x); return xc && (xc === hc || hc.includes(xc) || xc.includes(hc)); });
        if (!ok) {
          const looksOther = !matchesBusiness(handle, truth);
          add(el, { code: looksOther ? 'SOCIAL_OTHER_BUSINESS' : 'SOCIAL_MISMATCH', severity: looksOther ? 'critical' : 'warning', category: 'Social', message: `${label} ${via.toLowerCase()} doesn't match Business Info${looksOther ? ' — looks like ANOTHER business' : ''}`, found: net === 'google_my_business' ? handle : u.href, expected: expected.join(', '), foreignName: looksOther ? handle : undefined });
        }
      } else if (truth.businessName && !matchesBusiness(handle, truth)) {
        add(el, { code: 'SOCIAL_OTHER_BUSINESS', severity: 'critical', category: 'Social', message: `${label} ${via.toLowerCase()} looks like it belongs to another business`, found: net === 'google_my_business' ? handle : u.href, expected: `Something matching "${truth.businessName}"`, foreignName: handle });
      }
    }

    // --- Images ---
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-dm-image-path') || '';
      if (!src || src.startsWith('data:')) return; // form checkbox icons, lazy placeholders
      const w = img.getAttribute('width'); if (w === '1' || w === '0') return;
      if (/\/blank(-\d+w)?\.(webp|png|gif|jpe?g)$/i.test(src.split('?')[0])) return; // Duda spacer image
      if (img.closest('noscript')) return;
      let abs = src; try { abs = new URL(src, ctx.pageUrl).href; } catch (e) { /* ignore */ }
      if (!images.has(abs)) images.set(abs, { el: img });
      const alt = img.getAttribute('alt');
      const file = safeDecode(abs.split('?')[0].split('/').pop() || '');
      if (alt == null) add(img, { code: 'ALT_MISSING', severity: 'warning', category: 'Images / Alt', message: 'Image has no alt attribute', found: file });
      else if (!alt.trim()) add(img, { code: 'ALT_EMPTY', severity: 'warning', category: 'Images / Alt', message: 'Image alt text is empty', found: file });
      else {
        const a = alt.trim();
        if (/\.(jpe?g|png|gif|webp|svg|heic|avif)$/i.test(a) || /^(img|image|dsc|photo|pic|screenshot|untitled|shutterstock|adobestock|istock|getty|unsplash|pexels)[\s_\-]*\d*/i.test(a) || /^[a-f0-9_\-]{16,}$/i.test(a))
          add(img, { code: 'ALT_FILENAME', severity: 'warning', category: 'Images / Alt', message: 'Alt text looks like a file name', found: a });
        else if (/^(image|photo|picture|logo|icon|img|graphic|banner|placeholder|alt|alt text|default)$/i.test(a))
          add(img, { code: 'ALT_GENERIC', severity: 'warning', category: 'Images / Alt', message: 'Alt text is generic', found: a });
        // Logo detection — strict, so ordinary photos (galleries, service images) are never treated as logos
        const locImg = locationOf(img);
        const inGallery = !!img.closest('.dmPhotoGallery, .photoGalleryThumbs, [class*="Gallery"], [class*="slider"], [class*="Slider"]');
        const link = img.closest('a[href]');
        let linksHome = false;
        if (link) {
          const hp = (link.getAttribute('href') || '').split(/[?#]/)[0].replace(/\/+$/, '');
          linksHome = hp === '' || hp === '/site/' + ctx.siteId || hp === '/' || (truth.domain && /^https?:\/\//i.test(hp) && hp.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '') === truth.domain.replace(/^www\./, ''));
        }
        const logoHint = /logo/i.test(file) || /logo/i.test(img.id || '') || /\blogo\b|imageWidget.*logo/i.test(cls(img) + ' ' + cls(img.parentElement));
        const isLogo = !inGallery && (logoHint || ((locImg === 'Header' || locImg === 'Side panel' || locImg === 'Footer') && linksHome));
        altList.push({ alt: a, file, selector: uniqueSelector(img), location: locImg, linksHome, isLogo, inGallery, hiddenBy: hiddenReason(img, device) || '' });
        // A descriptive alt ("A man is spraying film on a car") describes the photo — it's never a business name
        const descriptive = /^(a|an|the|this|close[- ]up|photo|image|picture)\b/i.test(a) || a.split(/\s+/).length >= 7 || /\b(is|are|was|were|being|with|on|of|in)\b/i.test(a) && a.split(/\s+/).length >= 5;
        if (isLogo && truth.businessName && !matchesBusiness(a, truth)) {
          const meaningful = nameTokens(a).filter((t) => !/^(logo|footer|header|image|icon|main|site|brand|white|black|dark|light|color|colour|transparent|png|jpg)$/.test(t));
          if (meaningful.length && !descriptive) add(img, { code: 'ALT_LOGO_NAME', severity: 'critical', category: 'Business name', message: 'Logo alt text names a different business', found: a, expected: truth.businessName, foreignName: a });
          else add(img, { code: 'ALT_LOGO_GENERIC', severity: 'warning', category: 'Images / Alt', message: 'Logo alt text should include the business name', found: a, expected: truth.businessName + ' logo' });
        }
        if (a.length > 150) add(img, { code: 'ALT_LONG', severity: 'info', category: 'Images / Alt', message: `Alt text is very long (${a.length} chars)`, found: cut(a, 80) });
        for (const [re, label] of PLACEHOLDERS) if (re.test(a)) add(img, { code: 'ALT_PLACEHOLDER', severity: 'critical', category: 'Images / Alt', message: `Alt text: ${label}`, found: a });
      }
    });

    // --- Headings (only elements visible on this device) ---
    const heads = Array.from(doc.querySelectorAll('body h1, body h2, body h3, body h4, body h5, body h6')).filter((h) => !hiddenReason(h, device));
    const h1s = heads.filter((h) => h.tagName === 'H1');
    if (!h1s.length) add(null, { code: 'H1_MISSING', severity: 'warning', category: 'Meta / SEO', message: `No visible H1 heading on ${DEVICE_LABEL[device]}` });
    if (h1s.length > 1) add(h1s[1], { code: 'H1_MULTIPLE', severity: 'info', category: 'Meta / SEO', message: `${h1s.length} H1 headings on this page (${DEVICE_LABEL[device]})`, found: h1s.map((h) => cut(h.textContent, 40)).join(' | ') });

    // --- Maps & iframes ---
    doc.querySelectorAll('iframe').forEach((f) => {
      const src = f.getAttribute('src') || f.getAttribute('data-src') || '';
      if (/google\.[a-z.]+\/maps|maps\.google/i.test(src)) {
        const place = placeNameFromUrl(src);
        if (place && truth.businessName) {
          const addrLike = /^\d+\s/.test(place) || /,\s*[A-Z]{2}\b/.test(place);
          if (addrLike) {
            const num = (place.match(/^\d+/) || [''])[0];
            if (num && truth.addresses.length && !truth.addresses.some((x) => x.street && x.street.startsWith(num))) add(f, { code: 'MAP_ADDRESS', severity: 'critical', category: 'Contact info', message: 'Google Map embed shows a different address', found: place, expected: truth.addresses.map((x) => x.street).join(' | ') });
          } else if (!matchesBusiness(place, truth)) {
            add(f, { code: 'MAP_OTHER_BUSINESS', severity: 'critical', category: 'Contact info', message: 'Google Map embed points to ANOTHER business', found: place, expected: truth.businessName, foreignName: place });
          }
        }
      }
    });

    return {
      notFound: false,
      findings,
      internal: Array.from(internal),
      external: Array.from(external.keys()).map((url) => ({ url, selector: uniqueSelector(external.get(url).el), location: locationOf(external.get(url).el), hiddenBy: hiddenReason(external.get(url).el, device) || '' })),
      images: Array.from(images.keys()).map((url) => ({ url, selector: uniqueSelector(images.get(url).el), location: locationOf(images.get(url).el), hiddenBy: hiddenReason(images.get(url).el, device) || '' })),
      alts: altList,
      textIndex: textIndex.map((x) => ({ text: x.text, selector: uniqueSelector(x.el), location: locationOf(x.el), hiddenBy: hiddenReason(x.el, device) || '' })),
      meta: { title, description: desc, h1: h1s.map((h) => clean(h.textContent)) },
      schema: schemas.map((s) => s.data),
    };
  }

  function normalizePath(p) {
    p = safeDecode(String(p || '/')).split('?')[0].split('#')[0];
    p = '/' + p.replace(/^\/+/, '').replace(/\/+$/, '');
    return p === '/home' ? '/' : p;
  }

  // ---------- merging ----------
  function fingerprint(f) { return hash([f.code, f.path, f.selector, f.found || '', f.message].join('|')); }

  /** Merge per-device findings for the same page/element into one row with device visibility info. */
  function mergeDevices(list) {
    const map = new Map();
    for (const f of list) {
      const key = [f.code, f.path, f.selector, f.found || ''].join('|');
      let m = map.get(key);
      if (!m) { m = Object.assign({}, f, { devices: [], visibleOn: [], hiddenOn: [] }); delete m.device; delete m.visible; delete m.hiddenBy; map.set(key, m); }
      if (!m.devices.includes(f.device)) m.devices.push(f.device);
      if (f.visible) { if (!m.visibleOn.includes(f.device)) m.visibleOn.push(f.device); }
      else m.hiddenOn.push(`${DEVICE_LABEL[f.device]} (${f.hiddenBy})`);
    }
    return Array.from(map.values());
  }

  /** Group the same element+issue appearing on many pages (headers, footers, side panels, global sections). */
  function groupAcrossPages(list) {
    const map = new Map();
    for (const f of list) {
      const key = [f.code, f.selector, f.found || '', f.message].join('|');
      let g = map.get(key);
      if (!g) { g = Object.assign({}, f, { pages: [f.path] }); map.set(key, g); continue; }
      if (!g.pages.includes(f.path)) g.pages.push(f.path);
      f.devices.forEach((d) => { if (!g.devices.includes(d)) g.devices.push(d); });
      f.visibleOn.forEach((d) => { if (!g.visibleOn.includes(d)) g.visibleOn.push(d); });
      f.hiddenOn.forEach((d) => { if (!g.hiddenOn.includes(d)) g.hiddenOn.push(d); });
    }
    return Array.from(map.values()).map((g) => {
      g.pages.sort();
      g.path = g.pages[0];
      g.id = hash([g.code, g.selector, g.found || '', g.message, g.pages.length > 1 ? '*' : g.path].join('|'));
      return g;
    });
  }

  function sortFindings(list) {
    return list.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || a.category.localeCompare(b.category) || String(a.path).localeCompare(String(b.path)));
  }

  // ---------- full scan orchestration ----------
  /**
   * opts: {
   *   siteId, host, truth (from buildTruth or null), seedPaths: ['/','/about'], pagesMeta: {path:{noIndex, title}},
   *   fetchPage: async (path, device) => ({ status, html, url }),
   *   checkUrls: async (urls) => [{url,status,error}] (optional),
   *   onProgress: ({done,total,message}) => void, maxPages (default 150), concurrency (default 3),
   *   devices (default all three), shouldStop: () => bool
   * }
   */
  async function runScan(opts) {
    const devices = opts.devices || DEVICES;
    const maxPages = opts.maxPages || 150;
    const conc = opts.concurrency || 3;
    const log = [];
    const progress = (m) => { if (opts.onProgress) opts.onProgress(m); };
    const pagesMeta = opts.pagesMeta || {};
    let truth = opts.truth;
    const raw = [];
    const pageInfo = {};
    const external = new Map();
    const images = new Map();
    const altMap = new Map();
    const textIdx = [];
    const queue = [];
    const queued = new Set();
    const enqueue = (p, from) => { p = normalizePath(p); if (!queued.has(p) && queued.size < maxPages) { queued.add(p); queue.push(p); pageInfo[p] = pageInfo[p] || { path: p, from: from || null }; } };
    (opts.seedPaths && opts.seedPaths.length ? opts.seedPaths : ['/']).forEach((p) => enqueue(p, 'Duda pages list'));
    if (!queued.has('/')) enqueue('/', 'home');

    let doneFetches = 0;
    const parser = new DOMParser();

    // If no API truth, derive from the home page schema first
    if (!truth || truth.source === 'none') {
      const home = await opts.fetchPage('/', 'desktop');
      const doc = parser.parseFromString(home.html || '', 'text/html');
      const sch = extractSchema(doc).map((s) => s.data).find((d) => d.telephone || d.name);
      truth = buildTruth(null, sch);
      log.push(truth.source === 'schema' ? 'Business Info API unavailable — using the site schema (generated by Duda from Business Info) as reference.' : 'No Business Info reference found — contact checks are limited.');
    }

    async function worker() {
      while (queue.length) {
        if (opts.shouldStop && opts.shouldStop()) return;
        const path = queue.shift();
        for (const device of devices) {
          let res;
          try { res = await opts.fetchPage(path, device); } catch (e) { res = { status: 0, html: '', error: String(e && e.message || e) }; }
          doneFetches++;
          progress({ done: doneFetches, total: queued.size * devices.length, message: `${path} · ${DEVICE_LABEL[device]}` });
          const info = pageInfo[path];
          if (!res || !res.html || res.status >= 400) {
            const doc404 = res && res.html ? parser.parseFromString(res.html, 'text/html') : null;
            if (doc404 && doc404.body && doc404.body.getAttribute('data-page-alias') === 'dmPageNotFound') { info.notFound = true; }
            else { info.error = `HTTP ${res ? res.status : 0} ${res && res.error ? res.error : ''}`.trim(); }
            if (device === devices[0] || info.notFound) break;
            continue;
          }
          const doc = parser.parseFromString(res.html, 'text/html');
          const r = auditDocument(doc, { device, path, pageUrl: res.url || `https://${opts.host}/site/${opts.siteId}${path === '/' ? '' : path}`, truth, siteId: opts.siteId, host: opts.host, noIndex: pagesMeta[path] && pagesMeta[path].noIndex });
          if (r.notFound) { info.notFound = true; break; }
          info.title = info.title || r.meta.title;
          info.description = info.description || r.meta.description;
          info.devices = (info.devices || []).concat(device);
          r.findings.forEach((f) => raw.push(f));
          r.internal.forEach((p) => { if (!queued.has(p)) enqueue(p, path); (pageInfo[p] || {}).linkedFrom = (pageInfo[p] || {}).linkedFrom || { path, device }; });
          r.external.forEach((x) => { if (!external.has(x.url)) external.set(x.url, Object.assign({ path, device }, x)); });
          r.images.forEach((x) => { if (!images.has(x.url)) images.set(x.url, Object.assign({ path, device }, x)); });
          (r.alts || []).forEach((x) => {
            let m = altMap.get(x.alt);
            if (!m) { if (altMap.size >= 400) return; m = { alt: x.alt, file: x.file, selector: x.selector, location: x.location, linksHome: x.linksHome, isLogo: x.isLogo, pages: [], devices: [], visibleOn: [], hiddenOn: [] }; altMap.set(x.alt, m); }
            if (!m.pages.includes(path)) m.pages.push(path);
            if (!m.devices.includes(device)) m.devices.push(device);
            if (!x.hiddenBy) { if (!m.visibleOn.includes(device)) m.visibleOn.push(device); } else m.hiddenOn.push(`${DEVICE_LABEL[device]} (${x.hiddenBy})`);
            m.isLogo = m.isLogo || x.isLogo;
          });
          r.textIndex.forEach((x) => textIdx.push(Object.assign({ path, device }, x)));
        }
      }
    }
    // Home page first so nav links get queued, then parallel
    await (async () => { const first = queue.splice(1); await worker(); first.forEach((p) => queue.push(p)); })();
    await Promise.all(Array.from({ length: conc }, worker));

    // Broken internal links
    Object.values(pageInfo).forEach((p) => {
      if (p.notFound) {
        const lf = p.linkedFrom;
        raw.push({ code: 'LINK_BROKEN_INTERNAL', severity: 'critical', category: 'Links', message: 'Internal link goes to a page that does not exist (404)', found: p.path, path: lf ? lf.path : p.path, device: lf ? lf.device : 'desktop', selector: `a[href*="${p.path.replace(/"/g, '')}"]`, location: 'Body', visible: true, hiddenBy: '', snippet: '' });
      } else if (p.error) {
        raw.push({ code: 'PAGE_FETCH_ERROR', severity: 'warning', category: 'Scan', message: 'Page could not be scanned', found: p.error, path: p.path, device: 'desktop', selector: '(page)', location: 'Page', visible: true, hiddenBy: '', snippet: '' });
      }
    });

    // Foreign business names found in social/map/logo — search the text of every page for them
    const foreign = new Set();
    raw.forEach((f) => { if (f.foreignName) foreign.add(f.foreignName); });
    const phrases = [];
    foreign.forEach((n) => {
      const toks = nameTokens(safeDecode(n).replace(/([a-z])([A-Z])/g, '$1 $2'));
      if (toks.length >= 2) phrases.push({ name: n, phrase: toks.slice(0, 3).join(' ') });
      else if (toks.length === 1 && toks[0].length >= 6) phrases.push({ name: n, phrase: toks[0] });
    });
    if (phrases.length) {
      textIdx.forEach((x) => {
        const low = x.text.toLowerCase().replace(/[’'`]/g, '');
        phrases.forEach((ph) => {
          const at = low.indexOf(ph.phrase);
          if (at >= 0 && !matchesBusiness(ph.phrase, truth)) raw.push({ code: 'TEXT_OTHER_BUSINESS', severity: 'critical', category: 'Business name', message: 'Text mentions another business name', found: (at > 70 ? '…' : '') + cut(x.text.slice(Math.max(0, at - 70)), 170), expected: truth.businessName, path: x.path, device: x.device, selector: x.selector, location: x.location, visible: !x.hiddenBy, hiddenBy: x.hiddenBy, snippet: cut(x.text, 120) });
        });
      });
    }

    // External link + image checks
    if (opts.checkUrls) {
      const urls = Array.from(external.keys()).concat(Array.from(images.keys()));
      const results = [];
      for (let i = 0; i < urls.length; i += 20) {
        if (opts.shouldStop && opts.shouldStop()) break;
        progress({ done: doneFetches, total: queued.size * devices.length, message: `Checking links & images ${Math.min(i + 20, urls.length)}/${urls.length}` });
        try { results.push(...(await opts.checkUrls(urls.slice(i, i + 20)))); } catch (e) { log.push('Link check failed: ' + e); }
      }
      results.forEach((r) => {
        const src = external.get(r.url) || images.get(r.url);
        if (!src) return;
        const isImg = images.has(r.url);
        const base = { path: src.path, device: src.device, selector: src.selector, location: src.location, visible: !src.hiddenBy, hiddenBy: src.hiddenBy, snippet: '' };
        if (r.status === 404 || r.status === 410) raw.push(Object.assign({ code: isImg ? 'IMAGE_BROKEN' : 'LINK_BROKEN', severity: 'critical', category: isImg ? 'Images / Alt' : 'Links', message: isImg ? 'Broken image (404)' : `Broken external link (${r.status})`, found: r.url }, base));
        else if (r.status >= 500) raw.push(Object.assign({ code: 'LINK_SERVER_ERROR', severity: 'warning', category: 'Links', message: `External link returns server error (${r.status})`, found: r.url }, base));
        else if (r.status === 0 && !isImg) raw.push(Object.assign({ code: 'LINK_UNREACHABLE', severity: 'warning', category: 'Links', message: `External link unreachable (${r.error || 'timeout/DNS'}) — verify manually`, found: r.url }, base));
      });
    }

    // Cross-page duplicates (titles / descriptions)
    const byTitle = {}; const byDesc = {};
    Object.values(pageInfo).forEach((p) => { if (p.title) (byTitle[p.title] = byTitle[p.title] || []).push(p.path); if (p.description) (byDesc[p.description] = byDesc[p.description] || []).push(p.path); });
    Object.entries(byTitle).forEach(([t, ps]) => { if (ps.length > 1) ps.forEach((p) => raw.push({ code: 'META_TITLE_DUP', severity: 'warning', category: 'Meta / SEO', message: `Same SEO title used on ${ps.length} pages`, found: t, expected: 'Unique title per page (' + ps.join(', ') + ')', path: p, device: 'desktop', selector: 'head > title', location: 'Head / Meta', visible: true, hiddenBy: '', snippet: '' })); });
    Object.entries(byDesc).forEach(([t, ps]) => { if (ps.length > 1) ps.forEach((p) => raw.push({ code: 'META_DESC_DUP', severity: 'info', category: 'Meta / SEO', message: `Same meta description used on ${ps.length} pages`, found: cut(t, 160), path: p, device: 'desktop', selector: 'meta[name="description"]', location: 'Head / Meta', visible: true, hiddenBy: '', snippet: '' })); });

    // Unique text blocks (for the AI page-text check): real site pages first, blog posts after
    function buildTextBlocks() {
      const map = new Map();
      textIdx.forEach((x) => {
        if (x.text.length < 25) return;
        let m = map.get(x.text);
        if (!m) { if (map.size >= 2500) return; m = { text: x.text, selector: x.selector, location: x.location, pages: [], devices: [], visibleOn: [], hiddenOn: [] }; map.set(x.text, m); }
        if (!m.pages.includes(x.path)) m.pages.push(x.path);
        if (!m.devices.includes(x.device)) m.devices.push(x.device);
        if (!x.hiddenBy) { if (!m.visibleOn.includes(x.device)) m.visibleOn.push(x.device); } else if (m.hiddenOn.length < 6) m.hiddenOn.push(`${DEVICE_LABEL[x.device]} (${x.hiddenBy})`);
      });
      Object.values(pageInfo).forEach((p) => {
        [['head > title', p.title], ['meta[name="description"]', p.description]].forEach(([sel, t]) => {
          if (!t || t.length < 15) return;
          let m = map.get(t);
          if (!m) { m = { text: t, selector: sel, location: 'Head / Meta', pages: [], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [] }; map.set(t, m); }
          if (!m.pages.includes(p.path)) m.pages.push(p.path);
        });
      });
      const prio = (b) => (b.location === 'Head / Meta' ? 1 : 0) + (b.pages.some((p) => p === '/' || pagesMeta[p]) ? 0 : 2);
      return Array.from(map.values()).sort((a, b) => prio(a) - prio(b));
    }

    const merged = sortFindings(groupAcrossPages(mergeDevices(raw)));
    const counts = { critical: 0, warning: 0, info: 0 };
    merged.forEach((f) => { counts[f.severity]++; });
    return {
      truth,
      findings: merged,
      pages: Object.values(pageInfo).map((p) => ({ path: p.path, title: p.title || '', notFound: !!p.notFound, error: p.error || '', devices: p.devices || [] })),
      externalLinks: external.size,
      images: images.size,
      alts: Array.from(altMap.values()),
      texts: buildTextBlocks(),
      counts,
      log,
    };
  }

  /**
   * Apply AI verdicts about alt text. verdicts[i] belongs to alts[i]:
   * { verdict: describes_image | this_business | other_business | wrong_location | placeholder | unclear, confidence 0-1, reason, suggestion }
   * - Confirms or softens the rule-based logo findings
   * - Adds new findings for alts the rules couldn't judge (another business, wrong city, placeholder text)
   */
  function applyAltVerdicts(findings, alts, verdicts, truth) {
    const byAlt = new Map();
    alts.forEach((a, i) => { if (verdicts[i]) byAlt.set(a.alt, { a, v: verdicts[i] }); });
    const sure = (v) => v && Number(v.confidence) >= 0.6;
    const logoFlagged = new Set();
    findings.forEach((f) => {
      if (!/^ALT_/.test(f.code)) return;
      const m = byAlt.get(f.found); if (!m) return;
      f.ai = m.v;
      if (f.code === 'ALT_LOGO_NAME') {
        logoFlagged.add(f.found);
        if (sure(m.v) && m.v.verdict === 'this_business') { f.severity = 'info'; f.message = 'Logo alt text is worded differently from the business name (AI: it refers to this business)'; delete f.foreignName; }
        else if (sure(m.v) && m.v.verdict === 'describes_image') { f.severity = 'warning'; f.category = 'Images / Alt'; f.message = 'Logo alt text describes the image; it should include the business name'; delete f.foreignName; }
      }
    });
    const RULES = {
      other_business: ['AI_ALT_OTHER_BUSINESS', 'critical', 'Business name', 'AI: alt text names a different business'],
      wrong_location: ['AI_ALT_LOCATION', 'warning', 'Images / Alt', "AI: alt text mentions a location that doesn't match this business"],
      placeholder: ['AI_ALT_PLACEHOLDER', 'warning', 'Images / Alt', 'AI: alt text looks like placeholder or stock-photo text'],
    };
    alts.forEach((a, i) => {
      const v = verdicts[i];
      if (!sure(v) || !RULES[v.verdict] || logoFlagged.has(a.alt)) return;
      const [code, severity, category, message] = RULES[v.verdict];
      const pages = a.pages.slice().sort();
      const f = {
        code, severity, category, message, found: a.alt,
        expected: v.suggestion ? 'Suggested alt: ' + v.suggestion : (truth && truth.businessName) || '',
        path: pages[0], pages, devices: a.devices, visibleOn: a.visibleOn, hiddenOn: a.hiddenOn,
        selector: a.selector, location: a.location, snippet: `<img alt="${a.alt}" … ${a.file}>`, ai: v,
      };
      f.id = hash([f.code, f.selector, f.found, f.message, pages.length > 1 ? '*' : f.path].join('|'));
      findings.push(f);
    });
    return sortFindings(findings);
  }

  /** Apply AI page-text issues ({ i, type, quote, confidence, reason, suggestion }, i = index into texts). */
  function applyTextIssues(findings, texts, issues, truth) {
    const RULES = {
      other_business: ['AI_TEXT_OTHER_BUSINESS', 'critical', 'Business name', 'AI: text names a different business'],
      wrong_location: ['AI_TEXT_LOCATION', 'critical', 'Location', "AI: text mentions a location that doesn't match this business"],
      name_variant: ['AI_TEXT_NAME_VARIANT', 'warning', 'Business name', 'AI: business name is written differently'],
    };
    const loc = truth && truth.addresses && truth.addresses[0] ? [truth.addresses[0].city, truth.addresses[0].region].filter(Boolean).join(', ') : '';
    issues.forEach((v) => {
      const blk = texts[v.i];
      if (!blk || !RULES[v.type] || Number(v.confidence) < 0.6) return;
      const [code, severity, category, message] = RULES[v.type];
      // Already caught by a rule on the same element? Attach the AI opinion instead of duplicating
      const existing = findings.find((f) => f.selector === blk.selector && (f.pages || [f.path]).some((p) => blk.pages.includes(p)) && /OTHER_BUSINESS|COPYRIGHT_NAME/.test(f.code) && v.type === 'other_business');
      if (existing) { existing.ai = { verdict: 'other_business', confidence: v.confidence, reason: v.reason, suggestion: v.suggestion, quote: v.quote }; return; }
      const pages = blk.pages.slice().sort();
      const t = blk.text;
      const at = v.quote ? t.toLowerCase().indexOf(v.quote.toLowerCase()) : -1;
      const context = at > 80 ? '…' + t.slice(at - 80, at + v.quote.length + 80) + '…' : t.slice(0, 220) + (t.length > 220 ? '…' : '');
      const f = {
        code, severity, category, message,
        found: v.quote ? `"${v.quote}"` : context,
        expected: v.suggestion ? 'Suggested: ' + v.suggestion : v.type === 'wrong_location' ? loc : (truth && truth.businessName) || '',
        path: pages[0], pages, devices: blk.devices, visibleOn: blk.visibleOn, hiddenOn: blk.hiddenOn,
        selector: blk.selector, location: blk.location, snippet: context,
        ai: { verdict: v.type, confidence: v.confidence, reason: v.reason, suggestion: v.suggestion, quote: v.quote },
      };
      f.id = hash([f.code, f.selector, f.found, f.message, pages.length > 1 ? '*' : f.path].join('|'));
      if (!findings.some((x) => x.id === f.id)) findings.push(f);
    });
    return sortFindings(findings);
  }

  function toCSV(findings, siteLabel) {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Site', 'Severity', 'Category', 'Page', 'Other pages', 'Location', 'Visible on', 'Hidden on', 'CSS selector', 'Finding', 'Found', 'Expected', 'Assignee', 'Done']];
    findings.forEach((f) => rows.push([siteLabel || '', f.severity, f.category, f.path, (f.pages || []).slice(1).join(' '), f.location, (f.visibleOn || []).map((d) => DEVICE_LABEL[d]).join('/') || 'None (hidden)', (f.hiddenOn || []).join('; '), f.selector, f.message, f.found || '', f.expected || '', f.assigneeName || '', f.done ? 'yes' : '']));
    return rows.map((r) => r.map(esc).join(',')).join('\n');
  }

  global.DudaAudit = {
    DEVICES, DEVICE_LABEL, buildTruth, auditDocument, runScan, extractSchema, mergeDevices, groupAcrossPages,
    matchesBusiness, normPhone, fmtPhone, uniqueSelector, hiddenReason, placeNameFromUrl, socialHandle, socialUrl, toCSV, fingerprint, hash, normalizePath, applyAltVerdicts, applyTextIssues,
  };
})(typeof window !== 'undefined' ? window : globalThis);
