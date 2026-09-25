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

  // ---------------------------------------------------------------------
  // What this version of the app knows how to check.
  //
  // Every scan stamps itself with the version below. An audit scanned before new checks existed
  // then says so on its own page, instead of quietly looking finished when it was judged against a
  // shorter list. Nothing is ever recalculated in the background — the audit only changes when
  // somebody chooses to rescan it.
  //
  // WHEN ADDING CHECKS: add an entry here (v = the previous one + 1) and write the lines the way a
  // web designer would read them, not by code name. The app shows them word for word.
  // ---------------------------------------------------------------------
  const CHECK_RELEASES = [
    {
      v: 2,
      date: '2026-09-24',
      title: 'Fonts, FAQ schema, page URLs, analytics and thank-you pages',
      items: [
        'Typeface consistency — one font for the navigation, one for titles, one for paragraphs, one for buttons',
        'Fonts the design asks for but the page never loads, and fonts pulled from somewhere unusual',
        'More than one FAQ block on the same page, and FAQ pages with the FAQ schema switched off',
        'Business schema switched off for the website',
        'Page URLs with random numbers or copy suffixes left in them',
        'Missing favicon, and missing home-screen icon',
        'Insecure (http) images or scripts on a secure page',
        'Thank-you pages with no phone number, or no way back to the home page',
        'Missing analytics, or an old analytics tag',
        'More than one contact form on a page, and forms where the phone field is optional',
        'Buttons that go nowhere (now catches more button styles than before)',
      ],
    },
    {
      v: 3,
      date: '2026-09-25',
      title: 'Fonts read from the design settings, and one audit item per problem instead of two',
      items: [
        'Fonts are judged against the website\u2019s own design settings \u2014 the font it sets for the body text and for each heading level, H1 to H6. Anything that isn\u2019t one of those is what gets reported',
        'Instead of counting fonts, the audit names each piece of text in a font that isn\u2019t part of the design \u2014 the words themselves, on the page they\u2019re on, so Show on page finds them',
        'Reference data has a second tab beside Business Info \u2014 Fonts used on the website \u2014 showing the design\u2019s fonts and anything else that turned up',
        'A phone button that shows one number and dials another raised two items saying the same thing; it is now one item that says both. Same for email links',
      ],
    },
  ];
  const CHECKS_VERSION = CHECK_RELEASES[CHECK_RELEASES.length - 1].v;
  /** Releases of the check list newer than the one a scan ran with. Scans older than this feature count as v1. */
  function checksSince(v) { const n = Number(v) || 1; return CHECK_RELEASES.filter((r) => r.v > n); }

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

  // Path prefixes that come before the real name (linkedin.com/in/<name>, youtube.com/c/<name>, facebook.com/pages/<name>/…)
  const HANDLE_PREFIX = {
    linkedin: /^(in|company|school|showcase|pub|profile)$/i,
    youtube: /^(channel|c|user)$/i,
    facebook: /^(pages|pg|people)$/i,
    pinterest: /^(pin)$/i,
  };
  function handleFromSegs(net, segs) {
    segs = segs.filter(Boolean);
    const pre = HANDLE_PREFIX[net];
    if (pre && segs[0] && pre.test(segs[0])) return (segs[1] || '').replace(/^@/, '');
    return (segs[0] || '').replace(/^@/, '');
  }
  function socialHandle(net, value) {
    if (!value) return '';
    let v = String(value).trim();
    if (/^https?:\/\//i.test(v) || /\.(com|be|me|gl|page)\//i.test(v)) {
      try {
        const u = new URL(/^https?:/i.test(v) ? v : 'https://' + v);
        if (net === 'google_my_business') return placeNameFromUrl(u.href) || placeIdFromUrl(u.href) || u.pathname + u.search;
        if (net === 'facebook' && /profile\.php/i.test(u.pathname)) return u.searchParams.get('id') || '';
        return handleFromSegs(net, u.pathname.split('/'));
      } catch (e) { return v; }
    }
    v = v.replace(/^@/, '').replace(/\/+$/, '');
    // Partial paths saved in Business Info, e.g. "in/nathan-acito-749a0b254" or "company/acme"
    if (net !== 'google_my_business' && v.includes('/')) return handleFromSegs(net, v.split('/'));
    return v;
  }
  /** "Share this page" buttons (LinkedIn shareArticle, Facebook sharer, X intent, Pinterest pin/create…) aren't profile links. */
  function isShareLink(u) {
    const p = (u.pathname + u.search).toLowerCase();
    return /\/(sharer|share|shareArticle|sharing|share-offsite|intent|pin\/create|submit|send)(\b|\/|\.php|\?|$)/i.test(p) || /[?&](u|url|text|mini)=/i.test(u.search) && /share|intent|sharer/i.test(p);
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

  /** Google Maps links often carry only an ID (data=!4m2!3m1!1s0x…:0x…, cid=, place_id=, ftid=) and no business name. */
  function placeIdFromUrl(href) {
    const h = String(href || '');
    const m = h.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || h.match(/[?&](?:ftid|cid|place_id)=([^&]+)/i) || h.match(/!1s([A-Za-z0-9_-]{10,})/);
    return m ? m[1].toLowerCase() : '';
  }
  function placeNameFromUrl(href) {
    const m = String(href).match(/\/maps\/place\/([^/@?]+)/i) || String(href).match(/!2s([^!]+)/);
    // "place/data=!4m2!…" and "place/@lat,lng" are IDs and coordinates, not names
    if (m && !/^(data=|@|[-\d.,+]+$)/i.test(m[1])) return safeDecode(m[1].replace(/\+/g, ' ')).trim();
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

  /** Every @type in the page's JSON-LD, flattened — used to count FAQ blocks and spot missing schema. */
  function schemaTypes(doc) {
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((sc) => {
      try {
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) return o.forEach(walk);
          if (o['@type']) [].concat(o['@type']).forEach((t) => out.push(String(t)));
          if (o['@graph']) walk(o['@graph']);
          Object.keys(o).forEach((k) => { if (k !== '@graph' && o[k] && typeof o[k] === 'object') walk(o[k]); });
        };
        walk(JSON.parse(sc.textContent));
      } catch (e) { /* malformed JSON-LD is reported elsewhere */ }
    });
    return out;
  }

  // Fonts that are part of a widget's icons, not the design's typography.
  const ICON_FONTS = /font ?awesome|material (icons|symbols)|glyphicons?|icomoon|ionicons|feather|bootstrap-?icons|dmicon|fontello|elegant ?icons|themify|dashicons|simple-line/i;
  const GENERIC_FONTS = /^(inherit|initial|unset|revert|currentcolor|sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica( neue)?|arial|tahoma|verdana|georgia|times( new roman)?|courier( new)?|emoji|math|fangsong|none)$/i;
  const firstFamily = (decl) => String(decl || '').split(',')[0].replace(/!important/i, '').replace(/^['"\s]+|['"\s]+$/g, '').trim();
  // Where a typeface may legitimately come from: Google Fonts, the Duda/Envato asset CDNs, Typekit.
  const FONT_HOST_OK = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|p\.typekit\.net|cdn-website\.com|multiscreensite\.com|dudaone\.com|dudamobile\.com|envato\.com|envatousercontent\.com)$/i;

  /** Roughly CSS specificity, enough to decide which of two rules dresses an element. */
  function specificity(sel) {
    const s = String(sel || '');
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[a-z-]+(\([^)]*\))?/gi) || []).length;
    const els = ((s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[a-z-]+(\([^)]*\))?/gi, ' ').match(/[a-z][\w-]*/gi)) || []).length;
    return ids * 10000 + cls * 100 + els;
  }

  /** Typefaces the page loads, and from where. */
  function fontSources(doc, resolve) {
    const loaded = new Map();   // family (lowercased) → source label
    doc.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="font"]').forEach((l) => {
      const href = l.getAttribute('href') || '';
      let host = '';
      try { host = new URL(href, 'https://x/').hostname; } catch (e) { /* relative */ }
      const src = /fonts\.googleapis\.com$/i.test(host) ? 'Google Fonts' : host || 'stylesheet';
      let fm; const famRe = /[?&]family=([^&]+)/gi;
      while ((fm = famRe.exec(href))) {
        decodeURIComponent(fm[1]).split('|').forEach((one) => {
          const name = one.split(':')[0].replace(/\+/g, ' ').trim();
          if (name) loaded.set(name.toLowerCase(), { src, name });
        });
      }
    });
    doc.querySelectorAll('style').forEach((st) => {
      const css = st.textContent || '';
      let m; const face = /@font-face\s*\{([^}]*)\}/gi;
      while ((m = face.exec(css))) {
        const fam = /font-family\s*:\s*([^;]+)/i.exec(m[1]);
        const src = /url\(\s*['"]?([^'")]+)/i.exec(m[1]);
        if (!fam) continue;
        let host = '';
        try { host = new URL(src ? src[1] : '', 'https://x/').hostname; } catch (e) { /* relative */ }
        const name = firstFamily(resolve(fam[1]));
        if (name) loaded.set(name.toLowerCase(), { src: host && !/^x$/.test(host) ? host : 'this website', name });
      }
    });
    return loaded;
  }

  const THEME_TAGS = ['body', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  /**
   * The website's own typography — the fonts the theme sets, not the ones a widget asks for.
   *
   * Duda writes the site's typography as plain element rules in the page's stylesheet (body, p and
   * h1–h6), often through custom properties on :root. That is the design's font set: whatever an
   * element ends up in that is NOT one of these came from somewhere else, and that is the thing
   * worth reporting. Custom properties are resolved here so `font-family: var(--font-h1)` answers.
   */
  /**
   * The page's CSS custom properties, as a function that resolves `var(--x, fallback)` to a value.
   * Duda's themes are written with them, so nothing about fonts reads correctly without this.
   */
  function varResolver(doc) {
    const vars = new Map();
    doc.querySelectorAll('style').forEach((st) => {
      const css = st.textContent || '';
      let m; const rule = /([^{}]+)\{([^{}]*)\}/g;
      while ((m = rule.exec(css))) {
        if (!/--[\w-]+\s*:/.test(m[2])) continue;
        let v; const dec = /(--[\w-]+)\s*:\s*([^;]+)/g;
        while ((v = dec.exec(m[2]))) { if (!vars.has(v[1])) vars.set(v[1], v[2].trim()); }
      }
    });
    doc.querySelectorAll('[style*="--" i]').forEach((el) => {
      let v; const dec = /(--[\w-]+)\s*:\s*([^;"]+)/g;
      while ((v = dec.exec(el.getAttribute('style') || ''))) { if (!vars.has(v[1])) vars.set(v[1], v[2].trim()); }
    });
    const resolve = (val, depth) => String(val || '').replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g, (m, name, fb) => {
      if ((depth || 0) > 5) return fb || '';
      const got = vars.get(name);
      return got !== undefined ? resolve(got, (depth || 0) + 1) : resolve(fb || '', (depth || 0) + 1);
    });
    return (val) => resolve(val, 0);
  }

  function themeFonts(doc, resolve) {
    const roles = {};            // body / p / h1…h6 → family
    const spec = {};             // how specific the rule that set it was, so the last word wins
    const isPlain = (sel) => THEME_TAGS.includes(sel.trim().toLowerCase().replace(/::?[a-z-]+(\([^)]*\))?/gi, '').trim());

    doc.querySelectorAll('style').forEach((st) => {
      const css = (st.textContent || '').replace(/@font-face\s*\{[^}]*\}/gi, ' ');
      let m; const rule = /([^{}]+)\{([^{}]*)\}/g;
      while ((m = rule.exec(css))) {
        const sels = m[1].split(',').map((x) => x.trim());
        if (!/font-family/i.test(m[2])) continue;
        const fam = /font-family\s*:\s*([^;]+)/i.exec(m[2]);
        if (!fam) continue;
        const weight = /!important/i.test(fam[1]) ? 2 : 1;
        sels.forEach((sel) => {
          if (!isPlain(sel)) return;
          const tag = sel.toLowerCase().replace(/::?[a-z-]+(\([^)]*\))?/gi, '').trim();
          if (spec[tag] && spec[tag] > weight) return;
          const f = firstFamily(resolve(fam[1]));
          if (!f || GENERIC_FONTS.test(f) || ICON_FONTS.test(f)) return;
          roles[tag] = f; spec[tag] = weight;
        });
      }
    });
    // A theme that only dresses <body> still dresses the paragraphs.
    if (!roles.p && roles.body) roles.p = roles.body;
    const set = new Set(THEME_TAGS.map((t) => roles[t]).filter(Boolean));
    return { roles, fonts: set, found: set.size > 0 };
  }

  /**
   * Which typeface each element really ends up with.
   *
   * There is no browser rendering here, so the cascade is worked out by hand: every rule that sets
   * a font-family is matched against the page, the most specific one wins per element, inline styles
   * beat all of them — and because font-family inherits, an element with no rule of its own takes
   * the nearest dressed ancestor's. Rules that match nothing on this page are ignored, which is what
   * keeps a stylesheet full of unused widget CSS out of the answer.
   */
  function fontMap(doc, resolve) {
    const won = new Map();      // element → { fam, spec, order }
    const claim = (el, fam, spec, order) => {
      const f = firstFamily(resolve(fam));
      if (!f) return;
      const prev = won.get(el);
      if (!prev || spec > prev.spec || (spec === prev.spec && order >= prev.order)) won.set(el, { fam: f, spec, order });
    };
    let order = 0;
    doc.querySelectorAll('style').forEach((st) => {
      const css = (st.textContent || '').replace(/@font-face\s*\{[^}]*\}/gi, ' ');
      let m; const rule = /([^{}]+)\{([^{}]*)\}/g;
      while ((m = rule.exec(css))) {
        if (!/font-family/i.test(m[2])) continue;
        const fam = /font-family\s*:\s*([^;]+)/i.exec(m[2]);
        if (!fam) continue;
        const bang = /!important/i.test(fam[1]);
        order++;
        m[1].split(',').forEach((raw) => {
          const sel = raw.replace(/::[a-z-]+(\([^)]*\))?/gi, '').trim();
          if (!sel || /^@/.test(sel)) return;
          let hits = [];
          try { hits = doc.querySelectorAll(sel); } catch (e) { return; }
          const spec = specificity(sel) + (bang ? 1000000 : 0);
          hits.forEach((el) => claim(el, fam[1], spec, order));
        });
      }
    });
    doc.querySelectorAll('[style*="font-family" i]').forEach((el) => {
      const m = /font-family\s*:\s*([^;"]+)/i.exec(el.getAttribute('style') || '');
      if (m) claim(el, m[1], 100000000, ++order);
    });
    // font-family inherits, so an undressed element wears its nearest dressed ancestor's.
    const familyOf = (el) => {
      let n = el; let hops = 0;
      while (n && hops++ < 30) {
        const w = won.get(n);
        if (w) return w.fam;
        n = n.parentElement;
      }
      return '';
    };
    return familyOf;
  }

  // What each piece of text is for. A website has a typeface for its headings and one for its body
  // text; the navigation and the buttons follow one of those two. Naming the part lets the audit say
  // "this title is in the wrong font" instead of counting fonts.
  const FONT_ROLES = [
    { key: 'titles', label: 'Titles', sel: 'h1, h2, h3' },
    { key: 'paragraphs', label: 'Paragraphs', sel: 'p, li' },
    { key: 'navigation', label: 'Navigation', sel: 'nav a, header a, [class*="nav" i] a, [class*="menu" i] a' },
    { key: 'buttons', label: 'Buttons', sel: 'button, [role="button"], a[class*="btn" i], a[class*="button" i], .dmButtonLink' },
  ];
  const ROLE_LABEL = { titles: 'Title', paragraphs: 'Paragraph', navigation: 'Navigation link', buttons: 'Button', other: 'Text' };
  const ROLE_PLURAL = { titles: 'titles', paragraphs: 'paragraphs', navigation: 'navigation links', buttons: 'buttons', other: 'places' };
  const ROLE_PHRASE = { titles: 'titles are', paragraphs: 'body text is', navigation: 'navigation is', buttons: 'buttons are', other: 'text is' };
  const MAX_FONT_ROWS = 900;   // per page, per device
  const FONT_ITEM_CAP = 12;    // audit items per part-of-the-page + wrong typeface, before one summary row

  /**
   * Every piece of text on the page, with the typeface it really ends up in and what it is for.
   *
   * Nothing is judged here. One page can't know what the website's heading font is — the answer only
   * appears once every page has been read — so the rows go back to runScan, which works out the
   * website's typefaces and then flags the text that doesn't use them.
   */
  function fontsUsed(doc, device) {
    const resolve = varResolver(doc);
    const familyOf = fontMap(doc, resolve);
    const keep = (f) => f && !GENERIC_FONTS.test(f) && !ICON_FONTS.test(f);
    const rows = [];
    const seen = new Set();
    const take = (el, role) => {
      if (seen.has(el) || rows.length >= MAX_FONT_ROWS) return;
      const fam = familyOf(el);
      if (!keep(fam)) return;
      const text = clean(el.textContent);
      if (!text || text.length < 2) return;
      seen.add(el);
      const hid = hiddenReason(el, device);
      rows.push({ fam, role, text: cut(text, 90), selector: uniqueSelector(el), location: locationOf(el) || 'Body', tag: (el.tagName || '').toLowerCase(), hiddenBy: hid || '' });
    };
    FONT_ROLES.forEach((role) => {
      let hits = [];
      try { hits = doc.querySelectorAll(role.sel); } catch (e) { return; }
      hits.forEach((el) => take(el, role.key));
    });
    // Everything else with words in it, so the totals cover the whole page.
    doc.querySelectorAll('h4, h5, h6, span, td, th, label, figcaption, blockquote, strong, em, div').forEach((el) => {
      if (seen.has(el)) return;
      // Only the element that actually holds the words, not every wrapper around them.
      if (el.querySelector('h1,h2,h3,h4,h5,h6,p,li,span,td,th,label,a,button')) return;
      take(el, 'other');
    });
    const loaded = [];
    fontSources(doc, resolve).forEach((src, key) => loaded.push({ key, name: src && src.name ? src.name : key, src: src && src.src ? src.src : String(src || '') }));
    return { rows, loaded, theme: themeFonts(doc, resolve).roles };
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
    // Thank-you / confirmation pages SHOULD be noindex (they only show after a form is sent). Every other page should not be.
    const thankYou = isThankYouPath(ctx.path);
    if (thankYou && ctx.noIndex === false) add(titleEl, { code: 'META_THANKYOU_INDEXED', severity: 'critical', category: 'Meta / SEO', message: 'Thank-you page is NOT set to "noindex" — turn on "Hide from search engines" in Duda SEO settings', found: ctx.path });
    else if (!thankYou && ctx.noIndex) add(titleEl, { code: 'META_NOINDEX', severity: 'critical', category: 'Meta / SEO', message: 'Page is set to "noindex" in Duda SEO settings — Google will not index it' });
    if (!doc.querySelector('meta[property="og:image"]')) add(titleEl, { code: 'META_OG_IMAGE', severity: 'info', category: 'Meta / SEO', message: 'No social share image (og:image)' });
    const canon = doc.querySelector('link[rel="canonical"]');
    if (canon && truth.domain) {
      try {
        const h = new URL(canon.getAttribute('href')).hostname.toLowerCase().replace(/^www\./, '');
        if (h !== truth.domain.replace(/^www\./, '')) add(canon, { code: 'META_CANONICAL_DOMAIN', severity: 'warning', category: 'Meta / SEO', message: 'Canonical URL uses a different domain than the site domain', found: h, expected: truth.domain });
      } catch (e) { /* ignore */ }
    }

    // --- FAQ schema: Google wants at most one FAQ block per page ---
    const types = schemaTypes(doc);
    const faqBlocks = types.filter((t) => /^FAQPage$/i.test(t)).length;
    if (faqBlocks > 1) add(titleEl, { code: 'FAQ_SCHEMA_MULTI', severity: 'warning', category: 'Schema', message: `This page has ${faqBlocks} FAQ schema blocks — only one per page should have "enable FAQ schema" turned on`, found: `${faqBlocks} FAQPage blocks` });
    // An FAQ section on the page with the schema switch left off
    const faqEl = doc.querySelector('[class*="faq" i], [data-element-type*="faq" i], [id*="faq" i]');
    if (!faqBlocks && faqEl && (clean(faqEl.textContent).match(/\?/g) || []).length >= 3) {
      add(faqEl, { code: 'FAQ_SCHEMA_OFF', severity: 'info', category: 'Schema', message: 'Looks like an FAQ section, but "enable FAQ schema" is off — no FAQ structured data on this page' });
    }
    if (ctx.path === '/' && !types.some((t) => /LocalBusiness|AutoRepair|AutoWash|Store|ProfessionalService|Organization/i.test(t))) {
      add(titleEl, { code: 'SCHEMA_LOCALBUSINESS_OFF', severity: 'warning', category: 'Schema', message: 'No local business structured data on the home page — turn on "Local business schema" in Duda Business Info' });
    }

    // --- Page URL hygiene ---
    if (ctx.path && ctx.path !== '/') {
      const p = ctx.path;
      const bad = [];
      if (/[A-Z]/.test(p)) bad.push('capital letters');
      if (/_/.test(p)) bad.push('underscores');
      if (/%20|\s/.test(p)) bad.push('spaces');
      if (/[^/]\/\//.test(p)) bad.push('a double slash');
      if (/-\d{1,2}\/?$/.test(p)) bad.push('a number on the end (often a duplicated page)');
      if (/\b(copy|copy-of|untitled|new-page|page-\d+|test|draft|temp|tmp|asdf)\b/i.test(p)) bad.push('a leftover name');
      if (p.replace(/^\//, '').length > 80) bad.push('a very long address');
      if (bad.length) add(titleEl, { code: 'URL_MESSY', severity: 'warning', category: 'Meta / SEO', message: `Page address has ${bad.join(', ')}`, found: p });
    }

    // --- Thank-you page: the visitor has just converted, give them somewhere to go ---
    if (thankYou) {
      const links = [...doc.querySelectorAll('a[href]')];
      const hasCall = links.some((a) => /^tel:/i.test(a.getAttribute('href') || ''));
      const hasHome = links.some((a) => {
        const h = (a.getAttribute('href') || '').trim();
        if (/^(\/|\/index|\/home)?$/i.test(h.replace(/^https?:\/\/[^/]+/i, ''))) return true;
        return /\b(home|back to site|return)\b/i.test(clean(a.textContent));
      });
      if (!hasCall) add(titleEl, { code: 'THANKYOU_NO_CALL', severity: 'warning', category: 'Content', message: 'Thank-you page has no call button', found: ctx.path });
      if (!hasHome) add(titleEl, { code: 'THANKYOU_NO_HOME', severity: 'warning', category: 'Content', message: 'Thank-you page has no way back to the home page', found: ctx.path });
    }

    // --- Analytics ---
    if (ctx.path === '/') {
      const html = doc.documentElement ? doc.documentElement.innerHTML : '';
      const ga = /gtag\/js\?id=(G-[A-Z0-9]+)|googletagmanager\.com\/gtm\.js|['"](G-[A-Z0-9]{6,})['"]|['"](GTM-[A-Z0-9]{4,})['"]|UA-\d{4,}-\d/i.exec(html);
      if (!ga) add(titleEl, { code: 'ANALYTICS_MISSING', severity: 'warning', category: 'Meta / SEO', message: 'No Google Analytics or Tag Manager tag found on the home page' });
      else if (/UA-\d/.test(ga[0])) add(titleEl, { code: 'ANALYTICS_OLD', severity: 'info', category: 'Meta / SEO', message: 'Uses an old Universal Analytics tag (UA-), which no longer collects data', found: ga[0] });
    }

    // --- Contact form ---
    const realForms = [...doc.querySelectorAll('form')].filter((f) => f.querySelector('textarea, input[type="email" i], input[name*="email" i]'));
    if (realForms.length > 1) {
      add(realForms[1], { code: 'FORM_MULTIPLE', severity: 'warning', category: 'Content', message: `${realForms.length} contact forms on this page — there should be one, on the contact page`, found: `${realForms.length} forms` });
    }
    realForms.forEach((f) => {
      f.querySelectorAll('input').forEach((i) => {
        const hay = [i.getAttribute('type'), i.getAttribute('name'), i.getAttribute('id'), i.getAttribute('placeholder'), i.getAttribute('aria-label')].join(' ').toLowerCase();
        const isPhone = /\btel\b|phone|mobile|cell/.test(hay);
        if (isPhone && !i.hasAttribute('required') && String(i.getAttribute('aria-required')) !== 'true') {
          add(i, { code: 'FORM_PHONE_OPTIONAL', severity: 'warning', category: 'Content', message: 'Phone field on the contact form is not required', found: i.getAttribute('placeholder') || i.getAttribute('name') || 'phone field' });
        }
      });
    });

    // --- Typefaces ---
    // Collected, not judged. What counts as "the wrong font" depends on the typefaces the WEBSITE
    // uses, and no single page knows those — runScan works them out once every page has been read.
    const fonts = fontsUsed(doc, device);

    // --- Basics that are simply present or absent ---
    if (!doc.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i]')) add(titleEl, { code: 'FAVICON_MISSING', severity: 'warning', category: 'Meta / SEO', message: 'No favicon on this page — upload one in Duda SEO settings' });
    if (ctx.path === '/' && !doc.querySelector('link[rel="apple-touch-icon" i]')) add(titleEl, { code: 'HOMESCREEN_ICON_MISSING', severity: 'info', category: 'Meta / SEO', message: 'No home screen icon (apple-touch-icon)' });
    doc.querySelectorAll('img[src^="http://"], script[src^="http://"], link[rel="stylesheet"][href^="http://"], iframe[src^="http://"]').forEach((el) => {
      add(el, { code: 'MIXED_CONTENT', severity: 'warning', category: 'Links', message: 'Loaded over http:// on an https:// site — browsers may block it or warn', found: cut(el.getAttribute('src') || el.getAttribute('href'), 120) });
    });

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
      // Anything that looks like a button to a visitor: Duda's own, a btn class, or role="button".
      // A bare "#" on a script-driven toggle is normal, so only button-ish links are reported.
      const isButton = /\bdmButtonLink\b/.test(cls(a)) || /(^|[\s_-])(btn|button)([\s_-]|$)/i.test(cls(a)) || a.getAttribute('role') === 'button';
      const hasPopup = Array.prototype.some.call(a.attributes, (x) => /popup/i.test(x.name) || /popup/i.test(x.value) && x.name !== 'class');
      if (raw == null || raw.trim() === '' || raw.trim() === '#' || /^javascript:/i.test(raw.trim())) {
        if (isButton && !hasPopup) add(a, { code: 'BUTTON_NO_LINK', severity: 'warning', category: 'Links', message: 'Button has no link (href is empty, # or javascript:)', found: text || '(no text)' });
        return;
      }
      const href = raw.trim();

      if (/^tel:/i.test(href)) {
        const d = normPhone(safeDecode(href.slice(4)));
        if (d.length !== 10) { add(a, { code: 'TEL_INVALID', severity: 'critical', category: 'Contact info', message: 'Phone link has an invalid number', found: href }); return; }
        PHONE_RE.lastIndex = 0;
        const shown = PHONE_RE.exec(text);
        const sd = shown ? shown[1] + shown[2] + shown[3] : '';
        const dialOk = phoneOk(d);
        // One button, one problem, one item. A button that shows the right number and dials a wrong
        // one used to raise two items saying the same thing; the mismatch now carries both facts.
        if (sd && sd !== d) {
          add(a, { code: 'TEL_TEXT_MISMATCH', severity: 'critical', category: 'Contact info',
            message: dialOk ? 'Phone button shows one number but dials another' : 'Phone button shows one number but dials another, and the number it dials is not in Business Info',
            found: `Shows ${fmtPhone(sd)} → dials ${fmtPhone(d)}`, expected: expectedPhones });
        } else if (!dialOk) {
          add(a, { code: 'TEL_MISMATCH', severity: 'critical', category: 'Contact info', message: 'Phone link (tel:) dials a number that is not in Business Info', found: fmtPhone(d), expected: expectedPhones });
        }
        return;
      }
      if (/^mailto:/i.test(href)) {
        const e = safeDecode(href.slice(7).split('?')[0]).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) { add(a, { code: 'MAILTO_INVALID', severity: 'critical', category: 'Contact info', message: 'Email link has an invalid address', found: href }); return; }
        const shownE = (text.match(EMAIL_RE) || [])[0];
        const mailOk = emailOk(e);
        // Same again: one link, one item, carrying everything that is wrong with it.
        if (shownE && shownE.toLowerCase() !== e) {
          add(a, { code: 'MAILTO_TEXT_MISMATCH', severity: 'critical', category: 'Contact info',
            message: mailOk ? 'Email link shows one address but opens another' : 'Email link shows one address but opens another, and the address it opens is not in Business Info',
            found: `Shows ${shownE} → opens ${e}`, expected: expectedEmails });
        } else if (!mailOk) {
          add(a, { code: 'MAILTO_MISMATCH', severity: 'critical', category: 'Contact info', message: 'Email link (mailto:) goes to an address not in Business Info', found: e, expected: expectedEmails });
        }
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
      if (isShareLink(u)) return; // share buttons on blog posts, not the business's profile
      const handle = socialHandle(net, u.href);
      const label = net === 'google_my_business' ? 'Google Business/Maps' : net[0].toUpperCase() + net.slice(1);
      // A Google Maps link with only a place ID can't be judged by its address. Compare IDs with Business Info when we can;
      // otherwise leave it as a note to open and check by hand — never call it another business.
      if (net === 'google_my_business' && !placeNameFromUrl(u.href)) {
        const id = placeIdFromUrl(u.href);
        const known = (truth.socialLinks && truth.socialLinks.google_my_business) || [];
        const ids = known.map(placeIdFromUrl).filter(Boolean);
        if (id && ids.includes(id)) return;                      // same place as Business Info
        if (id && ids.length) add(el, { code: 'GMB_ID_MISMATCH', severity: 'warning', category: 'Social', message: `${label} ${via.toLowerCase()} points to a different Google place than Business Info — open both to check`, found: u.href, expected: known[0] || '' });
        else if (id) add(el, { code: 'GMB_ID_ONLY', severity: 'info', category: 'Social', message: `${label} ${via.toLowerCase()} uses a Google place ID, so it can't be checked automatically — open it to confirm it's this business`, found: u.href });
        else add(el, { code: 'SOCIAL_GENERIC', severity: 'warning', category: 'Social', message: `${label} link doesn't point to a specific place`, found: u.href });
        return;
      }
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
        // The SITE's own logo sits in the header / side panel (or links home from the footer).
        // Logos elsewhere (a row of brand, partner or certification logos) belong to other companies on purpose.
        const isLogo = !inGallery && ((((locImg === 'Header' || locImg === 'Side panel') && (linksHome || logoHint))) || (locImg === 'Footer' && linksHome));
        const row = img.closest('.dmRespRow, .dmRespColsWrapper, section, [class*="row"], ul') || (img.parentElement && img.parentElement.parentElement);
        const rowImgs = row ? Array.from(row.querySelectorAll('img')) : [];
        const logoRow = rowImgs.filter((x) => /logo|brand|partner|badge|certif/i.test((x.getAttribute('alt') || '') + ' ' + (x.getAttribute('src') || x.getAttribute('data-src') || ''))).length;
        const brandLogo = !isLogo && (logoHint || /\blogo\b/i.test(a) || logoRow >= 3);
        altList.push({ alt: a, file, src: abs, selector: uniqueSelector(img), location: locImg, linksHome, isLogo, brandLogo, logoRow: Math.max(logoRow, brandLogo ? 1 : 0), rowImgs: rowImgs.length, inGallery, hiddenBy: hiddenReason(img, device) || '' });
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
      fonts,
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
  /** /thank-you, /thanks, /thankyou-quote, /quote-thank-you, /confirmation, /form-success … */
  function isThankYouPath(path) {
    const last = String(path || '').toLowerCase().split('/').filter(Boolean).pop() || '';
    return /(^|-)(thank-?you|thanks|thx)(-|$)/.test(last) || /^(confirmation|form-(submitted|success|sent|confirmation)|submission-(received|success)|success)$/.test(last);
  }
  // ---------- "Correct for this website" exceptions ----------
  const ALLOW_CODES = {
    email: ['EMAIL_MISMATCH', 'MAILTO_MISMATCH', 'MAILTO_TEXT_MISMATCH', 'SCHEMA_EMAIL'],
    phone: ['PHONE_MISMATCH', 'TEL_MISMATCH', 'TEL_TEXT_MISMATCH', 'SMS_MISMATCH', 'SCHEMA_PHONE'],
    social: ['SOCIAL_OTHER_BUSINESS', 'SOCIAL_MISMATCH', 'GMB_ID_MISMATCH', 'GMB_ID_ONLY'],
    name: ['TEXT_OTHER_BUSINESS', 'COPYRIGHT_NAME', 'SCHEMA_NAME', 'MAP_OTHER_BUSINESS'],
  };
  /** Normalised key for an approved value, e.g. "email:sales@x.com", "phone:2625550147", "social:facebook:joesdetail", "name:joesdetailing". */
  function allowKey(type, value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (type === 'email') { const m = v.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/); return m ? 'email:' + m[0] : ''; }
    if (type === 'phone') { const d = normPhone(v); return d.length >= 10 ? 'phone:' + d.slice(-10) : ''; }
    if (type === 'social') { const net = socialNetOf(/^https?:/i.test(v) ? v : 'https://' + v.replace(/^\/+/, '')); const h = net ? compact(socialHandle(net, v)) : compact(v); return h ? 'social:' + (net || 'any') + ':' + h : ''; }
    if (type === 'name') { const c = compact(v); return c.length >= 3 ? 'name:' + c : ''; }
    return '';
  }
  /** Which value of a finding could be approved as correct for the website: { type, value, key } or null. */
  function allowValueOf(f) {
    if (!f) return null;
    for (const [type, codes] of Object.entries(ALLOW_CODES)) {
      if (!codes.includes(f.code)) continue;
      const value = type === 'name' ? (f.foreignName || f.found) : f.found;
      const key = allowKey(type, value);
      if (key) return { type, value: String(value), key };
    }
    // AI findings that name another business (alt text or page text)
    if (f.foreignName && /^AI_|TEXT_OTHER/.test(f.code)) { const key = allowKey('name', f.foreignName); if (key) return { type: 'name', value: f.foreignName, key }; }
    return null;
  }
  /** Drop findings whose value was approved for this website. */
  function filterAllowed(findings, allow) {
    if (!allow || !allow.length) return findings;
    const keys = new Set(allow.map((a) => a.key));
    return findings.filter((f) => { const a = allowValueOf(f); return !(a && keys.has(a.key)); });
  }
  // ---------- Which page text is worth sending to the AI ----------
  // Brands, platforms and suppliers that are fine to mention (never "another business")
  const SAFE_BRANDS = /\b(ceramic pro|xpel|suntek|llumar|gtechniq|gyeon|igl|meguiar'?s?|chemical guys|koch[- ]?chemie|opti-?coat|modesta|cquartz|system ?x|stek|fuel off[- ]?road|kmc|black rhino|toyo|nitto|bfgoodrich|falken|rough country|3m|google|yelp|facebook|instagram|youtube|tiktok|urable|square|paypal|visa|mastercard|bmw|tesla|audi|mercedes|porsche|toyota|honda|ford|chevrolet|chevy|jeep|dodge|ram|nissan|subaru|lexus|mazda|kia|hyundai|volkswagen|volvo|cadillac|gmc|corvette|mustang|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b/i;
  /** True when a block of page text could hide a problem (another business, a wrong place, filler). Plain marketing prose is skipped. */
  function textRisk(text, truth) {
    const t = String(text || '');
    if (t.length < 25) return false;
    if (/lorem ipsum|placeholder|your (business|company|shop) name|sample text|coming soon|insert (your )?text|dummy text|example\.com/i.test(t)) return true;
    if (/©|\(c\)\s*(19|20)\d\d|all rights reserved/i.test(t)) return true;
    if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(t)) return true;                     // an email
    if (/\b\d{3}[.\-\s)]\s?\d{3}[.\-\s]?\d{4}\b/.test(t)) return true;         // a phone number
    if (/\b(www\.|https?:\/\/)[\w-]+\.[a-z]{2,}/i.test(t)) return true;          // a web address
    if (/\b[A-Z][a-zA-Z.'-]+,\s*[A-Z]{2}\b/.test(t)) return true;                // "Brookfield, WI"
    if (/\b\d{5}(-\d{4})?\b/.test(t)) return true;                              // a postcode
    if (/\b(serving|located|based in|proudly serve[sd]?|visit us|stop by|come see us|our shop in|near you in)\b/i.test(t)) return true;
    // A capitalised phrase of 2+ words that isn't this business and isn't a known brand looks like another business
    const phrases = t.match(/\b[A-Z][A-Za-z&'’.-]*(?:\s+(?:[A-Z][A-Za-z&'’.-]*|of|and|the|for|at))+\b/g) || [];
    for (const p of phrases) {
      const words = p.trim().split(/\s+/).filter((w) => /^[A-Z]/.test(w));
      if (words.length < 2) continue;
      if (SAFE_BRANDS.test(p)) continue;
      if (matchesBusiness(p, truth)) continue;
      return true;
    }
    return false;
  }

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

  // ---------- the website's typefaces ----------
  /**
   * The website's font set, and what each part of it is dressed in.
   *
   * The design itself is the reference: the theme sets a font for the body text and one for each
   * heading level, and those are the website's fonts. Anything an element ends up in that is not one
   * of them came from a widget, a paste, or a leftover — and that is what the audit reports.
   *
   * A website with no theme rules to read (rare, and usually a broken export) falls back to what the
   * home page does: whatever its H1 is in dresses the titles, whatever its paragraphs are in dresses
   * the body text.
   */
  function buildFontSystem(rows, loaded, theme) {
    // One element, counted once. The same heading sits on every page and is read three times over
    // (Desktop, Tablet, Mobile), so counting raw rows would say "9 places" about a single title.
    const places = (list) => { const seen = new Set(); return list.filter((r) => { const k = r.selector + '|' + r.text; if (seen.has(k)) return false; seen.add(k); return true; }); };
    const countBy = (list) => { const m = new Map(); places(list).forEach((r) => m.set(r.fam, (m.get(r.fam) || 0) + 1)); return m; };
    const top = (m) => (m && m.size ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : '');
    const roles = Object.assign({}, theme || {});
    const fromTheme = THEME_TAGS.some((t) => roles[t]);
    if (!fromTheme) {
      const home = rows.filter((r) => r.path === '/');
      const pick = (role, tag) => top(countBy(home.filter((r) => r.role === role && (!tag || r.tag === tag))))
        || top(countBy(home.filter((r) => r.role === role))) || top(countBy(rows.filter((r) => r.role === role)));
      const h = pick('titles', 'h1');
      roles.body = pick('paragraphs', 'p');
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((t) => { roles[t] = h; });
      roles.p = roles.body;
    }
    const set = new Set(THEME_TAGS.map((t) => roles[t]).filter(Boolean));
    const heading = roles.h1 || roles.h2 || '';
    const body = roles.body || roles.p || '';
    const all = [...countBy(rows).entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => {
      const src = loaded.get(name.toLowerCase());
      return { name, n, loaded: !!src, src: (src && src.src) || '', theme: set.has(name) };
    });
    return { roles, fonts: set, heading, body, all, fromTheme, pages: new Set(rows.map((r) => r.path)).size };
  }

  /**
   * Text that isn't in one of the website's fonts — one audit item per piece of text, so it can be
   * found and fixed, rather than a count of fonts nobody can act on.
   */
  function fontFindings(rows, loaded, sys) {
    const out = [];
    if (rows.length < 8 || !sys.fonts.size) return out;
    const push = (r, f) => out.push(Object.assign({
      path: r.path, device: r.device, selector: r.selector, location: r.location,
      visible: !r.hiddenBy, hiddenBy: r.hiddenBy || '', snippet: r.text, category: 'Design',
    }, f));
    // What this piece of text should have been in, said the way a designer would say it.
    const wanted = (r) => {
      const t = /^h[1-6]$/.test(r.tag) ? sys.roles[r.tag] : '';
      return t || (r.role === 'titles' ? sys.heading : sys.body) || sys.heading || sys.body;
    };
    const setList = [...sys.fonts];

    // One group per part-of-the-page + off-theme typeface, so the count is honest and the cap is per slip.
    const groups = new Map();
    rows.forEach((r) => { if (sys.fonts.has(r.fam)) return; const key = r.role + '|' + r.fam; (groups.get(key) || groups.set(key, []).get(key)).push(r); });
    [...groups.entries()].forEach(([key, list]) => {
      const [role, fam] = key.split('|');
      const want = wanted(list[0]);
      const where = want ? `the website's ${ROLE_PHRASE[role] || 'text is'} set in ${want}`
        : `the website uses ${setList.slice(0, 2).join(' and ')}`;
      // One item per piece of text — but a header or footer repeats on every page and on three
      // devices, so those rows are kept and grouped later into a single item that lists its pages.
      const byText = new Map();
      list.forEach((r) => { const k = r.selector + '|' + r.text; (byText.get(k) || byText.set(k, []).get(k)).push(r); });
      const texts = [...byText.keys()];
      texts.slice(0, FONT_ITEM_CAP).forEach((k) => {
        const seenAt = new Set();
        byText.get(k).forEach((r) => {
          const at = r.path + '|' + r.device;
          if (seenAt.has(at)) return;
          seenAt.add(at);
          push(r, { code: 'FONT_OFF_SYSTEM', severity: 'warning', message: `${ROLE_LABEL[role]} in ${fam}, which is not one of the website's fonts — ${where}`, found: r.text, expected: want || setList.join(' / ') });
        });
      });
      if (texts.length > FONT_ITEM_CAP) push(byText.get(texts[FONT_ITEM_CAP])[0], {
        code: 'FONT_OFF_SYSTEM_MORE', severity: 'info',
        message: `${texts.length - FONT_ITEM_CAP} more ${ROLE_PLURAL[role] || 'places'} are in ${fam} as well — the first ${FONT_ITEM_CAP} are listed separately`,
        found: `${texts.length} in total`, expected: want || setList.join(' / '),
      });
    });

    // A typeface the website asks for but never loads: visitors without it see something else.
    const firstWith = (fam) => rows.find((r) => r.fam === fam);
    if (loaded.size) {
      sys.all.filter((f) => !f.loaded).forEach((f) => {
        const r = firstWith(f.name); if (!r) return;
        push(r, { code: 'FONT_NOT_LOADED', severity: 'info', message: `"${f.name}" is used but the website never loads it — visitors without it installed see a different typeface`, found: `${f.name}, ${f.n} place${f.n === 1 ? '' : 's'}`, expected: 'a loaded typeface' });
      });
    }
    // …and one loaded from somewhere unexpected: the rule is Google Fonts or Envato.
    sys.all.forEach((f) => {
      const src = f.src;
      if (!f.loaded || !src || src === 'Google Fonts' || src === 'this website' || FONT_HOST_OK.test(src)) return;
      const r = firstWith(f.name); if (!r) return;
      push(r, { code: 'FONT_SOURCE_ODD', severity: 'warning', message: `"${f.name}" is loaded from an unexpected place — typefaces should come from Google Fonts or Envato`, found: `${f.name} from ${src}`, expected: 'Google Fonts or Envato' });
    });
    return out;
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
    const fontRows = [];          // every piece of text on the website, with the typeface it ends up in
    const fontLoaded = new Map(); // family (lowercased) → where the website loads it from
    const fontTheme = {};         // body / p / h1…h6 → the font the website's own design sets
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
            if (!m) { if (altMap.size >= 400) return; m = { alt: x.alt, file: x.file, src: x.src, selector: x.selector, location: x.location, linksHome: x.linksHome, isLogo: x.isLogo, brandLogo: x.brandLogo, logoRow: x.logoRow, rowImgs: x.rowImgs, pages: [], devices: [], visibleOn: [], hiddenOn: [] }; altMap.set(x.alt, m); }
            if (!m.pages.includes(path)) m.pages.push(path);
            if (!m.devices.includes(device)) m.devices.push(device);
            if (!x.hiddenBy) { if (!m.visibleOn.includes(device)) m.visibleOn.push(device); } else m.hiddenOn.push(`${DEVICE_LABEL[device]} (${x.hiddenBy})`);
            m.isLogo = m.isLogo || x.isLogo;
          });
          r.textIndex.forEach((x) => textIdx.push(Object.assign({ path, device }, x)));
          if (r.fonts) {
            r.fonts.rows.forEach((x) => { if (fontRows.length < 9000) fontRows.push(Object.assign({ path, device }, x)); });
            r.fonts.loaded.forEach((l) => { if (!fontLoaded.has(l.key)) fontLoaded.set(l.key, l); });
            // The theme is the same on every page; the home page's is the one that counts.
            if (r.fonts.theme && (path === '/' || !Object.keys(fontTheme).length)) Object.keys(r.fonts.theme).forEach((k) => { if (path === '/' || !fontTheme[k]) fontTheme[k] = r.fonts.theme[k]; });
          }
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

    // The website's typefaces, and the text that doesn't use them
    let fontSys = null;
    if (fontRows.length) {
      fontSys = buildFontSystem(fontRows, fontLoaded, fontTheme);
      fontFindings(fontRows, fontLoaded, fontSys).forEach((f) => raw.push(f));
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
      checks: CHECKS_VERSION,
      fonts: fontSys ? { roles: fontSys.roles, fromTheme: fontSys.fromTheme, all: fontSys.all.slice(0, 12) } : null,
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
    DEVICES, DEVICE_LABEL, CHECKS_VERSION, CHECK_RELEASES, checksSince,
    buildTruth, auditDocument, runScan, extractSchema, mergeDevices, groupAcrossPages, buildFontSystem, fontFindings,
    matchesBusiness, normPhone, fmtPhone, uniqueSelector, hiddenReason, placeNameFromUrl, placeIdFromUrl, socialHandle, isShareLink, isThankYouPath, textRisk, allowKey, allowValueOf, filterAllowed, socialUrl, toCSV, fingerprint, hash, normalizePath, applyAltVerdicts, applyTextIssues,
  };
})(typeof window !== 'undefined' ? window : globalThis);
