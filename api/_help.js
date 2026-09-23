// The app's Help guide: one source for the Help page AND the Help assistant's knowledge.
// audience: 'all' (everyone) or 'admin' (admins only). Plain HTML, no scripts.
// Never mention how the app is built or hosted, which AI models it uses, or any keys/passwords.

export const HELP_SECTIONS = [
  {
    id: 'start', group: 'Getting started', title: 'What this app does', audience: 'all',
    html: `<p><b>Duda Site Auditor</b> checks Duda websites before and after launch, so no client ends up with another client's details, broken links or missing SEO basics.</p>
<p>It reads every page of a website on <b>Desktop, Tablet and Mobile</b>, including side panels (hamburger menus), popups and elements hidden on some devices, and compares everything with the site's <b>Business Info</b> in Duda: business name, phone numbers, emails, address, social links and domain.</p>
<p>Each problem becomes an <b>audit item</b> (like <b>#12</b>) that the team works through until the website is clean, then the fixes are confirmed on the live, published website.</p>
<h4>The process in short</h4>
<ol>
<li><b>Add</b> a website (paste its site ID or editor link), or pick one from <b>Live DR Sites</b>.</li>
<li>The app <b>scans</b> it and lists the audit items.</li>
<li>The team <b>fixes</b> each item in the Duda editor and sets its status (Done, For clarification, On hold or False alarm).</li>
<li>When every item is closed, <b>publish</b> the site in Duda.</li>
<li>Click <b>🌐 Verify on live site</b> to confirm the fixes are really live.</li>
<li>Set the website's status to <b>Complete</b>.</li>
</ol>
<h4>Finding your way</h4>
<p>The top menu has <b>Audits</b>, <b>Live DR Sites</b> and <b>Suggestions</b>. The <b>light-bulb</b> button (top left, next to the logo) opens <b>About</b>, <b>AI Status</b>, <b>Help</b>, <b>Suggest a feature</b> and today's <b>AI credits</b>.</p>`,
  },
  {
    id: 'account', group: 'Getting started', title: 'Your account', audience: 'all',
    html: `<h4>Signing up and signing in</h4>
<ul>
<li>Create an account with your work email. You'll get a 6-digit code by email to confirm it.</li>
<li>Accounts from the agency's email domain are ready right away. Other accounts wait for an admin to approve them (you'll get an email when approved).</li>
<li>Forgot your password? Use <b>Forgot password</b> on the sign-in screen to get a reset code.</li>
<li><b>Remember me</b> keeps you signed in for 30 days on that browser. Without it, you're signed out after 12 hours.</li>
</ul>
<h4>Your settings (click your avatar, top right)</h4>
<ul>
<li><b>Display name</b>: how teammates see you.</li>
<li><b>Pop-up notifications stay on screen for</b>: 4 seconds up to "until I close them". <b>Show a test notification</b> previews it, and also sends a Slack test message when your Slack option is ticked.</li>
<li><b>Open the Duda editor and previews on</b>: <b>White-label</b> (the agency's editor address) or <b>Duda</b> (my.duda.co). This only changes where your Editor and Preview links take you. The audit is the same for everyone.</li>
<li><b>Also message me on Slack</b> (when Slack is connected): you get a Slack message from <b>Site Auditor</b> when someone mentions you, replies to you or assigns you an item. It uses the Slack account with the same email as here. <b>Send a test message</b> checks it works.</li>
<li><b>Sign out</b> is at the bottom of the same window.</li>
</ul>`,
  },
  {
    id: 'team', group: 'Getting started', title: 'Team members and who is online', audience: 'all',
    html: `<ul>
<li>Click <b>Members</b> (top right) to see everyone on the team, how many websites each person is assigned, and whether they're online.</li>
<li>The coloured dots at the top right show who's online: <b>green</b> = active now, <b>grey</b> = idle (no activity for a while), no dot = offline. Click them to see what each person is working on.</li>
<li>Click a teammate to see their recent activity: websites, item changes, comments and scans.</li>
<li>When Slack is connected, click a teammate's <b>name</b> in a pop-up or in the "is also here" bar to open a Slack chat with them.</li>
</ul>`,
  },
  {
    id: 'admin-members', group: 'Getting started', title: 'Managing members (admins)', audience: 'admin',
    html: `<ul>
<li>New accounts from outside the agency's email domain show under <b>Admin for Approval</b> in <b>Members</b>. Click <b>Approve</b> or <b>Reject</b>. Admins also get a notification (bell, desktop and Slack if connected) when someone signs up.</li>
<li>Change someone's role with the <b>Member / Admin</b> menu. Admins can approve accounts, manage roles, reset passwords, see the app-wide <b>Activity</b> page and the <b>False alarms</b> list.</li>
<li>When Slack is connected, each member shows <b>Slack ✓</b> or <b>No Slack match</b>. "No Slack match" means no Slack account uses that email, so Slack messages can't reach them: they should register here with the same email they use in Slack. Nobody needs to install anything in Slack.</li>
<li><b>Reset password</b> creates a temporary password. Send it to the person privately; they can change it later with "Forgot password".</li>
<li><b>✕</b> removes an account. Some accounts are protected and can't be changed.</li>
<li>Members don't see who is an admin.</li>
</ul>`,
  },
  {
    id: 'audits', group: 'Audits', title: 'The Audits page', audience: 'all',
    html: `<p><b>Audits</b> lists every website the team is auditing.</p>
<ul>
<li><b>Search</b> by business name, site ID or who added it. Filter by website status, assignee, and (once Live DR Sites has loaded) <b>Live or not</b>: sites no longer live in Duda, or with domain problems.</li>
<li>Each row shows the assignee, the website status, the scan status, open issues by severity, and progress (closed / total items).</li>
<li><b>Rescan</b> scans one website again. <b>Rescan all shown</b> rescans every website in the current filter.</li>
<li><b>✕</b> deletes a website with its audit, comments and activity log (admins, or the person who added it).</li>
</ul>
<h4>A website's page</h4>
<ul>
<li>Under the name: the site ID and when it was <b>last published</b> in Duda.</li>
<li><b>Open editor ↗</b>: the Duda editor. <b>Live site ↗</b>: the published website visitors see. <b>Draft preview ↗</b>: the editor's current version, including changes that aren't published yet (this is what scans read).</li>
<li><b>Export CSV</b> downloads the audit items. <b>Rescan</b> scans the draft again.</li>
</ul>
<h4>Website statuses</h4>
<ul>
<li><b>Not started</b>: added, nobody has worked on it yet.</li>
<li><b>In progress</b>: set automatically after the first scan. The team is working on it.</li>
<li><b>Complete with query</b>: done, but a question remains (for the client or a lead).</li>
<li><b>Complete</b>: all items closed, published and verified on the live site.</li>
<li><b>On hold</b>: paused, for example waiting on the client.</li>
</ul>`,
  },
  {
    id: 'add', group: 'Audits', title: 'Adding websites', audience: 'all',
    html: `<ul>
<li>Click <b>+ Add website</b>. Paste <b>site IDs</b> (like <code>cb89784b</code>) or <b>Duda editor links</b>, one per line (commas work too). Both white-label and my.duda.co links work.</li>
<li>As you type, each new ID shows its business name or domain from Live DR Sites. "Not in the published list" means the ID may have a typo, or the site isn't published.</li>
<li>Websites already in Audits are skipped and shown with <b>Open existing audit</b>.</li>
<li>Pick who to <b>Assign</b> it to, then <b>Add &amp; start audit</b>. The scan starts right away.</li>
<li>You can also add a website from <b>Live DR Sites</b> with <b>Audit this website</b>.</li>
</ul>`,
  },
  {
    id: 'scan', group: 'Audits', title: 'Scanning and rescanning', audience: 'all',
    html: `<ul>
<li>The scan runs in <b>your browser tab</b>, 2 websites at a time. <b>Keep the tab open</b> until it finishes (the browser warns you if you try to close it).</li>
<li>It reads the Duda <b>preview</b> (what's in the editor now, published or not) on Desktop, Tablet and Mobile.</li>
<li>The scan status shows <b>Queued</b>, <b>Scanning 12/45</b> with a progress bar and the current step, then <b>✓ Scan complete</b> or <b>Scan failed</b>. "Interrupted, rescan" means the tab running it was closed.</li>
<li><b>Only one scan per website runs at a time.</b> If a teammate has it queued or is scanning it, you'll see "Queued by …" or "Scanning by …" and the Rescan button is greyed out until they finish. If their tab closed, it frees up within a few minutes.</li>
<li>During the AI steps, a <b>Skip AI</b> button lets you finish the scan without the AI checks. Skipped parts become "AI check pending" items.</li>
<li><b>Rescanning keeps your work.</b> The same issue keeps its number (#12), status, assignee and comments. New issues get new numbers.</li>
</ul>`,
  },
  {
    id: 'items', group: 'Audit items', title: 'Reading an audit item', audience: 'all',
    html: `<ul>
<li><b>ID</b> (#12): stays the same across rescans. Type <b>#12</b> in the search box to jump to it, or in a comment to link it.</li>
<li><b>Severity</b>: <b>critical</b> (wrong or harmful: another business's details, wrong phone, broken important link, wrong noindex), <b>warning</b> (should be fixed), <b>info</b> (nice to fix).</li>
<li><b>Category</b>: Contact info, Business name, Social, Links, Images / Alt, Meta / SEO, Schema, Content, Accessibility.</li>
<li><b>Page / path</b>: the page it's on (click to open the preview). "+3 more pages" means the same issue appears on other pages too.</li>
<li><b>Where</b>: Header, Footer, Body, Side panel (hamburger menu), Popup, Head / Meta, and the devices it shows on. A device marked as hidden means the element exists but is hidden on that device.</li>
<li><b>Unique CSS selector</b>: points to the exact element (see "Finding an element").</li>
<li><b>Found / Expected</b>: what the page has vs. what Business Info says.</li>
<li><b>✨ AI notes</b>: some items were flagged by the AI (alt text naming another business, wrong location in text, placeholder text). The note explains why and may suggest better wording with a Copy button.</li>
<li>Click the item (or its ID) to open the side panel with all details, the status buttons, the assignee and the discussion. Use the ↑ ↓ buttons to move between items and <b>Esc</b> to close.</li>
</ul>`,
  },
  {
    id: 'statuses', group: 'Audit items', title: 'Audit item statuses', audience: 'all',
    html: `<table class="help-table"><thead><tr><th>Status</th><th>Meaning</th><th>When to use it</th></tr></thead><tbody>
<tr><td><b>Open</b></td><td>Needs fixing.</td><td>Default for every new item.</td></tr>
<tr><td><b>For clarification</b></td><td>"I have a question before I can fix this."</td><td>Something is unclear (which phone number? is this logo right?). Add a comment and <b>@mention</b> the person who can answer. It stays in the default list and counts in "For clarification".</td></tr>
<tr><td><b>Done</b></td><td>Fixed in the Duda editor.</td><td>After you've made the change. It's checked again on the live site with <b>Verify on live site</b>.</td></tr>
<tr><td><b>On hold</b></td><td>"We know what to do, but it can't be done yet."</td><td>Waiting on something outside the team: the client's new logo, a domain fix, an approval. It leaves the default list and the open critical counts. Find it with the <b>On hold</b> filter.</td></tr>
<tr><td><b>False alarm</b></td><td>"This isn't actually a problem."</td><td>The check was wrong (a partner logo, a correct alt text). You can add a reason; it goes to the admins to improve the checks. False alarms are skipped by the live-site check.</td></tr>
</tbody></table>
<p><b>Rule of thumb:</b> if someone <i>inside</i> the team can answer, use <b>For clarification</b>. If you're waiting on someone <i>outside</i>, use <b>On hold</b>.</p>
<p>Only <b>Done</b> and <b>False alarm</b> count as cleared. The "All items are cleared" message shows when every item is one of those two.</p>
<p>The default filter shows <b>Open + For clarification</b>. Switch the status filter to see Done, On hold, False alarm or All. You can also filter by severity (the All / Critical / Warning / Info chips), category, location, device and assignee, and search (type <b>#12</b> to jump to an item).</p>`,
  },
  {
    id: 'find', group: 'Audit items', title: 'Finding an element (Show on page, preview, editor)', audience: 'all',
    html: `<ul>
<li><b>👁 Show on page</b>: opens a snapshot of the page inside the app with the element outlined in red. Hidden elements are revealed (side panels are opened, hidden or animated elements are shown) and a note explains where it lives.</li>
<li><b>Copy</b>: copies the CSS selector.</li>
<li><b>▶ Show on preview</b>: opens the Duda preview of that page on the item's device. When the item has visible text, the browser scrolls to it and highlights it.</li>
<li><b>✎ Show in editor</b>: opens that page in the Duda editor and copies the selector for you.</li>
<li><b>⌖ DSA Highlight</b> (one-time setup, click <b>?</b> next to the links): a bookmark you drag to your bookmarks bar. On the preview or in the editor, click it to scroll to the element and flash a red outline. In the editor it reads the copied selector (allow clipboard access the first time) or lets you paste it. If it says "hidden on this view", switch to the item's device or open the side panel and click it again.</li>
<li><b>⌖ Console snippet</b> (in the item panel): copies a small snippet you can paste in the browser console on the preview to outline the element.</li>
</ul>
<p>Editor and preview links follow your <b>White-label / Duda</b> setting in your account.</p>`,
  },
  {
    id: 'comments', group: 'Collaboration', title: 'Comments, mentions and assignments', audience: 'all',
    html: `<ul>
<li>Every item has its own <b>discussion</b>, and every website has a <b>Comments</b> tab for general talk.</li>
<li>Type <b>@</b> to tag a teammate (they're notified), and <b>#12</b> to link an item.</li>
<li>Paste screenshots with <b>Cmd/Ctrl+V</b> or click <b>Image</b>. Images are resized automatically.</li>
<li>Click <b>Reply</b> to quote someone. <b>Cmd/Ctrl+Enter</b> sends.</li>
<li>Each website has an assignee (the "site default"). Each item can be assigned to someone else; they're notified.</li>
<li>Each website's <b>Activity log</b> records scans, rescans, status changes, comments and live checks with date, time and who did it.</li>
</ul>`,
  },
  {
    id: 'notifications', group: 'Collaboration', title: 'Notifications and "someone is on this website"', audience: 'all',
    html: `<ul>
<li>The <b>bell</b> collects mentions, replies and assignments. Click one to jump to the item.</li>
<li>New notifications also pop up at the top right (macOS style). Hover to pause the timer, ✕ to close. Set how long they stay in your account settings.</li>
<li><b>Desktop notifications</b>: allow them when asked, and you'll get alerts even when the tab is in the background.</li>
<li><b>Slack</b> (when connected): the same updates as a Slack message from <b>Site Auditor</b>. Turn it on or off in your account settings.</li>
<li><b>Someone is on this website</b>: when you open a website a teammate is working on (or they open yours), a pop-up tells you, and the bar under the title shows "… is also here" and which item they're on. Talk to them so you don't fix the same item twice.</li>
</ul>`,
  },
  {
    id: 'ai', group: 'Checks', title: 'AI checks and "AI check pending"', audience: 'all',
    html: `<ul>
<li>Some things need judgement, so the <b>Site Auditor AI</b> reviews image <b>alt text</b> and <b>page text</b> for another business's name, a wrong city or placeholder text. Brand and partner logos (XPEL, Ceramic Pro, wheel brands…) are treated as correct.</li>
<li>Answers are saved, so rescans don't re-check text that hasn't changed.</li>
<li>Only text that could hide a problem is sent: a name that looks like another business, a place, contact details or filler text. Plain marketing prose is skipped, so a long blog doesn't use up the day's credits. The scan summary says how many blocks were read and how many were skipped.</li>
<li>The AI has a daily allowance. The <b>AI Status</b> page (light-bulb menu) shows credits left today and when they refill. The site page shows the credits too.</li>
<li>If the allowance runs out during a scan, the unchecked parts become <b>AI check pending</b> items ("will resume after …"). They're checked <b>automatically</b> when credits are back, or click <b>Run now</b>.</li>
<li>If you check a pending item yourself and mark it <b>Done</b>, the AI skips it.</li>
</ul>`,
  },
  {
    id: 'rules', group: 'Checks', title: 'What the checks look for', audience: 'all',
    html: `<ul>
<li><b>Contact info</b>: phone numbers and click-to-call links (including buttons that show one number but dial another), email links, addresses, Google Map embeds pointing to another business.</li>
<li><b>Business name</b>: another shop's name left over from a template, name written differently.</li>
<li><b>Social</b>: links to another business's profiles, generic links that don't point to a profile. A Google Maps link that carries only a place ID (<code>data=!4m2!…</code>) can't be read by name, so it's only a note asking you to open it, or a warning when it's a different place than Business Info — never "another business". "Share this page" buttons on blog posts are ignored.</li>
<li><b>Links</b>: broken internal pages, broken external links, insecure http:// links, links with no readable text.</li>
<li><b>Images / Alt</b>: missing or placeholder alt text, alt text naming another business, broken images. The site's own logo is checked; brand/partner logos are accepted.</li>
<li><b>Meta / SEO</b>: missing or too long/short titles and descriptions, missing H1, social share image, canonical pointing elsewhere.</li>
<li><b>noindex</b>: normal pages set to "noindex" are <b>critical</b>. <b>Thank-you / confirmation pages must be noindex</b>; one that isn't is <b>critical</b>.</li>
<li><b>Schema</b>: structured data that doesn't match Business Info.</li>
<li><b>Content</b>: lorem ipsum and template filler, copyright lines from another business.</li>
</ul>
<p class="small">Still check by hand: business hours, prices, service areas, form recipients and text inside images.</p>`,
  },
  {
    id: 'verify', group: 'Checks', title: 'Verify on live site', audience: 'all',
    html: `<p>Scans read the editor's <b>preview</b>. Fixes only reach the real website when it's <b>published</b> in Duda. The <b>Live site check</b> box on a website's page confirms that.</p>
<h4>What it checks</h4>
<ul>
<li>It scans the <b>published website</b> (the live domain) again, every page, on Desktop, Tablet and Mobile.</li>
<li>It then looks only at the items marked <b>Done</b>: is each one also fixed on the live site?</li>
<li><b>Open</b>, <b>On hold</b>, <b>For clarification</b> and <b>False alarm</b> items are <b>not</b> checked.</li>
</ul>
<h4>How to use it</h4>
<ol>
<li>Fix items in the Duda editor and mark them <b>Done</b>.</li>
<li><b>Publish</b> the site in Duda. The box shows <b>Last published in Duda</b> with the date and time, and warns you (with the item numbers) if items were marked Done after the last publish.</li>
<li>Click <b>🌐 Verify N Done items on live site</b>. The button is greyed out while nothing is marked Done.</li>
</ol>
<h4>Reading the result</h4>
<ul>
<li><b>✓ Fixed on live site</b>: the item numbers that are really gone. Click a number to open the item.</li>
<li><b>⚠ Marked Done but still on live site</b>: publish again, or click <b>Reopen these</b> to send them back to Open.</li>
<li><b>? Couldn't check</b>: the AI was busy for an AI-flagged item. Try again later.</li>
<li>If items were marked Done after the check, the box lists them so you can run it again.</li>
</ul>
<p>When every item is Done or False alarm, the box says <b>🎉 All items are cleared</b>. The result is saved on the page and in the Activity log. Only one live check or scan per website runs at a time.</p>`,
  },
  {
    id: 'approved', group: 'Checks', title: 'Approved values (correct for this website)', audience: 'all',
    html: `<p>Sometimes a value that isn't in Business Info is intentional. For example, the client asked for forms to go to a different email, or a second phone number is correct.</p>
<ol>
<li>Mark the item <b>False alarm</b> and write why (for example "Client asked for this email, see Duda comment #144").</li>
<li>For emails, phone numbers, social links and business names, the window shows a ticked box: <b>"… is the correct … for this website. Don't flag it again"</b>. The value is taken from the item's <b>Found</b>, so it works for any website.</li>
<li>If other open items on the same website have the same value, the box lists their numbers and closes them as False alarm too, with the same reason.</li>
<li>Future scans of <b>this website only</b> never flag that value again, on any page. Other websites are not affected.</li>
</ol>
<p>Approved values are listed under <b>Reference data → Also correct for this website</b>, with who approved them, when, from which item and why. Click <b>Remove</b> to have the value checked again on the next scan. Untick the box if you only want to close this one item.</p>`,
  },
  {
    id: 'live', group: 'Live DR Sites', title: 'Live DR Sites', audience: 'all',
    html: `<p><b>Live DR Sites</b> lists every <b>published</b> website in the Duda account, so you can pick what to audit.</p>
<ul>
<li>The list refreshes automatically every 6 hours. <b>↻ Pull from Duda</b> refreshes it now. <b>Last pulled</b> shows when and by whom.</li>
<li>Search and filter by name, site ID or domain, audited / not audited and domain health. Sort by newest publish, name or domain problems.</li>
<li><b>Audit this website</b> adds it to Audits and starts the scan. Already audited sites show a link to their audit.</li>
<li><b>Editor ↗</b> opens the site in the Duda editor (following your White-label / Duda setting).</li>
<li>Business names fill in automatically the first time.</li>
</ul>
<h4>Domain health (🌐 Check domains)</h4>
<p>Opens each site's custom domain to check it really shows this website.</p>
<ul>
<li><b>Working</b>: loads normally (redirects on the same domain are fine).</li>
<li><b>Redirects</b>: sends visitors to a different domain.</li>
<li><b>Shows unrelated content</b>: loads a spam, gambling or parked page. Fix the domain before auditing (this needs the customer).</li>
<li><b>Not pointing to this website</b>: the domain loads something else; its DNS may point to another host.</li>
<li><b>404 Not found</b>, <b>Not responding</b>, <b>Connection refused</b>, <b>SSL certificate problem</b>, <b>Could not open</b>: the domain has a technical problem.</li>
<li><b>No custom domain</b>: the site only has its Duda address.</li>
</ul>
<p>An audited website that's no longer in the published list shows <b>No longer live in Duda</b> (unpublished or deleted). The audit is kept for reference.</p>`,
  },
  {
    id: 'whatsnew', group: 'More', title: "What's New", audience: 'all',
    html: `<p>The <b>light-bulb</b> button (top left) <b>glows</b> when there's an update you haven't read.</p>
<ul>
<li>Click the light bulb → <b>What's New</b>.</li>
<li>Each note says what changed and, under <b>Where to find it</b>, the steps to try it. Some have a button that takes you straight there.</li>
<li>Notes you haven't seen are marked <b>New</b>. Opening the list clears the glow.</li>
</ul>`,
  },
  {
    id: 'suggest', group: 'More', title: 'Suggestions and False alarms', audience: 'all',
    html: `<ul>
<li><b>Suggest a feature</b> (in the light-bulb menu, top left, and on About) sends an idea to the app owner. You can follow what happens to it under <b>My suggestions</b>.</li>
<li>When you mark an item <b>False alarm</b>, you can add a reason. It helps improve the checks.</li>
</ul>`,
  },
  {
    id: 'admin-tools', group: 'More', title: 'Admin tools', audience: 'admin',
    html: `<ul>
<li><b>Activity</b> (top menu): everything that happened across the app, with filters.</li>
<li><b>Suggestions → False alarms</b>: every item someone marked False alarm, with their reason. Set each to <b>New</b>, <b>Ongoing</b>, <b>Done</b> or <b>Skip</b>, add notes, and jump to the item.</li>
<li><b>Suggestions → Feature suggestions</b>: ideas from the team.</li>
</ul>`,
  },
  {
    id: 'faq', group: 'More', title: 'Common questions', audience: 'all',
    html: `<h4>The Rescan button is greyed out</h4><p>A teammate has that website queued or is scanning it (hover to see who). It frees up when they finish.</p>
<h4>A scan shows "Interrupted, rescan"</h4><p>The tab running it was closed. Click Rescan.</p>
<h4>An item keeps coming back after I marked it Done</h4><p>Rescans keep your status. If a live check says "Still on live site", the fix isn't published yet or didn't work.</p>
<h4>The AI says "check pending"</h4><p>The daily AI allowance ran out. It resumes by itself when credits are back (see AI Status).</p>
<h4>"Show on page" can't find the element on Mobile</h4><p>It may only exist on another device, or inside the side panel. Check the device chips under "Where".</p>
<h4>Can two people work on the same website?</h4><p>Yes. You'll see a pop-up and a "… is also here" bar. Agree who takes which items.</p>`,
  },
];

export function helpFor(role) {
  return HELP_SECTIONS.filter((s) => s.audience === 'all' || (s.audience === 'admin' && role === 'admin'));
}
export function helpText(role) {
  return helpFor(role).map((s) => `## ${s.group} › ${s.title}\n` + s.html
    .replace(/<\/(p|li|h4|tr|ol|ul)>/g, '\n').replace(/<(td|th)>/g, ' | ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim()).join('\n\n');
}
