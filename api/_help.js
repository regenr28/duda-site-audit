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
<li>Click a teammate's <b>name</b> anywhere (a comment, a mention, the member list) to see who they are: their email, whether they're online, any previous names, and what they've been working on.</li>
<li><b>Display names are unique.</b> If someone tries to use a name that's taken, they're asked to add a surname or initial, so a mention always points to one person.</li>
<li>Mentions remember the person, not the text: if they change their display name later, older mentions show the new name (hover to see the name used at the time).</li>
<li>In <b>Members</b> you can search and filter by <b>Everyone</b>, <b>Online now</b>, <b>Offline</b> and <b>Switched off</b>.</li>
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
<li><b>Switch off</b> an account when someone leaves. They can't sign in any more, but their name stays on every audit item, comment and scan they touched, so nothing loses its history. Switched-off people are hidden from the assignee lists (an item already assigned to them still shows their name), and you can <b>Switch back on</b> any time.</li>
<li><b>Delete</b> (on a switched-off account) removes it for good: their name disappears from old items. Prefer <b>Switch off</b>.</li>
<li>Name changes are recorded: the member's card lists previous names, and the app-wide <b>Activity</b> page shows who renamed themselves and when.</li>
<li>Some accounts are protected and can't be changed.</li>
<li>Members don't see who is an admin.</li>
</ul>`,
  },
  {
    id: 'audits', group: 'Audits', title: 'The Audits page', audience: 'all',
    html: `<p><b>Audits</b> lists every website the team is auditing.</p>
<ul>
<li>Both site lists show a <b>Comments</b> column. Click the count and it opens that website's conversations, with the new ones highlighted for a few seconds.</li>
<li><b>Search</b> by business name, site ID or who added it. Filter by website status, assignee, and (once Live DR Sites has loaded) <b>Live or not</b>: sites no longer live in Duda, or with domain problems.</li>
<li>Each row shows the assignee, the website status, the scan status, open issues by severity, and progress (closed / total items).</li>
<li><b>Rescan</b> scans one website again. <b>Rescan all shown</b> rescans every website in the current filter.</li>
<li><b>✕</b> takes that audit off the list, with its items, comments and activity log (admins, or the person who added it). The website itself is untouched in Duda, and the removal is listed under <b>Removed from Audits</b> with the reason. See <b>Removing an audit</b>.</li>
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
<li>When the scan finishes, the person who <b>added</b> the website and the person it's <b>assigned</b> to are notified (bell, desktop, and Slack if they've switched it on). If you ran the scan yourself you just see it on screen.</li>
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
</ul>
<h3>When new checks are added</h3>
<p>The check list grows over time. A finished audit is <b>never</b> changed behind your back: it keeps exactly the items it was given, and no new item appears until somebody rescans that website. A <b>Complete</b> audit stays Complete.</p>
<ul>
<li>A website scanned before the newest checks shows a <b>blue note at the top of its Audit items</b>: how many checks were added, and <b>See what was added</b> for the full list in plain words.</li>
<li><b>Rescan now</b> runs it. <b>Not now</b> hides the note on that website — for you only, and it comes back the next time checks are added.</li>
<li>Rescanning <b>keeps every item you already have</b>, including everything marked <b>Done</b>, <b>False alarm</b> or <b>On hold</b>. The new checks only add new <b>Open</b> items, so a website at 24/24 might become 24/31.</li>
<li>Checks added this way are <b>warnings and notes, never critical</b>, so your critical counts don't move.</li>
<li>To find them all: on <b>Audits</b>, the toolbar button <b>✨ Scanned before the newest checks</b> filters the list to them, and each one is flagged in the <b>Scan</b> column. Filter first, then <b>Rescan all shown</b> if you want the lot done at once.</li>
</ul>
<p class="small muted">One thing to know on an update day: the scan runs in your browser tab, so a tab that's been open since before the update is still running the old checks. Reload the page once and you're on the new ones.</p>`,
  },
  {
    id: 'removed', group: 'Audits', title: 'Removing an audit (and finding it again)', audience: 'all',
    html: `<p>The <b>✕</b> on a row takes that audit <b>off the Audits list</b>. It does <b>not</b> touch the website: the Duda site stays exactly as it is, still published, still listed under <b>Live DR Sites</b>. Only the audit here — its items, comments and activity log — is thrown away.</p>
<ul>
<li>You're asked <b>why</b>, and a reason is required. It takes a second now and saves the "why is this one gone?" argument in six months.</li>
<li>The assignee, the person who added it and whoever marked it Complete are told that you removed it, and why.</li>
<li>It's then listed on <b>Removed from Audits</b> with the business name, the <b>site ID</b>, how far the audit had got, who removed it, when, and the reason.</li>
<li><b>Audit again</b> on that page puts the site ID back in the Add dialog, so a site that comes back after a few months is one click away from a fresh scan.</li>
<li>Admins see everything removed; everyone else sees what they removed, added or was assigned to.</li>
</ul>
<p class="small muted">The audit itself isn't a backup and can't be restored — "Audit again" starts a new scan. The newest 400 removals are kept.</p>`,
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
<li>You are told when <b>your own</b> scan finishes too, so you can start one and go and do something else — except on a <b>Rescan all shown</b>, which would ring dozens of times.</li>
<li>The <b>bell</b> collects mentions, replies, assignments, <b>finished scans</b> and any change to a website you own (see <b>Who owns an audit</b> below). Click one to jump to the item.</li>
<li>New notifications also pop up at the top right (macOS style). Hover to pause the timer, ✕ to close. Set how long they stay in your account settings.</li>
<li><b>Desktop notifications</b>: allow them when asked, and you'll get alerts even when the tab is in the background.</li>
<li><b>Slack</b> (when connected): the same updates as a Slack message from <b>Site Auditor</b>. Turn it on or off in your account settings.</li>
<li><b>Someone is on this website</b>: when you open a website a teammate is working on (or they open yours), a pop-up tells you, and the bar under the title shows "… is also here" and which item they're on. Talk to them so you don't fix the same item twice.</li>
</ul>`,
  },
  {
    id: 'comments-duda', group: 'Collaboration', title: 'Duda comments (from clients and the editor)', audience: 'all',
    html: `<p>Anyone who opens a website in the Duda editor — a teammate, or the client looking at their draft — can leave a comment pinned to the page. Those comments now appear here, on the <b>Duda comments</b> page in the top menu. They are separate from this app's own comments on an audit item.</p>
<h4>What you get</h4>
<ul>
<li><b>Every website in the Duda account</b>, not only the ones on the Audits list. A site does not have to be added to Audits to read its comments — and it does not have to be published either, which matters because most client comments land on a draft.</li>
<li>Each conversation shows the <b>page</b>, the <b>device</b> it was left on, who wrote it, when, and whether it is resolved.</li>
<li>Comments are marked <b>client</b> or <b>internal</b>. Anyone with an account here, or an address at the agency's domain, is internal; anyone else is the client. An admin can correct that on any name.</li>
<li><b>New to you</b> is per person: reading a website's comments clears your own count, not everyone's.</li>
<li>A conversation shows its <b>number</b> (as in the Duda editor), the opening comment, and its replies grouped underneath.</li>
<li><b>Resolved conversations are hidden</b> unless you tick <b>Show resolved</b> — otherwise a website that has been tidied up looks like a wall of "Resolved".</li>
<li>Search <b>inside</b> a website's comments to find the one you remember.</li>
<li>Some conversations say <b>"started before comments were connected"</b>. Only what was said since the connection was switched on can be here; open it in the Duda editor to read the whole thread.</li>
<li><b>It updates by itself.</b> Nothing needs refreshing: a new comment appears within a second or two, even while you are reading that website. The <b>↻ Refresh</b> button is only there for reassurance.</li>
<li>If it turns out to need work, <b>Add to Audits</b> is on the same screen.</li>
</ul>
<h4>The one notification</h4>
<p class="small muted">It only fires when the <b>client</b> spoke last. A teammate's own note — a worklog, or "this has been updated, let us know" — means we are holding the ball, not the client waiting, so it never rings. The alert names the conversation number and device, and carries two buttons: one into this app on that website, one straight into the Duda editor.</p>
<p>New comments do <b>not</b> notify anyone — there would be too many. The single exception: when a <b>client</b> comment has gone <b>24 hours with no reply from anyone on the team and is still unresolved</b>, the admins are told, once. Replying in Duda or resolving the conversation both count as answering. Weekends do not count, so a Friday-evening comment is flagged on Monday, not Saturday.</p>
<h4>Switching it on (admins)</h4>
<ul>
<li>Open <b>Duda comments</b> → <b>⚙ Duda connection</b> → <b>Connect to Duda</b>. That is the whole setup: it subscribes for the entire account in one click, using the app's existing Duda access. Nothing has to be requested from Duda and nothing is installed per website.</li>
<li>The panel shows what it subscribed to, whether deliveries are arriving, and lets you pause or disconnect at any time. Subscriptions on the Duda account that this app did not make are left alone.</li>
</ul>
<h4>Two things it cannot do</h4>
<ul>
<li><b>Reading only.</b> Replying and resolving still happen in the Duda editor — there is no way to write a comment from here. When someone resolves one there, it turns green here within a second.</li>
<li><b>No history.</b> Only comments made from the day this was switched on can appear. Anything said before that cannot be fetched.</li>
</ul>`,
  },
  {
    id: 'ownership', group: 'Collaboration', title: 'Who owns an audit (and how your work is protected)', audience: 'all',
    html: `<p>Nobody can quietly take a website off you, reopen your finished work or rescan it without you hearing about it. Every one of these tells the person affected <b>what happened and who did it</b>, in the bell, on the desktop and on Slack if you've switched that on.</p>
<ul>
<li><b>You're credited when you finish.</b> Set a website to <b>Complete</b> and the page and the Audits row show <b>✓ Marked Complete by you</b> with the date. That stays there even if someone rescans it later.</li>
<li><b>Rescanned after you completed it?</b> You're told who rescanned it and when, so "wait, I already finished this" never happens again.</li>
<li><b>Reopened?</b> If someone moves your Complete website back to In progress, you and the assignee are told who did it and why.</li>
<li><b>Reassigned?</b> If a website is taken off you, you're told who has it now and who moved it. If they gave it to themselves you'll see "<i>… took this website over from you</i>".</li>
<li><b>Taking one over asks first.</b> Before you can take a website off someone who is working on it — or reopen a completed audit — the app warns you how much they've already closed, tells you they'll be notified, and lets you add a short reason. The reason goes in the notification and in the website's <b>Activity log</b>.</li>
<li><b>Everything is logged.</b> The website's <b>Activity log</b> keeps every reassignment, reopen and rescan with the date, the time and the person.</li>
</ul>
<p class="small muted">If something still looks wrong, open the website's <b>Activity log</b> first — it usually answers the question — then talk to the person named there.</p>`,
  },
  {
    id: 'stats', group: 'Collaboration', title: 'Team stats', audience: 'all',
    html: `<ul>
<li><b>Team stats</b> shows, per person: websites assigned to them now, how many of those are Complete, how many websites they marked Complete, audit items they closed as <b>Done</b>, and how many they tagged <b>False alarm</b>, <b>On hold</b>, <b>For clarification</b> or reopened.</li>
<li>Open it from <b>Members</b> (top right) → <b>📊 Team stats</b>.</li>
<li>Members see their own row. Admins see everyone, so patterns stand out — for example someone tagging a lot of items as False alarm, which is worth a conversation rather than an assumption.</li>
<li>Counting starts from the day this was switched on, so older work isn't in the numbers.</li>
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
<li><b>FAQ schema</b>: more than one FAQ block on a page (Google only wants one), and an FAQ section with "enable FAQ schema" left off.</li>
<li><b>Local business schema</b>: missing on the home page.</li>
<li><b>Page addresses</b>: capital letters, underscores, spaces, a number on the end (usually a duplicated page), leftover names like "copy-of" or "untitled", and very long addresses.</li>
<li><b>Typefaces</b>: the scan first works out <b>the website's own fonts</b> — the home page H1 settles the title font, its paragraphs settle the body font, and the navigation and buttons are reported as following one of those two. You'll see all four on the website page under <b>Fonts on this website</b>, in Reference data. The audit items are then the <b>exceptions</b>: one item per piece of text that isn't in one of the website's fonts, naming the words themselves ("Title in Magistral-Medium — the rest of the titles use Bai Jamjuree"), so <b>Show on page</b> takes you straight to it. Text that repeats across pages (a header, a footer) is one item listing its pages. If one slip covers a lot of ground, the first 12 are listed and a note says how many more there are. Also flagged: a font the website uses but never loads (visitors see something else), and a font loaded from somewhere other than Google Fonts or Envato. Icon fonts, and CSS that matches nothing on the page, are ignored.</li>
<li><b>Thank-you page</b>: missing a call button or a way back to the home page.</li>
<li><b>Analytics</b>: no Google Analytics or Tag Manager tag on the home page, or an old UA- tag that no longer collects anything.</li>
<li><b>Contact form</b>: more than one form on a page, and a phone field that isn't required.</li>
<li><b>Buttons that go nowhere</b>: a button whose link is empty, "#" or javascript:.</li>
<li><b>Favicon</b> and <b>home screen icon</b> missing.</li>
<li><b>Mixed content</b>: images, scripts or stylesheets loaded over http:// on an https:// website.</li>
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
    html: `<p><b>Live DR Sites</b> lists every <b>published</b> website in the Duda account, so you can pick what to audit. A second tab, <b>Not published yet</b>, lists the websites still in build — the ones clients are reviewing and commenting on, which never appeared anywhere before. It starts on the ones <b>with comments</b>, and can also show those in Audits, or every unpublished website. Any website we are receiving comments for appears here even when Duda's own draft list leaves it out (it says so on the row). Both tabs have a <b>Comments</b> column.</p>
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
<h4>Can two people work on the same website?</h4><p>Yes. You'll see a pop-up and a "… is also here" bar. Agree who takes which items.</p>
<h4>A website says "new checks available" — do I have to rescan?</h4><p>No. It's an offer, not a warning. The audit keeps exactly the items it has until you rescan, and a rescan keeps your Done, False alarm and On hold items untouched — it only adds new Open ones. <b>Not now</b> hides the note on that website.</p>
<h4>Will new checks reopen an audit I already marked Complete?</h4><p>No. The Complete stamp stays, and nothing changes unless someone rescans. If you do rescan, the website stays Complete but will show the new items as Open, so you'd see something like 24/31 instead of 24/24.</p>`,
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
