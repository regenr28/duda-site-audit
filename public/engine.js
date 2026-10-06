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

  // "Outdated" sits between critical and warning: the value on the website is wrong and live, but
  // we know exactly what happened to it — Business Info changed and the website wasn't updated.
  const SEV_RANK = { critical: 0, outdated: 1, warning: 2, info: 3 };

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
    {
      v: 4,
      date: '2026-09-26',
      title: 'One thing to fix, one audit item',
      items: [
        'A whole menu or section in the wrong font is now a single item naming every piece of text in it, instead of one item per link',
        'The same wrong phone number found in the words, the tel: link and an aria-label is now one item that mentions where else it appears \u2014 the same for email addresses',
        'Links in body text are checked for their typeface too, not just navigation links and buttons',
      ],
    },
    {
      v: 5,
      date: '2026-09-26',
      title: 'Business Info remembers what it used to say',
      items: [
        'Every scan records Business Info and what changed since last time, so the audit can tell a detail nobody recognises from one that simply went out of date',
        'A website still showing a detail Duda no longer carries reads "Still using the old phone number \u2014 Business Info was changed on 12 Aug 2026", at a new Outdated severity rather than Critical',
        'An approval ("correct for this website") retires itself once Business Info catches up and carries that value officially',
        'A contact item now shows what the team already knows about that value \u2014 a Duda comment mentioning it, or the same value marked a False alarm before',
        'An item nobody has touched, whose value a client asked about in a comment, is set to For clarification automatically',
      ],
    },
    {
      v: 6,
      date: '2026-09-29',
      title: 'Your own additions and exceptions on top of Business Info',
      items: [
        'Values the client really uses that Duda doesn\u2019t carry \u2014 a second phone, an owner\u2019s personal email \u2014 can be marked correct for that website and are never flagged again',
        'Values Duda DOES carry that must not appear on a client\u2019s website \u2014 an agency address, a retired number \u2014 can be struck out, and are flagged if they turn up',
        'A typeface chosen on purpose can be approved for one website, so the font check stops arguing about it',
        'Approving a value closes the open items that flagged it, saying why, and the items can be reopened',
      ],
    },
    {
      v: 7,
      date: '2026-09-29',
      title: 'Weights of the same typeface count as one font',
      // A release can CORRECT a check, not just add one. Items already on a website from a check
      // listed here were produced by the old, wrong version — they are not work, they are noise —
      // so the audits carrying them say so plainly instead of quietly looking like a to-do list.
      fixes: ['FONT_OFF_SYSTEM', 'FONT_OFF_SYSTEM_MORE', 'FONT_NOT_LOADED'],
      fixedWhat: 'The font check was reading every weight of an uploaded typeface as a different font, so websites using one font in several weights came back with dozens of items saying the wrong font was used. Those items were never real.',
      items: [
        'An uploaded font that Duda serves one weight at a time — BarcolaExpanded-Bold, -SemiBold, -Medium, -Regular — is read as one typeface, not four different fonts',
        'The Fonts tab shows one card per typeface with its weights listed, instead of a separate card for every weight',
        'Text is only flagged when its typeface is not part of the design; a heading set in a heavier weight of the heading font is no longer an audit item',
        'An audit item names the family ("Title in Magistral"), so approving a font covers every weight of it at once',
      ],
    },
    {
      v: 8,
      date: '2026-09-29',
      title: 'Required form fields are recognised the way Duda marks them',
      fixes: ['FORM_PHONE_OPTIONAL'],
      fixedWhat: 'Ticking "Required" in the Duda form editor does not put a required attribute on the field \u2014 it marks the row around it and stars the label. The check only looked at the field, so it called every Duda form field optional, including the ones that were required all along.',
      items: [
        'A phone field is read as required if the Duda row is marked required, if its label or placeholder ends in a star, or if the field carries the plain HTML required attribute',
        'Hand-built forms that use required or aria-required on the field itself still work as before',
        'A genuinely optional phone field is still flagged \u2014 only the false ones go',
      ],
    },
    {
      v: 9,
      date: '2026-09-29',
      title: 'Map embeds are no longer read as pointing at a business called "ph"',
      fixes: ['MAP_OTHER_BUSINESS', 'MAP_ADDRESS'],
      fixedWhat: 'A Google Map embed URL ends with a language and region code \u2014 en, ph \u2014 and the check was reading that region as the name of the business the map points at. Any embed made by dropping a pin or typing an address, which carries no business name at all, was reported as pointing at another business.',
      items: [
        'The language and region codes at the end of a map embed are no longer mistaken for a business name',
        'An embed with no business name in it is left alone instead of being called another business',
        'A map that really does point at a different business, or a different street address, is still critical',
        'Google Business links with only a place ID still fall back to comparing IDs, as before',
      ],
    },
    {
      v: 10,
      date: '2026-09-29',
      title: 'The hamburger and the X that closes the menu are not broken buttons',
      fixes: ['BUTTON_NO_LINK'],
      fixedWhat: 'Duda builds a hamburger menu as a link with no address and an icon inside, which is how it is supposed to work \u2014 the menu opens by script. The check counted every one of those as a button that goes nowhere, on every page of every website.',
      items: [
        'A control with nothing to read on it \u2014 a hamburger, the X that closes a menu, a slider arrow \u2014 is no longer reported as a button with no link',
        'Neither is anything Duda itself names as a menu or slider widget, or any link with no address attribute at all',
        'A control word like "Menu" or "Next" is left alone inside a menu or slider, and still reported anywhere else',
        'A real button that goes nowhere is still reported, including one sitting in the header navigation, and the item now names the button instead of saying "(no text)"',
      ],
    },
    {
      v: 11,
      date: '2026-09-30',
      title: 'The same photo used in more than one place',
      items: [
        'Every picture on the website \u2014 in an image tag and as a CSS background \u2014 is fingerprinted from its own pixels, so the same photo counts as the same photo even when it was uploaded twice under different names or served at a different size',
        'A photo used in more than one place is one audit item that names every place it is used, each one openable on its own element and page',
        'Patterns, icons, logos, vector graphics, tiled backgrounds and anything too small or too flat to be a photograph are deliberately left alone \u2014 Reference data \u2192 Pictures on the website lists what was set aside and why',
        'A photo that is meant to repeat can be approved under Business Info \u2192 Add or exclude a value \u2192 Picture, and stops being flagged on that website',
      ],
    },
    {
      v: 12,
      date: '2026-09-30',
      title: 'A business renamed on Google is no longer called another business',
      fixes: ['MAP_OTHER_BUSINESS'],
      fixedWhat: 'The name in a Google Map embed link is a snapshot taken on the day somebody made the link, not a live lookup \u2014 Google draws the pin from a place ID and shows whatever that place is called today. A client who has since renamed their Google listing was therefore reported, at critical, as pointing at another business, when the map on the page was perfectly correct.',
      items: [
        'When a map is pinned by a Google place ID and the saved name still names the client\u2019s own town, it now reads "carries an old business name \u2014 the pin itself is probably right", as a warning, saying when the link was saved and to regenerate it',
        'A map whose saved name belongs to a business somewhere else entirely is still critical, and so is one with no place ID behind it',
        'Google place IDs are read correctly out of embed links for the first time \u2014 the colon in them arrives encoded, so every embed had been reading as having no place ID at all',
      ],
    },
    {
      v: 13,
      date: '2026-09-30',
      title: 'A map pinned by a place ID is never called another business',
      fixes: ['MAP_OTHER_BUSINESS'],
      fixedWhat: 'The first go at this only spared a renamed listing when Business Info had a town to compare against \u2014 so a mobile detailer with no address on file was still told, at critical, that their own map belonged to somebody else. A map pinned by a Google place ID cannot be judged from its link at all: the name in it is only a snapshot of what that place was called on the day the link was made.',
      items: [
        'A map with a Google place ID behind it now always reads as something to open and check, never as an accusation \u2014 whether or not there is an address in Business Info to compare with',
        'When the saved name still names the client\u2019s own town it says so outright: the pin is probably right and only the name is out of date',
        'A map with no place ID is still critical, because there the saved name is the only thing choosing the pin',
      ],
    },
    {
      v: 14,
      date: '2026-09-30',
      title: 'A location page is allowed to name its own location',
      fixes: ['AI_TEXT_LOCATION', 'AI_ALT_LOCATION'],
      fixedWhat: 'A page at /auto-detailing-located-in-aberdeen is a location page somebody built on purpose, so naming Aberdeen in its title, headings and alt text is the point of the page. The location check was comparing every mention against Business Info and reporting the whole set as critical.',
      items: [
        'A town named in the page\u2019s own address is accepted in that page\u2019s title, headings, copy and alt text',
        'A DIFFERENT town on the same page is still reported, and so is any town on a page whose address does not name one',
        'Words in the address that are just the business name or the service being sold no longer vouch for a place',
        'Only location findings are affected \u2014 another business named on a location page is still critical',
      ],
    },
    {
      v: 15,
      date: '2026-09-30',
      title: 'The favicon is judged once for the website, and our own footer badge is left out of the alt checks',
      // Only the two icon codes are declared corrected. The footer-badge change is a real fix too,
      // but it affects at most one image per website — declaring ALT_MISSING or AI_ALT_OTHER_BUSINESS
      // corrected would mark every alt item on every audit as unreliable to catch that one. Crying
      // wolf across 800 websites is worse than the bug.
      fixes: ['FAVICON_MISSING', 'HOMESCREEN_ICON_MISSING'],
      fixedWhat: 'Two things were being reported that were never the client\u2019s to fix. A favicon is one setting for the whole website, but it was checked page by page and device by device \u2014 and because Duda serves the mobile version as separate HTML that usually leaves the link tag out, a website with a perfectly good favicon was told "no favicon" on Mobile across every page. Separately, our own agency badge in the footer was being audited like one of the client\u2019s images, so its alt text was read as a business name that doesn\u2019t match theirs.',
      items: [
        'The favicon and the home screen icon are settled once for the whole website: if any page on any device carries one, nothing is reported \u2014 and when there genuinely isn\u2019t one, it is a single item instead of one per page and device',
        'The footer badge (id="footer-logo", and the same under agency-logo or credit-logo) is skipped by every alt text check and never sent to the AI \u2014 it is the agency\u2019s logo, not the client\u2019s image',
        'Any website carrying the old favicon items says so on the audit, and a rescan clears them — the footer badge simply stops being reported on the next scan',
      ],
    },
    {
      v: 16,
      date: '2026-10-01',
      title: 'A renamed Google listing is a note, not work — and a repeated photo says where it is',
      fixes: ['MAP_LABEL_OLD'],
      fixedWhat: 'A map embed pinned by a Google place ID, in the client’s own town, under the listing’s old name, is not a problem at all: Google draws the pin and its CURRENT name from the place ID, and the name sitting in the link is never shown to anybody. It was still being raised as an amber warning, which reads as work, so the same item kept coming back after each rescan.',
      items: [
        'That case is now Info, and says outright that nothing on the page is wrong — regenerate the link if you want it tidy, or mark the old name correct for this website and it never returns',
        'A map whose saved name belongs to a town that isn’t the client’s is still a warning to open and check, and one with no place ID behind it is still critical',
        '"Same photo used in 3 places" now lists the three places on the audit row itself — the part of the page, the element and the pages — each with its own Show on page',
        'The "A different photo in each place" line is gone, because it took the space where the places belonged',
      ],
    },
    {
      v: 17,
      date: '2026-10-06',
      title: 'Share-by-email buttons are left alone — and fixing then rescanning closes items by itself',
      fixes: ['MAILTO_INVALID'],
      fixedWhat: 'A "share this by email" button (an email link with no address, only a subject or message filled in, so the visitor chooses who to send it to) was raised as a critical "Email link has an invalid address". The empty address is on purpose. Email links that do carry an address are checked exactly as before.',
      items: [
        'Share-by-email buttons, the kind on blog posts, are no longer raised at all',
        'An email link with no address and nothing filled in is still critical — that one really is broken',
        'Fix something in the editor, rescan, and the item is closed as Done on its own, keeps its number, and says "Fixed on rescan"',
        'If a closed item shows up again on a later rescan, it reopens',
      ],
    },
    {
      v: 18,
      date: '2026-10-06',
      title: 'Service and product schema is no longer compared to the business name',
      fixes: ['SCHEMA_NAME'],
      fixedWhat: 'The structured data (JSON-LD) check compared EVERY "name" in a page\u2019s schema to the business name. On a service page that name belongs to the service ("Tesla Window Tinting"), a product or an FAQ, not to the business, so every service page got a critical "business name differs" item that was never wrong.',
      items: [
        'Only the schema entry that describes the business itself (a local business or organisation) has to carry the business name',
        'A business named inside a service\u2019s schema (as the one providing it) is now checked too, along with its phone and address, where before it was missed',
      ],
    },
    {
      v: 19,
      date: '2026-10-07',
      title: 'Business name spelling, compared letter for letter',
      items: [
        'Every mention of the business name in the page text is compared with the spelling in Business Info. "Buff & Beyond" or "Buff and Beyond" where Business Info says "Buff&Beyond" is raised, showing both spellings side by side',
        'A one-letter typo in a longer name ("Buff&Beyon") is raised as "looks misspelled"',
        'The name in capitals (usually a heading), curly vs straight apostrophes and possessives ("Buff&Beyond\u2019s") are not counted',
        'A spelling the client really uses can be approved as correct for that website, and it is never raised again there',
      ],
    },
    {
      v: 20,
      date: '2026-10-07',
      title: 'Share-by-email buttons are back — as one item listing every place',
      items: [
        'A share-by-email button with no recipient address is raised again, because it still needs fixing',
        'Instead of one item per blog post, the website gets ONE item that lists every place, each with its own Show on page',
        'The item keeps its number while places are fixed, and closes by itself on the rescan that finds none left',
        'A share link that also carries "class=…" in its address (a styling setting that leaked into the link) says so',
      ],
    },
  ];
  const CHECKS_VERSION = CHECK_RELEASES[CHECK_RELEASES.length - 1].v;
  /** Releases of the check list newer than the one a scan ran with. Scans older than this feature count as v1. */
  function checksSince(v) { const n = Number(v) || 1; return CHECK_RELEASES.filter((r) => r.v > n); }
  /** The check codes corrected since a scan ran — items carrying one of these are known to be unreliable. */
  function fixedSince(v) { const out = new Set(); checksSince(v).forEach((r) => (r.fixes || []).forEach((c) => out.add(c))); return out; }

  // Words that don't identify a specific business (used for name/handle matching)
  const GENERIC = new Set(('the and of for co company llc inc ltd corp auto autos automotive car cars truck trucks ' +
    'detail details detailing detailers mobile repair repairs service services shop shops garage tint tinting tints ' +
    'window windows ceramic coating coatings body collision tire tires center centre care wash spa pro pros plus ' +
    'motor motors mechanic mechanical express quality premier best top professional solutions group studio works ' +
    'customs custom clean cleaning protection film paint glass wrap wraps performance diesel transmission brake brakes ' +
    'oil lube tech technology fleet vehicle vehicles').split(' '));

  const EDITOR_HOSTS = /(^|\.)(responsivesiteeditor\.com|multiscreensite\.com|dudaone\.com|dudamobile\.com|mobilesitesonline\.com|dudasites\.com)$/i;

  // The words a menu or slider control has on it, and the places those controls live. Used to tell
  // "Get a quote, and nothing happens" from "the X that closes the menu", which has no link by design.
  const CONTROL_WORD = /^(menu|close|open|toggle|search|back|next|prev(ious)?|more|skip|expand|collapse|[×✕✖x+]|[«»‹›←→])$/i;
  // Duda writes these names in camelCase ("hamburgerButton", "dmNavIcon"), so the token is matched
  // wherever it sits in the word rather than only between separators.
  const MENU_WORDS = '(nav|navigation|navbar|menu|hamburger|burger|toggle|close|drawer|offcanvas|overlay|slider|carousel|swiper|arrow|prev|next|pagination|search)';
  const MENU_ISH = new RegExp(`(^|[\\s_-]|[a-z])${MENU_WORDS}([\\s_-]|[A-Z]|$)`, 'i');
  /** A Duda widget is what it says it is: dmle_widget="hamburgerButton" is not a call-to-action. */
  const widgetName = (el) => (el.getAttribute && (el.getAttribute('dmle_widget') || el.getAttribute('data-element-type'))) || '';
  /** Is this link a menu, slider or other control whose behaviour is wired up by script? */
  function inMenu(a) {
    for (let el = a, n = 0; el && n < 5; el = el.parentElement, n++) {
      if (el.tagName === 'NAV') return true;
      if (MENU_ISH.test(widgetName(el))) return true;
      const c = el.getAttribute ? (el.getAttribute('class') || '') : '';
      if (MENU_ISH.test(c)) return true;
      const role = el.getAttribute ? (el.getAttribute('role') || '') : '';
      if (/^(navigation|menu|menubar|toolbar)$/i.test(role)) return true;
    }
    return false;
  }

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
    // In an embed the colon arrives encoded — !1s0x0%3A0xfc49… — so decode before looking, or every
    // embed reads as having no place ID at all.
    const h = String(href || '').replace(/%3a/gi, ':');
    const m = h.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || h.match(/[?&](?:ftid|cid|place_id)=([^&]+)/i) || h.match(/!1s([A-Za-z0-9_-]{10,})/);
    return m ? m[1].toLowerCase() : '';
  }
  /** Coordinates, not a name: "45.52,-122.60", "@45.52,-122.60,15z". */
  const COORDS = /^@?[-+]?\d{1,3}(\.\d+)?\s*,\s*[-+]?\d{1,3}(\.\d+)?/;
  /**
   * The business name a Google Maps URL points at, or '' when it carries none.
   *
   * The `pb=` blob in an embed iframe is mostly coordinates, zoom levels and feature ids, written as
   * `!<n><type><value>` segments. It ALWAYS ends with a locale pair — `!3m2!1sen!2sph` is language
   * "en", region "ph" — and reading the first `!2s…` as a name turns that region code into a
   * business called "ph", which is how a perfectly correct map came to be reported as pointing at
   * another business. So the locale pair is skipped, along with ids, numbers and anything too short
   * to be a name, and the best remaining candidate wins. Plenty of embeds are generated from a
   * dropped pin or an address and carry no name at all — for those the honest answer is '', and
   * nothing is flagged.
   */
  function placeNameFromUrl(href) {
    const s = String(href || '');
    const path = s.match(/\/maps\/place\/([^/@?]+)/i);
    // "place/data=!4m2!…" and "place/@lat,lng" are IDs and coordinates, not names
    if (path && !/^(data=|@)/i.test(path[1]) && !COORDS.test(path[1])) {
      const v = safeDecode(path[1].replace(/\+/g, ' ')).trim();
      if (v) return v;
    }
    const cands = [];
    const re = /!2s([^!]*)/g;
    let x;
    while ((x = re.exec(s)) !== null) {
      // `!1s<lang>!2s<region>` — the locale pair, never a place.
      if (/!1s[a-z]{2,3}$/i.test(s.slice(Math.max(0, x.index - 8), x.index))) continue;
      const v = safeDecode(x[1].replace(/\+/g, ' ')).trim();
      if (v.length < 4) continue;                    // "ph", "en", and other codes
      if (/^0x[0-9a-f]+/i.test(v)) continue;         // feature ids
      if (COORDS.test(v) || !/[A-Za-z]{2}/.test(v)) continue;
      cands.push(v);
    }
    // A real name usually has a space in it; failing that, the longest candidate.
    cands.sort((a, c) => (/\s/.test(c) ? 1 : 0) - (/\s/.test(a) ? 1 : 0) || c.length - a.length);
    if (cands.length) return cands[0];
    try {
      const u = new URL(href);
      const q = (u.searchParams.get('q') || u.searchParams.get('query') || '').trim();
      if (q && !COORDS.test(q) && /[A-Za-z]{2}/.test(q)) return q;
    } catch (e) { /* ignore */ }
    return '';
  }

  /**
   * Build the reference ("truth") from Duda API responses. `api` = { site, content } (raw API JSON).
   * Falls back to the site's own JSON-LD schema (which Duda generates from Business Info) when the API is unavailable.
   */
  /**
   * The reference an audit is checked against.
   *
   * `brief` is the client's own document — the thing the website was actually built from. When a
   * project has one, it goes FIRST: during a pre-launch build, Duda's Business Info is often half
   * filled in or still carries the template's details, while the brief is what the customer wrote
   * down. Duda's values are kept alongside rather than discarded, so a phone number that appears in
   * either place is still correct and nobody gets a false alarm for using the one Duda holds.
   */
  function buildTruth(api, schemaObj, brief) {
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
    // The brief last in code, first in the lists: unshift, so it becomes the expected value a
    // finding quotes while everything Duda knows stays acceptable.
    if (brief && (brief.businessName || brief.phone || brief.email || brief.address)) {
      t.source = t.source === 'none' ? 'brief' : t.source + '+brief';
      t.fromBrief = true;
      if (brief.businessName) {
        t.names = [String(brief.businessName).trim()].concat(t.names.filter((n) => compact(n) !== compact(brief.businessName)));
      }
      if (brief.phone) {
        const d = normPhone(brief.phone).slice(-10);
        if (d.length >= 10) t.phones = [d].concat(t.phones.filter((x) => x !== d));
      }
      if (brief.email) {
        const e = String(brief.email).toLowerCase().trim();
        t.emails = [e].concat(t.emails.filter((x) => x !== e));
      }
      if (brief.address) {
        const a = normAddress(brief.address);
        if (a && (a.street || a.zip)) t.addresses = [a].concat(t.addresses);
      }
      t.notes.push('Business details taken from the client brief');
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

  /**
   * One typeface, whatever the weights are called.
   *
   * A self-hosted font is usually loaded as one family per weight — BarcolaExpanded-Bold,
   * BarcolaExpanded-SemiBold, BarcolaExpanded-Medium — rather than one family with several weights.
   * Compared by name those are four different typefaces, and a website using its own font properly
   * ends up with a hundred audit items saying so. They are the same typeface, so the weight is
   * stripped off the end and the base name is what gets compared.
   *
   * Only a TRAILING weight word is removed, and only when at least three characters are left, so a
   * family whose name merely ends in something weight-ish keeps it.
   */
  const FONT_WEIGHT_WORD = /^(thin|hairline|extra ?light|ultra ?light|light|regular|normal|book|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique|roman|[1-9]00)$/i;
  const FONT_WEIGHT_CAMEL = /^(.*[a-z])((?:Extra|Ultra|Semi|Demi)?(?:Thin|Hairline|Light|Regular|Normal|Book|Medium|Bold|Black|Heavy|Italic|Oblique))$/;
  // "Demi" and "Extra" are never a weight on their own, but "Avenir Next Demi Bold" is one font.
  // So they're only stripped in the pass straight after a weight word was taken off the end.
  const FONT_WEIGHT_MOD = /^(extra|ultra|semi|demi)$/i;
  function fontBase(name) {
    let s = String(name == null ? '' : name).replace(/['"]/g, '').trim();
    let justStripped = false;
    for (let i = 0; i < 4 && s; i++) {
      const sep = /^(.*?)[\s_-]+([A-Za-z]+|[1-9]00)$/.exec(s);
      const modOK = sep && justStripped && FONT_WEIGHT_MOD.test(sep[2]);
      if (sep && (FONT_WEIGHT_WORD.test(sep[2]) || modOK) && sep[1].trim().length >= 3) { s = sep[1].trim(); justStripped = !modOK; continue; }
      const camel = FONT_WEIGHT_CAMEL.exec(s);
      if (camel && camel[1].length >= 3) { s = camel[1]; justStripped = true; continue; }
      break;
    }
    return s;
  }
  /** The weight this family name carries, if any — "BarcolaExpanded-SemiBold" → "SemiBold". */
  function fontWeight(name) {
    const full = String(name == null ? '' : name).replace(/['"]/g, '').trim();
    const base = fontBase(full);
    if (!base || base === full) return '';
    return full.slice(base.length).replace(/^[\s_-]+/, '').trim();
  }

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
    // Compared as families: a theme that sets H1 in the Bold weight and H2 in the SemiBold weight of
    // the same typeface is using one typeface, not two.
    const set = new Set(THEME_TAGS.map((t) => roles[t]).filter(Boolean).map(fontBase));
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
  // ---------------------------------------------------------------------------
  // EVERY PICTURE ON A PAGE, AND WHERE IT IS
  //
  // Not the same thing as the image list the link checker uses. That one keeps a single entry per
  // address, because it only asks "does this load". Finding a photo used twice means keeping EVERY
  // occurrence, and it means CSS backgrounds too — on a Duda site the hero, most section banners and
  // half the cards are background images, so an <img>-only sweep would miss most of the photos.
  // ---------------------------------------------------------------------------
  const IMG_EXT = /\.(jpe?g|png|webp|avif|gif|svg)(\?|#|$)/i;
  /** The widest candidate in a srcset, which is the one worth fingerprinting. */
  function fromSrcset(v) {
    let best = ''; let bestW = -1;
    String(v || '').split(',').forEach((part) => {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return;
      const w = /^(\d+)w$/.exec(bits[1] || '') ? Number(RegExp.$1) : /^([\d.]+)x$/.exec(bits[1] || '') ? Number(RegExp.$1) * 1000 : 0;
      if (w >= bestW) { bestW = w; best = bits[0]; }
    });
    return best;
  }
  const urlsInCss = (v) => (String(v || '').match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi) || [])
    .map((u) => (/url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(u) || [])[2] || '').filter(Boolean);
  /**
   * Does this CSS tile the image? A tiled background is a pattern by definition, never a photograph.
   * "no-repeat" must not count: the hyphen is a word boundary, so a plain \brepeat\b matches inside
   * it and would call every cover photo on the website a pattern.
   */
  const TILED = /(^|[\s,/(])(repeat|repeat-x|repeat-y|round|space)([\s,;)]|$)/i;
  const tiledFrom = (css) => {
    const c = String(css || '');
    const explicit = /background-repeat\s*:\s*([^;]+)/i.exec(c);
    if (explicit) return TILED.test(explicit[1]);
    const short = /background\s*:\s*([^;]+)/i.exec(c);
    return short ? TILED.test(short[1].replace(/url\([^)]*\)/gi, ' ')) : false;
  };

  function photosUsed(doc, ctx, device) {
    const out = [];
    const abs = (u) => { try { return new URL(u, ctx.pageUrl).href; } catch (e) { return ''; } };
    const push = (el, url, how, extra) => {
      if (!url || /^data:/i.test(url)) return;
      const a = abs(url);
      if (!a || !/^https?:/i.test(a)) return;
      if (/\/blank(-\d+w)?\.(webp|png|gif|jpe?g)$/i.test(a.split('?')[0])) return;   // Duda's spacer
      out.push(Object.assign({
        url: a, how, selector: uniqueSelector(el), block: blockOf(uniqueSelector(el)),
        location: locationOf(el), hiddenBy: hiddenReason(el, device) || '',
      }, extra || {}));
    };

    doc.querySelectorAll('img').forEach((img) => {
      if (img.closest('noscript')) return;
      if (isAgencyBadge(img)) return;                                                 // our own footer badge
      const w = img.getAttribute('width'); const h = img.getAttribute('height');
      if (w === '1' || w === '0' || h === '1' || h === '0') return;                    // tracking pixels
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-dm-image-path') || fromSrcset(img.getAttribute('srcset'));
      push(img, src, 'img', { alt: img.getAttribute('alt') || '', w: Number(w) || 0, h: Number(h) || 0 });
    });
    doc.querySelectorAll('picture source[srcset], source[srcset]').forEach((sc) => {
      const holder = sc.parentElement && sc.parentElement.querySelector('img');
      push(holder || sc, fromSrcset(sc.getAttribute('srcset')), 'img', {});
    });
    // Inline backgrounds, which is how Duda writes most hero and section images.
    doc.querySelectorAll('[style*="url(" i]').forEach((el) => {
      const st = el.getAttribute('style') || '';
      if (!/background/i.test(st)) return;
      const tiled = tiledFrom(st);
      urlsInCss(st).forEach((u) => push(el, u, 'background', { tiled }));
    });
    doc.querySelectorAll('[data-background-image], [data-bg], [data-src-background]').forEach((el) => {
      push(el, el.getAttribute('data-background-image') || el.getAttribute('data-bg') || el.getAttribute('data-src-background'), 'background', {});
    });
    // …and backgrounds set in a stylesheet, matched to the elements they actually dress.
    doc.querySelectorAll('style').forEach((st) => {
      const css = (st.textContent || '').replace(/@font-face\s*\{[^}]*\}/gi, ' ');
      let m; const rule = /([^{}]+)\{([^{}]*)\}/g;
      while ((m = rule.exec(css))) {
        if (!/background/i.test(m[2]) || !/url\(/i.test(m[2])) continue;
        const urls = urlsInCss(m[2]);
        if (!urls.length) continue;
        const tiled = tiledFrom(m[2]);
        m[1].split(',').forEach((raw) => {
          const sel = raw.replace(/::?[a-z-]+(\([^)]*\))?/gi, '').trim();
          if (!sel || /^@/.test(sel)) return;
          let hits = [];
          try { hits = doc.querySelectorAll(sel); } catch (e) { return; }
          Array.prototype.slice.call(hits, 0, 40).forEach((el) => urls.forEach((u) => push(el, u, 'background', { tiled })));
        });
      }
    });
    // One entry per element per picture: a rule and an inline style naming the same file on the
    // same element is one picture in one place, not two.
    const seenHere = new Set();
    return out.filter((x) => {
      if (!IMG_EXT.test(x.url) && !/\/dms3rep\/|cdn-website|multiscreensite/i.test(x.url)) return false;
      const k = x.selector + '|' + x.url;
      if (seenHere.has(k)) return false;
      seenHere.add(k);
      return true;
    }).slice(0, 400);
  }

  // ---------------------------------------------------------------------------
  // IS IT A PHOTOGRAPH, AND IS IT THE SAME ONE TWICE?
  //
  // Two questions, one look at the pixels.
  //
  // "The same one" is a perceptual hash, not a file comparison: a 8×8 grey thumbnail turned into 64
  // bits by asking, for each pixel, whether it is brighter than the one to its right. Re-saving,
  // resizing or re-compressing a photo barely moves those bits, so the same picture uploaded twice
  // under different names still matches — which is the whole point of doing this by pixel.
  //
  // "Is it a photograph" is the harder half, and it is what keeps patterns, icons and logos out of
  // the report. A photograph has thousands of slightly different colours and almost no transparency;
  // a design element has a handful of flat colours, usually transparency around it, often tiles, and
  // is usually small. None of those on its own is proof, so they are counted together.
  // ---------------------------------------------------------------------------
  const HASH_N = 8;              // 8×8 → 64 bits
  const PROBE_N = 32;            // the sample the photo/graphic tests are measured on
  const GRAPHIC_NAME = /(^|[\W_])(icon|icons|logo|logos|favicon|sprite|pattern|texture|bg-?pattern|divider|shape|blob|swirl|badge|ribbon|arrow|bullet|placeholder|spacer|overlay|gradient|frame|border|watermark|stripe|dots?|noise|grain)([\W_]|$)/i;

  /** Read a picture into a small canvas and measure it. Returns null when it can't be read. */
  function measureImage(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const cv = document.createElement('canvas');
    cv.width = PROBE_N; cv.height = PROBE_N;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    cx.drawImage(img, 0, 0, PROBE_N, PROBE_N);
    let px;
    try { px = cx.getImageData(0, 0, PROBE_N, PROBE_N).data; } catch (e) { return null; }  // tainted

    // Colour variety, on a coarse grid so compression noise doesn't count as variety.
    const buckets = new Set();
    let clear = 0; let edge = 0; let last = -1;
    const grey = new Float64Array(PROBE_N * PROBE_N);
    for (let i = 0, n = 0; i < px.length; i += 4, n++) {
      const a = px[i + 3];
      if (a < 200) clear++;
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      grey[n] = g;
      buckets.add(((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4));
      if (last >= 0 && Math.abs(g - last) > 8) edge++;
      last = g;
    }
    const total = PROBE_N * PROBE_N;

    // The hash. Shrinking a large photo straight down to nine pixels wide leaves the answer at the
    // mercy of whatever the browser's sampler happens to pick up, and two copies of one photo saved
    // at different sizes then disagree. Going through an intermediate size averages first, so the
    // same picture re-uploaded lands on the same bits.
    const mid = document.createElement('canvas');
    mid.width = 64; mid.height = 64;
    const mcx = mid.getContext('2d', { willReadFrequently: true });
    if (!mcx) return null;
    mcx.imageSmoothingEnabled = true; mcx.imageSmoothingQuality = 'high';
    mcx.drawImage(img, 0, 0, 64, 64);
    cv.width = HASH_N + 1; cv.height = HASH_N;
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(mid, 0, 0, HASH_N + 1, HASH_N);
    let bits = '';
    try {
      const hp = cx.getImageData(0, 0, HASH_N + 1, HASH_N).data;
      for (let y = 0; y < HASH_N; y++) {
        for (let x = 0; x < HASH_N; x++) {
          const at = (i) => 0.299 * hp[i * 4] + 0.587 * hp[i * 4 + 1] + 0.114 * hp[i * 4 + 2];
          bits += at(y * (HASH_N + 1) + x) > at(y * (HASH_N + 1) + x + 1) ? '1' : '0';
        }
      }
    } catch (e) { return null; }

    return { w, h, hash: bits, colors: buckets.size, alpha: Math.round((clear / total) * 100), edges: Math.round((edge / total) * 100) };
  }

  /**
   * Photograph, or design element? Returns '' for a photograph, otherwise why it was set aside —
   * the reason is worth keeping so the Fonts-style reference panel can show what was skipped.
   */
  function graphicReason(m, hint) {
    hint = hint || {};
    if (/\.svg(\?|#|$)/i.test(hint.url || '')) return 'a vector graphic';
    if (GRAPHIC_NAME.test(String(hint.url || '').split('/').pop() || '')) return 'named like a design element';
    if (hint.tiled) return 'a tiled background pattern';
    if (!m) return '';
    if (m.w < 150 || m.h < 150) return 'too small to be a photo';
    if (m.alpha > 15) return 'mostly transparent, so a graphic';
    if (m.colors < 40) return 'too few colours to be a photo';
    if (m.colors < 90 && m.edges < 12) return 'flat colour, so a graphic';
    return '';
  }

  /** How many of the 64 bits differ. 0 is the same picture; up to ~6 is the same picture re-saved. */
  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 99;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }
  /** A picture with almost no detail at all hashes to nearly all one bit, and would match anything. */
  const flatHash = (h) => { let ones = 0; for (let i = 0; i < h.length; i++) if (h[i] === '1') ones++; return ones < 6 || ones > h.length - 6; };

  /**
   * The same picture served at a dozen sizes is one picture: Duda writes the width into the file
   * name and repeats it in the query, so both go before anything is compared. Kept in step with
   * imgKey on the server, which uses this same shape for the fingerprint cache.
   */
  function imageKey(raw) {
    let u;
    try { u = new URL(String(raw || ''), 'https://x.invalid'); } catch (e) { return String(raw || '').toLowerCase().trim(); }
    const path = u.pathname
      .replace(/-\d{2,5}w(?=\.[a-z0-9]+$)/i, '')
      .replace(/_\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '')
      .replace(/\/(?:opt|resize|fit|crop)\/(?=[^/]+$)/i, '/');
    return (u.origin + path).toLowerCase();
  }

  /** Load one picture through the app's own address, so the canvas can be read. */
  function loadImage(url, timeoutMs) {
    return new Promise((done) => {
      const img = new Image();
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; clearTimeout(t); done(v); } };
      const t = setTimeout(() => finish(null), timeoutMs || 12000);
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = '/api/imghash?url=' + encodeURIComponent(url);
    });
  }

  /**
   * Fingerprint every distinct picture on the website.
   *
   * Anything already fingerprinted — on an earlier scan, or on another website using the same stock
   * photo — comes back from the cache and is never downloaded again, which is what makes this
   * affordable across hundreds of sites.
   */
  async function fingerprintPhotos(photos, opts) {
    const byKey = new Map();
    photos.forEach((ph) => {
      const k = imageKey(ph.url);
      if (!byKey.has(k)) byKey.set(k, { key: k, url: ph.url, tiled: !!ph.tiled, places: [] });
      const e = byKey.get(k);
      if (ph.tiled) e.tiled = true;
      e.places.push(ph);
    });
    const list = [...byKey.values()];
    if (!list.length || !opts.imageHashes) return byKey;

    let known = {};
    try { known = (await opts.imageHashes(list.map((x) => x.url))) || {}; } catch (e) { /* cache is a bonus */ }
    const fresh = [];
    let done = 0;
    for (const e of list) {
      if (opts.shouldStop && opts.shouldStop()) break;
      const cached = known[e.url];
      if (cached && cached.h) { e.m = { hash: cached.h, w: cached.w, h: cached.h2, colors: cached.colors, alpha: cached.alpha }; e.why = cached.photo ? '' : (cached.why || 'a design element'); continue; }
      if (opts.onProgress) opts.onProgress({ done: ++done, total: list.length, message: `Fingerprinting pictures ${done}/${list.length}` });
      const img = await loadImage(e.url);
      const m = img ? measureImage(img) : null;
      if (!m) { e.why = 'could not be read'; continue; }
      e.m = m;
      e.why = graphicReason(m, { url: e.url, tiled: e.tiled });
      fresh.push({ url: e.url, h: m.hash, photo: !e.why, why: e.why, w: m.w, h2: m.h, colors: m.colors, alpha: m.alpha });
    }
    if (fresh.length && opts.saveImageHashes) { try { await opts.saveImageHashes(fresh); } catch (e) { /* likewise */ } }
    return byKey;
  }

  /**
   * The audit items: one per photograph that turns up in more than one place.
   *
   * "Place" is the element it sits in, not the number of times it was seen — a header photo appears
   * on all fifteen pages and on three devices, and that is one place, not forty-five. Header and
   * footer are counted once for the whole website for the same reason.
   */
  const PHOTO_ITEM_CAP = 12;
  /** Has the team said this picture is meant to repeat? By full address, or by the file name on the item. */
  const imageApproved = (ok, e) => ok.has('image:' + e.key)
    || ok.has('image:' + safeDecode(String(e.url).split('?')[0].split('/').pop() || '').toLowerCase());
  function duplicatePhotoFindings(byKey, allow) {
    const out = [];
    const ok = allow || new Set();
    const shots = [...byKey.values()].filter((e) => e.m && e.m.hash && !e.why && !flatHash(e.m.hash)
      && !imageApproved(ok, e));

    // Group by fingerprint: the same file, and the same picture uploaded twice under other names.
    const groups = [];
    shots.forEach((e) => {
      const g = groups.find((x) => x.key === e.key || hamming(x.hash, e.m.hash) <= 6);
      if (g) { g.members.push(e); } else groups.push({ key: e.key, hash: e.m.hash, members: [e] });
    });

    groups.forEach((g) => {
      // Where it is: one row per element, with the pages that element appears on gathered behind it.
      const spots = new Map();
      g.members.forEach((e) => e.places.forEach((ph) => {
        const k = [ph.block || ph.selector, ph.location].join('|');
        const sp = spots.get(k) || { block: ph.block || ph.selector, selector: ph.selector, location: ph.location, how: ph.how, paths: new Set(), hiddenBy: ph.hiddenBy, first: ph };
        sp.paths.add(ph.path || '/');
        if (!spots.has(k)) spots.set(k, sp);
      }));
      const places = [...spots.values()];
      if (places.length < 2) return;
      const names = [...new Set(g.members.map((e) => safeDecode(String(e.url).split('?')[0].split('/').pop() || '')))];
      // Approving covers the whole group, however many names the one picture was uploaded under.
      const allowValue = names[0];
      const reupload = names.length > 1;
      const where = places.slice(0, 6).map((sp) => `${sp.location}${sp.paths.size ? ' (' + [...sp.paths].slice(0, 3).join(', ') + (sp.paths.size > 3 ? ', …' : '') + ')' : ''}`);
      const one = places[0].first;
      out.push({
        code: 'IMAGE_DUPLICATE', severity: 'warning', category: 'Images / Alt',
        message: `Same photo used in ${places.length} places${reupload ? ' — and uploaded more than once' : ''}`,
        found: names.slice(0, 3).join(' · ') + (names.length > 3 ? ` · …and ${names.length - 3} more` : ''),
        // No "Expected" here. "A different photo in each place" told nobody anything they didn't
        // already know, and took the space where the places themselves belong — dupPlaces below is
        // the answer to "where?", and the audit list now shows it on the row, not only in the item.
        path: one.path, device: one.device, selector: places[0].block, location: places[0].location,
        visible: !one.hiddenBy, hiddenBy: one.hiddenBy || '', snippet: where.join(' · ') + (places.length > 6 ? ` · …and ${places.length - 6} more` : ''),
        allowValue,
        dupPlaces: places.slice(0, PHOTO_ITEM_CAP).map((sp) => ({ selector: sp.block, location: sp.location, how: sp.how, paths: [...sp.paths].slice(0, 8) })),
      });
    });
    return out;
  }

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
    doc.querySelectorAll('h4, h5, h6, span, td, th, label, figcaption, blockquote, strong, em, a, div').forEach((el) => {
      if (seen.has(el)) return;
      // Only the element that actually holds the words, not every wrapper around them.
      if (el.querySelector('h1,h2,h3,h4,h5,h6,p,li,span,td,th,label,a,button')) return;
      take(el, 'other');
    });
    const loaded = [];
    fontSources(doc, resolve).forEach((src, key) => loaded.push({ key, name: src && src.name ? src.name : key, src: src && src.src ? src.src : String(src || '') }));
    return { rows, loaded, theme: themeFonts(doc, resolve).roles };
  }

  /**
   * Is this JSON-LD object the BUSINESS, or something the business offers? Only the business's own
   * entry has to carry the business name. A Service, Product, Offer, FAQ or Article is named after
   * what it is ("Tesla Window Tinting"), and comparing that to the business name is meaningless.
   */
  const BUSINESS_TYPE = /(^|\b)(LocalBusiness|Organization|Corporation|AutomotiveBusiness|Auto[A-Z][A-Za-z]*|MotorcycleDealer|MotorcycleRepair|GasStation|ProfessionalService|HomeAndConstructionBusiness|[A-Za-z]*Store|[A-Za-z]*Shop|[A-Za-z]*Contractor|[A-Za-z]*Business)$/;
  function isBusinessType(t) { return [].concat(t || []).some((x) => BUSINESS_TYPE.test(String(x).replace(/^https?:\/\/schema\.org\//i, ''))); }
  function extractSchema(doc) {
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const j = JSON.parse(s.textContent);
        // Nested objects are walked too: a Service page's schema usually names the business one
        // level down, as its "provider", and that is the part worth checking.
        const walk = (o, depth) => {
          if (!o || typeof o !== 'object' || depth > 6) return;
          if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
          if (o.telephone || o.address || (o.name && o['@type'] && !/WebPage|BreadcrumbList|WebSite/i.test(String(o['@type'])))) out.push({ node: s, data: o, biz: isBusinessType(o['@type']) });
          Object.keys(o).forEach((k) => { if (k !== '@context' && o[k] && typeof o[k] === 'object') walk(o[k], depth + 1); });
        };
        walk(j, 0);
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

  /**
   * The agency's own logo in the footer — the "website by us" badge every client site carries.
   *
   * It is our image, not the client's, and its alt text is ours to decide, so an audit of the
   * CLIENT's website has no business reporting it. Duda's template gives it a fixed id, which is a
   * far better signal than anything about the picture itself.
   */
  const AGENCY_BADGE_ID = /^(footer-logo|agency-logo|credit-logo|built-by-logo|designer-logo)$/i;
  function isAgencyBadge(el) {
    for (let x = el, n = 0; x && n < 3; x = x.parentElement, n++) {
      const id = (x.getAttribute && x.getAttribute('id')) || '';
      if (AGENCY_BADGE_ID.test(id)) return true;
      const cls = (x.getAttribute && x.getAttribute('class')) || '';
      if (/(^|\s)(footer-logo|agency-logo|credit-logo)(\s|$)/i.test(cls)) return true;
    }
    return false;
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

  // ---------- one element, one problem ----------
  // The same wrong phone number can be found three ways on one button: in the words, in the tel:
  // link, and in an aria-label. That is one thing to fix, so the fullest finding survives and the
  // others are folded into it as a note about where else the number appears.
  const CONTACT_RANK = { TEL_TEXT_MISMATCH: 0, MAILTO_TEXT_MISMATCH: 0, TEL_MISMATCH: 1, MAILTO_MISMATCH: 1, TEL_INVALID: 1, MAILTO_INVALID: 1, SMS_MISMATCH: 2, PHONE_MISMATCH: 3, EMAIL_MISMATCH: 3 };
  const CONTACT_KIND = { TEL_TEXT_MISMATCH: 'phone', TEL_MISMATCH: 'phone', TEL_INVALID: 'phone', SMS_MISMATCH: 'phone', PHONE_MISMATCH: 'phone', MAILTO_TEXT_MISMATCH: 'email', MAILTO_MISMATCH: 'email', MAILTO_INVALID: 'email', EMAIL_MISMATCH: 'email' };
  const contactValues = (f) => {
    if (CONTACT_KIND[f.code] === 'email') return (String(f.found || '').match(EMAIL_RE) || []).map((x) => x.toLowerCase());
    return (String(f.found || '').match(/\d[\d\s().-]{8,}\d/g) || []).map(normPhone).filter((d) => d.length === 10);
  };
  /** Where else the same number or address turned up on this element, said in passing. */
  const attrNote = (msg) => { const m = /\(in ([\w-]+) attribute\)/.exec(String(msg || '')); return m ? m[1] : ''; };

  function collapseContact(findings) {
    const groups = new Map();
    findings.forEach((f, i) => {
      if (!CONTACT_KIND[f.code]) return;
      const key = f.selector + '|' + CONTACT_KIND[f.code];
      (groups.get(key) || groups.set(key, []).get(key)).push(i);
    });
    const drop = new Set();
    groups.forEach((idx) => {
      if (idx.length < 2) return;
      const sorted = idx.slice().sort((a, b) => CONTACT_RANK[findings[a].code] - CONTACT_RANK[findings[b].code]);
      const kept = [];
      sorted.forEach((i) => {
        const mine = contactValues(findings[i]);
        // Only folded away when the fuller finding already names the same number or address.
        const host = kept.find((k) => mine.length && mine.every((v) => contactValues(findings[k]).includes(v)));
        if (!host && host !== 0) { kept.push(i); return; }
        drop.add(i);
        const attr = attrNote(findings[i].message);
        if (attr) {
          const h = findings[host];
          const seen = String(h.alsoIn || '').split(', ').filter(Boolean);
          if (!seen.includes(attr)) { seen.push(attr); h.alsoIn = seen.join(', '); h.message = h.message.replace(/ \(also in [^)]*\)$/, '') + ` (also in the ${h.alsoIn} attribute${seen.length > 1 ? 's' : ''})`; }
        }
      });
    });
    return findings.filter((f, i) => !drop.has(i));
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
    /**
     * Is this field required?
     *
     * Duda does NOT put `required` on the input. Ticking "Required" in the form editor marks the
     * WRAPPER — `<div class="dmforminput … required">` — validates in its own JavaScript, and adds a
     * star to the field's label. So looking only at the input's attribute called every Duda form
     * field optional, including ones that really were required, which is the wrong answer every time.
     *
     * Four signals, any one of which means required:
     *  1. the input's own `required` / `aria-required` (a hand-built form, or a non-Duda one)
     *  2. `class="… required"` on an ancestor inside the form — how Duda actually marks it
     *  3. a trailing star on the placeholder or aria-label — "Phone*"
     *  4. a trailing star on the field's label, which Duda keeps in two places: a `<label for="…">`
     *     matching the input's NAME (not its id — Duda's own quirk), and a hidden
     *     `<input name="label-<name>">` carrying the same text.
     */
    function fieldRequired(form, i) {
      if (i.hasAttribute('required') || String(i.getAttribute('aria-required')).toLowerCase() === 'true') return true;
      for (let el = i.parentElement, n = 0; el && n < 4 && el !== form; el = el.parentElement, n++) {
        if (/(^|\s)required(\s|$)/i.test(el.getAttribute('class') || '')) return true;
      }
      const star = (v) => /\*\s*$/.test(String(v == null ? '' : v));
      if (star(i.getAttribute('placeholder')) || star(i.getAttribute('data-placeholder-original')) || star(i.getAttribute('aria-label'))) return true;
      const name = i.getAttribute('name') || '';
      if (name) {
        const hidden = form.querySelector(`input[type="hidden"][name="label-${(window.CSS && CSS.escape ? CSS.escape(name) : name.replace(/["\\]/g, '\\$&'))}"]`);
        if (hidden && star(hidden.getAttribute('value'))) return true;
      }
      const forId = i.getAttribute('id') || '';
      for (const lab of form.querySelectorAll('label[for]')) {
        const f = lab.getAttribute('for');
        if ((f === name || f === forId) && star(lab.textContent)) return true;
      }
      return false;
    }
    const realForms = [...doc.querySelectorAll('form')].filter((f) => f.querySelector('textarea, input[type="email" i], input[name*="email" i]'));
    if (realForms.length > 1) {
      add(realForms[1], { code: 'FORM_MULTIPLE', severity: 'warning', category: 'Content', message: `${realForms.length} contact forms on this page — there should be one, on the contact page`, found: `${realForms.length} forms` });
    }
    realForms.forEach((f) => {
      f.querySelectorAll('input').forEach((i) => {
        const hay = [i.getAttribute('type'), i.getAttribute('name'), i.getAttribute('id'), i.getAttribute('placeholder'), i.getAttribute('aria-label')].join(' ').toLowerCase();
        const isPhone = /\btel\b|phone|mobile|cell/.test(hay);
        if (isPhone && !fieldRequired(f, i)) {
          add(i, { code: 'FORM_PHONE_OPTIONAL', severity: 'warning', category: 'Content', message: 'Phone field on the contact form is not required', found: i.getAttribute('placeholder') || i.getAttribute('name') || 'phone field' });
        }
      });
    });

    // --- Typefaces ---
    // Collected, not judged. What counts as "the wrong font" depends on the typefaces the WEBSITE
    // uses, and no single page knows those — runScan works them out once every page has been read.
    const fonts = fontsUsed(doc, device);

    // --- Basics that are simply present or absent ---
    // A favicon is a setting for the whole WEBSITE, not a property of one page. Duda serves the
    // mobile version as separate HTML that often leaves the link tag out, so judging page by page
    // reported "no favicon" on Mobile for a website that plainly has one. These are raised here and
    // then settled once, across every page and device, in runScan.
    const hasFavicon = !!doc.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i]');
    const hasTouchIcon = !!doc.querySelector('link[rel="apple-touch-icon" i]');
    if (!hasFavicon) add(titleEl, { code: 'FAVICON_MISSING', severity: 'warning', category: 'Meta / SEO', message: 'No favicon on this website — upload one in Duda SEO settings' });
    if (ctx.path === '/' && !hasTouchIcon) add(titleEl, { code: 'HOMESCREEN_ICON_MISSING', severity: 'info', category: 'Meta / SEO', message: 'No home screen icon (apple-touch-icon) on this website' });
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
    if (/^api|\+brief/.test(truth.source || '') || truth.source === 'brief') {
      schemas.forEach(({ node, data, biz }) => {
        const tel = data.telephone && normPhone(data.telephone);
        if (tel && tel.length >= 10 && !phoneOk(tel)) add(node, { code: 'SCHEMA_PHONE', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) phone differs from Business Info', found: data.telephone, expected: expectedPhones });
        if (data.email && !emailOk(data.email)) add(node, { code: 'SCHEMA_EMAIL', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) email differs from Business Info', found: data.email, expected: expectedEmails });
        if (biz && data.name && truth.businessName && !matchesBusiness(data.name, truth)) add(node, { code: 'SCHEMA_NAME', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) business name differs from Business Info', found: data.name, expected: truth.businessName });
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
        // This check is about a button a visitor clicks expecting to GO somewhere, and finds nothing.
        // A hamburger, the X that closes the menu, a slider arrow — those are anchors JavaScript wires
        // up, and an empty href is how Duda builds them, not a mistake. Two things separate them from
        // a real dead button: there is nothing to read on them, or what there is to read is the name
        // of a control and they live inside a menu.
        const alt = clean(Array.prototype.map.call(a.querySelectorAll('img'), (i) => i.getAttribute('alt') || '').join(' '));
        const label = text || alt || clean(a.getAttribute('aria-label') || a.getAttribute('title') || '');
        const control = !label
          // No href attribute at all: it was never a link. Duda's hamburger is exactly this —
          // <a role="button" class="hamburgerButton" dmle_widget="hamburgerButton"> wrapping an SVG.
          || raw == null
          || MENU_ISH.test(widgetName(a)) || MENU_ISH.test(cls(a))
          || a.hasAttribute('aria-expanded') || a.hasAttribute('aria-controls') || a.hasAttribute('data-toggle')
          || (CONTROL_WORD.test(label) && inMenu(a));
        if (isButton && !hasPopup && !control) add(a, { code: 'BUTTON_NO_LINK', severity: 'warning', category: 'Links', message: 'Button has no link (href is empty, # or javascript:)', found: label });
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
        // "Share this by email": no address, only a subject or message filled in. Each one is still an
        // email link that opens with nobody to send to, and the team fixes them — but they repeat on
        // every blog post, so they become ONE item listing every place (see oneItemPerSite), not one
        // item per page.
        if (!e && /[?&](subject|body)=/i.test(href)) {
          const junk = /[?&]class=/i.test(href);
          add(a, { code: 'MAILTO_SHARE_NO_TO', severity: 'critical', category: 'Contact info',
            message: 'Share-by-email button has no recipient address',
            found: href.replace(/([?&]body=)[^&]*/i, '$1…').slice(0, 160) + (junk ? '  (the link also carries "class=…", a styling setting that leaked into the address)' : '') });
          return;
        }
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
      if (!text && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])') && !isAgencyBadge(a)) add(a, { code: 'LINK_NO_TEXT', severity: 'info', category: 'Accessibility', message: 'Link has no readable text or aria-label', found: href });
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
      if (isAgencyBadge(img)) return;   // our own badge in the footer, not the client's image
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
            // The name in an embed link is a SNAPSHOT, not a lookup. Google draws the pin from the
            // place id, and the "!2s" label is whatever that place was called on the day somebody
            // generated the link — so a business that has since been renamed on Google shows its
            // current name on the map while the link still carries the old one. When the pin is
            // identified by an id AND the saved label names the client's own town, that is a rename,
            // not somebody else's shop, and calling it critical sends people chasing nothing.
            const cid = placeIdFromUrl(src);
            const towns = [].concat(...(truth.addresses || []).map((a) => [a.city, a.region])).filter((t) => t && String(t).length > 2);
            const sameTown = towns.some((t) => compact(place).includes(compact(t)));
            const madeAt = /[!&]4v(\d{10,13})/.exec(src);
            const when = madeAt ? new Date(Number(madeAt[1])) : null;
            const stamp = when && !isNaN(when) ? when.toLocaleString('en-GB', { month: 'short', year: 'numeric' }) : '';
            const saved = stamp ? ` The link was saved ${stamp}.` : '';
            const madeWhen = stamp ? ` (${stamp})` : '';
            if (!cid) {
              // Nothing but the name identifies this pin, so a name that isn't the client's really
              // does mean the map is showing somebody else.
              add(f, { code: 'MAP_OTHER_BUSINESS', severity: 'critical', category: 'Contact info', message: 'Google Map embed points to ANOTHER business', found: place, expected: truth.businessName, foreignName: place });
            } else if (sameTown) {
              // Nothing a visitor sees is wrong here: Google renders the pin and its CURRENT name
              // from the place id, and the text in the link is never shown to anybody. The pin is
              // in the client's own town, so this is a renamed listing. It is a note about tidying
              // the link, not work — which is what "info" means, and why it is not amber.
              add(f, { code: 'MAP_LABEL_OLD', severity: 'info', category: 'Contact info',
                message: 'Google Map embed link still has the listing’s old name in it — the map itself shows the right one',
                found: place, expected: truth.businessName, allowValue: place,
                snippet: `Nothing on the page is wrong: Google draws this map from a place ID and shows whatever that place is called today. The name in the link is only a label from the day the link was made${madeWhen}, it is never shown to visitors, and the pin is still in ${towns[0]}. Regenerate the embed if you want the link tidy — or mark this value correct for this website (Business Info → Add or exclude a value) and it will not come back.` });
            } else {
              // A place id decides the pin and the name is only a snapshot, so the link genuinely
              // cannot say whether this is the wrong business or the right one under an old name.
              // Saying "ANOTHER business" at critical asserts more than the page actually knows.
              add(f, { code: 'MAP_LABEL_OLD', severity: 'warning', category: 'Contact info',
                message: 'Google Map embed has a different business name saved in it — open it to check',
                found: place, expected: truth.businessName,
                snippet: `The map is pinned by a Google place ID, and the name in the link is only what that place was called when the link was made.${saved} It is either the wrong map, or the right one under a name the client has since changed on Google — the link cannot say which. Open it, and if the pin is right, regenerate the embed so the name matches.` });
            }
          }
        }
      }
    });

    return {
      notFound: false,
      findings: collapseContact(findings),
      photos: photosUsed(doc, ctx, device),
      internal: Array.from(internal),
      external: Array.from(external.keys()).map((url) => ({ url, selector: uniqueSelector(external.get(url).el), location: locationOf(external.get(url).el), hiddenBy: hiddenReason(external.get(url).el, device) || '' })),
      images: Array.from(images.keys()).map((url) => ({ url, selector: uniqueSelector(images.get(url).el), location: locationOf(images.get(url).el), hiddenBy: hiddenReason(images.get(url).el, device) || '' })),
      alts: altList,
      textIndex: textIndex.map((x) => ({ text: x.text, selector: uniqueSelector(x.el), location: locationOf(x.el), hiddenBy: hiddenReason(x.el, device) || '' })),
      fonts,
      meta: { title, description: desc, h1: h1s.map((h) => clean(h.textContent)), favicon: hasFavicon, touchIcon: hasTouchIcon },
      schema: schemas.map((s) => s.data),
    };
  }

  function normalizePath(p) {
    p = safeDecode(String(p || '/')).split('?')[0].split('#')[0];
    p = '/' + p.replace(/^\/+/, '').replace(/\/+$/, '');
    return p === '/home' ? '/' : p;
  }


  // ---------- the business name, written differently ----------
  /**
   * Every place the text spells the business name differently from Business Info:
   * "Buff & Beyond" or "Buff and Beyond" where Business Info says "Buff&Beyond", "buff&beyond",
   * "Buff&Beyon". Each spelling is compared with the official one, letter for letter, rather than
   * judged loosely, so a reader sees exactly what differs.
   *
   * Not counted: the official spelling itself or another name Business Info carries, the same name in
   * capitals (usually a heading), curly vs straight apostrophes, a possessive ("Buff&Beyond's"),
   * and anything inside a web address or an email address.
   * A one-letter typo is only considered for names of 8+ letters, written with a capital, so
   * ordinary words that happen to be close are not flagged.
   */
  function lev1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  const nameSkel = (s) => String(s || '').toLowerCase().replace(/[’'`]s\b/g, '').replace(/\s*[&+]\s*/g, ' and ').replace(/[^a-z0-9]/g, '');
  const quoteNorm = (s) => String(s || '').replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim();
  function nameVariants(textIdx, truth) {
    const official = quoteNorm(truth && truth.businessName);
    if (!official) return [];
    const target = nameSkel(official);
    if (target.length < 5) return [];
    const okForms = new Set([official].concat((truth.names || []).map(quoteNorm)).filter(Boolean));
    const nWords = official.split(/[\s&+]+/).filter(Boolean).length;
    const maxW = Math.min(8, nWords * 2 + 1);
    const out = [];
    (textIdx || []).forEach((x) => {
      const toks = String(x.text || '').split(/\s+/).filter(Boolean);
      const seen = new Set();
      for (let i = 0; i < toks.length; i++) {
        for (let w = 1; w <= maxW && i + w <= toks.length; w++) {
          const raw = toks.slice(i, i + w).join(' ');
          if (/[@/\\]|\.[a-z]{2,}\b/i.test(raw)) continue;          // a web or email address
          let surf = quoteNorm(raw).replace(/^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$/g, '').replace(/'s$/i, '');
          if (!surf) continue;
          const k = nameSkel(surf);
          if (!k || k[0] !== target[0]) continue;
          let typo = false;
          if (k !== target) {
            if (target.length < 8 || !/^[A-Z]/.test(surf) || !lev1(k, target)) continue;
            typo = true;
          }
          if (okForms.has(surf)) continue;
          // Capitals alone: "BUFF&BEYOND" in a heading is styling. For a name of two or more words,
          // "Joe's auto care" in a sentence is ordinary writing, not a different name, so only a
          // one-word name ("buff&beyond") counts a change of capitals as a different spelling.
          const caseOnly = [...okForms].some((o) => o.toLowerCase() === surf.toLowerCase());
          if (caseOnly && (surf === surf.toUpperCase() || official.split(/\s+/).length >= 2)) continue;
          // A longer window that merely contains the official spelling ("Buff&Beyond LLC") is not a variant.
          if ([...okForms].some((o) => surf.includes(o))) continue;
          if (seen.has(surf)) continue;
          seen.add(surf);
          out.push({
            code: 'NAME_SPELLING', severity: 'warning', category: 'Business name',
            message: typo ? 'Business name looks misspelled' : 'Business name is written differently from Business Info',
            found: surf, expected: official, spelling: typo ? 'typo' : 'format',
            path: x.path, device: x.device, selector: x.selector, location: x.location,
            visible: !x.hiddenBy, hiddenBy: x.hiddenBy, snippet: cut(x.text, 120),
          });
        }
      }
    });
    return out;
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
    name: ['TEXT_OTHER_BUSINESS', 'COPYRIGHT_NAME', 'SCHEMA_NAME', 'MAP_OTHER_BUSINESS', 'MAP_LABEL_OLD', 'NAME_SPELLING'],
    font: ['FONT_OFF_SYSTEM', 'FONT_OFF_SYSTEM_MORE', 'FONT_NOT_LOADED', 'FONT_SOURCE_ODD'],
    image: ['IMAGE_DUPLICATE'],
  };
  /** Normalised key for an approved value, e.g. "email:sales@x.com", "phone:2625550147", "social:facebook:joesdetail", "name:joesdetailing". */
  function allowKey(type, value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (type === 'email') { const m = v.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/); return m ? 'email:' + m[0] : ''; }
    if (type === 'phone') { const d = normPhone(v); return d.length >= 10 ? 'phone:' + d.slice(-10) : ''; }
    if (type === 'social') { const net = socialNetOf(/^https?:/i.test(v) ? v : 'https://' + v.replace(/^\/+/, '')); const h = net ? compact(socialHandle(net, v)) : compact(v); return h ? 'social:' + (net || 'any') + ':' + h : ''; }
    if (type === 'name') { const c = compact(v); return c.length >= 3 ? 'name:' + c : ''; }
    if (type === 'font') { const c = fontBase(v).toLowerCase().replace(/\s+/g, ' ').trim(); return c ? 'font:' + c : ''; }
    // A picture may be approved by its full address or just by its file name, because that is what
    // somebody reads off the audit item and types in.
    if (type === 'image') { const c = /^https?:/i.test(v) ? imageKey(v) : v.toLowerCase().trim(); return c ? 'image:' + c : ''; }
    return '';
  }
  /** Which value of a finding could be approved as correct for the website: { type, value, key } or null. */
  function allowValueOf(f) {
    if (!f) return null;
    if (/^FONT_/.test(f.code || '')) { const fam = fontOf(f); const key = allowKey('font', fam); return key ? { type: 'font', value: fam, key } : null; }
    // A duplicate-photo item names several files, so it says outright which one to approve rather
    // than leaving "hero.png · hero-2.png" to be parsed back out of the message.
    if (f.code === 'IMAGE_DUPLICATE') { const v = f.allowValue || String(f.found || '').split(' · ')[0]; const key = allowKey('image', v); return key ? { type: 'image', value: v, key } : null; }
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
  /** The typeface a font finding is about, taken from the way the finding words itself. */
  function fontOf(f) {
    if (!f || !/^FONT_/.test(f.code || '')) return '';
    let m = /(?:in|places in) ([^,]+?), which is not one of/.exec(f.message || '');
    if (m) return m[1].trim();
    m = /^"([^"]+)"/.exec(f.message || '');
    if (m) return m[1].trim();
    m = /are in ([^ ]+(?: [^ ]+)?) as well/.exec(f.message || '');
    return m ? m[1].trim() : '';
  }
  /** Drop findings whose value was approved for this website. */
  function filterAllowed(findings, allow) {
    if (!allow || !allow.length) return findings;
    // Only the "correct for this website" side silences anything. The other side — a value Duda
    // carries that must NOT appear on the client's website — is handled by striking it out of the
    // reference before the scan, so the ordinary checks catch it by themselves.
    const keys = new Set(allow.filter((a) => a.mode !== 'deny').map((a) => a.key));
    return findings.filter((f) => { const a = allowValueOf(f); return !(a && keys.has(a.key)); });
  }

  /**
   * Business Info as this website should actually be judged against.
   *
   * Duda's copy is never edited — it is what Duda says, and the app must not quietly show something
   * else. What a team CAN do is strike a value out: an agency's own email sitting in a client's
   * Business Info is truth as far as Duda is concerned, and a bug if it turns up on the website.
   * Those are removed here, at scan time only, so the reference on screen stays Duda's.
   */
  function truthWithout(truth, allow) {
    const deny = (allow || []).filter((a) => a.mode === 'deny');
    if (!deny.length || !truth) return truth;
    const has = (type, value) => deny.some((a) => a.type === type && a.key === allowKey(type, value));
    const t = Object.assign({}, truth);
    t.emails = (truth.emails || []).filter((e) => !has('email', e));
    t.phones = (truth.phones || []).filter((p) => !has('phone', p));
    t.names = (truth.names || []).filter((n) => !has('name', n));
    if (t.names.length && !t.names.some((n) => n === truth.businessName)) t.businessName = t.names[0];
    t.socials = {}; t.socialLinks = {};
    Object.keys(truth.socials || {}).forEach((net) => {
      const keep = [];
      const links = [];
      (truth.socials[net] || []).forEach((h, i) => {
        const link = (truth.socialLinks || {})[net] ? truth.socialLinks[net][i] : '';
        if (has('social', link || h)) return;
        keep.push(h); links.push(link);
      });
      if (keep.length) { t.socials[net] = keep; t.socialLinks[net] = links; }
    });
    return t;
  }

  /** Typefaces a team has said are fine on this website, however far off the design they look. */
  const allowedFonts = (allow) => new Set((allow || []).filter((a) => a.type === 'font' && a.mode !== 'deny').map((a) => fontBase(a.value).toLowerCase()));
  /** Pictures the team has said are meant to repeat here — by address or by file name. */
  const allowedImages = (allow) => new Set((allow || []).filter((a) => a.type === 'image' && a.mode !== 'deny')
    .map((a) => allowKey('image', a.value)).filter(Boolean));
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


  /**
   * Some problems are one decision repeated on many pages: a share-by-email button on every blog
   * post, each with its own page address in it. One item per place buries the list in copies, so
   * these become ONE item per website that lists every place (like a repeated photo does), each with
   * its own Show on page. Its ID depends only on the check, so it keeps its number while places are
   * fixed one by one, and closes when the last one is gone.
   */
  const ONE_ITEM = {
    MAILTO_SHARE_NO_TO: (n) => `Share-by-email button has no recipient address — ${n} place${n === 1 ? '' : 's'}`,
  };
  function oneItemPerSite(list) {
    const out = []; const groups = {};
    list.forEach((f) => { if (ONE_ITEM[f.code]) (groups[f.code] = groups[f.code] || []).push(f); else out.push(f); });
    Object.entries(groups).forEach(([code, items]) => {
      const places = [];
      items.forEach((f) => {
        const paths = f.pages && f.pages.length ? f.pages : [f.path];
        const key = f.selector;
        const had = places.find((x) => x.selector === key);
        if (had) { paths.forEach((p) => { if (!had.paths.includes(p)) had.paths.push(p); }); (f.visibleOn || []).forEach((d) => { if (!had.devices.includes(d)) had.devices.push(d); }); return; }
        places.push({ selector: f.selector, location: f.location, how: 'link', paths: paths.slice(), devices: (f.visibleOn || []).slice() });
      });
      const n = places.reduce((a, x) => a + x.paths.length, 0);
      const first = items[0];
      const pages = [...new Set(places.flatMap((x) => x.paths))].sort();
      const g = Object.assign({}, first, {
        message: ONE_ITEM[code](n),
        found: first.found,
        path: pages[0], pages,
        devices: [...new Set(items.flatMap((f) => f.devices || []))],
        visibleOn: [...new Set(items.flatMap((f) => f.visibleOn || []))],
        hiddenOn: [...new Set(items.flatMap((f) => f.hiddenOn || []))],
        dupPlaces: places.slice(0, 60).map((x) => Object.assign(x, { paths: x.paths.sort().slice(0, 40) })),
        placesKind: 'link',
        snippet: `${n} place${n === 1 ? '' : 's'} on ${pages.length} page${pages.length === 1 ? '' : 's'}`,
      });
      g.id = hash([code, 'one-item-per-site'].join('|'));
      out.push(g);
    });
    return out;
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
  function buildFontSystem(rows, loaded, theme, allowed) {
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
    const set = new Set(THEME_TAGS.map((t) => roles[t]).filter(Boolean).map(fontBase));
    const heading = fontBase(roles.h1 || roles.h2 || '');
    const body = fontBase(roles.body || roles.p || '');
    // A typeface the team has said is fine here is fine here, whatever the design settings say — a
    // designer choosing something deliberately for one banner should not argue with the app forever.
    const okd = allowed || new Set();
    // One card per typeface, with the weights it turned up in. Four cards for one font that happens
    // to be self-hosted a weight at a time is a hundred audit items nobody can act on.
    const fam = new Map();
    [...countBy(rows).entries()].forEach(([name, n]) => {
      const base = fontBase(name) || name;
      const src = loaded.get(name.toLowerCase());
      const e = fam.get(base) || { name: base, n: 0, weights: [], loaded: false, src: '' };
      e.n += n;
      const w = fontWeight(name);
      if (w && !e.weights.includes(w)) e.weights.push(w);
      if (src && !e.loaded) { e.loaded = true; e.src = src.src || ''; }
      fam.set(base, e);
    });
    const all = [...fam.values()].sort((a, b) => b.n - a.n)
      .map((e) => Object.assign(e, { theme: set.has(e.name), approved: okd.has(e.name.toLowerCase()) }));
    const judge = new Set([...set, ...all.filter((f) => f.approved).map((f) => f.name)]);
    return { roles, fonts: set, judgeFonts: judge, heading, body, all, fromTheme, pages: new Set(rows.map((r) => r.path)).size };
  }

  /**
   * Text that isn't in one of the website's fonts — one audit item per piece of text, so it can be
   * found and fixed, rather than a count of fonts nobody can act on.
   */
  /**
   * The block a selector sits in. Duda gives every widget an id, so a selector like
   * `[id="1768548719"] > ul > li:nth-of-type(2) > a` belongs to the widget `[id="1768548719"]`:
   * one menu, one banner, one section. Without an id there is nothing to group by, so the element
   * stands on its own.
   */
  function blockOf(selector) {
    const m = /^(\[id="[^"]+"\])/.exec(String(selector || ''));
    return m ? m[1] : String(selector || '');
  }

  function fontFindings(rows, loaded, sys) {
    const out = [];
    if (rows.length < 8 || !sys.fonts.size) return out;
    const push = (r, f) => out.push(Object.assign({
      path: r.path, device: r.device, selector: r.selector, location: r.location,
      visible: !r.hiddenBy, hiddenBy: r.hiddenBy || '', snippet: r.text, category: 'Design',
    }, f));
    // What this piece of text should have been in, said the way a designer would say it.
    const wanted = (r) => {
      const t = /^h[1-6]$/.test(r.tag) ? fontBase(sys.roles[r.tag] || '') : '';
      return t || (r.role === 'titles' ? sys.heading : sys.body) || sys.heading || sys.body;
    };
    const setList = [...sys.fonts];

    // One group per part-of-the-page + off-theme typeface, so the count is honest and the cap is per slip.
    const groups = new Map();
    const ok = sys.judgeFonts || sys.fonts;
    rows.forEach((r) => { const base = fontBase(r.fam) || r.fam; if (ok.has(base)) return; const key = r.role + '|' + base; (groups.get(key) || groups.set(key, []).get(key)).push(r); });
    [...groups.entries()].forEach(([key, list]) => {
      const [role, fam] = key.split('|');
      const want = wanted(list[0]);
      const where = want ? `the website's ${ROLE_PHRASE[role] || 'text is'} set in ${want}`
        : `the website uses ${setList.slice(0, 2).join(' and ')}`;
      // Six links in one menu is one thing to fix, not six audit items. Rows are gathered by the
      // element they live in — in Duda that is the widget, the [id="…"] the selector starts with —
      // and become a single item that names every piece of text inside it. A header or footer
      // repeats on every page and on three devices; those rows are kept and grouped later into one
      // item listing its pages.
      const byBlock = new Map();
      list.forEach((r) => {
        const k = [blockOf(r.selector), r.path, r.device].join('|');
        (byBlock.get(k) || byBlock.set(k, []).get(k)).push(r);
      });
      // Cap on how many distinct blocks are listed, not how many rows: the same menu on 14 pages
      // and 3 devices is one slip, and it should not eat the whole allowance.
      const blocks = [...new Set([...byBlock.keys()].map((k) => k.split('|')[0]))];
      const shown = new Set(blocks.slice(0, FONT_ITEM_CAP));
      byBlock.forEach((rs, k) => {
        const block = k.split('|')[0];
        if (!shown.has(block)) return;
        const texts = [...new Set(rs.map((x) => x.text))];
        const one = rs[0];
        const many = texts.length > 1;
        push(Object.assign({}, one, { selector: block || one.selector, location: rs[0].location }), {
          code: 'FONT_OFF_SYSTEM', severity: 'warning',
          message: many
            ? `${texts.length} ${ROLE_PLURAL[role] || 'places'} in ${fam}, which is not one of the website's fonts — ${where}`
            : `${ROLE_LABEL[role]} in ${fam}, which is not one of the website's fonts — ${where}`,
          found: texts.slice(0, 8).join(' · ') + (texts.length > 8 ? ` · …and ${texts.length - 8} more` : ''),
          expected: want || setList.join(' / '),
        });
      });
      if (blocks.length > FONT_ITEM_CAP) push(byBlock.get([...byBlock.keys()].find((k) => k.split('|')[0] === blocks[FONT_ITEM_CAP]))[0], {
        code: 'FONT_OFF_SYSTEM_MORE', severity: 'info',
        message: `${blocks.length - FONT_ITEM_CAP} more places on the website are in ${fam} as well — the first ${FONT_ITEM_CAP} are listed separately`,
        found: `${blocks.length} places in total`, expected: want || setList.join(' / '),
      });
    });

    // A typeface the website asks for but never loads: visitors without it see something else.
    const firstWith = (fam) => rows.find((r) => (fontBase(r.fam) || r.fam) === fam);
    if (loaded.size) {
      sys.all.filter((f) => !f.loaded && !f.approved).forEach((f) => {
        const r = firstWith(f.name); if (!r) return;
        push(r, { code: 'FONT_NOT_LOADED', severity: 'info', message: `"${f.name}" is used but the website never loads it — visitors without it installed see a different typeface`, found: `${f.name}, ${f.n} place${f.n === 1 ? '' : 's'}`, expected: 'a loaded typeface' });
      });
    }
    // …and one loaded from somewhere unexpected: the rule is Google Fonts or Envato.
    sys.all.forEach((f) => {
      const src = f.src;
      if (f.approved) return;
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
    // A favicon and a home screen icon are website-wide settings in Duda, not page settings —
    // but Duda serves the mobile HTML separately and often leaves the <link> out of it. So we
    // remember whether ANY page on ANY device carried one, and judge the website once (below).
    const siteIcon = { favicon: false, touchIcon: false };
    const pageInfo = {};
    const external = new Map();
    const images = new Map();
    const photoRows = [];
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
          if (r.meta.favicon) siteIcon.favicon = true;
          if (r.meta.touchIcon) siteIcon.touchIcon = true;
          info.devices = (info.devices || []).concat(device);
          r.findings.forEach((f) => raw.push(f));
          r.internal.forEach((p) => { if (!queued.has(p)) enqueue(p, path); (pageInfo[p] || {}).linkedFrom = (pageInfo[p] || {}).linkedFrom || { path, device }; });
          r.external.forEach((x) => { if (!external.has(x.url)) external.set(x.url, Object.assign({ path, device }, x)); });
          r.images.forEach((x) => { if (!images.has(x.url)) images.set(x.url, Object.assign({ path, device }, x)); });
          // Every occurrence, not one per address: counting how many places use a photo is the point.
          // Desktop only — the same hero read three times over is one place, not three.
          if (device === devices[0] && photoRows.length < 3000) (r.photos || []).forEach((x) => photoRows.push(Object.assign({ path, device }, x)));
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

    // The business name spelled some other way
    nameVariants(textIdx, truth).forEach((f) => raw.push(f));

    // The website's typefaces, and the text that doesn't use them
    let fontSys = null;
    if (fontRows.length) {
      fontSys = buildFontSystem(fontRows, fontLoaded, fontTheme, allowedFonts(opts.allow));
      fontFindings(fontRows, fontLoaded, fontSys).forEach((f) => raw.push(f));
    }

    // The same photograph in more than one place. Patterns, icons and logos are measured and set
    // aside rather than guessed at — see graphicReason.
    let photoSys = null;
    if (photoRows.length && opts.imageHashes) {
      try {
        const byKey = await fingerprintPhotos(photoRows, opts);
        duplicatePhotoFindings(byKey, allowedImages(opts.allow)).forEach((f) => raw.push(f));
        photoSys = {
          total: byKey.size,
          photos: [...byKey.values()].filter((e) => !e.why && e.m).length,
          skipped: [...byKey.values()].filter((e) => e.why).map((e) => ({ url: e.url, why: e.why, n: e.places.length })).slice(0, 60),
        };
      } catch (e) { log.push('Picture fingerprinting failed: ' + e); }
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

    // Judge the two website-wide icons once. If anything anywhere carried one, the setting is
    // there and every row goes; if nothing did, one row for the whole website is enough.
    const siteWide = [['FAVICON_MISSING', 'favicon'], ['HOMESCREEN_ICON_MISSING', 'touchIcon']];
    siteWide.forEach(([code, flag]) => {
      let keep = siteIcon[flag] ? -1 : raw.findIndex((f) => f.code === code && f.device === devices[0] && f.path === '/');
      if (!siteIcon[flag] && keep < 0) keep = raw.findIndex((f) => f.code === code);
      for (let i = raw.length - 1; i >= 0; i--) if (raw[i].code === code && i !== keep) raw.splice(i, 1);
    });

    const merged = sortFindings(oneItemPerSite(groupAcrossPages(mergeDevices(raw))));
    const counts = { critical: 0, outdated: 0, warning: 0, info: 0 };
    merged.forEach((f) => { counts[f.severity]++; });
    return {
      truth,
      checks: CHECKS_VERSION,
      fonts: fontSys ? { roles: fontSys.roles, fromTheme: fontSys.fromTheme, all: fontSys.all.slice(0, 14) } : null,
      photos: photoSys,
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
  /**
   * A page whose own address names a place IS about that place.
   *
   * "/auto-detailing-located-in-aberdeen" is a location landing page somebody built on purpose, so
   * the words "Aberdeen, Scotland" in its title, its headings and its alt text are the point of the
   * page, not a mistake. The URL is the strongest statement of intent a page makes, and reading it
   * is what stops a whole set of location pages coming back as critical.
   *
   * Only ever silences a LOCATION verdict. A page called /detailing-in-elgin that names a different
   * town, and anything about another business, is still reported.
   */
  const PLACE_STOP = new Set(('in at on near located location locations serving service area areas around the and of for our us your ' +
    'page home index best top new all more info about contact services').split(' '));
  function placeWordsInPath(path) {
    return String(path || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !GENERIC.has(w) && !PLACE_STOP.has(w));
  }
  function pathNamesPlace(paths, text, truth) {
    const hay = compact(text);
    if (!hay) return false;
    // A word that is part of the business's own name proves nothing about place.
    const own = compact([(truth && truth.businessName) || '', ...((truth && truth.names) || [])].join(' '));
    return [].concat(paths || []).some((p) => placeWordsInPath(p).some((w) => {
      const c = compact(w);
      return c.length >= 4 && !own.includes(c) && hay.includes(c);
    }));
  }

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
      if (v.verdict === 'wrong_location' && pathNamesPlace(a.pages, a.alt, truth)) return;
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
      // Matched against the flagged WORDS only — not the model's commentary, and not the whole page.
      // A location page can still wrongly claim a different town somewhere in its copy, and that
      // has to keep coming through.
      if (v.type === 'wrong_location' && pathNamesPlace(blk.pages, v.quote || blk.text || '', truth)) return;
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
    DEVICES, DEVICE_LABEL, CHECKS_VERSION, CHECK_RELEASES, checksSince, fixedSince,
    buildTruth, auditDocument, runScan, extractSchema, mergeDevices, groupAcrossPages, buildFontSystem, fontFindings,
    matchesBusiness, normPhone, fmtPhone, uniqueSelector, truthWithout, allowedFonts, allowedImages, imageKey, measureImage, graphicReason, hamming, duplicatePhotoFindings, fingerprintPhotos, fontOf, fontBase, fontWeight, hiddenReason, placeNameFromUrl, placeIdFromUrl, socialHandle, isShareLink, isThankYouPath, textRisk, nameVariants, allowKey, allowValueOf, filterAllowed, socialUrl, toCSV, fingerprint, hash, normalizePath, applyAltVerdicts, applyTextIssues,
  };
})(typeof window !== 'undefined' ? window : globalThis);
