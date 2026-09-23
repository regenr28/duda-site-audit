// "What's New": short, friendly notes about updates, newest first.
// audience: 'all' (everyone) or 'admin' (admins only). Keep them about WHAT CHANGED and WHERE TO FIND IT.
// Never mention how the app is built or hosted, AI model names, settings or keys.

export const NEWS = [
  {
    id: '2026-09-23-who-is-who', date: '2026-09-23', audience: 'all', tag: 'Team',
    title: 'Always know who is who',
    what: 'Display names are now unique, so no two people can share one. <b>Click any name</b> (in a comment, a mention or the member list) to see their email, whether they\'re online and what they\'ve been working on. Mentions remember the person, so if someone renames themselves, older mentions show their new name; hover to see the name used at the time.',
    where: ['Click a name in a comment or an <b>@mention</b>.', 'Click <b>Members</b> (top right) to search and filter by <b>Everyone</b>, <b>Online now</b>, <b>Offline</b> and <b>Switched off</b>.', 'Changing your own name: avatar → <b>Your account</b>. If the name is taken you\'ll be asked to add a surname or initial.'],
  },
  {
    id: '2026-09-23-switch-off', date: '2026-09-23', audience: 'admin', tag: 'Admin',
    title: 'Switch an account off instead of deleting it',
    what: 'When somebody leaves, switch their account off. They can no longer sign in, but their name stays on every audit item, comment and scan, so you can still see who did what. You can switch it back on at any time.',
    where: ['Click <b>Members</b> → <b>Switch off</b> on that person.', 'Use the <b>Switched off</b> filter to see them.', 'Deleting for good is still there, but it removes their name from old items.'],
  },
  {
    id: '2026-09-23-scan-done', date: '2026-09-23', audience: 'all', tag: 'Audits',
    title: "You're told when a scan finishes",
    what: 'Submit a website for audit and get on with something else. When the scan finishes, the person who <b>added</b> the website and the person it is <b>assigned</b> to both get a notification with the number of audit items found: in the bell, on the desktop, and on Slack if they\'ve switched that on.',
    where: ['Click <b>+ Add website</b>, choose who to <b>Assign</b> it to, then <b>Add &amp; start audit</b>.', 'The dialog and the website page tell you that you\'ll be notified when it finishes.', 'Want it on Slack? Avatar → <b>Your account</b> → tick <b>Also message me on Slack</b>.'],
  },
  {
    id: '2026-09-23-ai-credits', date: '2026-09-23', audience: 'all', tag: 'AI',
    title: 'More AI capacity, and it lasts much longer',
    what: 'The ✨ AI can now check far more websites in a day. It also works smarter: only text that could hide a problem is sent (a name that looks like another business, a place, contact details or filler text), so plain marketing copy and long blog posts no longer use up the day\'s credits. When one AI runs out, the next one carries on by itself.',
    where: ['Click the <b>light bulb</b> (top left) → <b>AI Status</b> to see the credits left today.', 'On a website\'s page, the scan summary now says how many text blocks were read and how many plain ones were skipped.'],
    link: '#/ai', linkText: 'Open AI Status',
  },
  {
    id: '2026-09-23-slack', date: '2026-09-23', audience: 'all', tag: 'Slack',
    title: 'Get your notifications on Slack',
    what: 'When someone mentions you, replies to you or assigns you an audit item, you can get a direct message on Slack as well as the bell. You don\'t need to install anything: it uses the Slack account with the same email you signed up with here.',
    where: ['Click your <b>avatar</b> (top right) → <b>Your account</b>.', 'Tick <b>Also message me on Slack</b> and click <b>Save</b>.', 'Click <b>Show a test notification</b>: you\'ll see the pop-up and get a Slack message from <b>Site Auditor</b>.', 'Not receiving it? Your Slack account must use the same email as your account here.'],
  },
  {
    id: '2026-09-23-verify-live', date: '2026-09-23', audience: 'all', tag: 'Audits',
    title: 'Check that your fixes are really live',
    what: 'After you fix items and publish the site in Duda, the app can scan the <b>published</b> website and confirm that the items you marked <b>Done</b> are really fixed there. It shows the item numbers that are fixed, and the ones still on the live site.',
    where: ['Open a website, stay on <b>Audit items</b>.', 'The <b>Live site check</b> box shows when the site was last published.', 'Click <b>🌐 Verify … Done items on live site</b>.'],
    link: '#/help/verify', linkText: 'How it works',
  },
  {
    id: '2026-09-23-false-alarm', date: '2026-09-23', audience: 'all', tag: 'Audits',
    title: 'Approve a value as correct for a website',
    what: 'Some values are intentional, like a client asking for forms to go to a different email. When you mark an item <b>False alarm</b>, you can now tick a box to say that value is correct for that website. Other open items with the same value are closed too, and future scans stop flagging it.',
    where: ['Open an audit item → <b>False alarm</b>.', 'Write the reason, keep the tick box on, and save.', 'Approved values are listed under <b>Reference data → Also correct for this website</b>, where you can remove them.'],
    link: '#/help/approved', linkText: 'Read more',
  },
  {
    id: '2026-09-22-find-element', date: '2026-09-22', audience: 'all', tag: 'Audits',
    title: 'Jump straight to the element: preview or editor',
    what: 'Every audit item now has <b>Show on preview</b> and <b>Show in editor</b> under its CSS selector, so you can go straight to the page you need to fix. A one-time bookmark can outline the exact element for you.',
    where: ['Open a website → <b>Audit items</b>.', 'Under the selector, click <b>▶ Show on preview</b> or <b>✎ Show in editor</b>.', 'Click the small <b>?</b> next to them to set up the <b>⌖ DSA Highlight</b> bookmark once.'],
    link: '#/help/find', linkText: 'Read more',
  },
  {
    id: '2026-09-22-one-scan', date: '2026-09-22', audience: 'all', tag: 'Audits',
    title: 'Only one scan per website at a time',
    what: 'If a teammate has a website queued or is scanning it, you\'ll see <b>Queued by …</b> or <b>Scanning by …</b> and the Rescan button is greyed out. No more two people scanning the same site and getting different results.',
    where: ['You\'ll see it on the <b>Audits</b> list, in the Scan column.', 'It frees up when they finish, or within a few minutes if their tab closed.'],
  },
  {
    id: '2026-09-22-add-ids', date: '2026-09-22', audience: 'all', tag: 'Audits',
    title: 'Add websites by pasting site IDs',
    what: 'You no longer need the full editor link. Paste site IDs (like <code>cb89784b</code>), one per line. Each one shows its business name as you type, so typos stand out.',
    where: ['Click <b>+ Add website</b> and paste the IDs.', 'Links still work, and you can mix both.'],
  },
  {
    id: '2026-09-22-editor-env', date: '2026-09-22', audience: 'all', tag: 'Settings',
    title: 'Choose where editor and preview links open',
    what: 'Some of the team prefer the agency editor address, others prefer Duda\'s. You can now pick your own; it only changes where your links take you.',
    where: ['Click your <b>avatar</b> → <b>Your account</b>.', 'Pick under <b>Open the Duda editor and previews on</b>, then <b>Save</b>.'],
  },
  {
    id: '2026-09-22-site-header', date: '2026-09-22', audience: 'all', tag: 'Audits',
    title: 'Last published date and a Live site button',
    what: 'A website\'s page now shows when it was last published in Duda, plus a <b>Live site ↗</b> button for the published website. The old "Preview" button is now called <b>Draft preview ↗</b>, because it shows the editor\'s version including unpublished changes.',
    where: ['Open any website: it\'s under the business name and along the top-right buttons.'],
  },
  {
    id: '2026-09-22-help', date: '2026-09-22', audience: 'all', tag: 'Help',
    title: 'A full Help guide, with an assistant',
    what: 'Everything about the app is now written down: statuses, scanning, audit items, Live DR Sites and more. You can also ask the Help assistant a question in your own words.',
    where: ['Click the <b>light bulb</b> (top left) → <b>Help</b>.', 'Search the guide, or type a question at the top.'],
    link: '#/help', linkText: 'Open Help',
  },
  {
    id: '2026-09-22-checks', date: '2026-09-22', audience: 'all', tag: 'Checks',
    title: 'Fewer false alarms, one new critical check',
    what: 'Blog "share this page" buttons and Google Maps links that carry only a place ID are no longer reported as another business, and LinkedIn profiles are read correctly. New rule: a <b>thank-you page that is not set to noindex</b> is now critical, while thank-you pages that are noindex are correct.',
    where: ['You\'ll see the difference on the next rescan of a website.'],
    link: '#/help/rules', linkText: 'What the checks look for',
  },
  {
    id: '2026-09-23-admin-slack', date: '2026-09-23', audience: 'admin', tag: 'Admin',
    title: 'See who can be reached on Slack',
    what: 'The Members list now shows <b>Slack ✓</b> or <b>No Slack match</b> for each person, so you can spot someone whose app email differs from their Slack email.',
    where: ['Click <b>Members</b> (top right).'],
  },
];

export const newsFor = (role) => NEWS.filter((n) => n.audience === 'all' || (n.audience === 'admin' && role === 'admin'));
export const latestNewsId = (role) => (newsFor(role)[0] || {}).id || '';
