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
    {
      v: 21,
      date: '2026-10-14',
      title: 'Proofreading, and buttons that open the wrong page (AI)',
      items: [
        'Spelling mistakes and clear grammar errors in the page text, titles and meta descriptions, each with the exact words and the correction',
        'Unfinished copy: a sentence that stops mid-thought, or template text never filled in ("Add your text here", "[City]")',
        'Buttons and links that open a different page from the one they promise: "Contact us" opening the home page, "Read more" under Ceramic Coating opening the window tint page. A lead button (contact, quote, book, call) doing this is critical',
      ],
    },
    {
      v: 22,
      date: '2026-10-14',
      title: 'Proofreading reads whole paragraphs, links included',
      fixes: ['TEXT_INCOMPLETE', 'TEXT_GRAMMAR'],
      fixedWhat: 'Proofreading was given text in pieces split wherever a link started, so "This includes hydrophobic paint enhancements with our" (followed by a link to ceramic coatings) looked like an unfinished sentence. It now reads each paragraph whole, links included.',
      items: [
        'Each paragraph, heading and list item is proofread whole, with the words of its links in place',
        '"Unfinished" and grammar items raised from a split piece of a sentence close themselves on the next rescan, as the app\'s mistake',
      ],
    },
    {
      v: 23,
      date: '2026-10-14',
      title: 'Grammar flags are double-checked before they become audit items',
      fixes: ['TEXT_GRAMMAR', 'TEXT_INCOMPLETE'],
      fixedWhat: 'Proofreading called some correct sentences grammar mistakes and "suggested" a rewrite (for example "it is easy to end up with trapped air bubbles, an improper fit…" is correct English). Grammar and unfinished-text flags are now read a second time by a stricter reviewer, and a suggestion that rewrites the words instead of fixing one or two of them is dropped.',
      items: [
        'Only objective grammar mistakes are raised (your/you\u2019re, its/it\u2019s, a verb that does not agree with its own subject, a missing or doubled word), each with the smallest fix',
        'Every grammar and unfinished-text flag is double-checked by a second, stricter read before it becomes an audit item',
        'Grammar and unfinished items from earlier scans close themselves on the next rescan, as the app\u2019s mistake, unless they are confirmed again',
      ],
    },
    {
      v: 24,
      date: '2026-10-14',
      title: 'A widget\u2019s own hidden template is no longer reported as placeholder text',
      fixes: ['PLACEHOLDER', 'TEXT_INCOMPLETE', 'TEXT_SPELLING', 'TEXT_GRAMMAR', 'REPEATED_WORD'],
      fixedWhat: 'Duda\u2019s newer widgets are sent with a hidden blank template inside them (the accordion\u2019s "Title or Question" item, copied when somebody clicks Add Item). Duda\u2019s scripts replace it when the page loads, it is not in the editor, and no visitor or crawler that runs the page sees it, but scans read the page before its scripts run, so it was reported as placeholder text.',
      items: [
        'Wording checks (placeholder, spelling, grammar, unfinished text) leave out a Duda widget\u2019s own hidden template',
        'Items raised from it close themselves on the next rescan, as the app\u2019s mistake',
      ],
    },
    {
      v: 25,
      date: '2026-10-14',
      title: 'Hidden content that Google and SEO tools still read',
      items: [
        'Web designer credits ("Website by …", "Designed by …") naming anyone other than our own agencies, and above all ones hidden from visitors, which is critical: Google and SEO tools such as Ahrefs and Semrush still read hidden text',
        'Links to other websites hidden from visitors (display: none, visibility: hidden, the hidden attribute): search engines and SEO tools still follow them',
        'A page whose H1 heading exists but is hidden on a device is now said plainly ("the H1 is hidden on Desktop") instead of "no H1"',
        'Text hidden in the page\u2019s styles is still checked and labelled "Hidden on the page", so nothing hidden escapes the audit; only a widget\u2019s own blank template, which Duda\u2019s scripts replace and which is not in the editor, is left out',
      ],
    },
    {
      v: 26,
      date: '2026-10-14',
      title: 'Spelling, punctuation and spacing in titles, descriptions and alt text',
      items: [
        'Alt text is proofread too (spelling, punctuation), along with the SEO title and meta description, and each item says which one it is in',
        'Punctuation mistakes: sentences that run together, doubled marks ("today!!"), a stray mark ("car ."), a missing closing bracket or quote',
        'Spacing slips in the SEO title, meta description and alt text: two spaces in a row, a space before a comma, no space after one ("Schaumburg,IL")',
      ],
    },
    {
      v: 27,
      scope: { adds: ['PAGE_TOPIC_MISMATCH', 'PAGE_TOPIC_BODY', 'PAGE_WRONG_CITY', 'PAGE_WRONG_CITY_BODY', 'AI_PAGE_CITY', 'AI_PAGE_TOPIC', 'NAME_SPELLING', 'PLACEHOLDER', 'META_TITLE_NO_NAME'], ai: true },
      date: '2026-11-10',
      title: 'Every page is read against its address: service, town, business name and notes left in',
      items: [
        'Wrong service: a page whose address is one service (/ceramic-coating) but whose SEO title, H1, meta description or copy is about another (paint protection film). Critical when the title, H1 or description is wrong',
        'Wrong town: on a town\u2019s page (/locations/temple-tx/\u2026), a title, H1 or meta description naming another of the website\u2019s towns (\u201cCopperas Cove\u2019s top provider\u201d) and not its own. Critical. Copy that names another town more than its own is raised too',
        'The AI reads every page against its address as well (service, town, business name, notes left in) and catches what the rules can\u2019t word for word',
        'Business name: a one-letter slip such as \u201cCoating\u201d for \u201cCoatings\u201d is raised even when Business Info carries both spellings, and is critical in an H1 or SEO title. SEO titles are checked for the name too',
        'Notes left in the copy: \u201c[Matthew: confirm this is free before publishing.]\u201d, \u201c\u2026 before publishing\u201d, \u201cnote to client\u201d, \u201cinsert \u2026 here\u201d, and Duda\u2019s own default labels (a button that just says \u201cButton\u201d)',
      ],
    },
    {
      v: 28,
      scope: { adds: ['META_LOOKALIKE_CHAR'] },
      date: '2026-11-12',
      title: 'Look-alike characters in SEO titles and meta descriptions',
      items: [
        'A character that looks like the keyboard pipe "|" but is not (the box-drawing "\u2502" from copy and paste or AI-written text, the full-width "\uff5c" and others) in an SEO title or meta description. Screen readers read it differently, find and replace misses it, and Google is more likely to rewrite the title',
        'En dashes, em dashes and other look-alike dashes used as a separator in an SEO title (" \u2013 ", " \u2014 "): the separator is the keyboard pipe "|"',
        'Invisible characters (zero-width space, soft hyphen, byte-order mark) in an SEO title or meta description',
        'Each item names the character and its code, and gives the title back with plain pipes to paste in',
      ],
    },
    {
      v: 29,
      scope: { adds: ['CONTRAST_'], contrast: true },
      date: '2026-11-12',
      title: 'Colour contrast (WCAG AA), measured on a picture of every page',
      items: [
        'Text, button and link text that is hard to read against what is behind it: 4.5:1 for normal text, 3:1 for large text (24px, or 18.66px bold)',
        'Text over a photo, a gradient, a video or an overlay layer is measured against the picture itself, whichever element the background belongs to (a wrapper with no background inside a section with a photo is measured against the photo)',
        'Forms: placeholder text (4.5:1), the text a visitor types (each field is typed into), and whether each field\u2019s border or fill stands out from what is around it (3:1)',
        'Checked on desktop and mobile; each item shows both colours and the ratio',
      ],
    },
    {
      v: 30,
      scope: { fixes: ['TEXT_OTHER_BUSINESS', 'SOCIAL_OTHER_BUSINESS', 'SOCIAL_MISMATCH'], ai: true },
      date: '2026-11-16',
      title: 'Fewer false "not theirs": video links, and text cut where a link starts',
      items: [
        'The AI business-name check reads each piece of text with its whole paragraph: "our team at" followed by the link "86 Auto Lab" is not another business, and a quote with no name in it is never "names a different business"',
        'A link to a YouTube video (watch, youtu.be, Shorts, embed, live), a Facebook video or an Instagram post names no account, so it is not called "a link to an account that is not theirs" any more',
        'The auto audit asks YouTube whose channel each video is on: their own channel (Business Info\'s YouTube, or their business name) is fine; another channel is a warning that names it',
      ],
    },
    {
      v: 31,
      scope: { fixes: ['MAP_ADDRESS', 'MAP_OTHER_BUSINESS'] },
      date: '2026-11-16',
      title: 'Google Map embeds of a business whose name starts with a number',
      items: [
        'A map labelled "86 Auto Lab Franklin…" was read as the street address "86 …" and called "Google Map embed shows a different address". A label is only an address when it reads like one (a street word, or ", TN"), and one that names the business is fine',
      ],
    },
    {
      v: 32,
      scope: { fixes: ['PLACEHOLDER'] },
      date: '2026-11-17',
      title: 'A hidden "Button" is not a default label left on the page',
      items: [
        'A "Button" hidden with display:none is no longer reported as Duda\u2019s default label left on the page. A photo gallery with captions switched off keeps one for each picture in its code, and visitors never see it',
        'A visible "Button", and every other default label ("Heading", "Caption"…), is still critical',
      ],
    },
    {
      v: 33,
      scope: { fixes: ['AI_PAGE_CITY', 'PAGE_WRONG_CITY', 'PAGE_WRONG_CITY_BODY'], ai: true },
      date: '2026-11-17',
      title: 'A page for a town is about that town, wherever the shop is',
      items: [
        'A page whose address names a town (/brentwood-window-tinting) is no longer told by the AI that its heading should name the town the shop is in ("…in Brentwood, TN" is right on that page, even for a shop in Franklin)',
        'The AI is told which town each page\u2019s address is for, also when the address has no state (/brentwood-window-tinting, not only /locations/brentwood-tn)',
        'A page that names a DIFFERENT town from its address is still reported',
      ],
    },
    {
      v: 34,
      scope: { fixes: ['AI_PAGE_CITY', 'PAGE_WRONG_CITY', 'PAGE_WRONG_CITY_BODY'], ai: true },
      date: '2026-11-17',
      title: 'Pages with no town in their address may name the shop\u2019s town',
      items: [
        'A page whose address names no town (/paint-protection-film) may name the town in Business Info ("Franklin, TN\u2019s top choice for PPF"): the AI page check no longer calls that "a different town"',
        'A page whose address names a town is still checked against that town: a /brentwood-window-tinting page that says Franklin is still reported',
      ],
    },
    {
      v: 35,
      scope: { fixes: ['LINK_WRONG_PAGE'], ai: true },
      date: '2026-11-17',
      title: 'A link on a service word that opens that service\u2019s page is right',
      items: [
        'A link on "PPF" (or "ceramic coating", "window tint"…) inside a paragraph, opening that service\u2019s page, is no longer called "Link opens the wrong page", whatever page it sits on',
        'The AI\u2019s answer "should open the page it is already on" is never used: that is not a fix for a link',
      ],
    },
    {
      v: 36,
      scope: { fixes: ['PLACEHOLDER'] },
      date: '2026-11-19',
      title: 'A "Button" hidden any way is not a label left on the page',
      items: [
        'A gallery caption\u2019s "Button" hidden with visibility:hidden (not only display:none) is no longer reported: visitors never see it and screen readers skip it',
        'Blog posts are recognised from the page itself, so "Show in editor" opens them where the editor keeps them (/blog/<post>)',
      ],
    },
    {
      v: 37,
      date: '2026-11-19',
      title: 'robots.txt, sitemap.xml and llms.txt (Technical SEO)',
      scope: { adds: ['ROBOTS_', 'SITEMAP_', 'LLMS_', 'EMAIL_AUTOMATION'], files: true },
      items: [
        'robots.txt: missing, blocking every search engine or Google ("Disallow: /"), no Sitemap line, a sitemap on another website, and AI assistants (ChatGPT, Claude, Perplexity, Google\u2019s AI) kept out',
        'sitemap.xml: missing, empty (the whole website set to no index), or listing addresses on another website',
        'llms.txt (the summary AI assistants read): missing, not in the llms.txt format, not naming the business, or giving a phone or email that is not in Business Info',
        'Read from the published website, so only once it is published',
      ],
    },
    {
      v: 38,
      date: '2026-11-19',
      title: 'Structured data (schema) checked the way Google reads it',
      scope: { adds: ['SCHEMA_INVALID_JSON', 'SCHEMA_NO_TYPE', 'SCHEMA_NO_CONTEXT', 'SCHEMA_MULTI_BUSINESS', 'SCHEMA_REQUIRED', 'SCHEMA_RECOMMENDED', 'SCHEMA_TYPE_GENERIC', 'SCHEMA_RATING', 'SCHEMA_SELF_REVIEW', 'SCHEMA_URL', 'SCHEMA_FAQ_EMPTY'] },
      items: [
        'Every page: JSON-LD that is not valid JSON (Google ignores it), blocks with no @type or no schema.org @context, and several business blocks naming different businesses',
        'The business block: Google\u2019s required properties (name, full address) and the recommended ones (phone, website, hours, map position, image, price range); a plain "LocalBusiness" for an auto shop (AutoRepair, AutoBodyShop\u2026 are more exact); a website address that is not theirs',
        'Review stars: an incomplete rating, and a business rating on its own website (Google does not show it as stars)',
        'FAQ structured data with no complete question and answer',
      ],
    },
    {
      v: 39,
      date: '2026-11-19',
      title: 'Automation email addresses are never shown to customers',
      scope: { adds: ['EMAIL_AUTOMATION'] },
      items: [
        'An address that is in Business Info for automation (iyz\u2026@robot.zapier.com, a form parser, "no-reply") is no longer expected on the website, and is a critical item wherever it is shown: page text, an email link, the structured data or llms.txt',
      ],
    },
    {
      v: 40,
      date: '2026-11-19',
      title: 'A "Button" hidden by the page\u2019s stylesheet is not a label left on the page',
      fixes: ['PLACEHOLDER'],
      scope: { fixes: ['PLACEHOLDER'] },
      items: [
        'A gallery caption\u2019s "Button" hidden by the website\u2019s stylesheet (not written on the element itself) is no longer reported: the check that opens each page in a browser sees it is hidden on every device and leaves it out',
      ],
    },
    {
      v: 41,
      date: '2026-11-19',
      title: 'Duda\u2019s "Button" labels never reach the AI',
      fixes: ['AI_PAGE_NOTE', 'TEXT_INCOMPLETE', 'TEXT_GRAMMAR', 'TEXT_SPELLING'],
      scope: { fixes: ['AI_PAGE_NOTE', 'TEXT_INCOMPLETE', 'TEXT_GRAMMAR', 'TEXT_SPELLING'], ai: true },
      items: [
        'A gallery keeps a hidden "Button" label per picture, and the AI read them in the page\u2019s text ("Button Button A properly applied ceramic coating") and reported them as a note left in the copy. The text sent to the AI now leaves Duda\u2019s default labels out, and an AI item about a "Button" label is never kept: the default-label check alone judges them (a visible one is still critical)',
        'Real notes left in the copy or in a meta description ("Do not alter page until \u2026") are still reported',
      ],
    },
    {
      v: 42,
      date: '2026-11-20',
      title: 'Service-area towns: allowed in blog posts, and linked to their own service pages',
      fixes: ['AI_TEXT_LOCATION', 'AI_PAGE_CITY'],
      scope: { fixes: ['AI_TEXT_LOCATION', 'AI_PAGE_CITY'], adds: ['LINK_TOWN_SERVICE'], ai: true },
      items: [
        'The towns a business serves are read from its own town pages (/paint-protection-film-in-littleton-co) and its own town. A blog post or service page that names one of them ("a Littleton driver") is no longer "a location that doesn\u2019t match this business"; a town it does not serve still is, and a town page that names another town still is',
        'A page whose address names no town (/tesla, a blog post) may name any of those towns, Business Info\u2019s town, or the place in the business\u2019s own name ("Denver" for Denver Auto Shield) in its title, H1 or copy: "\u2026 for Teslas in Denver, CO" is no longer "a different town than the one in its address"',
        'The AI is told those towns too',
        'New: a page about one of those towns (named at least twice, or in its title or H1) that links a service ("paint protection film") to the general service page is told to link that town\u2019s page instead (/paint-protection-film-in-littleton-co). When the town has no page for that service yet, it says so',
      ],
    },
    {
      v: 43,
      date: '2026-11-20',
      title: 'A web page\u2019s own schema parts are not the business',
      fixes: ['SCHEMA_NAME', 'SCHEMA_PHONE', 'SCHEMA_EMAIL', 'SCHEMA_ADDRESS'],
      scope: { fixes: ['SCHEMA_NAME', 'SCHEMA_PHONE', 'SCHEMA_EMAIL', 'SCHEMA_ADDRESS'] },
      items: [
        'A form-protection or widget vendor that names itself in a web page\u2019s structured data (SpamKill as the "provider" of a protected contact form) is no longer "structured data names a different business". Anything inside a WebPage, WebSite or app block is skipped; a Service\u2019s provider is still checked',
      ],
    },
    {
      v: 44,
      date: '2026-11-20',
      title: 'A form field\u2019s format hint is not contact details',
      fixes: ['EMAIL_MISMATCH', 'PHONE_MISMATCH'],
      scope: { fixes: ['EMAIL_MISMATCH', 'PHONE_MISMATCH'] },
      items: [
        'A placeholder that shows the format to type ("name@email.com", "you@example.com", "(555) 555-5555") is no longer "Email / phone not in Business Info". A real address or number in a placeholder still is',
        'Colour contrast is measured on the home page first, then on every page with a form (typed text and placeholders), then the rest, up to 40 pages',
      ],
    },
    {
      v: 45,
      date: '2026-11-20',
      title: 'Photos judged by the AI as they look on the page; camera watermarks',
      scope: { adds: ['PHOTO_'], photos: true },
      items: [
        'Every photo a visitor sees (an image, a column or section with a photo background, a parallax background) is pictured where it sits on the page and shown to the AI with the page and the section around it: a photo that does not fit the page (a passenger car on the RV page, a bus on the truck page) or its section is reported',
        'The photo file is also looked at whole, so a phone or stock watermark ("Galaxy S21 Ultra 5G", "Shot on iPhone") in a corner the layout crops off is found: one item per photo, wherever it is used',
        'On the same pages as the colour contrast (the home page and pages with a form first, up to 40)',
      ],
    },
    {
      v: 46,
      date: '2026-11-20',
      title: 'Form service choices, and privacy / terms text left as a template',
      scope: { adds: ['FORM_SERVICE_MISSING', 'POLICY_', 'EMAIL_AUTOMATION'] },
      items: [
        'A form\u2019s service choices (a drop-down or tick boxes) that leave out services the website has its own page for',
        'Privacy policy and terms loaded by Termageddon are read as visitors see them (not the "Please wait while the policy is loaded" text): template fields left unfilled ("USA County", [Company Name], {{state}}, XXX-XXX-XXXX), another business\u2019s name, and a phone, email or notice address that is not in Business Info',
        'The same template fields on privacy and terms pages written on the page itself',
      ],
    },
    {
      v: 47,
      date: '2026-11-20',
      title: 'Redirects and old addresses that now give 404',
      scope: { adds: ['REDIRECT_'], files: true },
      items: [
        'The website\u2019s URL redirects in Duda: loops, chains, redirects that land on a page that does not exist, redirects over a page that still exists, and temporary (302) redirects',
        'Pages that were on the website in an earlier scan and now give 404 without a redirect, with the closest current page suggested',
      ],
    },
    {
      v: 48,
      date: '2026-11-20',
      title: 'A photo gallery\u2019s spare "Button" is checked the way visitors see the page',
      scope: { fixes: ['PLACEHOLDER'] },
      items: [
        'A photo gallery keeps a caption button labelled "Button" for every picture in its code, and shows it only when a link is set: one with no link is no longer reported',
        'Every other "Button" label is checked in a real browser on desktop and phone once the page, its pictures and its scripts have finished: one that is not shown on either is left out, one that is shown is still critical',
      ],
    },
    {
      v: 49,
      date: '2026-11-20',
      title: 'A relative link is not a link to the Duda editor',
      scope: { fixes: ['LINK_EDITOR_URL'] },
      items: [
        'A link written as a relative address ("/", "/contact", "/contact#quickform") opens on whatever website the page is on, so on the published website it opens the client\u2019s own domain. It was read as pointing at the editor when a page\u2019s links were written that way. Only a link written out in full to an editor or preview address is reported now',
      ],
    },
    {
      v: 50,
      date: '2026-11-20',
      title: 'A photo gallery\u2019s spare caption button is not a "Button has no link"',
      scope: { fixes: ['BUTTON_NO_LINK'] },
      items: [
        'The same spare caption buttons a photo gallery keeps for every picture were also reported as "Button has no link": they are not any more',
        'A button hidden on the page (by its own style, or by the page\u2019s styles and scripts once it has loaded, checked in a real browser) is not reported either: nobody can click it',
      ],
    },
    {
      v: 51,
      date: '2026-11-20',
      title: 'Google Maps short links are followed to where they open',
      scope: { fixes: ['SOCIAL_GENERIC', 'GMB_'] },
      items: [
        'A Google Maps short link (maps.app.goo.gl/\u2026, g.page/\u2026) says nothing about the place in its address, so it was reported as "doesn\u2019t point to a specific place". It is now followed to where it opens, the way a browser does, and the place Google names there is compared with the business: the business\u2019s own place (a link to one of its reviews too) is fine, another name is a warning to check',
      ],
    },
    {
      v: 52,
      date: '2026-11-23',
      title: 'A town in a link to the business\u2019s own page is not a wrong location',
      scope: { fixes: ['AI_TEXT_LOCATION', 'AI_PAGE_NOTE'], ai: true },
      items: [
        'The AI reported \u201cWe also offer auto detailing in Hamilton, NJ\u201d (a link to the business\u2019s own NJ page) as a location that does not match the business. A town in the words of a link to one of the website\u2019s own pages is a cross-reference to another service or area the business has a page for: it is no longer reported',
        'The AI now reads the whole paragraph first: \u201cwe also serve\u201d, \u201cour other location\u201d and similar mentions are fine; only text that presents this page or this business as being somewhere it is not is reported',
        'A sentence the AI called unfinished (\u201cBy applying PPF,\u201d) is no longer reported when the paragraph on the page goes on after it: the AI was shown the copy in pieces cut at bold words and links. It now reads each page\u2019s copy as whole paragraphs',
      ],
    },
    {
      v: 53,
      date: '2026-11-23',
      title: 'A page is judged by what its own parts say, not by what kind of business it is',
      scope: { fixes: ['AI_PAGE_TOPIC'], ai: true },
      items: [
        'The AI reported a detailer\u2019s towing page as \u201cnot a car-care service the business offers\u201d. A page is now judged by whether its SEO title, H1, description and copy agree on one service (the address is a clue, not the rule), with the website\u2019s own pages and menu as the evidence of what it offers: towing, storage, powder coating or anything else is fine when the page is consistent',
        'Only a clear mismatch is reported (a title about one service on a page about another). When the AI cannot tell what a page is meant to offer, the item is set to For clarification with what is unclear, instead of being called a mistake',
      ],
    },
    {
      v: 54,
      date: '2026-11-23',
      title: 'Locations: where the shop is, where it works, and which towns belong to an area',
      scope: { fixes: ['AI_TEXT_LOCATION', 'AI_PAGE_CITY'], ai: true },
      items: [
        'The AI now tells a shop\u2019s physical location from its service area, and knows which towns lie inside the county or region a page targets (Willow Grove on the Montgomery County page). Service-area towns are fine even when they are not in the address or the URL',
        'Only an explicit claim about where the shop is (\u201cVisit our Willow Grove shop\u201d) that conflicts with the business\u2019s location is reported as a wrong location. Ambiguous wording (\u201cAuto Detailing Experts in Willow Grove, PA\u201d) is a warning that starts as For clarification, with a wording suggestion and what is uncertain. Towns flagged before are asked again',
      ],
    },
    {
      v: 55,
      date: '2026-11-23',
      title: 'Spelling: detailing terms are words, and a fix keeps the same part',
      scope: { fixes: ['TEXT_SPELLING'], ai: true },
      items: [
        'The AI \u201ccorrected\u201d \u201cwheel barrels\u201d (the inner part of a wheel) to \u201cwheel wells\u201d (the body cavity around it). A spelling item now needs wrong letters in a word and a fix that is the same word spelled right; replacing one real word with another is never a spelling fix. Automotive and detailing terms are read in their sentence before anything is reported',
        'When the AI is not sure a term is wrong, it is an Info item, \u201cwording to confirm\u201d, that starts as For clarification, instead of a spelling mistake. Spelling items found before are checked again',
      ],
    },
    {
      v: 56,
      date: '2026-11-24',
      title: 'Grammar: a correction keeps the meaning, and claims are not grammar',
      scope: { fixes: ['TEXT_GRAMMAR'], ai: true },
      items: [
        'A grammar fix is now read as part of the whole sentence and checked for grammar AND logic: \u201cnot as glossy as a film\u201d for a clear bra (which is a film) is rejected. The AI knows automotive synonyms (clear bra = paint protection film) and checks subject\u2013verb agreement with the real subject',
        'Claims about how products perform are not corrected as grammar: they become Info items to confirm. When no sure correction exists, the item explains the problem without a suggested fix. Grammar items found before are checked again',
      ],
    },
    {
      v: 57,
      date: '2026-11-24',
      title: 'A service link is judged by the page it opens, not by a town in its address',
      scope: { fixes: ['LINK_TOWN_SERVICE'] },
      items: [
        'A link from a page about a town to a service page was reported when no service page had the town in its address. The page the link opens is now read first (title, H1, description, copy): when it already targets that town (\u201cProfessional Ceramic Coating in Campbell, CA\u201d at /ceramic-coating), or the town is the shop\u2019s own town, the link is fine and nothing is reported',
        'When the business does have a dedicated page for that town and service and the link skips it, that is still a warning. Otherwise a separate town page is only an optional idea (Info), never \u201cmake a page\u201d',
      ],
    },
    {
      v: 58,
      date: '2026-11-25',
      title: 'Stock photos licensed for editorial use only',
      scope: { adds: ['STOCK_EDITORIAL'] },
      items: [
        'New check: a Shutterstock photo that is licensed for editorial use only (not for promoting a business) is reported as critical, with where it is used and a link to it on Shutterstock. A picture is matched by the Shutterstock ID in its file name, or by how it looks, so a renamed or resized copy is still caught. The list of editorial images starts with the team\u2019s own Shutterstock downloads and is kept in Settings \u2192 Editorial stock photos; an ID the list does not know is looked up on Shutterstock once',
      ],
    },
    {
      v: 59,
      date: '2026-11-25',
      title: 'Editorial stock photos: every slide, gallery picture and hidden section',
      scope: { adds: ['STOCK_EDITORIAL'] },
      items: [
        'A published Duda page shows only the first slide of a slider; the other slides are in the slider\u2019s data and load as it moves. An editorial photo on any slide (the last one too) is now found, and so is a picture kept only in a gallery\u2019s data',
        'A background in a section hidden on every device is now found even when the section is not in the page as served (its picture is still in the page\u2019s styles). It is reported as a warning, in a hidden section',
      ],
    },
    {
      v: 60,
      date: '2026-11-26',
      title: 'Grammar: the smallest fix that keeps the meaning, the real problem named, wrong words apart',
      scope: { fixes: ['TEXT_GRAMMAR'], adds: ['TEXT_WORD_CHOICE'], ai: true },
      items: [
        'A grammar fix is now chosen after reading the whole sentence: the smallest change that keeps the meaning, tone and business message. \u201cWe believe in treating your vehicle is treated\u201d mixes two sentence structures; the fix is now \u201cin treating your vehicle\u201d (a statement of values), not \u201cthat your vehicle is treated\u201d. The fix is put into the sentence and the whole corrected sentence is read again before it is suggested',
        'The explanation names the real problem (mixed sentence structure, wrong verb form, missing word\u2026), not \u201csubject\u2013verb agreement\u201d or \u201cduplicated\u201d for everything',
        'A real word used in the wrong place (\u201ccartouches\u201d for coatings) is its own item, \u201cWrong word\u201d, separate from any grammar mistake in the same sentence. An optional style improvement, when reported, is an Info item that says it is not a mistake. Grammar items found before are checked again',
      ],
    },
    {
      v: 61,
      date: '2026-11-26',
      title: 'Links are judged by what they promise: town pages, packages, brands, sections and redirects',
      scope: { fixes: ['LINK_TOWN_SERVICE', 'LINK_WRONG_PAGE'], adds: ['LINK_ANCHOR_MISSING', 'LINK_VIA_REDIRECT'], ai: true },
      items: [
        'A page about a town linking the general service page is no longer flagged because a town page exists. Links to packages, a film or coating maker\u2019s page (STEK, LLumar, CARPRO\u2026), a vehicle\u2019s own service page (Porsche PPF) or a complementary service keep their page. Only a link whose own words name the town (\u201cpaint protection film Voorhees\u201d) is offered the town page, as an optional Info idea',
        'A button that scrolls to a section of its own page (\u201cVIEW PACKAGES\u201d to #FullVehicleDetailingPackages) is judged by that section, not sent to another page. A section that is not on the page is its own item, for clarification',
        'A link through a redirect is judged by the page it lands on: never \u201cnon-existent\u201d. When it lands on the right page, linking straight to it is an optional tidy-up',
        'A phrase that formatting split into several links (\u201cauto\u201d + \u201cwindow\u201d + \u201ctinting\u201d) is read whole. A suggested page must be one the scan opened and found working, and one link gets one recommendation',
      ],
    },
    {
      v: 62,
      date: '2026-11-27',
      title: 'A link is judged by what its page says, not by the town in that page\u2019s SEO title',
      scope: { fixes: ['LINK_WRONG_PAGE'], ai: true },
      items: [
        'A link from the Warminster home page to a service page whose SEO title targets Philadelphia was called wrong, with the same page as the fix. The page a link opens is now judged by its heading and copy; another town in its title is not a reason to call the link wrong, and a suggestion equal to the page it already opens is refused (the link is fine)',
      ],
    },
    {
      v: 63,
      date: '2026-11-27',
      title: 'Locations: a second facility or partner described on the page is asked about, not called wrong',
      scope: { fixes: ['AI_TEXT_LOCATION'], ai: true },
      items: [
        'The location check now reads each paragraph with its page\u2019s SEO title, H1, section heading and the page\u2019s other facility or partner sentences. A town the page itself describes (\u201cStorage in Warminster and New Britain through a partner\u201d) is a warning For clarification asking whether it is another facility or a partner, instead of a critical \u201cleftover from another client\u201d with a replacement town. A town that contradicts the page and the business is still reported. Only that page counts: a town described on one page is not approved for the others',
      ],
    },
  ];
  const CHECKS_VERSION = CHECK_RELEASES[CHECK_RELEASES.length - 1].v;
  /** Releases of the check list newer than the one a scan ran with. Scans older than this feature count as v1. */
  function checksSince(v) { const n = Number(v) || 1; return CHECK_RELEASES.filter((r) => r.v > n); }
  /** The check codes corrected since a scan ran — items carrying one of these are known to be unreliable. */
  function fixedSince(v) { const out = new Set(); checksSince(v).forEach((r) => (r.fixes || []).forEach((c) => out.add(c))); return out; }
  /**
   * "Apply check updates": what to read again so an audit catches up with the checks, without a full rescan.
   * Each release says what it touched (scope): `fixes` = checks that were corrected (only the pages with
   * those items need reading again), `adds` = new checks (every page, but only those checks), and whether
   * the AI, the colour-contrast pictures or the link checks are needed. A release without a scope (older
   * ones) can only be caught up with a full rescan.
   * Returns { releases, full: [releases that need a full rescan], codes, pages: 'all' | [paths], ai, contrast, photos (photos are pictured on the contrast visit: only when the AI is on), links, steps: [...] }.
   */
  function codeIn(codes, code) { const c = String(code || ''); return codes.some((x) => (x.endsWith('_') ? c.startsWith(x) : c === x)); }
  function updatePlan(v, findings) {
    const rel = checksSince(v);
    const full = rel.filter((r) => !r.scope);
    const live = (findings || []).filter((f) => f && !f.gone && !f.manual);
    const codes = new Set(); const paths = new Set(); let all = false, ai = false, contrast = false, links = false, photos = false;
    const steps = rel.filter((r) => r.scope).map((r) => {
      const sc = r.scope; const fx = sc.fixes || [], ad = sc.adds || [];
      const items = live.filter((f) => codeIn(fx, f.code));
      items.forEach((f) => (f.pages && f.pages.length ? f.pages : [f.path || '/']).forEach((p) => paths.add(normalizePath(p))));
      const used = items.length > 0 || ad.length > 0;
      if (used) { fx.concat(ad).forEach((c) => codes.add(c)); if (sc.ai) ai = true; if (sc.contrast) contrast = true; if (sc.photos) photos = true; if (sc.links) links = true; }
      if (ad.length && !sc.files) all = true;
      return { v: r.v, title: r.title, kind: ad.length ? 'adds' : 'fixes', files: !!sc.files, codes: fx.concat(ad), items, pages: sc.files ? [] : ad.length ? 'all' : [...new Set(items.flatMap((f) => (f.pages && f.pages.length ? f.pages : [f.path || '/']).map(normalizePath)))], ai: !!sc.ai, contrast: !!sc.contrast, photos: !!sc.photos, skip: !used };
    });
    // Checks that compare the whole website (duplicate titles, fonts, duplicate photos…) read every page.
    if ([...codes].some((c) => /^(META_TITLE_DUP|META_DESC_DUP|TEXT_OTHER_BUSINESS|FONT_|IMAGE_DUPLICATE|STOCK_EDITORIAL|FAVICON_MISSING|HOMESCREEN_ICON_MISSING|LINK_BROKEN_INTERNAL|PAGE_WRONG_CITY)/.test(c))) all = true;
    return { releases: rel, full, codes: [...codes], pages: all ? 'all' : [...paths], ai, contrast, photos, links, steps };
  }

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
    [/\bTBD\b|\bXXX+\b|\bTODO\b|\bFIXME\b/, 'TBD / XXX / TODO marker'],
    // Notes from the writer or the team that were never taken out: "[Matthew: confirm this is free before publishing.]"
    [/\[\s*[A-Z][A-Za-z.'’ -]{1,30}:\s*[^\]]{3,240}\]/, 'Editor note left in the text ([Name: …])'],
    [/\[\s*(?:note|notes|todo|tbd|fixme|placeholder|insert|add|update|confirm|check|verify|need|needs|client|writer|editor|internal|link|photo|image|pic|cta|source|citation|stat|price|pricing)\b[^\]]{0,200}\]/i, 'Unfilled or editor [note] left in the text'],
    [/\b(?:confirm|verify|check|double[- ]check|update|replace|add|remove|ask)\b[^.!?\]]{0,90}\bbefore (?:publishing|we publish|going live|it goes live|launch(?:ing)?|posting)\b/i, 'Editor note left in the text ("… before publishing")'],
    [/\b(?:note to (?:self|client|writer|editor|designer|dev)|internal note|writer[’']?s note|editor[’']?s note|for internal use)\b/i, 'Internal note left in the text'],
    [/\b(?:pending|awaiting|needs?) (?:client|owner|shop) (?:approval|confirmation|input|info)\b/i, 'Internal note left in the text (waiting on the client)'],
    [/\binsert (?:the |a |an |your |their )?(?:[\w-]+ ){0,3}here\b/i, 'Placeholder ("insert … here") left in the text'],
  ];
  // A Duda element whose own default label was never changed: a button that just says "Button".
  // Duda's default labels ("Button", "Heading"…) are the default-label rule's alone: it reports a visible one
  // and leaves out one the page hides (a gallery keeps a hidden "Button" per picture). Text sent to the AI
  // never carries them, so the AI cannot report the same hidden "Button" again as "a note left in the text".
  const LABEL_WORDS = /\b(?:New Button|Button Text|Button Label|Button)\b/g;
  // An AI item about a "Button" label: the words include "Button" and its reason or fix is about that label.
  const AI_LABEL_ONLY = (quote, reason) => /\bButton\b/.test(String(quote || '')) && /\bbuttons?\b|default label|ui label|ui element/i.test(String(reason || ''));
  const DEFAULT_LABEL = /^(?:Button|New Button|Button Text|Button Label|Heading|New Heading|Subtitle|Sub Title|Paragraph|New Paragraph|Caption|Image Caption|Image Title|Title Here|Your Title|Text Here|Your Text Here|Link Text|Label)$/;

  // Characters that look like the keyboard pipe "|", dashes used as title separators, and invisible characters.
  const PIPE_LIKE = /[\u2502\u2503\u2551\u23d0\u23ae\u2223\u2758\u2759\u275a\u01c0\u05c0\u0964\u0965\uff5c\uffe8\ufe31\ufe32\u2016\u23b8\u23b9\u2adb\u2af4\u2af5\u2af6]/g;
  const DASH_SEP = /\s([\u2013\u2014\u2012\u2015\u2010\u2011\u2212\ufe58\ufe63\uff0d])\s/g;
  const INVISIBLE = /[\u200b-\u200f\u2060\ufeff\u00ad]/g;
  const CHAR_NAME = { '\u2502': 'box-drawing line', '\u2503': 'heavy box-drawing line', '\u2551': 'double box-drawing line', '\u23d0': 'vertical line extension', '\u23ae': 'integral extension',
    '\u2223': '"divides" symbol', '\u2758': 'ornament bar', '\u2759': 'ornament bar', '\u275a': 'ornament bar', '\u01c0': 'click letter', '\u05c0': 'Hebrew paseq', '\u0964': 'danda', '\u0965': 'double danda',
    '\uff5c': 'full-width pipe', '\uffe8': 'half-width bar', '\ufe31': 'vertical dash', '\ufe32': 'vertical dash', '\u2016': 'double vertical line',
    '\u2013': 'en dash', '\u2014': 'em dash', '\u2012': 'figure dash', '\u2015': 'horizontal bar', '\u2010': 'Unicode hyphen', '\u2011': 'non-breaking hyphen', '\u2212': 'minus sign', '\ufe58': 'small em dash', '\ufe63': 'small hyphen', '\uff0d': 'full-width hyphen',
    '\u200b': 'zero-width space', '\u200c': 'zero-width non-joiner', '\u200d': 'zero-width joiner', '\u200e': 'left-to-right mark', '\u200f': 'right-to-left mark', '\u2060': 'word joiner', '\ufeff': 'byte-order mark',
    '\u00ad': 'soft hyphen', '\u00a0': 'non-breaking space', '\u202f': 'narrow non-breaking space', '\u2007': 'figure space' };

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
  /**
   * A link to one post or video rather than to an account: a YouTube video (watch, youtu.be, shorts,
   * embed, live, a playlist), a Facebook watch / reel / photo, an Instagram post or reel. Its address
   * names no account ("watch" is not a channel), so it cannot be judged by its handle.
   * Returns the YouTube video ID when there is one (whose channel it is can be asked of YouTube).
   */
  function postLink(net, href) {
    let u; try { u = new URL(href); } catch (e) { return null; }
    const segs = u.pathname.split('/').filter(Boolean); const s0 = (segs[0] || '').toLowerCase();
    if (net === 'youtube') {
      if (/(^|\.)youtu\.be$/i.test(u.hostname)) return { video: segs[0] || '' };
      if (s0 === 'watch') return { video: u.searchParams.get('v') || '' };
      if (['shorts', 'embed', 'live', 'v', 'e'].includes(s0)) return { video: segs[1] || '' };
      if (s0 === 'playlist' || s0 === 'results' || s0 === 'feed') return { video: '' };
      return null;
    }
    if (net === 'facebook') return ['watch', 'reel', 'story.php', 'photo.php', 'permalink.php', 'photo', 'events', 'groups', 'share'].includes(s0) ? { video: '' } : null;
    if (net === 'instagram') return ['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(s0) ? { video: '' } : null;
    return null;
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
  // Addresses that exist for automation (Zapier, form parsers, "no reply"): they can sit in Business Info so
  // leads reach a CRM, but a customer must never see them. Kept apart from the business's own emails.
  const AUTOMATION_EMAIL = /@(robot\.zapier\.com|zapiermail\.com|[a-z0-9.-]*\.?mailparser\.io|parsio\.io|[a-z0-9.-]*\.cloudmailin\.net|inbound\.[a-z0-9.-]+|[a-z0-9.-]+\.inbound\.[a-z0-9.-]+|email\.mailgun\.org|parse\.[a-z0-9.-]+)$|^(no-?reply|do-?not-?reply|mailer-daemon)@/i;
  const isAutomationEmail = (e) => AUTOMATION_EMAIL.test(String(e || '').trim());
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
      // An address can be a full one, only a town (a business that serves an area and hides its
      // street), or only Duda's map lookup string. Each is kept for what it is; checks that need a
      // street or a ZIP only use addresses that have one.
      let a = normAddress(L.address);
      if (!(a && (a.street || a.zip || a.city)) && typeof L.address_geolocation === 'string' && L.address_geolocation.trim()) a = normAddress(L.address_geolocation.trim());
      if (a && (a.street || a.zip || a.city) && !t.addresses.some((x) => x.street === a.street && x.zip === a.zip && x.city === a.city)) t.addresses.push(a);
      if (!t.addressSeen) t.addressSeen = L.address ? (typeof L.address === 'string' ? L.address : Object.entries(L.address).filter(([, v]) => v && typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(', ')) : '';
      const sa = flatSocials(L.social_accounts || L.socialAccounts || {});
      Object.keys(sa).forEach((k) => {
        const net = /^(google_my_business|google|gmb|google_business|googlemybusiness)$/i.test(k) ? 'google_my_business' : k.toLowerCase();
        sa[k].forEach((val) => {
          const url = socialUrl(net, val);
          const h = socialHandle(net, url || val);
          t.socials[net] = t.socials[net] || [];
          // The main location and an extra one often carry the same accounts: list each once.
          if (t.socials[net].includes(h)) return;
          t.socials[net].push(h);
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
    // Automation addresses are kept apart: never expected on the website, and reported if shown there.
    t.autoEmails = t.emails.filter(isAutomationEmail);
    t.emails = t.emails.filter((e) => !isAutomationEmail(e));
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
    const unplaced = [];
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
        let matched = 0; const sels = [];
        m[1].split(',').forEach((raw) => {
          const sel = raw.replace(/::?[a-z-]+(\([^)]*\))?/gi, '').trim();
          if (!sel || /^@/.test(sel)) return;
          sels.push(sel);
          let hits = [];
          try { hits = doc.querySelectorAll(sel); } catch (e) { return; }
          matched += hits.length;
          Array.prototype.slice.call(hits, 0, 40).forEach((el) => urls.forEach((u) => push(el, u, 'background', { tiled })));
        });
        // A background whose element is not on the page as served (a section hidden on every device):
        // the file is still part of the website, so it is kept for the checks that look at files.
        if (!matched && sels.length && /\.u_\d+|#\d{6,}|\[id=/.test(sels.join(','))) urls.forEach((u) => unplaced.push({ url: u, sel: sels[0] }));
      }
    });
    // Pictures that are not <img> or a background in the page as served, but are still the website's:
    // the other slides of a slider (Duda renders only the first and loads the rest from the slider's
    // data as it moves), gallery data, and backgrounds of sections hidden on every device. They are
    // marked fromData: the editorial-photo check uses them; the duplicate-photo check does not.
    const have = new Set(out.map((x) => imageKey(abs(x.url))));
    let extra = 0;
    const addData = (el, u, how, hid) => {
      if (extra >= 200) return;
      const a = abs(u); if (!a || !/^https?:/i.test(a)) return;
      const k = imageKey(a); if (have.has(k)) return;
      have.add(k); extra++;
      const holder = el && el.nodeType === 1 ? el : null;
      const sel = holder ? uniqueSelector(holder) : (hid && hid.sel) || 'style';
      out.push({ url: a, how, selector: sel, block: holder ? blockOf(sel) : sel, location: holder ? (locationOf(holder) || 'Body') : 'Hidden section',
        hiddenBy: holder ? (hiddenReason(holder, device) || '') : 'its section is not shown on the published page', fromData: true });
    };
    const DATA_URL = /https?:\/\/[^\s"'()<>\\,]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^\s"'()<>\\,]*)?(?=$|[\s"'()<>\\,&])/gi;
    const unwrap = (t) => { let x = String(t || '').replace(/\\u002[Ff]/g, '/').replace(/\\\//g, '/').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      if (/%2F/i.test(x)) { try { x = x + ' ' + decodeURIComponent(x.replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch (e) { /* as it is */ } }
      return x; };
    const widgetOf = (el) => (el && el.closest && el.closest('[data-element-type],[dmle_extension],[id]')) || el;
    // Slider and gallery data: Duda's hydration scripts, data-initial-props (url-encoded) and data-model (base64 JSON).
    doc.querySelectorAll('script').forEach((sc) => {
      const t = sc.textContent || ''; if (!/cdn-website|multiscreensite|dms3rep|imgSrc/i.test(t) || t.length > 400000) return;
      const host = widgetOf(sc.parentElement);
      (unwrap(t).match(DATA_URL) || []).forEach((u) => addData(host, u, 'slider', null));
    });
    doc.querySelectorAll('[data-initial-props],[data-model],[data-image-url],[data-gallery],[data-slides]').forEach((el) => {
      ['data-initial-props', 'data-model', 'data-image-url', 'data-gallery', 'data-slides'].forEach((a) => {
        let v = el.getAttribute(a); if (!v) return;
        if (a === 'data-model' && /^[A-Za-z0-9+/=]{40,}$/.test(v)) { try { v = typeof atob === 'function' ? atob(v) : Buffer.from(v, 'base64').toString('utf8'); } catch (e) { return; } }
        (unwrap(v).match(DATA_URL) || []).forEach((u) => addData(widgetOf(el), u, /slider|slide/i.test(el.getAttribute('data-element-type') || el.getAttribute('dmle_extension') || '') ? 'slider' : 'gallery', null));
      });
    });
    unplaced.forEach((x) => addData(null, x.url, 'background', { sel: x.sel }));
    // One entry per element per picture: a rule and an inline style naming the same file on the
    // same element is one picture in one place, not two.
    const seenHere = new Set();
    return out.filter((x) => {
      if (!IMG_EXT.test(x.url) && !/\/dms3rep\/|cdn-website|multiscreensite/i.test(x.url)) return false;
      const k = x.selector + '|' + x.url;
      if (seenHere.has(k)) return false;
      seenHere.add(k);
      return true;
    }).slice(0, 600);
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
    // Places read from slider/gallery data or hidden sections are not counted as repeats.
    const shots = [...byKey.values()].map((e) => Object.assign({}, e, { places: e.places.filter((ph) => !ph.fromData) }))
      .filter((e) => e.places.length && e.m && e.m.hash && !e.why && !flatHash(e.m.hash) && !imageApproved(ok, e));

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

  // ---------------------------------------------------------------------------
  // EDITORIAL-USE-ONLY STOCK PHOTOS
  //
  // Some Shutterstock images may only be used editorially (news, not a business's website). The team
  // keeps the list of the ones it has downloaded (Settings → Editorial stock photos). A picture on the
  // website is one of them when its file name still carries the Shutterstock ID, or when it LOOKS the
  // same as the list's preview of it — the same fingerprint as the duplicate-photo check, so a renamed
  // or resized copy is still caught. An ID in a file name that is not on the list is asked about once
  // (Shutterstock's own page says whether it is editorial), and joins the list if it is.
  // ---------------------------------------------------------------------------
  const STOCK_NAME = [
    /shutterstock[\s_-]*(\d{5,12})(?!\d)/i,                         // shutterstock_2530975229.jpg (as downloaded)
    /-\d{2,4}nw-(\d{5,12})(?!\d)/i,                                 // …-260nw-2669861029.jpg (Shutterstock's preview)
    /(?:^|[_-])stock-(?:photo|vector|image|illustration)-.*-(\d{5,12})(?=\D*$)/i,
  ];
  /** The Shutterstock ID in a picture's file name, or ''. */
  function stockIdOf(url) {
    const name = safeDecode(String(url || '').split('?')[0].split('#')[0].split('/').pop() || '');
    for (const re of STOCK_NAME) { const m = name.match(re); if (m) return m[1]; }
    return '';
  }
  const STOCK_LOOK = 7;   // bits that may differ: a watermarked preview against the clean file
  const stockLink = (id) => `https://www.shutterstock.com/image-photo/${id}`;
  /**
   * Fingerprint a Shutterstock preview. Its 260nw previews carry a 20px white Shutterstock strip at the
   * bottom that is not part of the photo: it is cut off first, so the fingerprint matches the photo
   * as it is used on a website.
   */
  function stockMeasure(img, url) {
    let src = String(url || img.src || '');
    try { src = decodeURIComponent(src); } catch (e) { /* as it is */ }
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!/-\d{2,4}nw-\d{5,12}\.jpe?g/i.test(src) || !w || h < 60) return measureImage(img);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h - 20;
    const cx = cv.getContext('2d'); if (!cx) return measureImage(img);
    cx.drawImage(img, 0, 0, w, h - 20, 0, 0, w, h - 20);
    return measureImage(cv);
  }
  /** Fill in missing fingerprints of listed pictures from their previews (a few per scan). */
  async function stockFingerprints(items, opts, max) {
    if (!opts.stockSaveHash || typeof document === 'undefined') return;
    const todo = items.filter((x) => !x.h && x.preview).slice(0, max || 8);
    for (const x of todo) {
      const img = await loadImage(x.preview, 10000);
      const m = img ? stockMeasure(img, x.preview) : null;
      if (!m || flatHash(m.hash)) continue;
      x.h = m.hash;
      try { await opts.stockSaveHash(x.id, m.hash); } catch (e) { /* next scan */ }
    }
  }
  async function editorialStockFindings(byKey, opts, log) {
    let items = [];
    try { items = (await opts.stockList()) || []; } catch (e) { log.push('Editorial stock list could not be read: ' + e); return []; }
    const ed = new Map(items.map((x) => [String(x.id), x]));
    const entries = [...byKey.values()];
    // IDs in file names that the list does not know yet: Shutterstock's page is asked once.
    const unknown = [...new Set(entries.map((e) => stockIdOf(e.url)).filter((id) => id && !ed.has(id)))].slice(0, 20);
    if (unknown.length && opts.stockLookup) {
      try {
        const r = (await opts.stockLookup(unknown)) || {};
        Object.values(r).forEach((v) => { if (v && v.id && v.editorial === true && !ed.has(v.id)) { const x = { id: v.id, preview: v.preview || '', title: v.title || '', src: 'lookup' }; ed.set(v.id, x); items.push(x); } });
        const unsure = unknown.filter((id) => !r[id] || r[id].editorial === null);
        if (unsure.length) log.push(`Shutterstock did not say whether ${unsure.length} picture${unsure.length === 1 ? ' is' : 's are'} editorial (${unsure.slice(0, 5).join(', ')})`);
      } catch (e) { log.push('Shutterstock lookup failed: ' + e); }
    }
    await stockFingerprints(items, opts, 8);
    const refs = items.filter((x) => x.h && x.h.length === 64 && !flatHash(x.h));
    const hits = new Map();
    entries.forEach((e) => {
      const fid = stockIdOf(e.url);
      let id = '', how = '', d = 99;
      if (fid && ed.has(fid)) { id = fid; how = 'name'; }
      else if (e.m && e.m.hash && !e.why && !flatHash(e.m.hash)) {
        refs.forEach((x) => { const dd = hamming(x.h, e.m.hash); if (dd < d) { d = dd; id = String(x.id); } });
        if (d <= STOCK_LOOK) how = 'look'; else id = '';
      }
      if (!id) return;
      const g = hits.get(id) || { id, how, members: [] };
      if (how === 'name') g.how = 'name';
      g.members.push(e);
      hits.set(id, g);
    });
    const out = [];
    hits.forEach((g) => {
      const spots = new Map();
      g.members.forEach((e) => e.places.forEach((ph) => {
        const k = [ph.block || ph.selector, ph.location].join('|');
        const sp = spots.get(k) || { block: ph.block || ph.selector, selector: ph.selector, location: ph.location, how: ph.how, paths: new Set(), hiddenBy: ph.hiddenBy, first: ph };
        sp.paths.add(ph.path || '/');
        if (!spots.has(k)) spots.set(k, sp);
      }));
      const places = [...spots.values()];
      if (!places.length) return;
      const shown = places.filter((sp) => !sp.hiddenBy);
      const one = (shown[0] || places[0]).first;
      const names = [...new Set(g.members.map((e) => safeDecode(String(e.url).split('?')[0].split('/').pop() || '')))];
      const where = places.slice(0, 6).map((sp) => `${sp.location}${sp.paths.size ? ' (' + [...sp.paths].slice(0, 3).join(', ') + (sp.paths.size > 3 ? ', …' : '') + ')' : ''}`);
      const ref = ed.get(g.id) || {};
      out.push({
        code: 'STOCK_EDITORIAL', severity: shown.length ? 'critical' : 'warning', category: 'Images / Alt',
        message: 'Stock photo licensed for editorial use only',
        found: `${names[0]} · Shutterstock ${g.id}`,
        expected: 'A photo licensed for commercial use, or the business’s own photo',
        reason: g.how === 'name'
          ? `The file name carries Shutterstock ID ${g.id}, which is on the list of editorial-use-only images. Editorial images may not be used to promote a business.`
          : `This photo looks the same as Shutterstock image ${g.id}, which is on the list of editorial-use-only images (it was probably renamed). Compare the two before replacing it.`,
        path: one.path, device: one.device, selector: (shown[0] || places[0]).block, location: (shown[0] || places[0]).location,
        visible: !!shown.length, hiddenBy: shown.length ? '' : (one.hiddenBy || ''),
        snippet: where.join(' · ') + (places.length > 6 ? ` · …and ${places.length - 6} more` : ''),
        stockId: g.id, stockUrl: stockLink(g.id), stockHow: g.how, stockTitle: String(ref.title || '').slice(0, 160),
        allowValue: names[0],
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
        // A web page's own parts are not the business: a form-protection or widget vendor names itself as the
        // page's "provider" (SpamKill on a protected contact form). Nothing inside a WebPage, WebSite or app is read.
        const NOT_BIZ_PARENT = /^(WebPage|WebPageElement|WebSite|SoftwareApplication|WebApplication|ContactPage|AboutPage|FAQPage|CollectionPage|ItemPage|SearchResultsPage)$/i;
        const walk = (o, depth, parentType) => {
          if (!o || typeof o !== 'object' || depth > 6) return;
          if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1, parentType));
          if ([].concat(parentType || []).some((t) => NOT_BIZ_PARENT.test(String(t).replace(/^https?:\/\/schema\.org\//i, '')))) return;
          if (o.telephone || o.address || (o.name && o['@type'] && !/WebPage|BreadcrumbList|WebSite/i.test(String(o['@type'])))) out.push({ node: s, data: o, biz: isBusinessType(o['@type']) });
          Object.keys(o).forEach((k) => { if (k !== '@context' && o[k] && typeof o[k] === 'object') walk(o[k], depth + 1, k === '@graph' ? null : o['@type']); });
        };
        walk(j, 0, null);
      } catch (e) { /* invalid JSON-LD handled elsewhere */ }
    });
    return out;
  }

  // ---------- TECHNICAL SEO: structured data, robots.txt, sitemap.xml, llms.txt ----------
  // Structured data (schema.org JSON-LD) is read by Google for the business panel, rich results and
  // the map; the rules below are Google's own (required and recommended properties for LocalBusiness,
  // review snippets, FAQ). Everything is the "Technical SEO" category, its own tab on the audit.
  const TECH = 'Technical SEO';
  const SCHEMA_REC = [['telephone', 'telephone'], ['url', 'url (the website)'], ['openingHoursSpecification', 'opening hours'], ['geo', 'geo (map position)'], ['image', 'image'], ['priceRange', 'priceRange']];
  const AUTO_WORDS = /\b(auto|car|vehicle|tint|detail|ceramic|ppf|paint protection|wrap|collision|body shop|mechanic|tire|windshield|glass)\b/i;
  const typeName = (t) => [].concat(t || []).map((x) => String(x).replace(/^https?:\/\/schema\.org\//i, '')).join(', ');
  function schemaTop(doc) {
    // Each JSON-LD block, its top-level nodes (an @graph is read as nodes) and whether it parsed.
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((sc) => {
      const raw = String(sc.textContent || '').trim();
      if (!raw) return;
      let j;
      try { j = JSON.parse(raw); } catch (e) { out.push({ node: sc, error: String(e.message || e).slice(0, 120), raw }); return; }
      const ctxOf = (o, outer) => o['@context'] || outer;
      const push = (o, outer) => { if (o && typeof o === 'object' && !Array.isArray(o)) out.push({ node: sc, data: o, context: ctxOf(o, outer) }); };
      const top = Array.isArray(j) ? j : [j];
      top.forEach((o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o['@graph'])) o['@graph'].forEach((g) => push(g, o['@context']));
        else push(o, null);
      });
    });
    return out;
  }
  function schemaQuality(doc, ctx, add, truth) {
    const nodes = schemaTop(doc);
    const titleEl = doc.querySelector('head title') || doc.head || doc.documentElement;
    nodes.filter((n) => n.error).forEach((n) => add(n.node, { code: 'SCHEMA_INVALID_JSON', severity: 'critical', category: TECH,
      message: 'Structured data (JSON-LD) that is not valid JSON: Google ignores the whole block', found: n.error, expected: 'Valid JSON (check commas, quotes and brackets in the custom code)' }));
    nodes.filter((n) => n.data).forEach((n) => {
      const t = n.data['@type'];
      if (!t) add(n.node, { code: 'SCHEMA_NO_TYPE', severity: 'warning', category: TECH, message: 'Structured data (JSON-LD) with no @type: Google does not know what it describes', found: Object.keys(n.data).slice(0, 6).join(', '), expected: 'An @type, such as AutoRepair, LocalBusiness or FAQPage' });
      else if (!/schema\.org/i.test(String(n.context || ''))) add(n.node, { code: 'SCHEMA_NO_CONTEXT', severity: 'warning', category: TECH, message: `Structured data (${typeName(t)}) without "@context": "https://schema.org": Google may not read it`, found: String(n.context || '(none)'), expected: 'https://schema.org' });
    });
    const biz = nodes.filter((n) => n.data && isBusinessType(n.data['@type']));
    // Several business blocks on one page that disagree on who the business is.
    const names = [...new Set(biz.map((n) => String(n.data.name || '').trim()).filter(Boolean))];
    if (names.length > 1) add(biz[1].node, { code: 'SCHEMA_MULTI_BUSINESS', severity: 'warning', category: TECH, message: `${biz.length} business blocks in the structured data name different businesses: Google has to guess which one this page is`, found: names.join(' | '), expected: truth.businessName || 'One business block' });
    biz.forEach((n) => {
      const d = n.data; const type = typeName(d['@type']);
      const local = !/^(Organization|Corporation)$/i.test(type);
      if (local) {
        // Google's required properties for a local business: name and address (street, town, state, ZIP).
        const a = d.address && typeof d.address === 'object' ? (Array.isArray(d.address) ? d.address[0] || {} : d.address) : null;
        const hasStreet = (truth.addresses || []).some((x) => x && x.street);
        const miss = [];
        if (!d.name) miss.push('name');
        if (!a) { if (hasStreet || typeof d.address === 'string') miss.push(typeof d.address === 'string' ? 'address as a PostalAddress (it is plain text)' : 'address'); }
        else ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode'].forEach((k) => { if (!a[k] && (k !== 'streetAddress' || hasStreet)) miss.push('address.' + k); });
        if (miss.length) add(n.node, { code: 'SCHEMA_REQUIRED', severity: 'warning', category: TECH, message: `The business's structured data (${type}) is missing what Google requires for a local business`, found: 'Missing: ' + miss.join(', '), expected: 'name, and the full address (street, town, state, ZIP), as in Business Info' });
        if (ctx.path === '/') {
          const rec = SCHEMA_REC.filter(([k]) => !d[k] && !(k === 'openingHoursSpecification' && d.openingHours)).map(([, l]) => l);
          if (rec.length) add(n.node, { code: 'SCHEMA_RECOMMENDED', severity: 'info', category: TECH, message: `The business's structured data (${type}) leaves out properties Google recommends`, found: 'Not filled in: ' + rec.join(', '), expected: 'Fill them in Duda Business Info (phone, hours, logo) so the schema carries them' });
          // An auto shop described as a plain "LocalBusiness": a more exact type helps Google place it.
          if (/^LocalBusiness$/i.test(type) && AUTO_WORDS.test([truth.businessName, d.name, d.description].join(' '))) add(n.node, { code: 'SCHEMA_TYPE_GENERIC', severity: 'info', category: TECH, message: 'The business is described as a general "LocalBusiness": a more exact type tells Google what kind of business it is', found: type, expected: 'AutoRepair, AutoBodyShop, AutoWash or AutomotiveBusiness (whichever fits)' });
        }
      }
      // Review stars: Google needs both the rating and how many reviews; a business rating itself is not shown as stars.
      const r = d.aggregateRating;
      if (r && typeof r === 'object') {
        const lack = ['ratingValue'].concat(r.reviewCount || r.ratingCount ? [] : ['reviewCount or ratingCount']).filter((k) => k.includes(' or ') || !r[k]);
        if (lack.length) add(n.node, { code: 'SCHEMA_RATING', severity: 'warning', category: TECH, message: 'The review rating in the structured data is incomplete: Google ignores it', found: 'Missing: ' + lack.join(', '), expected: 'ratingValue and reviewCount, matching real reviews shown on the page' });
        else add(n.node, { code: 'SCHEMA_SELF_REVIEW', severity: 'info', category: TECH, message: 'A business rating on its own website: Google does not show stars for reviews a business publishes about itself, and fake or copied ratings can bring a penalty', found: `${r.ratingValue} from ${r.reviewCount || r.ratingCount} reviews`, expected: 'Only real reviews that are shown on the page' });
      }
      // The website the business points to.
      const u = d.url || d['@id'];
      if (u && truth.domain && /^https?:/i.test(String(u))) {
        let h = ''; try { h = new URL(String(u)).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { /* not a URL */ }
        const own = String(truth.domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
        if (h && own && h !== own && !/multiscreensite|dudaone|duda\.co|mobilesitesystem|ds-preview|localhost/.test(h)) add(n.node, { code: 'SCHEMA_URL', severity: 'warning', category: TECH, message: 'The business\'s structured data points to a different website', found: String(u), expected: 'https://' + own });
      }
    });
    nodes.filter((n) => n.data && /FAQPage/i.test(typeName(n.data['@type']))).forEach((n) => {
      const qs = [].concat(n.data.mainEntity || []).filter((q) => q && /Question/i.test(typeName(q['@type'])) && q.name && q.acceptedAnswer);
      if (!qs.length) add(n.node, { code: 'SCHEMA_FAQ_EMPTY', severity: 'warning', category: TECH, message: 'FAQ structured data with no complete question and answer: Google ignores it', found: 'FAQPage', expected: 'Each question with its answer (Question + acceptedAnswer)' });
    });
    if (!biz.length) return ctx.path === '/' ? { none: true } : null;
    const d = biz[0].data; const a = d.address && typeof d.address === 'object' ? (Array.isArray(d.address) ? d.address[0] || {} : d.address) : {};
    return ctx.path === '/' ? { type: typeName(d['@type']), name: String(d.name || ''), phone: String(d.telephone || ''), email: String(d.email || ''), url: String(d.url || ''),
      address: typeof d.address === 'string' ? d.address : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(', '), n: biz.length } : null;
  }

  // robots.txt, sitemap.xml and llms.txt: files at the root of the published website.
  // files = { robots: {status, text}, sitemap: {status, text}, llms: {status, text}, domain }.
  // Returns { raw: [findings without device], info: what each file says (for the Technical SEO and NAP tabs) }.
  const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'Bytespider', 'meta-externalagent'];
  const looksHtml = (t) => /^\s*(<!doctype|<html|<head|<body)/i.test(String(t || ''));
  function robotsGroups(text) {
    const groups = []; let cur = null; let lastWasAgent = false; const sitemaps = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      const l = line.replace(/#.*$/, '').trim(); if (!l) return;
      const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) return;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'sitemap') { sitemaps.push(v); return; }
      if (k === 'user-agent') { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; return; }
      lastWasAgent = false;
      if (cur && (k === 'disallow' || k === 'allow')) cur.rules.push({ k, v });
    });
    return { groups, sitemaps };
  }
  function blocksAll(groups, agent) {
    const g = groups.find((x) => x.agents.includes(agent.toLowerCase())) || (agent !== '*' ? null : null);
    if (!g) return false;
    return g.rules.some((r) => r.k === 'disallow' && r.v === '/') && !g.rules.some((r) => r.k === 'allow' && (r.v === '/' || r.v === '/*'));
  }
  function fileFindings(files, truth) {
    const raw = []; const info = { domain: files.domain || '', at: new Date().toISOString() };
    const item = (code, severity, location, message, found, expected, snippet) => raw.push({ code, severity, category: TECH, message, found: found || '', expected: expected || '', path: '/', selector: '(page)', location, visible: true, hiddenBy: '', snippet: snippet || '' });
    // The line of the file a value was found on, so the item shows where it is (and when it was read).
    const lineOf = (t, test) => { const l = String(t || '').split(/\r?\n/).find(test) || ''; return l.trim().slice(0, 220); };
    const ok = (f) => f && f.status === 200 && String(f.text || '').trim() && !looksHtml(f.text);
    const own = String(files.domain || '').replace(/^www\./, '').toLowerCase();
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
    // robots.txt
    const R = files.robots;
    if (R) {
      if (!ok(R)) { info.robots = { found: false, status: R.status || 0 }; item('ROBOTS_MISSING', 'warning', 'robots.txt', 'No robots.txt on the website: search engines expect one at /robots.txt', `https://${files.domain}/robots.txt → ${R.status || 'no answer'}`, 'Duda makes one on every publish: check Indexing & Crawling → URL Redirect for a custom robots.txt that replaces it'); }
      else {
        const { groups, sitemaps } = robotsGroups(R.text);
        const allBlocked = blocksAll(groups, '*'); const gBlocked = blocksAll(groups, 'googlebot');
        const ai = AI_BOTS.filter((b) => blocksAll(groups, b) || (allBlocked && !groups.some((g) => g.agents.includes(b.toLowerCase()))));
        info.robots = { found: true, status: 200, blocksAll: allBlocked, blocksGoogle: gBlocked, sitemaps, aiBlocked: ai, lines: String(R.text).split(/\r?\n/).length, text: String(R.text).slice(0, 3000) };
        if (allBlocked) item('ROBOTS_BLOCKS_ALL', 'critical', 'robots.txt', 'robots.txt tells every search engine not to read the website ("Disallow: /"): it will drop out of Google', 'User-agent: * / Disallow: /', 'Allow the website to be read (remove "Disallow: /")');
        else if (gBlocked) item('ROBOTS_BLOCKS_ALL', 'critical', 'robots.txt', 'robots.txt tells Google not to read the website ("Disallow: /" for Googlebot)', 'User-agent: Googlebot / Disallow: /', 'Allow Googlebot');
        if (!sitemaps.length) item('ROBOTS_NO_SITEMAP', 'info', 'robots.txt', 'robots.txt does not say where the sitemap is: search engines find pages faster when it does', '(no "Sitemap:" line)', `Sitemap: https://${files.domain}/sitemap.xml`);
        sitemaps.forEach((u) => { const h = hostOf(u); if (h && own && h !== own) item('ROBOTS_SITEMAP_DOMAIN', 'warning', 'robots.txt', 'robots.txt points to a sitemap on another website', u, `https://${files.domain}/sitemap.xml`); });
        if (!allBlocked && ai.length) item('ROBOTS_BLOCKS_AI', 'info', 'robots.txt', `robots.txt keeps AI assistants out (${ai.join(', ')}): ChatGPT, Claude, Perplexity and Google's AI answers cannot read or recommend the business from its website`, ai.join(', '), 'Allowed, unless the client chose to block them');
      }
    }
    // sitemap.xml
    const S = files.sitemap;
    if (S) {
      const isXml = S.status === 200 && /<(urlset|sitemapindex)\b/i.test(String(S.text || ''));
      if (!isXml) { info.sitemap = { found: false, status: S.status || 0 }; item('SITEMAP_MISSING', 'warning', 'sitemap.xml', 'No sitemap at /sitemap.xml: search engines use it to find every page', `https://${files.domain}/sitemap.xml → ${S.status || 'no answer'}`, 'A sitemap.xml (Duda makes one when the website is published)'); }
      else {
        const locs = [...String(S.text).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
        const other = locs.filter((u) => { const h = hostOf(u); return h && own && h !== own; });
        info.sitemap = { found: true, status: 200, urls: locs.length, index: /<sitemapindex/i.test(S.text) };
        // Duda leaves noindex pages out of its sitemap: an empty one means the whole website is set to noindex.
        if (!locs.length) item('SITEMAP_EMPTY', 'critical', 'sitemap.xml', 'The sitemap lists no pages: Duda leaves noindex pages out, so the whole website is probably set to "no index" and will not show in Google', 'sitemap.xml with 0 addresses', 'Turn off "Set the entire site to no index" in SEO settings, then publish');
        if (other.length) item('SITEMAP_DOMAIN', 'warning', 'sitemap.xml', `The sitemap lists ${other.length} address${other.length === 1 ? '' : 'es'} on another website`, other.slice(0, 3).join(', ') + (other.length > 3 ? ` +${other.length - 3}` : ''), `Addresses on https://${files.domain}`);
      }
    }
    // llms.txt: a plain text (Markdown) summary of the business for AI assistants (llmstxt.org).
    const L = files.llms;
    if (L) {
      if (!ok(L)) { info.llms = { found: false, status: L.status || 0, html: L.status === 200 && looksHtml(L.text) };
        item('LLMS_MISSING', 'info', 'llms.txt', info.llms.html ? 'llms.txt answers with a web page, not a text file: AI assistants find no summary of the business' : 'No llms.txt: Duda makes one on every publish (the summary AI assistants such as ChatGPT, Claude and Perplexity read), so it is missing or replaced by a custom file', `https://${files.domain}/llms.txt → ${info.llms.html ? 'a web page' : L.status || 'no answer'}`, 'Publish the website again; if it is still missing, check Indexing & Crawling → URL Redirect for a custom llms.txt'); }
      else {
        const t = String(L.text);
        const phones = [...new Set([...t.matchAll(/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-](\d{4})/g)].map((m) => m[1] + m[2] + m[3]))];
        const emails = [...new Set((t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
        const h1 = (t.match(/^\s*#\s+(.+)$/m) || [])[1] || '';
        const nameIn = truth.businessName && t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(String(truth.businessName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
        info.llms = { found: true, status: 200, title: h1.trim().slice(0, 120), phones, emails, nameIn: !!nameIn, chars: t.length, text: t.slice(0, 3000) };
        if (!/^\s*#\s+\S/.test(t)) item('LLMS_FORMAT', 'warning', 'llms.txt', 'llms.txt does not start with the business name as a "# " heading, as the llms.txt format expects', t.trim().split(/\n/)[0].slice(0, 120), `# ${truth.businessName || 'Business name'}`);
        if (truth.businessName && !nameIn) item('LLMS_NAME', 'warning', 'llms.txt', 'llms.txt never names the business as it is in Business Info', h1.slice(0, 120) || '(no name)', truth.businessName);
        const tp = truth.phones || [];
        phones.filter((d) => tp.length && !tp.includes(d)).forEach((d) => item('LLMS_PHONE', 'critical', 'llms.txt', 'llms.txt gives AI assistants a phone number that is not in Business Info', fmtPhone(d), tp.map(fmtPhone).join(', '),
          `In llms.txt as read on ${new Date().toISOString().slice(0, 10)}: “${lineOf(t, (l) => l.replace(/\D/g, '').includes(d))}”`));
        emails.forEach((e) => {
          const ln = `In llms.txt as read on ${new Date().toISOString().slice(0, 10)}: “${lineOf(t, (l) => l.toLowerCase().includes(e))}”`;
          if (isAutomationEmail(e)) item('EMAIL_AUTOMATION', 'critical', 'llms.txt', 'llms.txt gives AI assistants an automation email address (it is for Zapier or a form parser, not for customers)', e, (truth.emails || []).join(', ') || 'Remove it', ln);
          else if ((truth.emails || []).length && !truth.emails.includes(e)) item('LLMS_EMAIL', 'critical', 'llms.txt', 'llms.txt gives AI assistants an email that is not in Business Info', e, truth.emails.join(', '), ln);
        });
      }
    }
    return { raw, info };
  }

  /** A sample value written to show the format: "name@email.com", "you@example.com", "(555) 555-5555", "123-456-7890". */
  function sampleValue(v) {
    const t = String(v || '').toLowerCase();
    const em = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    const phones = (t.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || []).map((x) => x.replace(/\D/g, ''));
    const sampleEmail = (e) => /^(name|your\.?name|you|your|yourname|youremail|email|example|john|jane|john\.?doe|jane\.?doe|johndoe|janedoe|first\.?last|firstname|user|username|someone|me|test|hello)@/.test(e)
      || /@(email|example|domain|yourdomain|yourcompany|company|mail|test|website|yoursite|address)\.(com|org|net)$/.test(e);
    const samplePhone = (d) => /^(\d)\1{9}$/.test(d) || /^(1234567890|0123456789)$/.test(d) || /^\d{3}555\d{4}$/.test(d) || /^555/.test(d);
    return (em.length || phones.length) && em.every(sampleEmail) && phones.every(samplePhone);
  }
  // ---------- Forms: service choices ----------
  const UTILITY_PAGE = /^\/(home|contact|contact-us|about|about-us|our-story|team|meet-the-team|blog|news|reviews|testimonials|gallery|portfolio|projects|our-work|faq|faqs|privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|accessibility|sitemap|thank-you|thanks|careers|jobs|financing|specials|deals|offers|promotions|coupons|locations|service-areas|areas-we-serve|learn|resources|warranty|warranties|shop|store|cart|book|booking|schedule|quote|get-a-quote|estimate|pricing|packages|services|our-services)\/?$/i;
  /** The services a website has its own page for: { key, name, words } from each such page's title and address. */
  function serviceCatalog(allPaths, pagesMeta, pageInfo) {
    const out = []; const seen = new Set();
    allPaths.forEach((path) => {
      if (path === '/' || UTILITY_PAGE.test(path) || isBlogPath(path) || placeOfPath(path) || isThankYouPath(path) || (pageInfo[path] && pageInfo[path].blog)) return;
      const seg = String(path).toLowerCase().split('/').filter(Boolean);
      if (seg.length > 2 || seg.some((x) => CAR_WORDS.has(x))) return;
      const title = String((pagesMeta[path] && pagesMeta[path].title) || (pageInfo[path] && (pageInfo[path].h1 || pageInfo[path].title)) || '').split('|')[0].trim();
      const name = title && title.length <= 60 ? title : titleCase(seg[seg.length - 1].replace(/-/g, ' '));
      const words = [...new Set((name + ' ' + seg.join(' ').replace(/-/g, ' ')).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w) && !SLUG_FILLER.has(w)))];
      const key = compact(name); if (!words.length || seen.has(key)) return; seen.add(key);
      out.push({ key, name, words, svc: servicesOfPath(path) });
    });
    return out.slice(0, 40);
  }
  /** Does a form choice ("Paint Protection Film / Clear Bra") cover a service page? Same known service, or a shared word. */
  function choiceCovers(option, sp) {
    const o = String(option || '').toLowerCase();
    if (sp.svc.some((k) => { const sv = SERVICES.find((z) => z.key === k); return sv && new RegExp(sv.re.source, 'i').test(o); })) return true;
    const ow = o.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    return sp.words.some((w) => ow.some((x) => x === w || x.replace(/s$/, '') === w.replace(/s$/, '')));
  }
  // ---------- Privacy policy / terms: template fields left unfilled, and details that are not the business's ----------
  const LEGAL_PATH = /(privacy|terms|policy|policies|legal|disclaimer|cookie|conditions|sms-terms)/i;
  const TEMPLATE_FIELDS = [
    [/\bUSA County\b/i, 'the county left as "USA County"'],
    [/\[[^\]\n]{0,30}\b(company|business|name|address|state|county|city|e-?mail|phone|date|website|url|zip)\b[^\]\n]{0,30}\]/i, 'a [placeholder] field'],
    [/\{\{[^}\n]{1,40}\}\}/, 'a {{placeholder}} field'],
    [/\b(your|the) (company|business) name\b/i, '"your company name"'],
    [/\binsert\b[^.\n]{1,40}\bhere\b/i, '"insert … here"'],
    [/\(?\bXXX\)?[\s.-]?XXX[\s.-]?XXXX\b|\bXX\/XX\/XXXX\b/, 'a phone or date left as X\'s'],
    [/lorem ipsum/i, 'lorem ipsum'],
    [/\b(example\.com|yourdomain\.com|yourwebsite\.com|yoursite\.com)\b/i, 'an example web address'],
    [/\b123 Main St(reet)?\b/i, 'a sample address'],
  ];
  function htmlText(html) {
    try { const d = new DOMParser().parseFromString(String(html || ''), 'text/html'); d.querySelectorAll('script, style, noscript').forEach((x) => x.remove()); return clean(d.body ? d.body.textContent : ''); }
    catch (e) { return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
  }
  /** Problems in a policy's text. embedded: the text was loaded from Termageddon, so its contact details are checked here too. */
  function policyFindings(text, truth, embedded) {
    const out = []; const t = String(text || '');
    const ctx = (at, len) => '…' + t.slice(Math.max(0, at - 70), at + len + 70).replace(/\s+/g, ' ').trim() + '…';
    const seen = new Set();
    TEMPLATE_FIELDS.forEach(([re, what]) => {
      const m = re.exec(t); if (!m || seen.has(m[0].toLowerCase())) return; seen.add(m[0].toLowerCase());
      out.push({ code: 'POLICY_TEMPLATE', severity: 'critical', category: 'Content', message: `The ${embedded ? 'policy (loaded by Termageddon)' : 'policy / terms page'} still has ${what}`,
        found: cut(m[0], 80), expected: embedded ? 'Fill it in Termageddon (the policy\u2019s settings), then it updates on the website by itself' : 'The real value', snippet: ctx(m.index, m[0].length) });
    });
    const op = /\b(?:operated by|owned by|provided by|property of)\s+(?:the\s+)?([A-Z][A-Za-z0-9&'\u2019. -]{2,60}?)(?=\s*[,.(\u201c"]|\s+\(|\s+and\b|\s*$)/.exec(t);
    if (op && truth.businessName && !/^(us|we|our|this website|the website|company)$/i.test(op[1].trim()) && !matchesBusiness(op[1], truth))
      out.push({ code: 'POLICY_NAME', severity: 'critical', category: 'Business name', message: `The ${embedded ? 'policy (loaded by Termageddon)' : 'policy / terms page'} names a different business`, found: cut(op[1], 70), expected: truth.businessName, snippet: ctx(op.index, op[0].length) });
    if (embedded) {
      const phones = new Set(truth.phones || []);
      if (phones.size) [...t.matchAll(/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g)].forEach((m) => { const d = m[1] + m[2] + m[3]; if (!phones.has(d) && !seen.has(d)) { seen.add(d); out.push({ code: 'POLICY_CONTACT', severity: 'warning', category: 'Contact info', message: 'The policy (loaded by Termageddon) gives a phone number that is not in Business Info', found: fmtPhone(d), expected: [...phones].map(fmtPhone).join(', '), snippet: ctx(m.index, m[0].length) }); } });
      const emails = (truth.emails || []).map((e) => e.toLowerCase());
      if (emails.length) [...t.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].forEach((m) => { const e = m[0].toLowerCase(); if (!emails.includes(e) && !/termageddon|example\.com/.test(e) && !seen.has(e)) { seen.add(e); out.push({ code: isAutomationEmail(e) ? 'EMAIL_AUTOMATION' : 'POLICY_CONTACT', severity: isAutomationEmail(e) ? 'critical' : 'warning', category: 'Contact info', message: isAutomationEmail(e) ? 'The policy (loaded by Termageddon) shows an automation email address' : 'The policy (loaded by Termageddon) gives an email that is not in Business Info', found: e, expected: emails.join(', '), snippet: ctx(m.index, m[0].length) }); } });
      const zips = new Set((truth.addresses || []).map((a) => a && a.zip).filter(Boolean));
      if (zips.size) [...t.matchAll(/\b([A-Z][A-Za-z .'-]{2,30}),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/g)].forEach((m) => { if (!zips.has(m[3]) && !seen.has(m[3])) { seen.add(m[3]); out.push({ code: 'POLICY_ADDRESS', severity: 'warning', category: 'Contact info', message: 'The policy (loaded by Termageddon) gives an address (notice address) that is not in Business Info', found: cut(m[0], 80), expected: (truth.addresses || []).map((a) => [a.street, a.city, [a.region || a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')).join(' | '), snippet: ctx(m.index, m[0].length) }); } });
    }
    return out;
  }
  // ---------- Redirects ----------
  /**
   * rd = { rules: [{ source, target, code }], past: [paths that existed in an earlier scan], domain }.
   * liveStatus(path) → the HTTP status of that address on the published website (after following redirects), or 0.
   */
  async function redirectFindings(rd, allPaths, liveStatus) {
    const out = []; const pages = new Set(allPaths.map(normalizePath));
    const pathOf = (u) => { const x = String(u || '').trim(); if (!x) return ''; if (/^https?:\/\//i.test(x)) { try { const q = new URL(x); return rd.domain && q.hostname.replace(/^www\./, '').toLowerCase() !== String(rd.domain).replace(/^www\./, '').toLowerCase() ? '' : normalizePath(q.pathname); } catch (e) { return ''; } } return normalizePath(x); };
    const rules = [].concat(rd.rules || []).filter((r) => r && r.source).slice(0, 300).map((r) => ({ src: normalizePath(r.source), target: String(r.target || ''), to: pathOf(r.target), code: Number(r.code) || 301 }));
    const bySrc = new Map(rules.map((r) => [r.src, r]));
    let budget = 40;
    const status = async (p) => { if (!liveStatus || budget <= 0) return 0; budget--; try { return Number(await liveStatus(p)) || 0; } catch (e) { return 0; } };
    for (const r of rules) {
      const base = { category: TECH, path: r.src, found: `${r.src} → ${r.target}` };
      if (r.to && bySrc.has(r.to)) {
        const seenR = new Set([r.src]); let cur = r.to; let loop = false;
        while (bySrc.has(cur)) { if (seenR.has(cur)) { loop = true; break; } seenR.add(cur); cur = bySrc.get(cur).to; if (!cur) break; }
        out.push(Object.assign({}, base, loop ? { code: 'REDIRECT_LOOP', severity: 'critical', message: `Redirect loop: ${r.src} leads back to itself`, expected: 'Point it straight at the page that replaced it' }
          : { code: 'REDIRECT_CHAIN', severity: 'warning', message: `Redirect chain: ${r.src} → ${r.to} → ${bySrc.get(r.to).to || bySrc.get(r.to).target}`, expected: `Redirect ${r.src} straight to ${bySrc.get(r.to).to || bySrc.get(r.to).target}` }));
        continue;
      }
      if (r.to && pages.has(r.src) && r.src !== '/') out.push(Object.assign({}, base, { code: 'REDIRECT_SHADOWS_PAGE', severity: 'warning', message: `A redirect sends ${r.src} away, but the website still has a page there`, expected: 'Remove the redirect, or the page if it was replaced' }));
      if (r.to && !pages.has(r.to) && !isBlogPath(r.to)) {
        const st = await status(r.src);
        if (st >= 400 || (!st && !liveStatus)) out.push(Object.assign({}, base, { code: 'REDIRECT_BROKEN', severity: st >= 400 ? 'critical' : 'warning', message: st >= 400 ? `Redirect ${r.src} lands on a page that does not exist (${st})` : `Redirect ${r.src} points to ${r.to}, which is not one of the website's pages`, expected: 'Point it at a page that exists' }));
      }
      if (r.code === 302 || r.code === 307) out.push(Object.assign({}, base, { code: 'REDIRECT_TEMPORARY', severity: 'info', message: `Redirect ${r.src} is temporary (${r.code}): Google keeps the old address`, expected: 'Use a permanent 301 redirect for a page that moved for good' }));
    }
    // Pages that existed in an earlier scan, are gone now, and have no redirect: visitors and Google get a 404.
    const gone = [...new Set([].concat(rd.past || []).map(normalizePath))].filter((p) => p && p !== '/' && !pages.has(p) && !bySrc.has(p) && !isBlogPath(p)).slice(0, 30);
    for (const p of gone) {
      const st = await status(p);
      if (st && st < 400) continue;
      if (!st && liveStatus) continue;
      const near = bestMatch(p, [...pages]);
      out.push({ code: 'REDIRECT_MISSING', severity: 'warning', category: TECH, path: p, found: `${p} → ${st || 'not published, not checked'}`,
        message: `${p} was a page in an earlier scan; it is gone now and has no redirect${st ? ` (it gives ${st})` : ''}`, expected: near ? `A 301 redirect to ${near} (or the page that replaced it)` : 'A 301 redirect to the page that replaced it, or leave it gone if nothing did' });
    }
    return out;
  }
  function bestMatch(p, pages) {
    const w = (x) => new Set(String(x).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !SLUG_FILLER.has(t)));
    const a = w(p); let best = '', score = 0;
    pages.forEach((q) => { if (q === '/') return; const b = w(q); let n = 0; a.forEach((t) => { if (b.has(t)) n++; }); const sc = n / Math.max(1, Math.max(a.size, b.size)); if (sc > score) { score = sc; best = q; } });
    return score >= 0.4 ? best : '';
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
   * A photo gallery's caption button that was never set up: Duda keeps one in the code for every picture
   * (labelled "Button", with no link) and shows it only once a link is given. It is not on the page a
   * visitor sees, whatever the styles in the code say before the gallery's own script has run.
   */
  function galleryCaptionButton(el) {
    const a = el.closest && el.closest('a.caption-button, .caption-button');
    if (!a || !a.closest('.caption-container, .caption-inner')) return false;
    if (!a.closest('[data-widget-type="photoGallery"], .dmPhotoGallery, [data-element-type="dPhotoGalleryId"]')) return false;
    const href = String(a.getAttribute('href') || '').trim();
    return !href || href === '#' || /^javascript:/i.test(href);
  }

  /**
   * The agency's own logo in the footer — the "website by us" badge every client site carries.
   *
   * It is our image, not the client's, and its alt text is ours to decide, so an audit of the
   * CLIENT's website has no business reporting it. Duda's template gives it a fixed id, which is a
   * far better signal than anything about the picture itself.
   */
  const AGENCY_BADGE_ID = /^(footer-logo|agency-logo|credit-logo|built-by-logo|designer-logo)$/i;
  /** Our own agencies: their credit on a client website is expected, hidden or not. */
  const AGENCY_RE = /detailers\s*road\s*map|8\s*bit\s*creative|eight\s*bit\s*creative/i;
  /** "Website by …", "Designed by …": a web designer's credit. */
  const CREDIT_RE = /\b(?:web\s*site|site|web)?\s*(?:design(?:ed)?|develop(?:ed|ment)|built|created|made|managed|maintained|hosted|optimi[sz]ed|seo)\s+by\b|\bwebsite\s+by\b|\bweb\s+design\s+by\b|\bpowered\s+by\b/i;
  /** Widgets and services that sign their own output ("Powered by Google"): not a designer's credit. */
  const SERVICE_CREDIT = /powered\s+by\s+(google|yelp|facebook|duda|stripe|square|paypal|shopify|elfsight|trustindex|birdeye|podium|urable|weglot|userway|accessibe|mapbox|openstreetmap|tidio|wix|wordpress|calendly|squareup|housecall|jobber|tekmetric|shopmonkey)/i;
  /** Hidden on purpose, rather than switched to another device's version of the page. */
  const SNEAKY_HIDE = /^(display:none|visibility:hidden|hidden attribute)$/;
  function isAgencyBadge(el) {
    for (let x = el, n = 0; x && n < 3; x = x.parentElement, n++) {
      const id = (x.getAttribute && x.getAttribute('id')) || '';
      if (AGENCY_BADGE_ID.test(id)) return true;
      const cls = (x.getAttribute && x.getAttribute('class')) || '';
      if (/(^|\s)(footer-logo|agency-logo|credit-logo)(\s|$)/i.test(cls)) return true;
    }
    return false;
  }

  /**
   * A page's copy as a reader goes through it: every heading and paragraph of the page body, top to
   * bottom, one entry each (a paragraph with a link in it stays one paragraph). The header, footer,
   * menus, pop-ups and forms are left out: they are the same on every page. Used by vs Docs.
   */
  function pageCopy(body, device) {
    if (!body) return [];
    const SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dt, dd, td, th, .dmNewParagraph, [data-element-type="paragraph"]';
    const out = [];
    // Buttons too, in their place: a section often ends with one, and a packages section has one per package.
    body.querySelectorAll(SEL + ', a.dmButtonLink').forEach((el) => {
      if (out.length >= 300 || el.closest('script, style, noscript, nav, form')) return;
      if (el.matches('a.dmButtonLink')) {
        if (locationOf(el) !== 'Body') return;
        const t = clean(el.textContent); if (!t) return;
        const hid = hiddenReason(el, device) || '';
        out.push({ t: t.slice(0, 200), tag: 'btn', ...(hid ? { hid } : {}) }); return;
      }
      if (el.closest('button, .dmButtonLink')) return;
      if (el.querySelector(SEL)) return;
      if (locationOf(el) !== 'Body') return;
      const t = clean(el.textContent);
      if (t.length < 3 || !/[a-z]/i.test(t)) return;
      const hd = el.closest('h1, h2, h3, h4, h5, h6');
      const tag = hd ? hd.tagName.toLowerCase() : el.tagName.toLowerCase() === 'li' ? 'li' : 'p';
      const hid = hiddenReason(el, device) || '';
      const prev = out[out.length - 1];
      if (prev && prev.t === t) return;
      out.push({ t: t.slice(0, 2000), tag, ...(hid ? { hid } : {}) });
    });
    return out;
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
    const btnList = [];
    const linkRows = new Map();  // label|to|section -> an internal link a visitor reads, for the "opens the page it promises" check
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
    // An automation address (Zapier, a form parser, "no reply") shown to visitors: its own item, whatever check found it.
    const autoMailItem = (el, e, where, category) => add(el, { code: 'EMAIL_AUTOMATION', severity: 'critical', category: category || 'Contact info',
      message: `An automation email address is shown to visitors${where || ''}: it is in Business Info so leads reach a system (Zapier, a form parser), not for customers to write to`,
      found: e, expected: (truth.emails || []).length ? (truth.emails || []).join(', ') : 'Remove it (Business Info has no public email)' });

    // --- Meta ---
    // Spacing and punctuation slips in the words Google shows (SEO title, meta description) and reads
    // (alt text), checked on the raw text: "Schaumburg,IL", "Coating  |  Detailing", "today!!", "car .".
    const spacingSlip = (raw) => {
      const s = String(raw || '').replace(/\u00a0/g, ' ').trim();
      if (!s) return '';
      if (/\S {2,}\S/.test(s)) return 'two spaces in a row';
      if (/\w\s+[,.;:!?](\s|$)/.test(s)) return 'a space before a comma or full stop';
      if (/[a-z][,;:!?][A-Za-z]/.test(s) || /[a-z]{2}\.[A-Z][a-z]/.test(s)) return 'no space after a comma or full stop';
      if (/([!?,;:])\1/.test(s) || /[^.]\.\.(?!\.)/.test(s)) return 'doubled punctuation';
      return '';
    };
    const slipItem = (el, raw, where, category) => {
      const why = spacingSlip(raw); if (!why) return;
      add(el, { code: 'TEXT_SPACING', severity: 'warning', category, message: `Spacing or punctuation slip in the ${where}: ${why}`, found: cut(String(raw).replace(/\s+$/, '').replace(/^\s+/, ''), 200) });
    };
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
    if (title) slipItem(titleEl, titleEl.textContent, 'SEO title', 'Meta / SEO');
    // Look-alike characters in the words Google shows. "Ceramic Coating │ Temple" looks right in the
    // editor, but "│" is a box-drawing symbol (from copy and paste, or AI-written text): screen readers
    // read it differently, find-and-replace for "|" misses it, and Google is more likely to rewrite the
    // title. The only separator is the keyboard pipe "|".
    const oddChars = (raw, where, el) => {
      const s0 = String(raw || '');
      if (!s0.trim()) return;
      const hits = new Map();
      let m; PIPE_LIKE.lastIndex = 0;
      while ((m = PIPE_LIKE.exec(s0))) hits.set(m[0], 'looks like the keyboard pipe "|" but is not');
      // Dashes only count as a SEPARATOR in a title (" – ", " — "); inside a sentence they are punctuation.
      if (where === 'SEO title') { DASH_SEP.lastIndex = 0; while ((m = DASH_SEP.exec(s0))) hits.set(m[1], 'used as a separator instead of the keyboard pipe "|"'); }
      INVISIBLE.lastIndex = 0;
      while ((m = INVISIBLE.exec(s0))) hits.set(m[0], 'an invisible character, usually from copy and paste');
      if (!hits.size) return;
      const fixed = s0.replace(PIPE_LIKE, '|').replace(where === 'SEO title' ? DASH_SEP : /(?!)/, ' | ').replace(INVISIBLE, '').replace(/\s{2,}/g, ' ').trim();
      const what = [...hits].map(([c, why]) => `${CHAR_NAME[c] || 'character'} ${/\s|[\u200b-\u200f\u2060\ufeff\u00ad]/.test(c) ? '' : `"${c}" `}(U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}): ${why}`).join('; ');
      add(el, { code: 'META_LOOKALIKE_CHAR', severity: 'warning', category: 'Meta / SEO',
        message: `The ${where} has ${hits.size === 1 ? 'a look-alike character' : hits.size + ' look-alike characters'}: ${what}. Use only the standard keyboard pipe | as a separator`,
        found: cut(s0, 200), expected: cut(fixed, 200) });
    };
    if (title) oddChars(titleEl.textContent, 'SEO title', titleEl);
    if (desc) oddChars(descEl.getAttribute('content'), 'meta description', descEl);
    if (desc) slipItem(descEl, descEl.getAttribute('content'), 'meta description', 'Meta / SEO');
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
    if (faqBlocks > 1) add(titleEl, { code: 'FAQ_SCHEMA_MULTI', severity: 'warning', category: TECH, message: `This page has ${faqBlocks} FAQ schema blocks — only one per page should have "enable FAQ schema" turned on`, found: `${faqBlocks} FAQPage blocks` });
    // An FAQ section on the page with the schema switch left off
    const faqEl = doc.querySelector('[class*="faq" i], [data-element-type*="faq" i], [id*="faq" i]');
    if (!faqBlocks && faqEl && (clean(faqEl.textContent).match(/\?/g) || []).length >= 3) {
      add(faqEl, { code: 'FAQ_SCHEMA_OFF', severity: 'info', category: TECH, message: 'Looks like an FAQ section, but "enable FAQ schema" is off — no FAQ structured data on this page' });
    }
    if (ctx.path === '/' && !types.some((t) => /LocalBusiness|AutoRepair|AutoWash|Store|ProfessionalService|Organization/i.test(t))) {
      add(titleEl, { code: 'SCHEMA_LOCALBUSINESS_OFF', severity: 'warning', category: TECH, message: 'No local business structured data on the home page — turn on "Local business schema" in Duda Business Info' });
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
    // The choices a form offers (a drop-down, or a set of tick boxes / round buttons), for the "service choices" check.
    const formChoices = [];
    const labelOf = (el, form) => {
      const id = el.getAttribute('id');
      const l = (id && form.querySelector(`label[for="${(window.CSS && CSS.escape ? CSS.escape(id) : id)}"]`)) || el.closest('label');
      if (l) return clean(l.textContent);
      for (let e = el.parentElement, k = 0; e && e !== form && k < 3; e = e.parentElement, k++) { const lab = e.querySelector('label, .dmform-label, legend'); if (lab && !lab.contains(el)) return clean(lab.textContent); }
      return clean(el.getAttribute('aria-label') || el.getAttribute('name') || '');
    };
    realForms.forEach((form) => {
      form.querySelectorAll('select').forEach((sel) => {
        const options = [...sel.options].map((o) => clean(o.textContent)).filter((t) => t && !/^(select|choose|pick|please|--|-)/i.test(t)).slice(0, 60);
        if (options.length >= 2) formChoices.push({ selector: uniqueSelector(sel), label: cut(labelOf(sel, form), 80), options });
      });
      const groups = new Map();
      form.querySelectorAll('input[type="checkbox" i], input[type="radio" i]').forEach((i) => { const n = i.getAttribute('name') || ''; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(i); });
      groups.forEach((list) => {
        if (list.length < 2) return;
        const options = list.map((i) => { const id = i.getAttribute('id'); const l = (id && form.querySelector(`label[for="${(window.CSS && CSS.escape ? CSS.escape(id) : id)}"]`)) || i.closest('label'); return clean(l ? l.textContent : (i.getAttribute('value') || '')); }).filter(Boolean).slice(0, 60);
        const box = list[0].closest('.dmforminput, .dmform-field, fieldset, div') || list[0];
        const head = box.querySelector('.dmform-label, legend, label:not([for])');
        formChoices.push({ selector: uniqueSelector(box), label: cut(clean(head ? head.textContent : '') || labelOf(list[0], form), 80), options });
      });
    });
    // A privacy policy or terms page loaded by a script (Termageddon): the page itself only says "Please wait
    // while the policy is loaded". The policy's own address is kept, so the scan can read the real text.
    const policies = [];
    doc.querySelectorAll('[data-policy-key]').forEach((el) => {
      const key = el.getAttribute('data-policy-key'); if (!/^[A-Za-z0-9=_-]{8,200}$/.test(key || '')) return;
      const extra = String(el.getAttribute('data-extra') || '').replace(/&amp;/g, '&');
      policies.push({ url: `https://app.termageddon.com/api/policy/${key}${extra ? '?' + extra : ''}`, selector: uniqueSelector(el) });
    });
    if (!policies.length) doc.querySelectorAll('a[href*="app.termageddon.com/api/policy/"]').forEach((a) => { if (policies.length < 3) policies.push({ url: a.getAttribute('href'), selector: uniqueSelector(a.parentElement || a) }); });
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
      // What the page calls itself. Business data named after the page is the website's own data filled
      // in wrongly ("Ceramic Pro Gold Package"), not another business.
      const flatT = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const heads = [title].concat([...doc.querySelectorAll('h1')].map((h) => h.textContent)).map(flatT).filter((x) => x.length >= 6);
      schemas.forEach(({ node, data, biz }) => {
        // One field can list several numbers ("+1-253-533-6776,+1-360-915-6218"): each is checked on its own.
        const tels = String(data.telephone || '').split(/[,;/|]|\bor\b/i).map((x) => normPhone(x)).filter((d) => d.length >= 10);
        const theirs = tels.filter((d) => phoneOk(d));
        tels.filter((d) => !phoneOk(d)).forEach((d) => add(node, { code: 'SCHEMA_PHONE', severity: theirs.length ? 'warning' : 'critical', category: 'Schema', verify: theirs.length > 0,
          message: theirs.length ? 'Structured data (JSON-LD) lists a second phone that is not in Business Info (add it there if it is theirs)' : 'Structured data (JSON-LD) phone differs from Business Info', found: fmtPhone(d.slice(-10)), expected: expectedPhones }));
        if (data.email && isAutomationEmail(data.email)) autoMailItem(node, String(data.email), ' in the structured data (JSON-LD), which Google reads', 'Schema');
        else if (data.email && !emailOk(data.email)) add(node, { code: 'SCHEMA_EMAIL', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) email differs from Business Info', found: data.email, expected: expectedEmails });
        if (biz && data.name && truth.businessName && !matchesBusiness(data.name, truth)) {
          const named = flatT(data.name);
          const ownData = theirs.length > 0 || (named.length >= 6 && heads.some((h) => h.includes(named) || named.includes(h)));
          add(node, ownData
            ? { code: 'SCHEMA_NAME', severity: 'warning', category: 'Schema', message: 'Structured data (JSON-LD) uses the page\'s title as the business name: their own data, named wrongly', found: data.name, expected: truth.businessName }
            : { code: 'SCHEMA_NAME', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) business name differs from Business Info', found: data.name, expected: truth.businessName });
        }
        const a = normAddress(data.address);
        const zips = truth.addresses.filter((x) => x.zip);
        if (a && a.zip && zips.length && !zips.some((x) => x.zip === a.zip)) add(node, { code: 'SCHEMA_ADDRESS', severity: 'critical', category: 'Schema', message: 'Structured data (JSON-LD) ZIP differs from Business Info', found: [a.street, a.city, a.zip].filter(Boolean).join(', '), expected: zips.map((x) => [x.street, x.city, x.zip].filter(Boolean).join(', ')).join(' | ') });
      });
    }
    schemas.forEach(({ node, data }) => {
      [].concat(data.sameAs || []).forEach((u) => checkSocial(node, u, 'Schema sameAs'));
    });
    // The structure itself, the way Google reads it (Technical SEO). Desktop only: the code is the same on every device.
    const schemaBiz = device === 'desktop' ? schemaQuality(doc, ctx, add, truth) : null;

    // --- Text nodes: phones, emails, placeholders, copyright ---
    const body = doc.body;
    const tn = body ? textNodes(body) : [];
    const perEl = new Map();
    tn.forEach((n) => { const p = n.parentElement; perEl.set(p, (perEl.get(p) || '') + n.nodeValue); });
    // Whole paragraphs, links included, for proofreading. The pieces above are split wherever a link
    // or a styled span starts ("This includes hydrophobic paint enhancements with our" + a link), and a
    // piece read on its own looks like an unfinished sentence when it is not.
    const PROSE = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dt, dd, td, th, .dmNewParagraph, [data-element-type="paragraph"]';
    const prose = [];
    if (body) {
      const seenP = new Set();
      body.querySelectorAll(PROSE).forEach((el) => {
        if (prose.length >= 400 || el.closest('script, style, noscript, nav, form, [id="hcontainer"], .dmHeader')) return;
        if (el.querySelector(PROSE)) return;          // its inner paragraphs are read on their own
        const t = textNoLabels(el);
        if (t.length < 12 || seenP.has(t)) return;
        seenP.add(t);
        prose.push({ el, text: t.slice(0, 3000) });
      });
    }
    // A web designer's credit ("Website by …"), above all one hidden from visitors: Google and SEO
    // tools (Ahrefs, Semrush) read hidden text and follow hidden links, so it is somebody's free
    // advertising on the client's website. Our own agencies' credits are expected and left alone.
    const credited = new Set();
    const creditCheck = (el, t) => {
      if (!t || t.length > 160 || !CREDIT_RE.test(t) || SERVICE_CREDIT.test(t) || AGENCY_RE.test(t)) return;
      if (truth.businessName && matchesBusiness(t.replace(CREDIT_RE, ' '), truth)) return;
      const box = el.closest('a, p, div, span, li, footer') || el;
      if (credited.has(box)) return; credited.add(box);
      const why = hiddenReason(el, device);
      const sneaky = why && SNEAKY_HIDE.test(why);
      add(el, sneaky
        ? { code: 'DESIGNER_CREDIT', severity: 'critical', category: 'Business name', hiddenCredit: true, message: 'Hidden credit to a web designer: visitors don\'t see it, but Google and SEO tools (Ahrefs, Semrush) read it', found: cut(t, 160) }
        : { code: 'DESIGNER_CREDIT', severity: 'warning', category: 'Business name', message: 'Credit to another web designer or company on the client\'s website', found: cut(t, 160) });
    };
    perEl.forEach((text, el) => {
      const t = clean(text);
      creditCheck(el, t);
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
      // A hidden "Button" (display:none or visibility:hidden) is part of Duda's widget kept in the code
      // (a gallery with captions switched off keeps one per picture): visitors never see it and screen
      // readers skip it. Every other default label is still reported, hidden or not.
      if (DEFAULT_LABEL.test(t) && !(t === 'Button' && (hiddenReason(el, device) || galleryCaptionButton(el)))) add(el, { code: 'PLACEHOLDER', severity: 'critical', category: 'Content', message: `Duda's default label left on the page ("${t}")`, found: t, expected: 'Real wording, or remove the element' });
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
          // A form field's placeholder is a format hint ("name@email.com", "(555) 555-5555"), not contact details.
          if (a.value && /\d{3}|@/.test(a.value) && !((n === 'placeholder' || n === 'data-placeholder-original') && sampleValue(a.value))) scanValue(el, a.value, 'Contact info', n);
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
        if (isAutomationEmail(e)) autoMailItem(el, e, where);
        else if (!emailOk(e)) add(el, { code: 'EMAIL_MISMATCH', severity: 'critical', category, message: `Email not in Business Info${where}`, found: e, expected: expectedEmails });
      });
    }

    // --- Links ---
    // The headings of the page, in order, so a link can say which section it sits in ("Read more"
    // under "Ceramic Coating"). Read once per page, only if there is an internal link to describe.
    let linkHeads = null;
    const sectionOf = (a) => {
      if (!linkHeads) linkHeads = Array.prototype.slice.call(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'));
      let best = '';
      for (const h of linkHeads) {
        if (h.contains(a)) continue;
        if (h.compareDocumentPosition(a) & 4) { const tx = clean(h.textContent); if (tx) best = tx; } else break;
      }
      return best.slice(0, 120);
    };
    const nearOf = (a, label) => {
      let e = a.parentElement;
      for (let n = 0; e && n < 5; e = e.parentElement, n++) {
        const tx = clean(e.textContent);
        if (tx.length > label.length + 25) return cut(tx.replace(label, ' ').replace(/\s+/g, ' ').trim(), 220);
      }
      return '';
    };
    // Sections a link can scroll to: ids, names and Duda's anchor settings (data-* values), read once per page.
    let anchorIds = null;
    const anchorEl = (frag) => {
      if (!anchorIds) {
        anchorIds = new Map();
        doc.querySelectorAll('[id], [name], *').forEach((e) => {
          for (const at of e.attributes || []) {
            if (!(at.name === 'id' || at.name === 'name' || at.name.startsWith('data-anchor') || (at.name.startsWith('data-') && /anchor|section|scroll/i.test(at.name)))) continue;
            const v = String(at.value || '').trim().toLowerCase(); if (v && v.length < 120 && !anchorIds.has(v)) anchorIds.set(v, e);
          }
        });
      }
      return anchorIds.get(String(frag || '').toLowerCase()) || null;
    };
    /** What a visitor sees where a section link lands: the section's heading and first words. */
    const sectionText = (e) => {
      for (let n = 0, x = e; x && n < 4; n++, x = x.nextElementSibling || (x.parentElement && x.parentElement.nextElementSibling)) {
        const t = clean(x.textContent); if (t.length >= 20) { const h = x.querySelector && x.querySelector('h1, h2, h3, h4, h5, h6'); return cut((h ? clean(h.textContent) + ' \u2014 ' : '') + t, 240); }
      }
      return '';
    };
    /**
     * Formatting can cut one phrase into several links to the same page ("auto" + "window" + "tinting").
     * The whole phrase is what the link promises: the run of neighbouring links with the same address,
     * read as one when the paragraph has them side by side. Each element keeps its own selector.
     */
    const splitPhrase = (a, label) => {
      const href = a.getAttribute('href'); let blk = a.parentElement;
      for (let n = 0; blk && n < 4 && !/^(P|LI|H[1-6]|TD|DD|BLOCKQUOTE|DIV)$/.test(blk.tagName); n++) blk = blk.parentElement;
      if (!blk || !href) return null;
      const same = Array.prototype.filter.call(blk.querySelectorAll('a'), (x) => x.getAttribute('href') === href);
      if (same.length < 2) return null;
      const para = clean(blk.textContent).toLowerCase();
      const at = same.indexOf(a); if (at < 0) return null;
      let lo = at, hi = at;
      const joined = (i, j) => same.slice(i, j + 1).map((x) => clean(x.textContent)).join(' ').toLowerCase();
      while (lo > 0 && para.includes(joined(lo - 1, hi))) lo--;
      while (hi < same.length - 1 && para.includes(joined(lo, hi + 1))) hi++;
      if (lo === hi) return null;
      return { text: clean(same.slice(lo, hi + 1).map((x) => clean(x.textContent)).join(' ')), first: same[lo], n: hi - lo + 1 };
    };
    const noteLink = (a, to, label, isButton, frag) => {
      const where = locationOf(a);
      if (where === 'Head / Meta') return;
      // Menus are a list of page names; a header or footer only counts when it is a button.
      if ((where === 'Header' || where === 'Footer' || where === 'Side panel') && !isButton) return;
      if (!label || label.length > 80 || linkRows.size >= 150) return;
      const sp = splitPhrase(a, label);
      const el = sp ? sp.first : a;
      const text = sp && sp.text.length <= 120 ? sp.text : label;
      const context = sectionOf(el);
      frag = String(frag || '').replace(/^#/, '');
      const k = [text.toLowerCase(), to, frag.toLowerCase(), context.toLowerCase()].join('|');
      if (linkRows.has(k)) return;
      const row = { el, text, to, button: !!isButton, context, near: nearOf(el, text) };
      if (sp) Object.assign(row, { parts: sp.n, part: label });
      // The fragment is kept for this link only (the page address stays the same everywhere else).
      if (frag) {
        row.frag = cut(frag, 100);
        if (to === ctx.path) { const e = anchorEl(frag); row.anchor = e ? { found: true, text: sectionText(e) } : { found: false }; }
      }
      linkRows.set(k, row);
    };
    doc.querySelectorAll('a').forEach((a) => {
      const raw = a.getAttribute('href');
      const text = clean(a.textContent);
      // Anything that looks like a button to a visitor: Duda's own, a btn class, or role="button".
      // A bare "#" on a script-driven toggle is normal, so only button-ish links are reported.
      const isButton = /\bdmButtonLink\b/.test(cls(a)) || /(^|[\s_-])(btn|button)([\s_-]|$)/i.test(cls(a)) || a.getAttribute('role') === 'button';
      // Every button, in page order, with where it goes: the "vs Docs" check compares them with the
      // buttons the copy document asked for.
      const btnRow = (isButton || /^(tel|sms|mailto):/i.test(String(raw || '').trim())) && btnList.length < 120 && locationOf(a) !== 'Head / Meta'
        ? { text: cut(text || clean(a.getAttribute('aria-label') || a.getAttribute('title') || ''), 80), to: '', href: cut(String(raw || ''), 200), where: locationOf(a), button: !!isButton, hidden: !!hiddenReason(a, device) } : null;
      if (btnRow) btnList.push(btnRow);
      const btnTo = (to) => { if (btnRow && !btnRow.to) btnRow.to = to; };
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
          || (CONTROL_WORD.test(label) && inMenu(a))
          // A photo gallery's spare caption button: Duda shows it only once it has a link.
          || galleryCaptionButton(a)
          // Hidden on purpose: nobody can click it.
          || SNEAKY_HIDE.test(hiddenReason(a, device) || '');
        if (isButton && !hasPopup && !control) add(a, { code: 'BUTTON_NO_LINK', severity: 'warning', category: 'Links', message: 'Button has no link (href is empty, # or javascript:)', found: label });
        return;
      }
      const href = raw.trim();

      if (/^tel:/i.test(href)) {
        const d = normPhone(safeDecode(href.slice(4)));
        btnTo('tel:' + d);
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
        btnTo('mailto:' + e);
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
        if (isAutomationEmail(e)) { autoMailItem(a, e, ' (an email link opens it)'); return; }
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
      if (href.startsWith('#')) {
        // A button that scrolls to a section of this page: fine when the section is there.
        const fr = href.slice(1).trim();
        if (isButton && fr && !hasPopup && !/^(top|!|\/)/i.test(fr)) noteLink(a, ctx.path, text || clean(a.getAttribute('aria-label') || ''), isButton, fr);
        return;
      }

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
        internal.add(normalizePath(siteMatch[2] || '/')); btnTo(normalizePath(siteMatch[2] || '/'));
        noteLink(a, normalizePath(siteMatch[2] || '/'), text || clean(Array.prototype.map.call(a.querySelectorAll('img'), (i) => i.getAttribute('alt') || '').join(' ')) || clean(a.getAttribute('aria-label') || ''), isButton, u.hash);
        return;
      }
      // A relative address ("/", "/contact") opens on whatever website the page is on: on the published
      // website that is the client's own domain. Only an address written out in full can point at the editor.
      if (!isAbs) {
        internal.add(normalizePath(u.pathname)); btnTo(normalizePath(u.pathname));
        noteLink(a, normalizePath(u.pathname), text || clean(Array.prototype.map.call(a.querySelectorAll('img'), (i) => i.getAttribute('alt') || '').join(' ')) || clean(a.getAttribute('aria-label') || ''), isButton, u.hash);
        return;
      }
      if (EDITOR_HOSTS.test(u.hostname) || sameHost) {
        add(a, { code: 'LINK_EDITOR_URL', severity: 'critical', category: 'Links', message: 'Link points to a Duda editor/preview domain', found: href });
        return;
      }
      const hostNoWww = u.hostname.toLowerCase().replace(/^www\./, '');
      if (truth.domain && hostNoWww === truth.domain.replace(/^www\./, '')) {
        internal.add(normalizePath(u.pathname)); btnTo(normalizePath(u.pathname));
        noteLink(a, normalizePath(u.pathname), text || clean(Array.prototype.map.call(a.querySelectorAll('img'), (i) => i.getAttribute('alt') || '').join(' ')) || clean(a.getAttribute('aria-label') || ''), isButton, u.hash);
        return;
      }
      const net = socialNetOf(u.href);
      if (net) { checkSocial(a, u.href, 'Link'); return; }
      if (u.protocol === 'http:') add(a, { code: 'LINK_HTTP', severity: 'info', category: 'Links', message: 'External link uses insecure http://', found: href });
      // A link to another website that visitors can't see (hidden on purpose, not just swapped for
      // another device's version): search engines and SEO tools still follow it.
      {
        const why = hiddenReason(a, device);
        if (why && SNEAKY_HIDE.test(why) && !AGENCY_RE.test(u.hostname + ' ' + text) && !isAgencyBadge(a)) {
          add(a, { code: 'HIDDEN_LINK', severity: 'warning', category: 'Links', message: 'Hidden link to another website: visitors don\'t see it, but Google and SEO tools follow it', found: u.href + (text ? ` ("${cut(text, 60)}")` : '') });
        }
        if (text) creditCheck(a, text);
      }
      if (!external.has(u.href)) external.set(u.href, { el: a });
      if (!text && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])') && !isAgencyBadge(a)) add(a, { code: 'LINK_NO_TEXT', severity: 'info', category: 'Accessibility', message: 'Link has no readable text or aria-label', found: href });
    });

    function checkSocial(el, href, via) {
      const net = socialNetOf(href);
      if (!net) return;
      let u; try { u = new URL(href); } catch (e) { return; }
      if (isShareLink(u)) return; // share buttons on blog posts, not the business's profile
      // A video or a post is not an account: whose channel a YouTube video is on is checked on the
      // live website by the auto audit, which can ask YouTube. Here it is left alone.
      if (postLink(net, u.href)) return;
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
        slipItem(img, img.getAttribute('alt'), 'alt text', 'Images / Alt');
        if (a.length > 150) add(img, { code: 'ALT_LONG', severity: 'info', category: 'Images / Alt', message: `Alt text is very long (${a.length} chars)`, found: cut(a, 80) });
        for (const [re, label] of PLACEHOLDERS) if (re.test(a)) add(img, { code: 'ALT_PLACEHOLDER', severity: 'critical', category: 'Images / Alt', message: `Alt text: ${label}`, found: a });
      }
    });

    // --- Headings (only elements visible on this device) ---
    const heads = Array.from(doc.querySelectorAll('body h1, body h2, body h3, body h4, body h5, body h6')).filter((h) => !hiddenReason(h, device));
    const h1s = heads.filter((h) => h.tagName === 'H1');
    // An H1 that exists but is hidden is a different problem from no H1 at all: Google and SEO tools
    // read it, visitors never see it.
    const hiddenH1 = !h1s.length ? Array.from(doc.querySelectorAll('body h1')).find((h) => clean(h.textContent)) : null;
    if (hiddenH1) add(hiddenH1, { code: 'H1_HIDDEN', severity: 'warning', category: 'Meta / SEO', message: `The page's H1 heading is hidden on ${DEVICE_LABEL[device]}: Google and SEO tools read it, visitors don't see it`, found: cut(hiddenH1.textContent, 120) });
    else if (!h1s.length) add(null, { code: 'H1_MISSING', severity: 'warning', category: 'Meta / SEO', message: `No visible H1 heading on ${DEVICE_LABEL[device]}` });
    if (h1s.length > 1) add(h1s[1], { code: 'H1_MULTIPLE', severity: 'info', category: 'Meta / SEO', message: `${h1s.length} H1 headings on this page (${DEVICE_LABEL[device]})`, found: h1s.map((h) => cut(h.textContent, 40)).join(' | ') });

    // --- Maps & iframes ---
    doc.querySelectorAll('iframe').forEach((f) => {
      const src = f.getAttribute('src') || f.getAttribute('data-src') || '';
      if (/google\.[a-z.]+\/maps|maps\.google/i.test(src)) {
        const place = placeNameFromUrl(src);
        if (place && truth.businessName) {
          // A label that starts with a number is an address only when it reads like one ("1552 Columbia
          // Ave", "…, TN"): a business whose name starts with a number ("86 Auto Lab Franklin") is a name.
          const STREET_WORD = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|cir|circle|pl|place|pike|trl|trail|suite|ste|unit|bldg|building)\b\.?/i;
          const addrLike = !matchesBusiness(place, truth) && ((/^\d+\s/.test(place) && STREET_WORD.test(place)) || /,\s*[A-Z]{2}\b/.test(place));
          if (addrLike) {
            const num = (place.match(/^\d+/) || [''])[0];
            const streets = truth.addresses.filter((x) => x.street);
            if (num && streets.length && !streets.some((x) => x.street.startsWith(num))) add(f, { code: 'MAP_ADDRESS', severity: 'critical', category: 'Contact info', message: 'Google Map embed shows a different address', found: place, expected: streets.map((x) => x.street).join(' | ') });
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

    // A button that scrolls to a section of its own page, and the section is not there: that problem, and
    // no other page invented to replace it. A page's scripts could still place it, so it asks to be confirmed.
    linkRows.forEach((x) => {
      if (!x.anchor || x.anchor.found) return;
      add(x.el, { code: 'LINK_ANCHOR_MISSING', severity: 'warning', category: 'Links', clarify: true,
        message: `${x.button ? 'Button' : 'Link'} scrolls to a section (#${x.frag}) that is not on this page`,
        found: `"${cut(x.text, 60)}" \u2192 #${x.frag}`,
        expected: 'Check in preview that it scrolls to the right section. If it does not, pick the section in the button\u2019s link settings in Duda (Link to: Section/Anchor)' });
    });
    return {
      notFound: false,
      findings: collapseContact(findings),
      photos: photosUsed(doc, ctx, device),
      internal: Array.from(internal),
      links: Array.from(linkRows.values()).map((x) => ({ text: x.text, to: x.to, button: x.button, context: x.context, near: x.near, selector: uniqueSelector(x.el), location: locationOf(x.el), hiddenBy: hiddenReason(x.el, device) || '',
        ...(x.frag ? { frag: x.frag } : {}), ...(x.anchor ? { anchor: x.anchor } : {}), ...(x.parts ? { parts: x.parts, part: x.part } : {}) })),
      external: Array.from(external.keys()).map((url) => ({ url, selector: uniqueSelector(external.get(url).el), location: locationOf(external.get(url).el), hiddenBy: hiddenReason(external.get(url).el, device) || '' })),
      images: Array.from(images.keys()).map((url) => ({ url, selector: uniqueSelector(images.get(url).el), location: locationOf(images.get(url).el), hiddenBy: hiddenReason(images.get(url).el, device) || '' })),
      alts: altList,
      textIndex: textIndex.map((x) => {
        const hd = x.el.closest && x.el.closest('h1, h2, h3, h4, h5, h6');
        // The whole paragraph a piece of text sits in, when the piece is only part of it: "our team at"
        // is cut where the link "86 Auto Lab" starts, and read alone it looks unfinished or nameless.
        const box = x.el.closest && x.el.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, .dmNewParagraph, [data-element-type="paragraph"]');
        const para = box ? textNoLabels(box) : '';
        // The section heading it sits under (for the location check: "Storage in New Britain" above a paragraph).
        const sec = !hd ? sectionOf(x.el) : '';
        return { text: x.text, selector: uniqueSelector(x.el), location: locationOf(x.el), hiddenBy: hiddenReason(x.el, device) || '', ...(hd ? { heading: hd.tagName } : {}), ...(sec ? { sec } : {}), ...(para && para.length > x.text.length + 2 && para.length < 3000 ? { para } : {}) };
      }),
      prose: prose.map((x) => ({ text: x.text, selector: uniqueSelector(x.el), location: locationOf(x.el), hiddenBy: hiddenReason(x.el, device) || '' })),
      ...(ctx.copy ? { copy: pageCopy(body, device) } : {}),
      fonts,
      meta: { forms: realForms.length, ...(formChoices.length ? { formChoices } : {}), ...(policies.length ? { policies } : {}), title, description: desc, h1: h1s.map((h) => clean(h.textContent)), favicon: hasFavicon, touchIcon: hasTouchIcon, ...(schemaBiz ? { schemaBiz } : {}),
        // What the page says it is about, for the "does the page match its address" checks: every H1
        // (a hidden one still tells Google what the page is), and the section headings under it.
        buttons: btnList.map((b) => (b.to ? b : Object.assign(b, { to: /^https?:/i.test(b.href) ? b.href : '' }))),
        fit: {
          h1: Array.from(doc.querySelectorAll('body h1')).map((h) => ({ text: clean(h.textContent), selector: uniqueSelector(h) })).filter((h) => h.text).slice(0, 3),
          heads: heads.filter((h) => /^H[23]$/.test(h.tagName)).map((h) => clean(h.textContent)).filter(Boolean).slice(0, 24),
        } },
      schema: schemas.map((s) => s.data),
    };
  }

  /** An element's text without the default labels inside it ("Button Button A properly applied…" → "A properly applied…"). */
  function textNoLabels(el) {
    const t = clean(el.textContent);
    if (!/\b(Button|Heading|Caption|Paragraph|Subtitle|Label)\b/.test(t)) return t;
    const c = el.cloneNode(true);
    c.querySelectorAll('*').forEach((x) => { if (x.parentNode && DEFAULT_LABEL.test(clean(x.textContent))) x.remove(); });
    return clean(c.textContent);
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
    let official = quoteNorm(truth && truth.businessName);
    if (!official) return [];
    // Business Info with two spellings one letter apart ("Ceramic Coating" in one place, "Ceramic
    // Coatings" in another): the one the website itself uses most is the name, the other the slip.
    {
      const sk = nameSkel(official);
      const near = (truth.names || []).map(quoteNorm).filter((n) => { const k = nameSkel(n); return k !== sk && (lev1(k, sk) || k + 's' === sk || k === sk + 's'); });
      if (near.length) {
        const all = (textIdx || []).map((x) => x.text).join(' \n ');
        const uses = (n) => { const re = new RegExp('\\b' + n.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+') + '(?![A-Za-z])', 'gi'); return (all.match(re) || []).length; };
        const best = [official].concat(near).map((n) => ({ n, c: uses(n) })).sort((a, b) => b.c - a.c)[0];
        if (best.n !== official && best.c > uses(official)) truth = Object.assign({}, truth, { businessName: best.n, names: [best.n].concat((truth.names || []).filter((n) => quoteNorm(n) !== best.n)) }), official = best.n;
      }
    }
    const target = nameSkel(official);
    if (target.length < 5) return [];
    // The name without "LLC" / "Inc." is the name as people write it on a website: compared too.
    const LEGAL = /[\s,]+(llc|l\.l\.c\.|inc|co|corp|ltd|company|pllc)\.?$/i;
    const targets = [target]; const bare = nameSkel(official.replace(LEGAL, '')); if (bare !== target && bare.length >= 5) targets.push(bare);
    // A second spelling in Business Info that differs by one letter ("Coating" next to "Coatings") is
    // not a second name: it is the same slip, made in Duda. The first one is the name; the near-twin
    // is reported wherever the website uses it, so the site ends up written one way.
    const twin = (n) => { const k = nameSkel(n); return k !== target && targets.some((t) => lev1(k, t) || k + 's' === t || k === t + 's'); };
    const twins = (truth.names || []).map(quoteNorm).filter((n) => n && twin(n));
    const okForms = new Set([official, official.replace(LEGAL, '')].concat((truth.names || []).map(quoteNorm)).filter((n) => n && !twins.includes(n)));
    // Other names in Business Info ("HH Ceramic Coatings" next to "Harker Heights Ceramic Coatings"):
    // a one-letter slip of any of them is a slip too.
    // Only a real slip, not singular against plural: which of those two is right is the official name's call.
    const aliasT = [];
    [...okForms].forEach((n) => { const k = nameSkel(n.replace(LEGAL, '')); if (k.length >= 8 && !targets.includes(k)) aliasT.push(k); });
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
          if (!k || !targets.concat(aliasT).some((t) => t[0] === k[0])) continue;
          if (aliasT.includes(k)) continue;
          let typo = false;
          if (!targets.includes(k)) {
            const slip = targets.some((t) => lev1(k, t)) || aliasT.some((t) => lev1(k, t) && k + 's' !== t && k !== t + 's');
            if (target.length < 8 || !/^[A-Z]/.test(surf) || !slip) continue;
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
          // Singular for plural ("Ceramic Coating" for "Ceramic Coatings") says what changed.
          const plural = typo && targets.some((t) => k + 's' === t) ? ' (missing the final "s")' : typo && targets.some((t) => k === t + 's') ? ' (an extra "s")' : '';
          // In the H1 or the SEO title it is the first thing Google and a visitor read: critical.
          const top = x.heading === 'H1' || x.heading === 'TITLE';
          const where = x.heading === 'H1' ? ' in the H1 heading' : x.heading === 'TITLE' ? ' in the SEO title' : '';
          out.push({
            code: 'NAME_SPELLING', severity: top ? 'critical' : 'warning', category: 'Business name',
            message: (typo ? 'Business name looks misspelled' : 'Business name is written differently from Business Info') + where + plural + (twins.includes(surf) ? '. Business Info has this spelling too: correct it there as well' : ''),
            found: surf, expected: official, spelling: typo ? 'typo' : 'format',
            path: x.path, device: x.device, selector: x.selector, location: x.location,
            visible: !x.hiddenBy, hiddenBy: x.hiddenBy, snippet: cut(x.text, 120),
          });
        }
      }
    });
    return out;
  }
  // ---------- page fit: does each page say what its address promises? ----------
  /**
   * A page's address is a promise: /locations/nolanville-tx/ceramic-coating is the Nolanville ceramic
   * coating page. Pages built from a copy of a sister page keep the sister's words: the ceramic page
   * ends up about paint protection film, the Temple page's heading names Copperas Cove. Nothing else in
   * the audit is wrong on such a page (the phone, the name, the links are fine), so it needs its own check.
   *
   * Read in order: the address (what service, what town), then the SEO title, the H1, the meta
   * description, the section headings and the body copy. The business's own name is taken out first:
   * "Harker Heights Ceramic Coatings" says nothing about the topic or the town of a page.
   */
  const SERVICES = [
    { key: 'ppf', label: 'Paint protection film (PPF)', primary: true, slug: /paint-protection-film|(^|-)ppf(-|$)|clear-?bra|protection-film/,
      re: /\bpaint[\s-]+protection[\s-]+films?\b|\bPPF\b|\bclear[\s-]?bras?\b/gi },
    { key: 'tint', label: 'Window tint', primary: true, slug: /tint|window-film/,
      re: /\bwindow[\s-]+tint(?:s|ing|ed)?\b|\btint(?:s|ing|ed)?\b|\bwindow[\s-]+films?\b/gi },
    { key: 'ceramic', label: 'Ceramic coating', primary: true, slug: /ceramic/, re: /\bceramic\b/gi },
    { key: 'graphene', label: 'Graphene coating', slug: /graphene/, re: /\bgraphene\b/gi },
    { key: 'correction', label: 'Paint correction', slug: /paint-correction|(^|-)correction(-|$)|polish|swirl/, re: /\bpaint[\s-]+correction\b|\bswirl[\s-]+(?:marks?|removal)\b|\bpolishing\b/gi },
    { key: 'wrap', label: 'Vinyl wraps', slug: /(^|-)wraps?(-|$)|wrapping|vinyl/, re: /\b(?:vinyl|car|vehicle|truck|colou?r[\s-]+change|commercial|fleet)[\s-]+wraps?\b|\bwraps?\b/gi },
    { key: 'headlight', label: 'Headlight restoration', slug: /headlight/, re: /\bheadlights?\b/gi },
    { key: 'detailing', label: 'Detailing', slug: /detail/, re: /\bdetail(?:s|ing|ed)?\b/gi },
  ];
  const US_STATES = new Set('al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc'.split(' '));
  const AREA_DIRS = /^(locations?|service-areas?|areas?|areas-we-serve|areas-served|cities|city|communities|near-me)$/;
  const SLUG_FILLER = new Set(('ceramic coating coatings paint protection film films ppf clear bra window windows tint tinting detailing detail detailer detailers ' +
    'auto car cars truck mobile correction wraps wrap vinyl graphene service services and in near at for best top the of located serving ' +
    'location locations headlight restoration interior exterior installation install installer shop pro professional').split(' '));
  const isBlogPath = (p) => /\/(blog|blogs|post|posts|news|articles?)\//i.test(p);
  const titleCase = (w) => w.split(' ').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');

  /** The town a page's address is about ("temple" from /locations/temple-tx/…), or ''. */
  function placeOfPath(path) {
    const segs = String(path || '').toLowerCase().split('/').filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      let toks = segs[i].split('-').filter(Boolean);
      const underArea = i > 0 && AREA_DIRS.test(segs[i - 1]);
      const st = toks.length >= 2 && US_STATES.has(toks[toks.length - 1]) ? toks.pop() : '';
      if (!st && !underArea) continue;
      while (toks.length && SLUG_FILLER.has(toks[0])) toks.shift();
      if (!toks.length || toks.length > 4 || toks.some((t) => /\d/.test(t))) continue;
      const place = toks.join(' ');
      if (place.length >= 3) return place;
    }
    return '';
  }
  /** The services a page's address names, read from its last segment that names any. */
  function servicesOfPath(path) {
    const segs = String(path || '').toLowerCase().split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      if (i > 0 && AREA_DIRS.test(segs[i - 1])) continue;          // the town's own segment
      const hit = [];
      SERVICES.forEach((s) => { if (s.slug.test(segs[i])) hit.push(s.key); });
      // "ceramic-coating" also matches nothing else; "paint-protection-film" must not count as "paint-correction"
      if (hit.includes('ppf')) { const k = hit.indexOf('correction'); if (k >= 0) hit.splice(k, 1); }
      if (hit.length) return hit;
    }
    return [];
  }
  /** The towns a website serves: every town it has its own page for (/paint-protection-film-in-littleton-co), and the shop's own town. Map compact key → { key, name }. */
  function serviceAreas(paths, truth) {
    const m = new Map();
    const put = (t) => { const k = compact(t); if (k.length >= 3 && !m.has(k)) m.set(k, { key: t.toLowerCase(), name: titleCase(t.toLowerCase()) }); };
    [].concat(paths || []).forEach((p) => { const t = placeOfPath(p); if (t) put(t); });
    ((truth && truth.addresses) || []).forEach((a) => { if (a && a.city) put(String(a.city)); });
    return m;
  }
  /** The towns a business may name on a page that is not about a town: Business Info's towns, its service-area towns, and the place its name starts with. */
  function ownTowns(truth) {
    const t = truth || {};
    const out = new Set();
    ((t.addresses || []).map((a) => a && a.city).concat(t.serviceAreas || [])).forEach((x) => { const c = compact(x || ''); if (c.length >= 3) out.add(c); });
    // "Denver Auto Shield", "Austin Tint Pros": the first word of the name, when it is not a trade word, is the area they trade in.
    [t.businessName || ''].concat(t.names || []).forEach((n) => {
      const w = String(n || '').trim().split(/\s+/)[0] || '';
      const c = compact(w);
      if (c.length >= 4 && !GENERIC.has(c) && !SLUG_FILLER.has(c) && !SERVICES.some((sv) => sv.slug.test(c))) out.add(c);
    });
    return out;
  }
  const namesOwnTown = (quote, truth) => { const q = compact(quote || ''); return !!q && [...ownTowns(truth)].some((t) => q.includes(t)); };
  /** The one service-area town a page is about: named at least twice, more than twice as often as any other, or in its title / H1. */
  /**
   * What a link promises, from its words and where it goes: 'packages' (prices, coverage, options),
   * 'brand' (a film or coating maker's page), 'vehicle' (a make's own service page), 'lead' (contact,
   * quote, booking) or 'service' (about the service). Only 'service' links may be offered a town page.
   */
  const BRAND_RE = /\b(stek|llumar|xpel|suntek|3m|carpro|c-?quartz|gtechniq|ceramic pro|gyeon|feynlab|igl|kavaca|avery|hexis|geoshield|madico|huper ?optik|global window films|johnson window films|solar gard|formula one|vvivid|opti-?coat|system x|modesta|nanolex|cquartz)\b/i;
  const MAKE_RE = /\b(porsche|tesla|bmw|mercedes(-benz)?|audi|lexus|ford|chevy|chevrolet|corvette|toyota|honda|jeep|rivian|lucid|ferrari|lamborghini|mclaren|bentley|rolls[- ]royce|maserati|cadillac|gmc|ram|dodge|subaru|mazda|nissan|hyundai|kia|volkswagen|vw|volvo|land rover|range rover|jaguar|genesis|acura|infiniti|lincoln|mini|alfa romeo|aston martin|polestar)\b/i;
  const PACKAGE_RE = /\b(packages?|pricing|prices?|costs?|coverage|options?|plans?|tiers?|levels?|warrant(y|ies)|compare|comparison)\b/i;
  function linkPurpose(text, to) {
    const t = String(text || ''), where = String(to || '').replace(/[-_/]+/g, ' ');
    if (LEAD_WORDS.test(t)) return 'lead';
    if (BRAND_RE.test(t) || BRAND_RE.test(where)) return 'brand';
    if (MAKE_RE.test(t) || MAKE_RE.test(where)) return 'vehicle';
    if (PACKAGE_RE.test(t)) return 'packages';
    return 'service';
  }
  function focusTown(head, body, areas) {
    const count = (t, x) => { const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+') + '\\b', 'gi'); return (String(x || '').match(re) || []).length; };
    const rows = [...areas.values()].map((a) => ({ key: a.key, name: a.name, inTitle: count(a.key, head) > 0, n: count(a.key, head) + count(a.key, body) })).filter((r) => r.n).sort((a, b) => b.n - a.n);
    if (!rows.length) return null;
    const [top, next] = rows;
    if (next && next.inTitle && !top.inTitle) return null;
    if (top.inTitle && (!next || !next.inTitle)) return top;
    return top.n >= 2 && (!next || top.n >= next.n * 2) ? top : null;
  }
  /** Words with the business's own name(s) taken out. */
  function withoutNames(text, truth) {
    let t = ' ' + String(text || '') + ' ';
    const forms = [(truth && truth.businessName) || ''].concat((truth && truth.names) || []).filter((n) => n && n.length >= 4);
    forms.sort((a, b) => b.length - a.length).forEach((n) => {
      // Any capitals, "Coating"/"Coatings", "&"/"and", with or without the possessive
      const core = n.replace(/\b(llc|inc|co|corp|ltd|company)\.?\s*$/i, '').trim().replace(/s$/i, '');
      const pat = core.split(/\s+/).map((w) => (/^(&|and)$/i.test(w) ? '(?:&|and)' : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('[\\s-]+');
      t = t.replace(new RegExp(pat + "s?(?:[’']s)?", 'gi'), ' ');
    });
    return t;
  }
  const countRe = (re, t) => { re.lastIndex = 0; const m = String(t || '').match(re); return m ? m.length : 0; };
  const placeRe = (place) => new RegExp('\\b' + place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+') + '\\b', 'gi');
  /** Mentions of a town written as a name (capitalised or in capitals), not the ordinary word ("temple"). */
  function placeCount(place, text) {
    const re = placeRe(place); let n = 0, m;
    const t = String(text || '');
    while ((m = re.exec(t))) if (/^[A-Z]/.test(m[0])) n++;
    return n;
  }

  /**
   * pages: [{ path, title, description, h1: [{text, selector}], heads: [..], body: 'all body text' }]
   * Returns audit items (critical when the title or H1 is wrong, warning when only the body copy is).
   */
  function pageFitFindings(pages, truth) {
    const out = [];
    const live = (pages || []).filter((p) => p && p.path && !p.notFound && !p.error);
    // Every town the website has a page for, plus its own town(s).
    const places = new Set();
    live.forEach((p) => { const pl = placeOfPath(p.path); if (pl) places.add(pl); });
    ((truth && truth.addresses) || []).forEach((a) => { if (a.city) places.add(String(a.city).toLowerCase().trim()); });
    const homeTowns = new Set(((truth && truth.addresses) || []).map((a) => String(a.city || '').toLowerCase().trim()).filter(Boolean));
    const base = (p, f) => Object.assign({ path: p.path, device: 'desktop', visible: true, hiddenBy: '', snippet: '' }, f);
    live.forEach((p) => {
      const h1 = (p.h1 || [])[0] || null;
      const parts = {
        title: withoutNames(p.title, truth),
        h1: withoutNames((p.h1 || []).map((h) => h.text).join(' · '), truth),
        desc: withoutNames(p.description, truth),
        heads: withoutNames((p.heads || []).join(' · '), truth),
        body: withoutNames(p.body, truth),
      };
      const where = (k) => (k === 'title' ? { selector: 'head > title', location: 'Head / Meta', found: p.title }
        : k === 'desc' ? { selector: 'meta[name="description"]', location: 'Head / Meta', found: p.description }
        : { selector: (h1 && h1.selector) || 'h1', location: 'Body', found: (h1 && h1.text) || '' });

      // --- the service ---
      const want = servicesOfPath(p.path);
      if (want.length && want.length <= 2) {
        const sc = {};
        SERVICES.forEach((s) => { sc[s.key] = { title: countRe(s.re, parts.title), h1: countRe(s.re, parts.h1), desc: countRe(s.re, parts.desc), heads: countRe(s.re, parts.heads), body: countRe(s.re, parts.body) }; });
        const label = (k) => SERVICES.find((s) => s.key === k).label;
        const wantLabel = want.map(label).join(' / ');
        const others = SERVICES.filter((s) => s.primary && !want.includes(s.key)
          // Graphene and ceramic are both coatings: a graphene page talking about ceramic is not a mix-up.
          && !(s.key === 'ceramic' && want.includes('graphene')));
        const wantIn = (part) => want.some((w) => sc[w][part] > 0);
        let flagged = false;
        ['title', 'h1', 'desc'].forEach((part) => {
          if (!parts[part].trim()) return;
          if (wantIn(part)) return;
          const d = others.filter((s) => sc[s.key][part] > 0).sort((a, b) => sc[b.key].body - sc[a.key].body)[0];
          if (!d) return;
          flagged = true;
          const w = where(part);
          const what = part === 'title' ? 'SEO title' : part === 'h1' ? 'H1 heading' : 'meta description';
          out.push(base(p, { code: 'PAGE_TOPIC_MISMATCH', severity: 'critical', category: 'Content',
            message: `The ${what} is about ${d.label}, but this page's address is the ${wantLabel} page`,
            found: cut(w.found, 200), expected: `A ${what} about ${wantLabel}${placeOfPath(p.path) ? ' in ' + titleCase(placeOfPath(p.path)) : ''}`,
            selector: w.selector, location: w.location, topic: d.key, urlTopic: want.join(',') }));
        });
        if (!isBlogPath(p.path)) {
          const wantBody = Math.max(...want.map((w) => sc[w].body + sc[w].heads));
          const d = others.map((s) => ({ s, n: sc[s.key].body + sc[s.key].heads })).sort((a, b) => b.n - a.n)[0];
          if (d && d.n >= 6 && d.n >= 3 * Math.max(1, wantBody)) {
            out.push(base(p, { code: 'PAGE_TOPIC_BODY', severity: flagged ? 'critical' : 'warning', category: 'Content',
              message: `Most of this page's copy is about ${d.s.label} (${d.n} mentions) rather than ${wantLabel} (${wantBody}), which its address promises`,
              found: `${d.s.label}: ${d.n} mentions · ${wantLabel}: ${wantBody}`, expected: `Copy about ${wantLabel}`,
              selector: '(page)', location: 'Body', topic: d.s.key, urlTopic: want.join(',') }));
          }
        }
      }

      // --- the town ---
      const own = placeOfPath(p.path);
      if (own && places.size >= 2) {
        const rivals = [...places].filter((q) => q !== own && !q.includes(own) && !own.includes(q));
        let named = false;
        ['h1', 'title', 'desc'].forEach((part) => {
          const t = parts[part];
          if (!t.trim() || placeCount(own, t) > 0) return;
          const q = rivals.find((x) => placeCount(x, t) > 0);
          if (!q) return;
          named = true;
          const w = where(part);
          const what = part === 'title' ? 'SEO title' : part === 'h1' ? 'H1 heading' : 'meta description';
          out.push(base(p, { code: 'PAGE_WRONG_CITY', severity: 'critical', category: 'Location',
            message: `The ${what} names ${titleCase(q)}, but this is the ${titleCase(own)} page`,
            found: cut(w.found, 200), expected: `${titleCase(own)} in the ${what}`, selector: w.selector, location: w.location, place: q, urlPlace: own }));
        });
        if (!isBlogPath(p.path)) {
          const ownN = placeCount(own, parts.body) + placeCount(own, parts.heads);
          rivals.filter((q) => !homeTowns.has(q)).forEach((q) => {
            const n = placeCount(q, parts.body) + placeCount(q, parts.heads);
            if (n >= 3 && n > ownN) out.push(base(p, { code: 'PAGE_WRONG_CITY_BODY', severity: named ? 'critical' : 'warning', category: 'Location',
              message: `The copy names ${titleCase(q)} ${n} times and ${titleCase(own)} ${ownN === 0 ? 'not once' : ownN + ' time' + (ownN > 1 ? 's' : '')}, on the ${titleCase(own)} page`,
              found: `${titleCase(q)}: ${n} · ${titleCase(own)}: ${ownN}`, expected: `Copy about ${titleCase(own)}`, selector: '(page)', location: 'Body', place: q, urlPlace: own }));
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
   *   liveRoutes: { domain, check: async (paths) => [{path, chain, final, finalStatus, loop?, error?}] } (optional): the published website's redirects,
   *   googlePlaces: async (urls) => [{url, finalUrl, id, name, address}] (optional): Google Maps short links followed,
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
    let siteSchema = null;
    const pageLinks = [];    // every link in the body of each page (desktop), for the town → town-page check   // the business as the home page's structured data describes it (for the NAP tab)
    const pageInfo = {};
    const external = new Map();
    const images = new Map();
    const photoRows = [];
    const altMap = new Map();
    const textIdx = [];
    const linkMap = new Map();    // the internal links a visitor reads, once per wording + destination + section
    const proseIdx = [];          // whole paragraphs (links included), for proofreading
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

    const ruleMap = new Map();
    ((opts.redirects && opts.redirects.rules) || []).forEach((r) => {
      let src = String(r.source || '').trim(); let to = String(r.target || '').trim();
      try { src = new URL(src, 'https://x').pathname; } catch (e) { return; }
      try { const u = new URL(to, 'https://x'); to = u.hostname === 'x' || (truth && truth.domain && u.hostname.replace(/^www\./, '') === String(truth.domain).replace(/^www\./, '')) ? u.pathname : u.href; } catch (e) { return; }
      if (src && !/[*$^(]/.test(src)) ruleMap.set(normalizePath(src).toLowerCase(), /^\//.test(to) ? normalizePath(to) : to);
    });
    const redirectTarget = (path) => ruleMap.get(normalizePath(path).toLowerCase()) || '';
    /** The page a fetch ended on, when the response says (preview /site/<id>/… or the live domain). '' when unknown. */
    const landedPath = (res) => {
      if (!res || !res.html || res.status >= 400) return '';
      // A page that sends the browser on at once (<meta http-equiv="refresh" content="0; url=…">).
      const meta = String(res.html).slice(0, 6000).match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\s*0\s*;\s*url=([^"'>\s]+)/i);
      const to = res.finalUrl || (meta ? new URL(meta[1], res.url || 'https://x/').href : '');
      if (!to) return '';
      let u; try { u = new URL(to); } catch (e) { return ''; }
      // Only a move within the same website counts (a sign-in page or another host is not this page moving).
      let was = null; try { was = new URL(res.url || to); } catch (e) { was = u; }
      if (u.hostname.replace(/^www\./, '') !== was.hostname.replace(/^www\./, '')) return '';
      const inSite = /^\/site\/[^/]+/.exec(was.pathname);
      if (inSite && !u.pathname.startsWith(inSite[0])) return '';
      const m = u.pathname.match(/^\/site\/[^/]+(\/.*)?$/);
      return normalizePath(m ? m[1] || '/' : u.pathname);
    };
    async function worker() {
      while (queue.length) {
        if (opts.shouldStop && opts.shouldStop()) return;
        const path = queue.shift();
        // A page the website redirects (a URL Redirect rule in Duda): visitors never see it, they land on
        // the target. Its old content is not audited (an old town in its address is not a mistake); the
        // target is audited instead. The redirect itself is judged with the other redirects.
        const ruleTo = redirectTarget(path);
        if (ruleTo) { pageInfo[path].redirectTo = ruleTo; if (ruleTo !== path && /^\//.test(ruleTo)) { enqueue(ruleTo, path); viaFrom(ruleTo, path); } continue; }
        // …or the published website sends visitors on (the page may still open in the Duda preview).
        const live = liveMap.get(normalizePath(path).toLowerCase());
        if (live && live.to) { Object.assign(pageInfo[path], { redirectTo: live.to, redirectLive: live }); if (/^\//.test(live.to)) { enqueue(live.to, path); viaFrom(live.to, path); } continue; }
        for (const device of devices) {
          let res;
          try { res = await opts.fetchPage(path, device); } catch (e) { res = { status: 0, html: '', error: String(e && e.message || e) }; }
          // …and a page that redirects when it is opened (the address it ends at is another page).
          const landed = landedPath(res);
          if (landed && landed !== path) { pageInfo[path].redirectTo = landed; enqueue(landed, path); viaFrom(landed, path); doneFetches++; break; }
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
          const r = auditDocument(doc, { device, path, pageUrl: res.url || `https://${opts.host}/site/${opts.siteId}${path === '/' ? '' : path}`, truth, siteId: opts.siteId, host: opts.host, noIndex: pagesMeta[path] && pagesMeta[path].noIndex, copy: !!opts.keepCopy && device === devices[0] });
          if (r.notFound) { info.notFound = true; break; }
          // A blog post: Duda says so in the page (its layout is BLOG_LAYOUT, its parts are bound to the post).
          // Its address has no /blog/ in it, but the editor opens it under /blog/<post>.
          if (/pageType\s*:\s*['"]BLOG_LAYOUT['"]/.test(res.html) || doc.querySelector('[data-blog-template], [data-blog-post-alias]')) info.blog = true;
          info.title = info.title || r.meta.title;
          info.h1 = info.h1 || (r.meta.h1 || [])[0] || '';
          info.description = info.description || r.meta.description;
          if (device === devices[0] && r.meta.fit) info.fit = r.meta.fit;
          if (device === devices[0] && r.meta.buttons) info.buttons = r.meta.buttons;
          if (r.meta.forms) info.forms = Math.max(info.forms || 0, r.meta.forms);
          if (device === devices[0] && r.meta.formChoices) info.formChoices = r.meta.formChoices;
          if (device === devices[0] && r.meta.policies) info.policies = r.meta.policies;
          if (r.copy) info.copy = r.copy;
          if (r.meta.favicon) siteIcon.favicon = true;
          if (r.meta.touchIcon) siteIcon.touchIcon = true;
          if (r.meta.schemaBiz) siteSchema = r.meta.schemaBiz;
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
          if (proseIdx.length < 6000) (r.prose || []).forEach((x) => proseIdx.push(Object.assign({ path, device }, x)));
          if (device === devices[0] && pageLinks.length < 8000) (r.links || []).forEach((x) => { if (x.location === 'Body' && x.to) pageLinks.push(Object.assign({ path }, x)); });
          if (device === devices[0]) (r.links || []).forEach((x) => {
            const k = [x.text.toLowerCase(), x.to, (x.frag || '').toLowerCase(), x.context.toLowerCase(), x.anchor ? path : ''].join('|');
            let m = linkMap.get(k);
            if (!m) { if (linkMap.size >= 600) return; m = Object.assign({ pages: [] }, x); linkMap.set(k, m); }
            if (!m.pages.includes(path)) m.pages.push(path);
          });
          if (r.fonts) {
            r.fonts.rows.forEach((x) => { if (fontRows.length < 9000) fontRows.push(Object.assign({ path, device }, x)); });
            r.fonts.loaded.forEach((l) => { if (!fontLoaded.has(l.key)) fontLoaded.set(l.key, l); });
            // The theme is the same on every page; the home page's is the one that counts.
            if (r.fonts.theme && (path === '/' || !Object.keys(fontTheme).length)) Object.keys(r.fonts.theme).forEach((k) => { if (path === '/' || !fontTheme[k]) fontTheme[k] = r.fonts.theme[k]; });
          }
        }
      }
    }
    // The published website's own redirects, checked before any content is read: a retired page can still
    // open in the Duda preview while visitors are sent on to another page. Its content is not audited;
    // the page visitors land on is, and the redirect is noted once under "Retired page / preview cleanup".
    const liveMap = new Map();
    if (opts.liveRoutes) {
      const dom = String(opts.liveRoutes.domain || '').toLowerCase().replace(/^www\./, '');
      const paths = [...new Set(queue.concat(Object.keys(pagesMeta || {})).map(normalizePath))].slice(0, 300);
      progress({ done: 0, total: queued.size * devices.length, message: `Checking the published website's redirects (${paths.length} pages)` });
      for (let i = 0; i < paths.length; i += 25) {
        let out = [];
        try { out = await opts.liveRoutes.check(paths.slice(i, i + 25)); } catch (e) { log.push('The published website\'s redirects could not be checked: ' + (e.message || e)); break; }
        (out || []).forEach((r) => {
          if (!r || !r.path) return;
          const k = normalizePath(r.path).toLowerCase(); const first = (r.chain || [])[0] || {};
          if (r.loop) { liveMap.set(k, { loop: true, chain: r.chain || [] }); return; }
          if (r.error) { if (first.status >= 300 && first.status < 400) liveMap.set(k, { error: r.error, chain: r.chain || [] }); return; }
          if (!(first.status >= 300 && first.status < 400) || !r.final) return;
          let u; try { u = new URL(r.final); } catch (e) { return; }
          const same = u.hostname.toLowerCase().replace(/^www\./, '') === dom;
          const to = same ? normalizePath(u.pathname) : u.href;
          if (same && to.toLowerCase() === k) return; // http → https, www, a trailing slash: the same page
          liveMap.set(k, { to, status: first.status, chain: r.chain || [], finalStatus: r.finalStatus || 0 });
        });
      }
    }
    // Pages visitors also reach through a redirect: noted on what is found there.
    const viaOf = new Map();
    function viaFrom(to, from) { const k = normalizePath(to); const l = viaOf.get(k) || []; if (!l.includes(from)) l.push(from); viaOf.set(k, l); }
    // Home page first so nav links get queued, then parallel
    await (async () => { const first = queue.splice(1); await worker(); first.forEach((p) => queue.push(p)); })();
    await Promise.all(Array.from({ length: conc }, worker));
    // Redirects found on the published website (or when a preview page sends the browser on).
    Object.values(pageInfo).forEach((p) => {
      const lv = liveMap.get(normalizePath(p.path).toLowerCase());
      const base = { path: p.path, device: 'desktop', selector: '(page)', location: 'Redirects', visible: true, hiddenBy: '', snippet: '' };
      if (lv && lv.loop) raw.push(Object.assign({ code: 'REDIRECT_LIVE_LOOP', severity: 'critical', category: 'Links', message: `On the published website, ${p.path} redirects in a loop: visitors never reach a page`, found: (lv.chain || []).map((c) => c.url.replace(/^https?:\/\/[^/]+/, '') + ' (' + c.status + ')').join(' \u2192 ') }, base));
      else if (lv && lv.error) raw.push(Object.assign({ code: 'REDIRECT_UNVERIFIED', severity: 'info', category: 'Links', message: `${p.path} redirects on the published website, but where it ends could not be checked (${lv.error}): open it to confirm`, found: (lv.chain || []).map((c) => c.url + ' (' + c.status + ')').join(' \u2192 ') }, base));
      if (!p.redirectTo || redirectTarget(p.path)) return; // a Duda URL Redirect rule is judged with the other rules
      const how = p.redirectLive ? `${p.redirectLive.status} on the published website` : 'the page sends the browser on';
      raw.push(Object.assign({ code: 'REDIRECT_RETIRED_PAGE', severity: 'info', category: 'Retired page / preview cleanup',
        message: `Redirect detected: ${p.path} redirects to ${p.redirectTo}. Content checks run on the destination page, and any findings are listed there. The original page remains accessible in Duda preview.`,
        found: `${p.path} \u2192 ${p.redirectTo} (${how})`, expected: 'Nothing to fix for visitors. To tidy up: hide or delete the old page in Duda.' }, base));
    });

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

    // The business name spelled some other way: in the copy, and in each page's SEO title
    const titleRows = Object.values(pageInfo).filter((p) => p.title && !p.notFound).map((p) => ({ text: p.title, path: p.path, device: devices[0], selector: 'head > title', location: 'Head / Meta', heading: 'TITLE', hiddenBy: '' }));
    nameVariants(textIdx.concat(titleRows), truth).forEach((f) => raw.push(f));

    // ---- Service areas: the towns the website has its own pages for (and the shop's own town) ----
    const allPaths = [...new Set(Object.keys(pagesMeta).concat(Object.keys(pageInfo)))];
    const areaMap = serviceAreas(allPaths, truth);
    // ---- A link whose own words name a town the business has a page for ----
    // A link is judged by what it promises. A page about a town may link a general service page to
    // show packages, explain the service, compare coverage, recommend an add-on, or open a brand's or a
    // vehicle's page: all fine, and the page's town alone never asks for a town page. Only when the
    // link's own words name the town ("paint protection film Voorhees") is that town's page offered,
    // as an optional idea (Info), because the general page still answers the link.
    if (areaMap.size) {
      const bodyText = {};
      textIdx.forEach((x) => { if (x.device !== devices[0] || x.location !== 'Body') return; const b = bodyText[x.path] || (bodyText[x.path] = []); if (b.length < 600) b.push(x.text); });
      const linksOf = {}; pageLinks.forEach((x) => (linksOf[x.path] = linksOf[x.path] || []).push(x));
      const townIn = (t) => [...areaMap.values()].find((a) => new RegExp('\\b' + a.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+') + '\\b', 'i').test(String(t || '')));
      Object.values(pageInfo).forEach((p) => {
        if (p.notFound || p.error || p.path === '/' || isThankYouPath(p.path)) return;
        const seen = new Set();
        (linksOf[p.path] || []).forEach((x) => {
          const to = normalizePath(x.to);
          if (!to || to === p.path || placeOfPath(to) || isBlogPath(to) || (pageInfo[to] && pageInfo[to].blog)) return;
          if (linkPurpose(x.text, to) !== 'service') return;   // packages, a brand, a vehicle, a contact action: kept
          const town = townIn(x.text); if (!town) return;
          const svcs = servicesOfPath(to); if (!svcs.length) return;
          if (!pageInfo[to] && !pagesMeta[to]) return;   // only links to this website's own pages
          svcs.forEach((sv) => {
            const key = [p.path, to, sv, town.key].join('|'); if (seen.has(key)) return; seen.add(key);
            const label = (SERVICES.find((z) => z.key === sv) || {}).label || sv;
            const target = allPaths.find((q) => compact(placeOfPath(q)) === compact(town.key) && servicesOfPath(q).includes(sv));
            if (!target) return;
            // The page the link opens already targets that town ("Ceramic Coating in Campbell, CA"): nothing to offer.
            const dest = pageInfo[to] || {};
            const destText = [dest.title, dest.h1, dest.description, ((dest.fit && dest.fit.h1) || []).map((h) => h.text || '').join(' '), (bodyText[to] || []).slice(0, 40).join(' ')].join(' \n ');
            if (compact(destText).includes(compact(town.name))) return;
            raw.push({ code: 'LINK_TOWN_SERVICE', severity: 'info', category: 'Links', optional: true,
              message: `Optional: the "${cut(x.text, 50)}" link names ${town.name}; the ${town.name} ${label} page is another option`,
              found: `"${cut(x.text, 60)}" \u2192 ${to}`,
              expected: `Optional: link to ${target}. The general ${label} page it opens now still answers the link`,
              path: p.path, device: devices[0], selector: x.selector, location: x.location || 'Body', visible: !x.hiddenBy, hiddenBy: x.hiddenBy || '',
              snippet: x.near ? `Around it: ${cut(x.near, 200)}` : '' });
          });
        });
      });
    }
    // Does each page say what its address promises (service and town)?
    // Whole paragraphs (links and bold words in place): pieces cut at a link or a bold word read as
    // unfinished sentences ("By applying PPF," then the rest in bold) and were reported as notes left in.
    const bodyOf = {};
    proseIdx.forEach((x) => { if (x.device !== devices[0] || x.location !== 'Body' || DEFAULT_LABEL.test(String(x.text || '').trim())) return; const b = bodyOf[x.path] || (bodyOf[x.path] = []); if (b.length < 400) b.push(x.text); });
    const hasProse = new Set(Object.keys(bodyOf));
    textIdx.forEach((x) => { if (hasProse.has(x.path)) return; if (x.device !== devices[0] || x.location !== 'Body' || x.heading || DEFAULT_LABEL.test(String(x.text || '').trim())) return; const b = bodyOf[x.path] || (bodyOf[x.path] = []); if (b.length < 400) b.push(x.text); });
    const fitPages = Object.values(pageInfo).filter((p) => !p.notFound && !p.error).map((p) => ({
      path: p.path, title: p.title || '', description: p.description || '', h1: (p.fit && p.fit.h1) || (p.h1 ? [{ text: p.h1, selector: 'h1' }] : []),
      heads: (p.fit && p.fit.heads) || [], body: (bodyOf[p.path] || []).join(' \n '),
    }));
    pageFitFindings(fitPages, truth).forEach((f) => raw.push(f));

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
        if (!opts.noDuplicates) duplicatePhotoFindings(byKey, allowedImages(opts.allow)).forEach((f) => raw.push(f));
        if (opts.stockList) (await editorialStockFindings(byKey, opts, log)).forEach((f) => raw.push(f));
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

    // Google Maps short links (maps.app.goo.gl/…): their address says nothing, so they are followed to where
    // they open, and the place Google names there is compared with the business. A link to one of the
    // business's own reviews opens the business's own place, and is fine.
    if (opts.googlePlaces) {
      const SHORT_G = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|share\.google|g\.co\/kgs)\b/i;
      const items = raw.filter((f) => /^(SOCIAL_GENERIC|GMB_ID_ONLY|GMB_ID_MISMATCH)$/.test(f.code) && f.category === 'Social' && SHORT_G.test(f.found || ''));
      const urls = [...new Set(items.map((f) => f.found))];
      if (urls.length) {
        progress({ done: doneFetches, total: queued.size * devices.length, message: `Following ${urls.length} Google Maps short link${urls.length === 1 ? '' : 's'}` });
        const got = new Map();
        for (let i = 0; i < urls.length; i += 20) { try { (await opts.googlePlaces(urls.slice(i, i + 20))).forEach((r) => r && got.set(r.url, r)); } catch (e) { log.push('Google Maps short links could not be followed: ' + e); } }
        const known = ((truth.socialLinks && truth.socialLinks.google_my_business) || []).map(placeIdFromUrl).filter(Boolean);
        // A place whose name is the business's is the business's: its ID counts as known too.
        got.forEach((r) => { if (r.id && r.name && matchesBusiness(r.name, truth)) known.push(String(r.id).toLowerCase()); });
        const drop = new Set(); let fine = 0;
        items.forEach((f) => {
          const r = got.get(f.found); if (!r || (!r.id && !r.name)) return;
          const id = String(r.id || '').toLowerCase();
          if ((r.name && matchesBusiness(r.name, truth)) || (id && known.includes(id))) { drop.add(f); fine++; return; }
          const opens = r.finalUrl ? ` (opens ${cut(r.finalUrl, 140)})` : '';
          if (r.name) Object.assign(f, { code: 'GMB_OTHER_PLACE', severity: 'warning', message: `Google Business/Maps link opens "${r.name}"${r.address ? ', ' + r.address : ''}, not this business by its name — open it to check`, found: f.found, expected: truth.businessName || '', note: opens.trim() });
          else Object.assign(f, { code: 'GMB_ID_ONLY', severity: 'info', message: 'Google Business/Maps short link opens a Google place that could not be named automatically — open it to confirm it is this business', found: f.found, expected: r.finalUrl ? cut(r.finalUrl, 300) : '' });
        });
        if (drop.size) { for (let k = raw.length - 1; k >= 0; k--) if (drop.has(raw[k])) raw.splice(k, 1); }
        log.push(`Google Maps short links: ${urls.length} followed to where they open; ${fine} place${fine === 1 ? '' : 's'} on them ${fine === 1 ? 'is' : 'are'} the business's own${got.size < urls.length ? `, ${urls.length - got.size} could not be followed` : ''}.`);
      }
    }

    // Cross-page duplicates (titles / descriptions)
    const byTitle = {}; const byDesc = {};
    Object.values(pageInfo).forEach((p) => { if (p.title) (byTitle[p.title] = byTitle[p.title] || []).push(p.path); if (p.description) (byDesc[p.description] = byDesc[p.description] || []).push(p.path); });
    Object.entries(byTitle).forEach(([t, ps]) => { if (ps.length > 1) ps.forEach((p) => raw.push({ code: 'META_TITLE_DUP', severity: 'warning', category: 'Meta / SEO', message: `Same SEO title used on ${ps.length} pages`, found: t, expected: 'Unique title per page (' + ps.join(', ') + ')', path: p, device: 'desktop', selector: 'head > title', location: 'Head / Meta', visible: true, hiddenBy: '', snippet: '' })); });
    Object.entries(byDesc).forEach(([t, ps]) => { if (ps.length > 1) ps.forEach((p) => raw.push({ code: 'META_DESC_DUP', severity: 'info', category: 'Meta / SEO', message: `Same meta description used on ${ps.length} pages`, found: cut(t, 160), path: p, device: 'desktop', selector: 'meta[name="description"]', location: 'Head / Meta', visible: true, hiddenBy: '', snippet: '' })); });

    // Unique text blocks (for the AI page-text check): real site pages first, blog posts after
    function buildTextBlocks(rows) {
      const map = new Map();
      (rows || textIdx).forEach((x) => {
        if (x.text.length < (rows ? 12 : 25)) return;
        let m = map.get(x.text);
        if (!m) { if (map.size >= 2500) return; m = { text: x.text, selector: x.selector, location: x.location, pages: [], devices: [], visibleOn: [], hiddenOn: [], ...(x.para ? { para: x.para } : {}), ...(x.sec ? { sec: x.sec } : {}) }; map.set(x.text, m); }
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

    // ---- A form's service choices should cover the services the website has pages for ----
    try {
      const svcPages = serviceCatalog(allPaths, pagesMeta, pageInfo);
      const seenForm = new Set();
      Object.values(pageInfo).forEach((p) => (p.formChoices || []).forEach((fc) => {
        const sig = fc.options.join('|').toLowerCase(); if (seenForm.has(sig)) { const prev = raw.find((x) => x.code === 'FORM_SERVICE_MISSING' && x._sig === sig); if (prev && !prev._pages.includes(p.path)) prev._pages.push(p.path); return; }
        seenForm.add(sig);
        const covered = (sp) => fc.options.some((o) => choiceCovers(o, sp));
        const hits = svcPages.filter(covered);
        const looksLikeServices = /service|interest|help|looking|need|package|type of/i.test(fc.label) || hits.length >= 2;
        if (!looksLikeServices || svcPages.length < 2) return;
        const missing = svcPages.filter((sp) => !covered(sp));
        if (!missing.length) return;
        devices.forEach((d) => raw.push({ code: 'FORM_SERVICE_MISSING', severity: 'warning', category: 'Content', _sig: sig, _pages: [p.path],
          message: `The form's ${fc.label ? `"${cut(fc.label, 50)}" ` : ''}choices leave out ${missing.length === 1 ? 'a service' : missing.length + ' services'} this website has a page for`,
          found: 'Choices: ' + cut(fc.options.join(', '), 220), expected: 'Add: ' + missing.slice(0, 10).map((x) => x.name).join(', ') + (missing.length > 10 ? ` (+${missing.length - 10})` : '') + ', or group them and add "Other"',
          path: p.path, device: d, selector: fc.selector, location: 'Body', visible: true, hiddenBy: '', snippet: '' }));
      }));
    } catch (e) { log.push('Form choices: ' + e.message); }
    // ---- Privacy policy and terms: the real text (loaded by Termageddon), and template fields left unfilled ----
    try {
      const done = new Set();
      for (const p of Object.values(pageInfo)) {
        for (const pol of p.policies || []) {
          if (done.has(pol.url) || !opts.fetchPolicy) continue; done.add(pol.url);
          progress({ done: doneFetches, total: doneFetches, message: 'Reading the privacy policy / terms text…' });
          let text = '';
          try { const r = await opts.fetchPolicy(pol.url); text = r && r.status < 400 ? htmlText(r.html || r.text || '') : ''; } catch (e) { text = ''; }
          if (!text) { log.push(`The policy loaded on ${p.path} (Termageddon) could not be read.`); continue; }
          policyFindings(text, truth || {}, true).forEach((x) => devices.forEach((d) => raw.push(Object.assign({ path: p.path, device: d, selector: pol.selector, location: 'Body (policy loaded by Termageddon)', visible: true, hiddenBy: '', snippet: x.snippet || '' }, x))));
        }
        if (LEGAL_PATH.test(p.path) && !(p.policies || []).length) {
          const body = textIdx.filter((x) => x.path === p.path && x.device === devices[0] && x.location === 'Body').map((x) => x.text).join(' \n ');
          if (body) policyFindings(body, truth || {}, false).forEach((x) => devices.forEach((d) => raw.push(Object.assign({ path: p.path, device: d, selector: '(page)', location: 'Body', visible: true, hiddenBy: '', snippet: x.snippet || '' }, x))));
        }
      }
    } catch (e) { log.push('Policy text: ' + e.message); }
    // ---- Redirects: the website's URL redirects, and pages that existed before and now give 404 ----
    if (opts.redirects) {
      try {
        progress({ done: doneFetches, total: doneFetches, message: 'Checking redirects and old addresses…' });
        (await redirectFindings(opts.redirects, allPaths, opts.liveStatus)).forEach((x) => devices.forEach((d) => raw.push(Object.assign({ device: d, selector: '(page)', location: 'Redirects', visible: true, hiddenBy: '', snippet: '' }, x))));
      } catch (e) { log.push('Redirects: ' + e.message); }
    }
    // robots.txt, sitemap.xml and llms.txt on the published website (the browser says how to read them).
    let files = null;
    if (opts.fetchFile) {
      progress({ done: doneFetches, total: doneFetches, message: 'Reading robots.txt, sitemap.xml and llms.txt…' });
      try {
        const got = {};
        for (const [k, path] of [['robots', '/robots.txt'], ['sitemap', '/sitemap.xml'], ['llms', '/llms.txt']]) {
          try { const r = await opts.fetchFile(path); got[k] = { status: (r && r.status) || 0, text: String((r && (r.text || r.html)) || '').slice(0, 400000) }; } catch (e) { got[k] = { status: 0, text: '' }; }
        }
        got.domain = opts.fileDomain || '';
        const ff = fileFindings(got, truth || {});
        ff.raw.forEach((x) => devices.forEach((d) => raw.push(Object.assign({}, x, { device: d }))));
        files = ff.info;
      } catch (e) { log.push('robots.txt / llms.txt: ' + e.message); }
    } else if (opts.fileNote) log.push(opts.fileNote);
    // Pages that show packages, prices or coverage options: a "packages" link to one of them keeps its promise.
    const pkgPages = new Set(textIdx.filter((x) => x.device === devices[0] && x.location === 'Body' && /\b(packages?|coverage options|pricing|prices)\b/i.test(x.text)).map((x) => x.path));
    const merged = sortFindings(oneItemPerSite(groupAcrossPages(mergeDevices(raw))));
    const counts = { critical: 0, outdated: 0, warning: 0, info: 0 };
    merged.forEach((f) => { counts[f.severity]++; });
    return {
      truth: truth ? Object.assign({}, truth, { serviceAreas: [...areaMap.values()].map((x) => x.name) }) : truth,
      checks: CHECKS_VERSION,
      files, schemaBiz: siteSchema,
      fonts: fontSys ? { roles: fontSys.roles, fromTheme: fontSys.fromTheme, all: fontSys.all.slice(0, 14) } : null,
      photos: photoSys,
      findings: merged,
      retired: Object.values(pageInfo).filter((p) => p.redirectTo).map((p) => p.path),
      pages: Object.values(pageInfo).map((p) => ({ path: p.path, ...(p.redirectTo ? { redirectTo: p.redirectTo } : {}), ...(viaOf.get(p.path) ? { via: viaOf.get(p.path).slice(0, 10) } : {}), title: p.title || '', h1: p.h1 || '', ...(p.description ? { description: String(p.description).slice(0, 320) } : {}), ...(pkgPages.has(p.path) ? { pkg: true } : {}), notFound: !!p.notFound, error: p.error || '', devices: p.devices || [], ...(p.blog ? { blog: true } : {}), ...(p.forms ? { forms: p.forms } : {}) })),
      links: Array.from(linkMap.values()),
      // For the AI read of whether each page fits its address. Not saved with the audit.
      // Buttons on each page, in order (desktop). Not saved with the audit.
      buttons: Object.fromEntries(Object.values(pageInfo).filter((p) => p.buttons).map((p) => [p.path, p.buttons])),
      // keepCopy: each page's own copy, in reading order (headings and paragraphs). Not saved with the audit.
      ...(opts.keepCopy ? { copy: Object.fromEntries(Object.values(pageInfo).filter((p) => p.copy).map((p) => [p.path, p.copy])) } : {}),
      fit: fitPages.map((p) => ({ path: p.path, title: p.title, description: p.description, h1: p.h1.map((h) => h.text), h1Sel: (p.h1[0] && p.h1[0].selector) || '', heads: p.heads.slice(0, 14), excerpt: p.body.slice(0, 2400), urlServices: servicesOfPath(p.path), urlPlace: placeOfPath(p.path) || slugTown(p, areaMap) })),
      externalLinks: external.size,
      images: images.size,
      alts: Array.from(altMap.values()),
      texts: buildTextBlocks(),
      prose: buildTextBlocks(proseIdx),
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
  /** "brentwood" from /brentwood-window-tinting: the words of the address that are not a service and
   *  that the page's own title or H1 also says. Used to tell the AI which town the page is for. */
  // Car makes and models are in many page addresses (/tesla, /porsche-ppf) and are never a town.
  const CAR_WORDS = new Set(('tesla bmw porsche ferrari audi rivian ford toyota lexus mercedes benz chevy chevrolet corvette lamborghini mclaren jeep dodge ' +
    'honda nissan subaru hyundai volkswagen cadillac lucid polestar mazda acura infiniti volvo jaguar bentley maserati genesis mini rover range ' +
    'lotus aston martin bugatti rolls royce alfa romeo fiat chrysler lincoln buick ram gmc kia scion pagani koenigsegg hummer cybertruck model ' +
    'exotic exotics luxury classic fleet boat boats marine motorcycle motorcycles rv rvs suv suvs truck trucks').split(' '));
  /** "brentwood" from /brentwood-window-tinting: the words of the address that are not a service and that the page's own
   *  title or H1 presents as a place ("in Brentwood", "Brentwood, TN"), or that are one of the website's service-area towns.
   *  A car make ("Tesla Window Tinting") is never a town. Used to tell the AI which town the page is for. */
  function slugTown(p, areas) {
    const heads = [p.title || '', ...(p.h1 || []).map((h) => h.text || h)].join(' \n ');
    const said = compact(heads);
    const seg = String(p.path || '').toLowerCase().split('/').filter(Boolean).pop() || '';
    const w = seg.split('-').filter((x) => x.length >= 4 && !GENERIC.has(x) && !PLACE_STOP.has(x) && !SLUG_FILLER.has(x) && !CAR_WORDS.has(x) && !/\d/.test(x));
    if (!w.length || w.length > 3 || !said.includes(compact(w.join(' ')))) return '';
    const town = w.join(' ');
    if (areas && areas.has && areas.has(compact(town))) return town;
    const pat = town.replace(/\s+/g, '[\\s-]+');
    return new RegExp('\\b(?:in|near|serving)\\s+' + pat + '\\b|\\b' + pat + ',\\s*[A-Z]{2}\\b', 'i').test(heads) ? town : '';
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

  /** Is the quoted text (part of) the words of a link to a page of this website, on the block's page? */
  function ownPageLink(blk, quote, links) {
    const n = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const q = n(quote); if (!q) return false;
    // Only a link that leads to another service or area page counts: "Copperas Cove's top shop" linking to
    // the contact page is still a claim about this business.
    const other = (to) => to && String(to).startsWith('/') && to !== '/' && !/contact|quote|estimate|book|appointment|schedul|about|review|gallery|thank/i.test(to) && !(blk.pages || []).includes(to);
    if (/(^|> )a(:nth-of-type\(\d+\))?$/.test(String(blk.selector || '')) && n(blk.text).includes(q) && (links || []).some((l) => other(l.to) && n(l.text) === n(blk.text))) return true;
    return (links || []).some((l) => {
      if (!other(l.to)) return false;
      if (l.pages && blk.pages && !l.pages.some((p) => blk.pages.includes(p))) return false;
      const t = n(l.text); return t.length >= 6 && (t.includes(q) || q.includes(t));
    });
  }
  /** Apply AI page-text issues ({ i, type, quote, confidence, reason, suggestion }, i = index into texts). */
  /**
   * What a page says about places besides the paragraph being judged: its SEO title, its H1, and up to
   * three sentences from the page's OTHER text that describe a facility, a partner or a location
   * ("Vehicle storage in New Britain through Car Heads Auto Group"). Kept to that one page, so a town
   * described on one page is never approved for the whole website.
   */
  const FACILITY_RE = /\b(facilit(y|ies)|storage|warehouse|garage|showroom|branch|location|locations|second shop|our other|partner(s|ed|ing|ship)?|through|in partnership|affiliate|sister)\b/i;
  function placeContext(texts, pages, path, except) {
    const pg = (pages || []).find((p) => p.path === path) || {};
    const h1 = Array.isArray(pg.h1) ? pg.h1.join(' | ') : String(pg.h1 || '');
    const sentences = [];
    (texts || []).forEach((b) => {
      if (sentences.length >= 3 || b.text === except || !(b.pages || []).includes(path) || b.location === 'Head / Meta') return;
      String(b.para || b.text).split(/(?<=[.!?])\s+/).forEach((x) => {
        if (sentences.length >= 3 || x.length < 20 || !FACILITY_RE.test(x) || !/\b[A-Z][a-z]{2,}/.test(x.replace(/^\S+\s*/, ''))) return;
        const t = cut(x.trim(), 220); if (!sentences.includes(t) && !String(except || '').includes(x.trim())) sentences.push(t);
      });
    });
    return { title: cut(String(pg.title || ''), 160), h1: cut(h1, 200), facility: sentences };
  }
  const STATE_NAMES = /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|[a-z]{2})$/i;
  /**
   * Place names in a quote ("New Britain" in "conditions in New Britain, Pennsylvania"): capitalised words
   * after in/at/near/from…, or before ", PA" / ", Pennsylvania". Plain capitalised words ("Luxury Vehicle
   * Storage") are not places. States are left out.
   */
  function placesIn(quote) {
    const q = String(quote || ''), out = new Set();
    const NAME = "([A-Z][a-z]+(?:[\\s-]+[A-Z][a-z]+){0,2})";
    const add = (w) => { w = String(w || '').trim(); if (w.length >= 4 && !STATE_NAMES.test(w)) out.add(w); };
    for (const m of q.matchAll(new RegExp('\\b(?:in|at|near|from|around|serving|outside|of|to)\\s+' + NAME, 'g'))) add(m[1]);
    for (const m of q.matchAll(new RegExp(NAME + ',\\s*(?:[A-Z]{2}\\b|[A-Z][a-z]+)', 'g'))) add(m[1]);
    for (const m of q.matchAll(new RegExp('\\bour\\s+' + NAME + '(?:\\s+[a-z]+)?\\s+(?:location|shop|facility|branch|store|office|studio|garage)', 'g'))) add(m[1]);
    return [...out];
  }
  function applyTextIssues(findings, texts, issues, truth, links, pageList) {
    const RULES = {
      other_business: ['AI_TEXT_OTHER_BUSINESS', 'critical', 'Business name', 'AI: text names a different business'],
      wrong_location: ['AI_TEXT_LOCATION', 'critical', 'Location', "AI: text mentions a location that doesn't match this business"],
      name_variant: ['AI_TEXT_NAME_VARIANT', 'warning', 'Business name', 'AI: business name is written differently'],
    };
    const loc = truth && truth.addresses && truth.addresses[0] ? [truth.addresses[0].city, truth.addresses[0].region].filter(Boolean).join(', ') : '';
    issues.forEach((v) => {
      const blk = texts[v.i];
      if (!blk || !RULES[v.type] || Number(v.confidence) < 0.6) return;
      // "Names another business" has to quote a name. Words with no name in them ("our team at") are a
      // piece of a sentence that goes on in a link (often the business's own name), not another business.
      if (v.type === 'other_business') {
        const q = String(v.quote || '').trim(); const words = q.split(/\s+/).filter(Boolean);
        const named = words.length <= 2 ? /[A-Z0-9]/.test(q) : /[A-Z0-9]/.test(words.slice(1).join(' ')) || /\b(llc|inc|co)\b/i.test(q);
        if (!q || !named) return;
        // The quote followed, in its paragraph, by this business's own name: it is theirs.
        if (blk.para) { const at2 = blk.para.toLowerCase().indexOf(q.toLowerCase()); if (at2 >= 0 && matchesBusiness(blk.para.slice(at2, at2 + q.length + 60), truth)) return; }
      }
      // Matched against the flagged WORDS only — not the model's commentary, and not the whole page.
      // A location page can still wrongly claim a different town somewhere in its copy, and that
      // has to keep coming through.
      if (v.type === 'wrong_location' && pathNamesPlace(blk.pages, v.quote || blk.text || '', truth)) return;
      // A town in the words of a link to one of the website's own pages ("We also offer auto detailing in
      // Hamilton, NJ" linking to /car-detailing-nj) points visitors to another service or area the business
      // has a page for: a cross-reference, not a claim that this page is about that town.
      if (v.type === 'wrong_location' && ownPageLink(blk, v.quote, links)) return;
      // A town the business serves (it has its own pages for it, or it is the shop's town) is fine on any
      // page that is not about a different town: a blog post may talk about "a Littleton driver".
      if (v.type === 'wrong_location' && !blk.pages.some((p) => placeOfPath(p))) {
        if (namesOwnTown(v.quote, truth)) return;
      }
      const [code, severity0, category, message] = RULES[v.type];
      // The same page describes that town elsewhere (its title, its H1, a facility or partner paragraph):
      // it may be another facility, a partner or a storage site, not another client's leftover. Asked,
      // not asserted — whatever the AI's confidence. Only this page counts.
      let described = '';
      if (v.type === 'wrong_location' && pageList) {
        const ctx = placeContext(texts, pageList, blk.pages[0], blk.text);
        const hay = compact([ctx.title, ctx.h1].concat(ctx.facility).join(' '));
        described = placesIn(v.quote).find((t) => hay.includes(compact(t))) || '';
        // The paragraph itself presents it as an ADDITIONAL place ("our second shop in Doylestown", "storage
        // through our partner in …"): not the main address, so it is asked about too.
        if (!described && /\b(second|other|another|additional|extra|partner(s|ed|ship)?|sister|affiliate|through)\b/i.test(blk.para || blk.text) && FACILITY_RE.test(blk.para || blk.text)) described = placesIn(v.quote)[0] || '';
      }
      // Uncertain location wording ("Detailing experts in Willow Grove" on a Montgomery County page) is a
      // question for the team, not a confirmed wrong location: a warning that starts as For clarification.
      const unsure = v.type === 'wrong_location' && (v.clarify || Number(v.confidence) < 0.8 || !!described);
      const severity = unsure ? 'warning' : severity0;
      // Already caught by a rule on the same element? Attach the AI opinion instead of duplicating
      const existing = findings.find((f) => f.selector === blk.selector && (f.pages || [f.path]).some((p) => blk.pages.includes(p)) && /OTHER_BUSINESS|COPYRIGHT_NAME/.test(f.code) && v.type === 'other_business');
      if (existing) { existing.ai = { verdict: 'other_business', confidence: v.confidence, reason: v.reason, suggestion: v.suggestion, quote: v.quote }; return; }
      // The spelling rule compares the name letter for letter and has usually caught it already:
      // the AI's opinion joins that item rather than making a second one for the same words.
      if (v.type === 'name_variant') {
        const spelled = findings.find((f) => f.code === 'NAME_SPELLING' && f.selector === blk.selector && (f.pages || [f.path]).some((p) => blk.pages.includes(p)));
        if (spelled) { spelled.ai = { verdict: 'name_variant', confidence: v.confidence, reason: v.reason, suggestion: v.suggestion, quote: v.quote }; return; }
      }
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
      // The spelling as written, picked out of the quote, so reports can group by it.
      if (v.type === 'name_variant' && truth) { const nv = nameVariants([{ text: v.quote || t }], truth)[0]; if (nv) f.variant = nv.found; }
      if (unsure) Object.assign(f, { clarify: true, message: 'AI: location wording to confirm (the town may be a service area, not a claim about where the shop is)' });
      if (described) Object.assign(f, {
        message: `AI: location to confirm \u2014 this page also describes ${described} (another facility, a partner or a service area?)`,
        expected: `Confirm whether ${described} is one of the business\u2019s facilities or partners. If it is, nothing to fix; if not, correct it`,
        ai: Object.assign({}, f.ai, { reason: `${described} is also named in this page\u2019s title, H1 or another paragraph, so it may be a second facility or a partner. The AI said: ${v.reason || ''}`.slice(0, 300), suggestion: '' }),
      });
      f.id = hash([f.code, f.selector, f.found, f.message, pages.length > 1 ? '*' : f.path].join('|'));
      if (!findings.some((x) => x.id === f.id)) findings.push(f);
    });
    return sortFindings(findings);
  }

  /**
   * The AI's read of each whole page against its address (op 'pagefit'):
   * { i (index into fit pages), type: wrong_service | wrong_city | name_variant | editor_note, part: title | h1 | desc | body, quote, confidence, reason, suggestion }
   * When a rule already reported the same thing on that page, the AI's opinion joins that item.
   */
  const NOT_OFFERED = /\b(not|isn'?t|is not)\b[^.]{0,40}\b(a |an )?(car[- ]care |detailing )?service[^.]{0,40}\b(offer|provide)|\b(doesn'?t|does not|do not|don'?t)\s+(offer|provide)|\bnot offered\b|\bunrelated to\b|\boutside (the|its) (business|services)/i;
  /** Do the page's address, SEO title and H1 agree on what it is about (and does the quote say the same)? */
  function pageAgrees(pg, quote) {
    const STOP = new Set(['services', 'service', 'page', 'best', 'near', 'with', 'from', 'your', 'about', 'professional', 'expert', 'premium', 'auto', 'car', 'vehicle', 'vehicles']);
    const toks = String(pg.path || '').split('/').pop().toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 4 && !STOP.has(t));
    if (!toks.length) return false;
    const has = (t, txt) => String(txt || '').toLowerCase().includes(t.replace(/s$/, ''));
    const h1 = [].concat(pg.h1 || []).map((h) => (h && h.text) || h).join(' ');
    const key = toks.filter((t) => has(t, pg.title) && has(t, h1));
    return key.length > 0 && (!quote || key.some((t) => has(t, quote)));
  }
  function applyPageFit(findings, fit, issues, truth, locate) {
    const RULES = {
      wrong_service: ['AI_PAGE_TOPIC', 'Content', /^PAGE_TOPIC_/, "AI: this page's content doesn't match the service in its address"],
      wrong_city: ['AI_PAGE_CITY', 'Location', /^PAGE_WRONG_CITY/, "AI: this page names a different town than the one in its address"],
      name_variant: ['AI_PAGE_NAME', 'Business name', /^(NAME_SPELLING|AI_TEXT_NAME_VARIANT)$/, 'AI: business name is written differently'],
      editor_note: ['AI_PAGE_NOTE', 'Content', /^PLACEHOLDER$/, 'AI: a note from the writer or the team was left in the text'],
    };
    const PART = { title: ['head > title', 'Head / Meta', 'SEO title'], h1: ['h1', 'Body', 'H1 heading'], desc: ['meta[name="description"]', 'Head / Meta', 'meta description'], body: ['(page)', 'Body', 'page copy'] };
    (issues || []).forEach((v) => {
      const pg = fit[v.i];
      const rule = RULES[v.type];
      if (!pg || !rule || Number(v.confidence) < 0.7) return;
      // A Duda "Button" label is the default-label rule's to judge (visible: reported; hidden: left out).
      if (AI_LABEL_ONLY(v.quote, [v.reason, v.suggestion].join(' '))) return;
      // "Wrong town" about words that name the town in the page's OWN address is backwards: a
      // /brentwood-window-tinting page saying "…in Brentwood, TN" is right even though the shop is in
      // Franklin. Kept only when the AI's fix keeps the address's town too (another town named beside it).
      if (v.type === 'wrong_city' && pathNamesPlace([pg.path], v.quote || '', truth) && !(v.suggestion && pathNamesPlace([pg.path], v.suggestion, truth))) return;
      // A page whose address names no town (/paint-protection-film) may name the business's own town
      // from Business Info ("Franklin, TN's top choice"): that is where the shop is, not a mistake.
      // A page whose address names no town (/tesla, a blog post) may name any town the business is in or
      // serves: Business Info's town, its service-area towns, and the place in its own name ("Denver" in
      // "Denver Auto Shield"). Only a town it does not serve is reported there.
      if (v.type === 'wrong_city' && !pg.urlPlace && namesOwnTown(v.quote, truth)) return;
      // "Not a service this business offers": the type of business is no evidence of what it offers. A
      // page whose own address, title and H1 agree on what it is about is consistent, whatever the service
      // (a detailer's /service/enclosed-vehicle-towing-services with a towing title and heading is fine).
      if (v.type === 'wrong_service' && (NOT_OFFERED.test([v.reason, v.suggestion].join(' ')) || pageAgrees(pg, v.quote))) return;
      const [code, category, sameRe, message] = rule;
      const part = PART[v.part] ? v.part : 'body';
      const ai = { verdict: v.type, confidence: v.confidence, reason: v.reason, suggestion: v.suggestion, quote: v.quote };
      const quote = String(v.quote || '').toLowerCase();
      const same = findings.find((f) => sameRe.test(f.code) && (f.pages || [f.path]).includes(pg.path)
        && (v.type !== 'name_variant' && v.type !== 'editor_note' ? true : quote && String(f.found || '').toLowerCase().includes(quote.slice(0, 30))));
      if (same) { same.ai = ai; return; }
      // "Cut off mid-thought": when the page's own paragraph goes on after the quoted words, the sentence
      // is not unfinished (the AI was shown it in pieces): nothing to report.
      if (v.type === 'editor_note' && locate && /incomplete|cut off|fragment|unfinished|trailing|mid-thought|mid thought/i.test([v.reason, v.suggestion].join(' '))) {
        const el = locate(pg.path, v.quote, true); if (el && el.continues) return;
      }
      const [selector, location, what] = PART[part];
      const top = part !== 'body' || v.type === 'editor_note';
      const f = {
        code, severity: top ? 'critical' : 'warning', category,
        message: `${message} (${what})`,
        found: v.quote ? `"${v.quote}"` : part === 'title' ? pg.title : part === 'h1' ? (pg.h1 || [])[0] || '' : part === 'desc' ? pg.description : '',
        expected: v.suggestion ? 'Suggested: ' + v.suggestion : '',
        path: pg.path, pages: [pg.path], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [],
        selector: part === 'h1' && pg.h1Sel ? pg.h1Sel : selector, location, snippet: cut(v.reason || '', 160), ai,
        // The AI could not tell what the page is meant to offer: a question for the team, not a mistake.
        ...(v.clarify ? { clarify: true, severity: 'warning' } : {}),
      };
      f.id = hash([f.code, f.selector, f.found, f.message, f.path].join('|'));
      // Words in the page copy: the element that holds them, so the item opens on the page at them
      // (the ID above stays the same as before, so an item already on the audit is the same item).
      if (f.selector === '(page)' && v.quote && locate) { const el = locate(pg.path, v.quote); if (el) Object.assign(f, { selector: el.selector, location: el.location || f.location }); }
      if (!findings.some((x) => x.id === f.id)) findings.push(f);
    });
    return sortFindings(findings);
  }

  /**
   * Photos judged by the AI from pictures of the page ({ photo, v }): photo = { path, sel, kind, src, alt,
   * heading }, v = { subject, fits_page, fits_section, watermark, confidence, reason, suggestion }.
   * A camera watermark is one item per photo file, wherever it is used.
   */
  function applyPhotoVerdicts(findings, entries, truth) {
    const fileOf = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || '').slice(0, 90); } catch (e) { return String(u || '').slice(-60); } };
    const fileKey = (u) => String(u || '').split('?')[0].replace(/-\d+w(\.\w+)$/, '$1');
    const where = (k) => (k === 'parallax' ? 'parallax background' : k === 'background' ? 'background photo' : 'photo');
    const marks = new Map();
    (entries || []).forEach(({ photo: x, v }) => {
      if (!x || !v) return;
      const conf = Number(v.confidence) || 0;
      const base = { path: x.path, pages: [x.path], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [], selector: x.sel || '(page)', location: 'Body', category: 'Images / Photos',
        ai: { verdict: 'photo', confidence: conf, reason: v.reason || '', suggestion: v.suggestion || '', quote: v.subject || '' }, photo: { src: x.src, kind: x.kind } };
      const wm = String(v.watermark || '').trim();
      if (wm && conf >= 0.6) {
        const k = fileKey(x.src); const m = marks.get(k);
        if (m) { if (!m.pages.includes(x.path)) m.pages.push(x.path); }
        else marks.set(k, Object.assign({}, base, { code: 'PHOTO_WATERMARK', severity: 'warning',
          message: `Camera watermark on a ${where(x.kind)}: "${cut(wm, 60)}"`, found: `"${cut(wm, 60)}" on ${fileOf(x.src)}`,
          expected: 'The same photo without the watermark: re-export or crop the original, then replace it in Duda', snippet: v.subject || '' }));
      }
      const head = String(x.heading || '').trim();
      if (v.fits_page === false && conf >= 0.75) {
        findings.push(Object.assign({}, base, { code: 'PHOTO_WRONG_PAGE', severity: 'warning',
          message: `${where(x.kind).replace(/^./, (c) => c.toUpperCase())} doesn't fit this page: ${cut(v.subject || 'the photo shows something else', 80)}`,
          found: `${cut(v.subject || '', 80)} (${fileOf(x.src)})`, expected: v.suggestion ? 'A photo of: ' + cut(v.suggestion, 120) : 'A photo of this page\u2019s service', snippet: cut(v.reason || '', 200) }));
      } else if (v.fits_section === false && conf >= 0.8) {
        findings.push(Object.assign({}, base, { code: 'PHOTO_WRONG_SECTION', severity: 'info',
          message: `${where(x.kind).replace(/^./, (c) => c.toUpperCase())} doesn't fit its section${head ? ` "${cut(head, 60)}"` : ''}: ${cut(v.subject || '', 60)}`,
          found: `${cut(v.subject || '', 80)} (${fileOf(x.src)})`, expected: v.suggestion ? 'A photo of: ' + cut(v.suggestion, 120) : 'A photo that suits the section', snippet: cut(v.reason || '', 200) }));
      }
    });
    marks.forEach((f) => { f.pages.sort(); f.path = f.pages[0]; findings.push(f); });
    findings.forEach((f) => { if (/^PHOTO_/.test(f.code) && !f.id) f.id = hash([f.code, f.code === 'PHOTO_WATERMARK' ? fileKey(f.photo && f.photo.src) : f.selector, f.code === 'PHOTO_WATERMARK' ? '' : f.path].join('|')); });
    const seen = new Set();
    return sortFindings(findings.filter((f) => !/^PHOTO_/.test(f.code) || (!seen.has(f.id) && seen.add(f.id))));
  }

  /**
   * Proofreading by the AI: spelling, grammar, and copy left unfinished. Only what it is sure of
   * (75%+) becomes an audit item, and only the exact words, so the item says what to change.
   */
  function applyProofIssues(findings, texts, issues) {
    const RULES = {
      spelling: ['TEXT_SPELLING', 'warning', 'Content', 'Spelling mistake'],
      grammar: ['TEXT_GRAMMAR', 'warning', 'Content', 'Grammar mistake'],
      punctuation: ['TEXT_PUNCTUATION', 'warning', 'Content', 'Punctuation mistake'],
      wordchoice: ['TEXT_WORD_CHOICE', 'warning', 'Content', 'Wrong word'],
      incomplete: ['TEXT_INCOMPLETE', 'warning', 'Content', 'Unfinished or placeholder text'],
    };
    issues.forEach((v) => {
      const blk = texts[v.i];
      if (!blk || !RULES[v.type] || (!v.clarify && Number(v.confidence) < (v.type === 'spelling' ? 0.75 : 0.85))) return;
      // An optional style improvement is not a mistake: never a warning, and it says so.
      const optional = !!v.optional && !v.clarify;
      if (AI_LABEL_ONLY(v.quote, [v.reason, v.suggestion].join(' '))) return;
      const q = String(v.quote || '').trim();
      // The words have to really be there: an answer about text the block does not contain is dropped.
      if (q && blk.text.toLowerCase().indexOf(q.toLowerCase()) < 0) return;
      if (q && v.suggestion && q.toLowerCase() === String(v.suggestion).trim().toLowerCase()) return;
      const [code, severity0, category0, message0] = RULES[v.type];
      // An unfamiliar word or wording the AI is not sure about is a question, not a mistake.
      const severity = v.clarify || optional ? 'info' : severity0;
      // Alt text and the SEO title / description say where the slip is, so it is fixed in the right place.
      const where = blk.location === 'Image alt text' ? ' in the alt text' : blk.selector === 'head > title' ? ' in the SEO title' : /meta\[name="description"\]/.test(blk.selector || '') ? ' in the meta description' : '';
      const category = blk.location === 'Image alt text' ? 'Images / Alt' : where ? 'Meta / SEO' : category0;
      const message = (optional ? 'Optional style improvement (not a mistake)' : v.clarify ? (v.type === 'grammar' ? 'Wording to confirm (no sure correction; a product claim may need checking)' : 'Wording to confirm (the term may be correct)') : message0) + where;
      // Placeholder text the rules already caught ("Lorem ipsum") is one item, not two.
      if (v.type === 'incomplete' && findings.some((f) => f.code === 'PLACEHOLDER' && f.selector === blk.selector && (f.pages || [f.path]).some((p) => blk.pages.includes(p)))) return;
      const pages = blk.pages.slice().sort();
      const t = blk.text;
      const at = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
      const context = at > 80 ? '…' + t.slice(at - 80, at + q.length + 80) + '…' : t.slice(0, 220) + (t.length > 220 ? '…' : '');
      const f = {
        code, severity, category, message,
        found: q ? `"${q}"` : context,
        expected: v.suggestion ? (optional ? 'Optional: ' : 'Suggested: ') + v.suggestion : '',
        path: pages[0], pages, devices: blk.devices, visibleOn: blk.visibleOn, hiddenOn: blk.hiddenOn,
        selector: blk.selector, location: blk.location, snippet: context,
        ai: { verdict: v.type, confidence: v.confidence, reason: v.reason, suggestion: v.suggestion, quote: q },
      };
      if (v.clarify) f.clarify = true;
      if (optional) f.optional = true;
      f.id = hash([f.code, f.selector, f.found, pages.length > 1 ? '*' : f.path].join('|'));
      if (!findings.some((x) => x.id === f.id)) findings.push(f);
    });
    return sortFindings(findings);
  }
  /** Where a link really lands: its address followed through the website's redirects (at most 4 hops). */
  function finalPage(to, byPath) {
    let p = normalizePath(to), seen = new Set();
    for (let n = 0; n < 4; n++) {
      const d = byPath.get(p); if (!d || !d.redirectTo || !/^\//.test(d.redirectTo) || seen.has(p)) break;
      seen.add(p); p = normalizePath(d.redirectTo);
    }
    return p;
  }
  /**
   * A button or link that opens a different page from the one its words (or its section) promise,
   * as judged by the AI with the destination page (after redirects) and its section in front of it.
   */
  function applyLinkVerdicts(findings, links, verdicts, pages) {
    const byPath = new Map((pages || []).map((p) => [p.path, p]));
    // A page a replacement may name: one the scan opened and found working, not a redirect.
    const usable = (q) => { const d = byPath.get(q); return !!(d && !d.notFound && !d.error && !d.redirectTo); };
    verdicts.forEach((v) => {
      const l = links[v.i];
      if (!l || v.verdict !== 'wrong_page' || Number(v.confidence) < 0.75) return;
      const where = (l.pages || []).slice().sort();
      const land = finalPage(l.to, byPath);
      // A link is never sent to the page it is already on, and a link to a section of its own page that
      // the scan found is judged by that section, not replaced by another page.
      let exp = normalizePath(String(v.expected || '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#\s]/)[0] || '');
      if (exp && (l.pages || []).map((p) => normalizePath(p)).includes(exp)) return;
      if (l.anchor && l.anchor.found) return;
      // "Should open" the very page it opens (same page, same section): the answer contradicts itself, so the
      // link is fine as it is. Fragments count: /x#a and /x#b are different places on a page.
      const expFrag = (String(v.expected || '').split('#')[1] || '').trim().toLowerCase();
      if (exp && exp === normalizePath(l.to) && expFrag === String(l.frag || '').toLowerCase()) return;
      // A link whose words name a service ("PPF", "ceramic coating") and that opens that service's page is right.
      const named = SERVICES.filter((sv) => { sv.re.lastIndex = 0; return sv.re.test(String(l.text || '')); }).map((sv) => sv.key);
      if (named.length && servicesOfPath(land).some((k) => named.includes(k))) return;
      const dest = byPath.get(land) || {};
      const lead = LEAD_WORDS.test(l.text);
      // The link reaches the page it should through a redirect: not wrong. Linking straight to it is optional tidying.
      if (exp && land !== normalizePath(l.to) && exp === land) {
        const f = { code: 'LINK_VIA_REDIRECT', severity: 'info', category: 'Links', optional: true,
          message: `Optional: ${l.button ? 'button' : 'link'} reaches the right page through a redirect`,
          found: `"${l.text}" → ${l.to} → ${land}`, expected: `Optional: link straight to ${land}. Duda URL redirects work on the published website only, so in preview the old address may not open`,
          path: where[0] || '/', pages: where, selector: l.selector, location: l.location, visibleOn: l.hiddenBy ? [] : ['desktop'], hiddenOn: l.hiddenBy ? [`Desktop (${l.hiddenBy})`] : [],
          snippet: [l.context ? `Section: ${l.context}` : '', l.near ? `Around it: ${l.near}` : ''].filter(Boolean).join(' · ').slice(0, 300) };
        f.id = hash([f.code, f.selector, l.to, where.length > 1 ? '*' : f.path].join('|'));
        if (!findings.some((x) => x.id === f.id)) findings.push(f);
        return;
      }
      // Packages, a brand's page or a vehicle's page that the link already opens is its purpose: kept.
      const purpose = linkPurpose(l.text, land);
      if ((purpose === 'brand' || purpose === 'vehicle') && linkPurpose('', land) === purpose) return;
      if (purpose === 'packages' && dest.pkg) return;
      // Only a replacement the scan found working is suggested; never one guessed from an address.
      if (exp && !usable(exp)) exp = '';
      const optional = v.optional === true;
      const f = {
        code: 'LINK_WRONG_PAGE', severity: optional ? 'info' : lead ? 'critical' : 'warning', category: 'Links',
        message: optional ? `Optional: a better page for this ${l.button ? 'button' : 'link'}` : `${l.button ? 'Button' : 'Link'} opens the wrong page`,
        found: `"${l.text}" → ${l.to}${land !== normalizePath(l.to) ? ` → ${land}` : ''}${dest.title ? ` (${dest.title})` : ''}`,
        expected: exp ? `${optional ? 'Optional: ' : 'Should open '}${exp}${byPath.get(exp) && byPath.get(exp).title ? ` (${byPath.get(exp).title})` : ''}` : (v.reason || ''),
        path: where[0] || '/', pages: where, selector: l.selector, location: l.location,
        visibleOn: l.hiddenBy ? [] : ['desktop'], hiddenOn: l.hiddenBy ? [`Desktop (${l.hiddenBy})`] : [],
        snippet: [l.context ? `Section: ${l.context}` : '', l.near ? `Around it: ${l.near}` : ''].filter(Boolean).join(' · ').slice(0, 300),
        ai: { verdict: 'wrong_page', confidence: v.confidence, reason: v.reason, suggestion: exp || '' },
      };
      if (optional) f.optional = true;
      if (!exp && !optional) f.clarify = true;   // a mismatch with no page we could check to offer instead
      f.id = hash([f.code, f.selector, l.to, l.text, where.length > 1 ? '*' : f.path].join('|'));
      if (!findings.some((x) => x.id === f.id)) findings.push(f);
    });
    return sortFindings(reconcileLinks(findings));
  }
  /**
   * One answer per link: when the AI found a link opens the wrong page (or reaches it through a
   * redirect), a town-page idea for the same link and page is dropped, so a link is never told to go
   * two different places. Only these overlapping link items; nothing else is touched.
   */
  function reconcileLinks(findings) {
    const strong = findings.filter((f) => !f.gone && (f.code === 'LINK_WRONG_PAGE' || f.code === 'LINK_VIA_REDIRECT' || f.code === 'LINK_ANCHOR_MISSING'));
    if (!strong.length) return findings;
    return findings.filter((f) => f.code !== 'LINK_TOWN_SERVICE' || f.gone || !strong.some((g) => g.selector === f.selector && (g.pages || [g.path]).some((p) => (f.pages || [f.path]).includes(p))));
  }
  /** Words that ask for a lead: a button with them opening the wrong page loses enquiries, so it is critical. */
  const LEAD_WORDS = /\b(contact|get in touch|quote|estimate|book|schedule|appointment|call|reach us|enquir|inquir)/i;

  function toCSV(findings, siteLabel) {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Site', 'Severity', 'Category', 'Page', 'Other pages', 'Location', 'Visible on', 'Hidden on', 'CSS selector', 'Finding', 'Found', 'Expected', 'Assignee', 'Done']];
    findings.forEach((f) => rows.push([siteLabel || '', f.severity, f.category, f.path, (f.pages || []).slice(1).join(' '), f.location, (f.visibleOn || []).map((d) => DEVICE_LABEL[d]).join('/') || 'None (hidden)', (f.hiddenOn || []).join('; '), f.selector, f.message, f.found || '', f.expected || '', f.assigneeName || '', f.done ? 'yes' : '']));
    return rows.map((r) => r.map(esc).join(',')).join('\n');
  }

  /**
   * Design polish: real, but not what a visitor or Google judges the business by. Inconsistent
   * typefaces and the same photo used twice sit on their own tab, so the audit items that affect
   * the business (contact details, links, spelling, SEO) can be finished first and seen to be finished.
   */
  const POLISH_CODES = new Set(['FONT_OFF_SYSTEM', 'FONT_OFF_SYSTEM_MORE', 'FONT_NOT_LOADED', 'FONT_SOURCE_ODD', 'IMAGE_DUPLICATE']);
  const isPolish = (f) => !!f && POLISH_CODES.has(f.code);
  /**
   * Lengths: an SEO title, meta description or alt text that is longer or shorter than ideal. Worth
   * tidying, never what is wrong with the website, so they have their own tab too. What the words SAY
   * (spelling, a wrong name or phone, a missing title) stays with the audit items.
   */
  const LENGTH_CODES = new Set(['META_TITLE_LONG', 'META_TITLE_SHORT', 'META_DESC_LONG', 'META_DESC_SHORT', 'ALT_LONG']);
  const isLength = (f) => !!f && LENGTH_CODES.has(f.code);
  /** Which list an audit item belongs to: 'must' (audit items), 'polish' (fonts, duplicate photos) or 'length'. */
  /**
   * Technical SEO: what search engines and AI assistants read about the website rather than what visitors
   * see — structured data (schema), robots.txt, sitemap.xml, llms.txt, indexing settings, analytics and icons.
   * Wrong business details INSIDE the schema (name, phone, email, address) stay with the audit items: they
   * are contact details, just in another place.
   */
  const TECH_RE = /^(ROBOTS_|SITEMAP_|LLMS_|REDIRECT_|SCHEMA_(INVALID_JSON|NO_TYPE|NO_CONTEXT|MULTI_BUSINESS|REQUIRED|RECOMMENDED|TYPE_GENERIC|RATING|SELF_REVIEW|URL|FAQ_EMPTY|LOCALBUSINESS_OFF)$|FAQ_SCHEMA_|META_NOINDEX$|META_CANONICAL_DOMAIN$|META_THANKYOU_INDEXED$|MIXED_CONTENT$|ANALYTICS_|FAVICON_MISSING$|HOMESCREEN_ICON_MISSING$|META_OG_IMAGE$)/;
  const isTech = (f) => !!f && TECH_RE.test(String(f.code || ''));
  const groupOf = (f) => (isPolish(f) ? 'polish' : isLength(f) ? 'length' : isTech(f) ? 'tech' : 'must');

  // ---------------------------------------------------------------------------
  // EXCEPTIONS — pages (and values) where some checks don't apply.
  //
  // A dealer's website carries the manufacturer's landing pages (XPEL, 3M…), which are supposed to
  // show the manufacturer's phone, email and socials. An exception names those pages (an exact path
  // or a wildcard: /xpel-*, *ppf*) and what not to check there; an exception set can also list
  // values (the manufacturer's phone, its Facebook page) that are fine anywhere on any website.
  // Items they cover are not deleted: they are shown as Exempt, so removing the exception brings
  // them straight back.
  // ---------------------------------------------------------------------------
  const EXEMPT_GROUPS = [
    { k: 'contact', label: 'Contact info', desc: 'Business name, phone, email, address and social accounts', def: true },
    { k: 'meta', label: 'Meta', desc: 'SEO title and meta description' },
    { k: 'headings', label: 'Heading tags', desc: 'H1 missing, hidden or repeated' },
    { k: 'content', label: 'Content', desc: 'Spelling, grammar, punctuation and placeholder text' },
    { k: 'links', label: 'Links and buttons', desc: 'Links to other websites, broken links, buttons opening the wrong page' },
  ];
  /** Which tick-box an audit item falls under, or '' for items no exception can silence. */
  function exemptGroupOf(f) {
    const c = String((f && f.code) || ''), cat = (f && f.category) || '';
    // Somebody else's credit or a hidden link is never "the manufacturer's page being itself".
    if (!c || c === 'DESIGNER_CREDIT' || c === 'HIDDEN_LINK' || /^AI_PENDING/.test(c)) return '';
    if (/^META_/.test(c)) return 'meta';
    if (/^H\d_|^HEADING/.test(c)) return 'headings';
    if (cat === 'Contact info' || cat === 'Social' || cat === 'Business name' || f.foreignName
      || /^(PHONE|TEL|SMS|EMAIL|MAILTO|ADDRESS|SOCIAL|GMB|MAP_|NAME_|SCHEMA_(NAME|PHONE|EMAIL|ADDRESS))/.test(c)) return 'contact';
    if (/^(TEXT_|PLACEHOLDER|REPEATED_WORD)/.test(c)) return 'content';
    if (cat === 'Links' || /^(LINK_|BUTTON_)/.test(c)) return 'links';
    return '';
  }
  /** A page address as an exception compares it: path only, lower case, no trailing slash. */
  function exemptPath(p) {
    let x = String(p || '').trim();
    if (!x) return '';
    if (/^https?:\/\//i.test(x)) { try { x = new URL(x).pathname; } catch (e) { /* keep as typed */ } }
    x = x.split(/[?#]/)[0].toLowerCase().replace(/\s+/g, '');
    if (!x.startsWith('/') && !x.startsWith('*')) x = '/' + x;
    if (x.length > 1) x = x.replace(/\/+$/, '');
    return x || '/';
  }
  /** Does a page match a pattern? Exact path, or * for "anything here": /about-us-*, *xpel*. */
  function exemptMatch(pattern, path) {
    const pat = exemptPath(pattern), x = exemptPath(path) || '/';
    if (!pat) return false;
    if (!pat.includes('*')) return pat === x;
    return new RegExp('^' + pat.split('*').map((t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(x);
  }
  const exemptPages = (f) => ((f && f.pages && f.pages.length ? f.pages : [f && f.path]).filter(Boolean));
  /** The exception (if any) that covers an audit item: { id, name, kind, … } or null. */
  function exemptRuleFor(f, rules) {
    if (!f || !rules || !rules.length) return null;
    const g = exemptGroupOf(f);
    if (!g) return null;
    const paths = exemptPages(f);
    let av;
    for (const r of rules) {
      // A page exception covers an item only when every page it was found on is exempt.
      if ((r.skip || []).includes(g) && (r.pages || []).length && paths.length && paths.every((p) => r.pages.some((pat) => exemptMatch(pat, p)))) return r;
      if (g === 'contact' && (r.values || []).length) {
        if (av === undefined) av = allowValueOf(f);
        if (av && r.values.some((v) => allowKey(v.type, v.value) === av.key)) return r;
        if (f.found && r.values.some((v) => placeValueIn(v, f.found))) return r;
      }
    }
    return null;
  }
  /**
   * An address, city or state somebody said is fine: found inside the text of an item. An address is
   * compared loosely (punctuation and spacing aside); a city or state must be a whole word, so "IL"
   * never matches "mail".
   */
  function placeValueIn(v, text) {
    if (!v || !text) return false;
    if (v.type === 'address') return compact(v.value).length >= 6 && compact(text).includes(compact(v.value));
    if (v.type !== 'city' && v.type !== 'state') return false;
    const w = String(v.value || '').trim().toLowerCase();
    return w.length >= 2 && new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '([^a-z0-9]|$)').test(String(text).toLowerCase());
  }
  /** The same for one thing the auto audit found on a live page: { type, value, path }. */
  function exemptIssueRule(x, rules) {
    if (!x || !rules || !rules.length) return null;
    const key = x.type === 'address' ? '' : allowKey(x.type, x.value);
    for (const r of rules) {
      if ((r.skip || []).includes('contact') && x.path && (r.pages || []).some((pat) => exemptMatch(pat, x.path))) return r;
      if ((r.values || []).some((v) => (key ? v.type === x.type && allowKey(v.type, v.value) === key : placeValueIn(v, x.value)))) return r;
    }
    return null;
  }

  global.DudaAudit = {
    POLISH_CODES, isPolish, LENGTH_CODES, isLength, isTech, groupOf, serviceAreas, focusTown, linkPurpose, isAutomationEmail, fileFindings, robotsGroups,
    EXEMPT_GROUPS, exemptGroupOf, exemptPath, exemptMatch, exemptRuleFor, exemptIssueRule,
    DEVICES, DEVICE_LABEL, CHECKS_VERSION, CHECK_RELEASES, checksSince, fixedSince, updatePlan, codeIn,
    buildTruth, auditDocument, runScan, extractSchema, mergeDevices, groupAcrossPages, buildFontSystem, fontFindings,
    matchesBusiness, normPhone, fmtPhone, uniqueSelector, truthWithout, allowedFonts, allowedImages, imageKey, measureImage, graphicReason, hamming, duplicatePhotoFindings, fingerprintPhotos, stockIdOf, editorialStockFindings, stockMeasure, photosUsed, fontOf, fontBase, fontWeight, hiddenReason, placeNameFromUrl, placeIdFromUrl, socialHandle, postLink, isShareLink, isThankYouPath, textRisk, nameVariants, pageFitFindings, placeOfPath, servicesOfPath, applyPageFit, allowKey, allowValueOf, filterAllowed, socialUrl, toCSV, fingerprint, hash, normalizePath, applyAltVerdicts, applyTextIssues, placeContext, placesIn, applyProofIssues, applyLinkVerdicts, applyPhotoVerdicts, finalPage, LEAD_WORDS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
