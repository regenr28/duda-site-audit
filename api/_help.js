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
<li>The app <b>backs the website up in Duda</b>, then <b>scans</b> it and lists the audit items.</li>
<li>The team <b>fixes</b> each item in the Duda editor and rescans (fixed items close themselves), or sets a status by hand (Done, For clarification, On hold or False alarm).</li>
<li><b>📋 Summary</b> writes up what was found and fixed for the group chat.</li>
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
<li><b>📋 Summary</b> writes a short note for the group chat (see below). <b>Export CSV</b> downloads the audit items. <b>Rescan</b> scans the draft again.</li>
<li><b>💾 Backup</b> (under the last scan): the latest backup of the website made from here, and <b>Back up now</b> to make another.</li>
</ul>
<h4>Summary for the group chat</h4>
<p><b>📋 Summary</b> on a website's page writes a plain-text note of the audit, ready to paste into Slack or Google Chat:</p>
<ul>
<li><b>What the app checked</b>: how many pages, on which devices, how many links and images, and that every contact detail was compared with Business Info (and the client's brief, if there is one) and cross-checked with the client's comments.</li>
<li><b>What was found</b>: each problem once, however many places it was in. The same wrong phone number in 15 meta descriptions is one entry, not 15. Each entry says what was found and where on the page (meta description, page text, click-to-call links…), what Business Info says is correct, whether the client mentioned it in a comment, the pages it was on (a., b., c. and how many more), and whether it is fixed. For example:<br><i>1. Wrong phone number. Found (732) 800-3960 in the meta description and social share description. The correct number is (609) 642-8206 (Business Info). Not mentioned in any of the 14 client comments on this website. Found on these pages: a. /ceramic-coating b. /ppf c. /window-tint …and 10 more pages. ✅ Fixed — all 26 places, confirmed by a rescan</i></li>
<li>Spelling works the same way: <i>Found "Buff &amp; Beyond", but Business Info says "Buff&amp;Beyond", which is the official spelling.</i></li>
<li><b>Smaller fixes</b> and <b>Still to do (minor)</b> are counted by kind.</li>
<li><b>Checked and ruled out</b> (false alarms) and <b>Still open</b>.</li>
<li>Choose <b>Whole audit</b>, <b>Last 24 hours</b> or <b>Last 7 days</b>, and how many pages to list per issue (3, 5, 10 or all). Edit the text if you like, then <b>Copy</b>.</li>
</ul>
<h4>Backups in Duda</h4>
<ul>
<li>Before the <b>first scan</b> of an audit, the app makes a backup of the website in Duda, named <span class="mono">R8</span> + your initials + <span class="mono">_b4_audit_</span> + the date and time, e.g. <span class="mono">R8RR_b4_audit_20261007_0930</span>. Rescans don't make more.</li>
<li><b>Back up now</b> makes one at any time. Two in the same minute get <span class="mono">_2</span> on the end.</li>
<li>Backups live in Duda, not here. To restore one, open the editor and use <b>Site History</b>.</li>
<li>Duda keeps at most <b>50</b> manual backups per website. When it's full, the app says so; delete old ones in Site History.</li>
<li>If a backup fails, the scan still runs, and the page says why.</li>
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
<h3>Fix it in the editor, then rescan</h3>
<p>You don't have to change an item's status after fixing it. Fix the problem in the Duda editor, rescan, and anything that is <b>no longer on the website closes by itself</b>.</p>
<ul>
<li>It is set to <b>Done</b>, keeps its number, and is labelled <b>✓ Fixed on rescan</b>. Opening it says who rescanned and when. It counts towards the website's progress like any item you closed by hand.</li>
<li>Done items are hidden by the default filter, as always. Pick <b>Done</b> in the Status filter to see them.</li>
<li>An item from a check that has since been corrected closes as <b>✓ Check corrected — closed</b> instead, because there was nothing to fix.</li>
<li><b>Your decisions stand.</b> An item you already marked <b>Done</b> or <b>False alarm</b> is left as it is. <b>On hold</b> and <b>For clarification</b> items do close if the problem is gone.</li>
<li><b>Only pages that were scanned count.</b> If a page wasn't part of the scan, its items are not judged.</li>
<li><b>Marked Done but not actually fixed?</b> If a rescan still finds an item someone marked <b>Done</b>, it goes back to <b>Open</b>, labelled <b>⚠ Still there after rescan</b>. A note at the top of Audit items lists them, and whoever marked it Done is told by name (bell and Slack, under <b>Items reopened against you</b>). The note clears itself once each one has a new status. If the scan is wrong about it, mark it <b>False alarm</b> instead. False alarms are never reopened by a rescan.</li>
<li><b>If it comes back, it reopens.</b> A later rescan that finds it again sets it back to <b>Open</b> with the same number, labelled <b>↺ Back after a rescan</b>.</li>
<li><b>Fixing one of several identical items</b> (say the 2nd of five links) changes the others' CSS selectors. Those are recognised as the same items: they keep their numbers and statuses, and are not counted as fixed or new.</li>
<li>Items written by hand are never closed this way. No scan can see them, so only a person can close them.</li>
</ul>
<h3>Recheck just a few items</h3>
<p>Fixed one or two things and don't want to wait for the whole website? <b>⟳ Recheck</b> scans only the pages those items are on (Desktop, Tablet and Mobile, plus the home page) and checks whether they are still there.</p>
<ul>
<li><b>One item:</b> press <b>⟳ Recheck</b> under its status in the list, or <b>⟳ Recheck this item</b> in its side panel.</li>
<li><b>Several:</b> tick them in the list and press <b>⟳ Recheck</b> in the bar that appears.</li>
<li>Gone → closed as <b>Done</b>, labelled <b>✓ Fixed · rechecked</b>. Still there → stays as it is, labelled <b>⟳ Still there · rechecked</b>. An item someone marked <b>Done</b> that is still there reopens, just like a rescan.</li>
<li>It checks the editor preview, like Rescan, so a fix shows up before you publish. It only judges the items you picked; anything new on those pages appears on the next full Rescan.</li>
<li>Some items can't be rechecked on their own, because the check compares the whole website: duplicate titles or descriptions, fonts, repeated photos, the favicon, broken internal links, and another business's name found on one page and searched for everywhere. Use <b>Rescan</b> for those. False alarms, items written by hand and AI check pending items aren't rechecked either.</li>
<li>AI items use the same AI check as a scan. If the AI is out of credits, they are reported as couldn't check and left as they are.</li>
</ul>
<h3>When new checks are added</h3>
<p>The check list grows over time. A finished audit is <b>never</b> changed behind your back: it keeps exactly the items it was given, and no new item appears until somebody rescans that website. A <b>Complete</b> audit stays Complete.</p>
<ul>
<li>A website scanned before the newest checks shows a <b>blue note at the top of its Audit items</b>: how many checks were added, and <b>See what was added</b> for the full list in plain words.</li>
<li><b>Rescan now</b> runs it. <b>Not now</b> hides the note on that website — for you only, and it comes back the next time checks are added.</li>
<li>Rescanning <b>keeps every item you already have</b>, including everything marked <b>False alarm</b> or <b>On hold</b>, and everything marked <b>Done</b> that the scan no longer finds. The new checks only add new <b>Open</b> items, so a website at 24/24 might become 24/31.</li>
<li>Checks added this way are <b>warnings and notes, never critical</b>, so your critical counts don't move.</li>
<li>To find them all: on <b>Audits</b>, the toolbar button <b>✨ Scanned before the newest checks</b> filters the list to them, and each one is flagged in the <b>Scan</b> column. Filter first, then <b>Rescan all shown</b> if you want the lot done at once.</li>
</ul>
<h3>When a check is corrected</h3>
<p>Sometimes a check was <b>wrong</b>, not just missing — it flagged things that were never a problem. That usually starts with somebody marking an item <b>False alarm</b> and an admin agreeing (<a href="#/help/suggest">how that works</a>); the moment they set it to <b>Audit Adjusted</b>, everything below happens on its own, with no update needed.</p><p> The items it already produced are still sitting on websites, looking exactly like work. Those are not quietly deleted (an item may have your comments, a status, a number somebody quoted in Slack), so they are <b>marked</b> instead.</p>
<ul>
<li>The website shows an <b>orange note</b> at the top of its Audit items: how many items came from the corrected check, what was wrong with it, and <b>Rescan to clear them</b>.</li>
<li>Each affected item carries <b>⚠ This check was corrected — rescan</b> next to its finding, and says the same thing when you open it. <b>Don't work through them.</b></li>
<li>There is no <b>Not now</b> on this one — a wrong item is not optional noise, and hiding it would leave somebody fixing a problem that doesn't exist.</li>
<li>On <b>Audits</b>, the <b>Scan</b> column flags the website with <b>⚠ A check was corrected — rescan</b>.</li>
<li>Items you already marked <b>Done</b>, <b>False alarm</b> or <b>On hold</b> are left alone and not marked — you've already made your decision about them.</li>
<li>Rescanning replaces them with whatever the corrected check finds. If something was a real problem all along, it comes straight back, with its number.</li>
</ul>
<h3>On an update day</h3>
<p>The scan runs <b>in your browser tab</b>, using the checks that tab loaded when you opened it. So a tab left open across an update is still running the <b>old</b> checks, and a rescan from it quietly hands back the old answers — which looks exactly like "the fix didn't work".</p>
<ul>
<li>The app watches for this. When it spots an update it shows an orange note on <b>Audits</b> and on each website: <b>The app has been updated since you opened this tab</b>.</li>
<li>If you start a scan or rescan from a stale tab it <b>stops you</b> and offers <b>Reload and scan</b> — which reloads and then starts the scan you asked for, so nothing is lost.</li>
<li>Reloading takes a second and loses nothing. If in doubt on an update day, reload first.</li>
</ul>`,
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
    html: `<table class="help-table"><tbody>
<tr><td><b>Open</b></td><td>Needs fixing. The default.</td></tr>
<tr><td><b>For clarification</b></td><td>"I have a question before I can fix this." Picking it <b>asks you what the question is</b> and who can answer — see below.</td></tr>
<tr><td><b>Done</b></td><td>Fixed in the Duda editor. Confirm later with <b>Verify on live site</b>.</td></tr>
<tr><td><b>On hold</b></td><td>"We know what to do, but it can't be done yet." Waiting on someone outside the team. Leaves the default list.</td></tr>
<tr><td><b>False alarm</b></td><td>Not actually a problem. You're asked why — that reason becomes a comment on the item and a <a href="#/help/suggest">report against the check</a> you can follow. You can also approve the value so it's never flagged again.</td></tr>
</tbody></table>
<p class="small muted">Rule of thumb: someone <i>inside</i> the team can answer → For clarification. Waiting on someone <i>outside</i> → On hold. Only Done and False alarm count as cleared.</p>
<h3>Changing several items at once</h3>
<ul>
<li>Tick the box at the start of each row (or the box in the header for every item shown). A bar appears with <b>Set status…</b>, <b>Assign to…</b> and <b>⟳ Recheck</b>.</li>
<li><b>False alarm</b> asks for the reason once, and that reason goes on every selected item. <b>For clarification</b> asks its question once, posted on the first item.</li>
<li>Only rows you can see are selected: changing a filter drops any ticked row it hides.</li>
</ul>
<h3>Asking for clarification</h3>
<p>An item parked on "For clarification" without saying what the question is leaves the work stuck quietly, so picking that status asks for the question up front.</p>
<ul>
<li>Type the question. It's <b>posted as a comment on the item</b>, so the answer has somewhere to land and the whole exchange stays with the finding.</li>
<li>Type <b>@</b> to tag a member, or <b>@Admins</b> to reach every admin at once. Everyone tagged gets it on the <b>bell</b>, on their <b>desktop</b> and in <b>Slack</b>.</li>
<li><b>@Admins</b> is worked out when you send it, so it always means whoever is an admin today — not whoever was one when you typed it.</li>
<li>You can attach a screenshot, same as any comment.</li>
</ul>
<h3>Finding what's waiting</h3>
<ul>
<li>On <b>Audits</b>, a website with a question outstanding shows <b>❓ N waiting on an answer</b> under its name.</li>
<li>The <b>For clarification</b> tile at the top is a filter — click it to see only those websites, click again to clear.</li>
<li>Inside a website, the <b>For clarification</b> chip does the same for the item list.</li>
</ul>`,
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
<li><b>Team notes.</b> A conversation nobody on the client side has ever commented in is a note the team left itself — "2 new location pages added by SEO" — and Duda leaves those unresolved forever, because nobody resolves their own notes. They are tagged <b>team note</b> in grey rather than an amber <b>unresolved</b>, they are kept out of <b>New to you</b> and <b>Unresolved</b>, and they have a <b>Team notes</b> chip of their own so nothing is hidden. The moment a client comments in one it becomes an ordinary conversation again. A thread longer than ten comments is never called a note, because the app can't see far enough back to be sure.</li>
<li>On <b>Duda comments</b> and <b>Live DR Sites</b>, unread comments are shown as two capsules — an amber <b>2 client</b> and a grey <b>1 team</b> — because the two mean different things: a client comment you haven't read is somebody waiting on you, one of ours is a colleague keeping you posted. A side with nothing in it shows no capsule. Conversations that arrived before this was switched on still show a plain <b>new</b> count until their next comment.</li>
<li><b>Every count on an Audits row is a way in.</b> Click <b>24 warning</b> and the website opens showing exactly those twenty-four — same for critical, outdated, info, for clarification and on hold. The numbers are worked out the same way the audit list filters, so the count and the list always agree.</li>
<li>The <b>💬 count</b> on the Audits list is every comment on that website, including the ones left on individual audit items. <b>Click it</b> and it opens the discussion with those included, on the newest one — and flashes the control that did it, so you can get there yourself next time.</li>
<li>From the discussion, <b>Show the discussed audit items</b> filters the audit list to just the items somebody has commented on. The same filter is the <b>💬 Discussed</b> chip beside Critical / Warning / Info.</li>
<li>Whenever the audit list is filtered it says so above the table — <b>Showing 2 of 38 · filtered by …</b> — with a <b>Clear filters</b> link, so a short list is never a mystery.</li>
<li>Each website's <b>Activity log</b> records scans, rescans, status changes, comments, live checks and False alarm triage (who set a report to what, and their note) with date, time and who did it.</li>
</ul>`,
  },
  {
    id: 'roles', group: 'Collaboration', title: 'Roles and what each one allows', audience: 'all',
    html: `<p>A role is two things: a <b>name</b> and a <b>list of what it allows</b>. The app ships with two \u2014 <b>Admin</b> and <b>Member</b> \u2014 and you can rename them and add as many more as your team needs.</p>
<p><b>Members \u2192 \ud83e\udde9 Roles</b> (needs <i>Create and change roles</i>).</p>
<h3>Renaming and adding</h3>
<ul>
<li><b>Rename anything.</b> If your "Members" are really developers, call the role <b>Dev</b>. Nobody has to be moved \u2014 it is the same role under a better name.</li>
<li><b>Add what you need</b> \u2014 QA, Project Manager, Content, whoever. Give the role a name, tick what it allows, save.</li>
<li><b>Admin always allows everything</b> and cannot have permissions taken off it. You can rename it, but not weaken it \u2014 an app nobody can get back into is not a state worth being able to reach. The app also refuses to remove the last Admin.</li>
<li>Admin and Member are built in: they can be renamed and (except Admin) changed, but not removed. Roles you create can be removed.</li>
</ul>
<h3>Removing a role people already have</h3>
<p>Say five people are Project Managers and you remove that role. Nobody is left without a role, and nobody is quietly promoted \u2014 so the app <b>refuses until you say what those people become instead</b>. It tells you how many there are and names them, you pick the replacement role, and they are moved in the same step. Everything they have done is untouched; only what they are allowed to do changes.</p>
<h3>Seeing only your own websites</h3>
<p><b>See every website</b> is a permission like any other. Without it, somebody's Audits list holds only the websites they have been <b>assigned or added themselves</b> \u2014 and a website <b>stays on their list after it moves on</b>. A dev who had it, then handed it to QA, then to the project manager, still sees it: the app remembers everybody a website has passed through, not just whoever holds it now. Opening one that was never theirs, even by typing the address, comes back as not found \u2014 the list is narrowed on the server, not in the page.</p>
<h3>Live DR Sites</h3>
<p>The whole page is a permission, and so is each thing on it, so a role can be given the list without the buttons:</p>
<ul>
<li><b>See Live DR Sites</b> \u2014 without it the page is not in the top bar and the address is refused.</li>
<li><b>Pull the list from Duda</b> and <b>Check domains</b> \u2014 the two buttons at the top right.</li>
<li><b>See the audit column and start audits from there</b> \u2014 the Audit column and the "Audit this website" button. Usually QA rather than everybody.</li>
</ul>
<h3>One person, one exception</h3>
<p>Sometimes one person needs something their role doesn't have. <b>Members \u2192 Access</b> (beside their name) opens the same permission grid for that person alone. Tick something the role doesn't have, or untick something it does, and they are badged <b>Custom access</b> in the list.</p>
<p>Only the <b>difference</b> is stored, never a copy of the role. So when the role changes later, everybody on it moves with it and only the deliberate exceptions stay behind \u2014 and when an admin reviews it, the additions are highlighted green and the removals red, because those are exactly what was stored. <b>Put back to plain \u2039role\u203a</b> clears them.</p>
<h3>Changing somebody's access while they are working</h3>
<p>It takes effect <b>there and then</b>. Their page notices on its next request to the server (or within a couple of minutes if they are sitting completely idle), tells them their access has changed, and redraws itself. If they were on a website they can no longer see, they are taken back to the list with an explanation rather than dropped on an error. Nothing they have typed is lost.</p>
<p>Before it saves, the app checks whether that person is <b>in the middle of something</b> \u2014 "Serena is working on Spotless Detailing right now (item #14). Change their role anyway?" \u2014 so nobody has the floor pulled out from under them without the person doing it knowing.</p>
<h3>Looking through somebody else's eyes</h3>
<p><b>Roles \u2192 \ud83d\udc41 View as</b> on any role, or <b>Members \u2192 Access \u2192 \ud83d\udc41 View as \u2039name\u203a</b> for one person including their exceptions. A dark band sits across the top until you leave.</p>
<p>It is not a mock-up: <b>the server applies it too</b>, so while you are previewing you are refused exactly what they would be refused, admin or not. That is what makes it worth trusting. You are still yourself \u2014 anything you do is recorded under your own name.</p>
<h3>A note on two permissions</h3>
<ul>
<li><b>Create and change roles</b> is the keys to the building: anyone who has it can grant themselves everything else. Give it out as carefully as Admin.</li>
<li><b>See enquirers' contact details</b> is worth thinking about separately. Without it, somebody still sees that an enquiry arrived, which page it came from and which source \u2014 enough to do QA on a form \u2014 but not the customer's name, email or phone. The details are removed before they leave the server, not hidden in the page.</li>
</ul>
<h3>Where permissions apply</h3>
<p>Both places, always. The app leaves out buttons and tabs a role cannot use, and <b>every request is checked again on the server</b>. The screen is a convenience; the server is the rule.</p>
<p>A change takes effect the next time that person loads the app.</p>`,
  },
  {
    id: 'analysis', group: 'Collaboration', title: 'Lead analysis', audience: 'all',
    html: `<p><b>Lead analysis</b> in the top bar is what the enquiries across every website add up to. It needs the analysis database connected; until then the pages explain that and nothing is lost \u2014 enquiries keep arriving and <b>Bring enquiries in</b> copies across everything already held.</p>
<h3>Junk and real enquiries</h3>
<p>Every enquiry is sorted as it arrives, in three steps, and most never reach the third:</p>
<ul>
<li><b>What the team has taught it</b> \u2014 a phrase, a sender or a message somebody has already ruled on.</li>
<li><b>Rules</b> \u2014 this kind of pitch is formulaic: "I came across your website", "first page of Google", "link building", a URL in a message that asks for nothing. Against that, the words a real customer uses: quote, price, book, my car, tint, ceramic, this week.</li>
<li><b>The AI</b>, only for what the rules could not settle \u2014 and one answer covers every copy of the same message, wherever else it landed.</li>
</ul>
<p>Nothing is ever deleted. A false negative wastes somebody a minute; a false positive loses a job the shop never hears about, so everything leans towards calling an enquiry real. <b>Mark as junk</b> or <b>Mark as real</b> on any enquiry overrules it, with your name against the decision, and you can teach it the phrase or the sender at the same time.</p>
<p>One deliberate limit: the same message arriving on several websites is strong evidence of a blast \u2014 but it never convicts an enquiry that is plainly asking for work. Two customers can phrase a request identically; a blast cannot ask for a quote on its own car.</p>
<h3>Forms gone quiet</h3>
<p>A form that quietly breaks \u2014 the recipient changed, a redesign dropped the widget \u2014 looks exactly like a slow month, and nobody notices for weeks. This page lists websites that <b>used to get enquiries and have stopped</b>, with how long and how busy they usually are.</p>
<p>It counts <b>real</b> enquiries only. On a website where a third of submissions are junk, a raw count hides the thing worth knowing: the spam carries on while the customers stop.</p>
<h3>Across all websites</h3>
<p>What the busy websites do differently: which kinds of page produce enquiries, where they come from, what day and hour people get in touch. Counts only, <b>nobody named</b>, and a row needs <b>at least three websites</b> behind it before it is shown \u2014 otherwise it is one shop's story dressed up as a pattern.</p>
<p>No single client can see this. It is the one thing that comes from holding hundreds of websites rather than one.</p>
<h3>Junk and blasts</h3>
<p>The same message sent to more than one client. Any one shop sees an odd email; across the whole list it is plainly a blast.</p>`,
  },
  {
    id: 'profiles', group: 'Collaboration', title: 'Profiles, form submissions and client access', audience: 'all',
    html: `<p>Every website has <b>one Profile</b>, and it looks the same whichever way you arrive: the <b>Profile</b> tab of an audit, or <b>Profile</b> on Live DR Sites (an audited website opens its audit's Profile tab; one not audited yet opens the same layout with its form submissions underneath).</p>
<ul>
<li><b>Picture</b>: a small picture of the website's home page, taken the first time somebody opens the profile, and again after the website is published or once a week. Click it to open the preview.</li>
<li><b>Name, domain, site ID</b> (with <b>Copy</b>), launch date, last publish and labels; <b>Client contact</b>; <b>View as client</b>, <b>Audit this website</b> (when not audited yet) and <b>Open editor</b>.</li>
<li><b>Domain health</b>: working or not, when the domain registration must be renewed (red within 7 days), the certificate as information only, speed, when it was last checked, and <b>Check now</b>.</li>
<li><b>Audit</b>, <b>Form submissions</b>, <b>Comments</b> and <b>Client tickets</b>, each a link into the page that explains it.</li>
</ul>
<p>Nothing was created to make this work: an audited website's Profile is its audit record, and a website not audited yet is assembled from the Duda list, so every website already has one.</p>
<h3>Form submissions</h3>
<ul>
<li>New submissions arrive on their own once Duda's connection is switched on \u2014 the same connection that brings client comments in.</li>
<li><b>Live DR Sites \u2192 \u2709\ufe0f Get form submissions</b> fetches them for <b>every website currently listed</b>, so the filters above the table decide the scope: search for a label, or pick "Not audited yet", and only those are fetched. It asks how many months back, then works through them a few at a time with a running count, and <b>Stop</b> ends it cleanly \u2014 whatever has been fetched is kept.</li>
<li>The <b>Enquiries</b> column on that page shows how many are stored for each website and when the last one arrived. Click the number to open that website's submissions. A website that is not in Audits yet has no profile to open, so it offers to add it first \u2014 no scan is started, and the enquiries are already there waiting.</li>
<li><b>Import history from Duda</b> (admins) brings in what Duda already holds for that website, a month at a time, up to a year. Running it twice is safe, and it <b>repairs as well as adds</b>: Duda keeps the original of every submission, so anything the app once read wrongly is read again and rewritten. Your own <b>junk</b> and <b>real</b> rulings are the one thing it never touches.</li>
<li><b>Every live website has a profile</b>, audited or not — the <b>Profile</b> button on any Live DR Sites row opens it. A website that has never been audited has no record and does not need one: its profile is built from the website list and its own enquiries. Nothing is created until somebody presses <b>Audit this website</b>.</li>
<li><b>Form submissions arrive on their own.</b> Duda tells the app the moment any website in the account receives one, so nothing is polled and nothing needs scheduling. The <b>Enquiries</b> column on Live DR Sites says <b>none yet</b> for a website that genuinely has none and <b>waiting…</b> for one whose history is still being fetched.</li>
<li><b>History catches itself up.</b> Every published website is queued once for its past year, and the queue empties a few websites at a time while somebody has the app open — the note above the list says how many are left. A website joins the queue when it is published, when it is sent for audit, and when it first appears in the website list, so a customer being onboarded already has their data.</li>
<li><b>"Page not recorded".</b> Duda's form history does not say which page a form was on — only enquiries that arrive live do. Those older ones are counted in their own bucket at the bottom of <b>By page</b> rather than being credited to the homepage, and every enquiry from now on records its page.</li>
<li><b>The same enquiry is only ever stored once.</b> Duda's history gives a submission no id of its own, so the app recognises one by what the customer wrote and when. The live copy and the imported copy of the same enquiry become one — keeping the page the live one knew — and importing the same history twice adds nothing. Somebody asking again days later is still two enquiries.</li>
<li><b>If a submission reads as "[object Object]"</b>, it was stored before the app understood that form's shape. What the customer wrote is safe in Duda — only our copy is unreadable, so it is hidden rather than shown, a banner appears above the list, and <b>Import history from Duda</b> puts it right.</li>
<li>They are grouped three ways, because they answer different questions: <b>by page</b> (which pages produce work), <b>by form</b> (one page can host more than one), and <b>by source</b> (which marketing actually produces enquiries, from the UTM tags on the link the visitor arrived by).</li>
<li>Duda keeps its own copy of every submission, so nothing here is the only copy \u2014 an import can always be run again.</li>
</ul>
<h3>Client access</h3>
<p>A client can be given their own sign-in that shows them their website and nothing else. On the Profile, use <b>Manage client access</b> (admins only): add a person by name and email, and they get an email saying their dashboard is ready. They set their own password with <b>Forgot password</b> \u2014 we never set one for them.</p>
<p>A client account is <b>not</b> a team member. They never appear in Members, in @mentions or as an assignee, and the team's pages refuse their account outright rather than hiding things from it.</p>
<p><b>One person, several websites:</b> a client's account lists the websites they may see. Give one person two websites and both appear in their sidebar, each with its own enquiries, comments and dashboard. Nothing else needs setting up.</p>
<h3>What a client sees</h3>
<p>Their own left-hand menu, one entry per website they were given:</p>
<ul>
<li><b>Dashboard</b> \u2014 enquiries this month against last, all enquiries, busiest page, top source, a bar per month, and breakdowns by page, by source and by day of the week.</li>
<li><b>Form Submissions</b> \u2014 every enquiry, filterable by page, form and source, with the contact details clickable.</li>
<li><b>Comments</b> \u2014 the conversation about their website.</li>
<li><b>Access website</b> \u2014 opens their website's editor, signed in as them, without a Duda password. The link is made at the moment they click it and lasts about two minutes, so there is nothing to keep or share.</li>
</ul>
<p>They never see audit items, severities, false alarm reports, who marked what, anything the team writes to itself, or any other company's website.</p>
<h3>Checking it yourself \u2014 View as client</h3>
<p>On a Profile, <b>\ud83d\udc41 View as client</b> opens the real client view for that website, with a dark band across the top so nobody mistakes it for the team's pages. It is not a mock-up: it asks the server for exactly what a client would be given, so if something internal ever did leak, this is where you would see it. <b>Back to the team view</b> returns.</p>
<p>It is worth a glance after any change that touches a website's page \u2014 it takes five seconds and it is the only way to be sure.</p>`,
  },
  {
    id: 'analytics', group: 'Collaboration', title: 'Website analytics', audience: 'all',
    html: `<p>Every website's <b>Profile</b> has an <b>📊 Analytics</b> section. Pick <b>30 days</b>, <b>90 days</b> or <b>12 months</b>.</p>
<h3>Duda (always on)</h3>
<ul>
<li><b>Visits</b>, <b>Unique visitors</b> and <b>Page views</b>, each with the change against the period before (▲ / ▼).</li>
<li>What visitors did: <b>Form submits</b>, <b>Click to call</b>, <b>Click to email</b>, <b>Click to map</b>. (The <b>Form submissions</b> card above counts the enquiries this app has stored; Duda's own count can differ slightly.)</li>
<li><b>Daily visits</b> (weekly for 12 months), <b>Visits, last 12 months</b>, <b>Devices</b> and <b>Countries</b>. Hover a chart for the numbers.</li>
<li>No setup: every website has it. Numbers are kept for 6 hours; <b>Refresh now</b> fetches them again.</li>
</ul>
<h3>Custom analytics (added per website)</h3>
<p><b>＋ Add custom analytics</b> (needs <b>Connect custom analytics</b> in your role) adds more sources to one website. Each gets its own tab:</p>
<ul>
<li><b>Google Analytics 4</b>: sessions, users, page views, engagement rate, daily sessions, top pages, and where visitors came from. Enter the GA4 <b>property ID</b> (numbers only, from Admin → Property settings).</li>
<li><b>Google Search Console</b>: search clicks, impressions, click rate, average position and the top search queries. Enter the property as Search Console shows it (<code>sc-domain:example.com</code> or the full https:// address). It runs about three days behind.</li>
</ul>
<p>Before connecting, give the Google account shown on that screen <b>Viewer</b> access in Google Analytics (Admin → Property access management) or Search Console (Settings → Users and permissions). The app tries it before saving, so a wrong ID or missing access is said straight away. More providers can be added to the same list later.</p>
<p>Clients never see analytics. <b>See website analytics</b> and <b>Connect custom analytics</b> are separate switches on the Roles screen.</p>`,
  },
  {
    // Owner only: the one-time Google connection.
    id: 'analytics-setup', group: 'More', title: 'Connecting Google for analytics (one time)', audience: 'owner',
    html: `<p>Google Analytics and Search Console are read with <b>one Google service account for the whole app</b>. Set it up once:</p>
<ol>
<li>In Google Cloud, create (or pick) a project, enable the <b>Google Analytics Data API</b> and the <b>Google Search Console API</b>.</li>
<li>Create a <b>service account</b>, add a key (JSON) and download it.</li>
<li>In Vercel → the project → Settings → Environment Variables, add <code>GOOGLE_SERVICE_ACCOUNT</code> with the whole JSON (or the JSON base64-encoded), then redeploy.</li>
<li>Open any website's Profile → Analytics → <b>＋ Add custom analytics</b>: it now shows the service account's email. Give that email Viewer access in each GA4 property / Search Console site you connect.</li>
</ol>`,
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
</ul>
<h3>Choosing what you get told about</h3>
<p>Open the avatar at the top right → <b>Your account</b>, and scroll to <b>What you get told about</b>. It's a small grid: the kinds of notification down the side, the ways they can reach you across the top.</p>
<ul>
<li><b>Mentions and replies</b> — someone types @your name, or replies to one of yours.</li>
<li><b>Work assigned to you</b> — an audit item or a whole website given to you, taken off you, or reopened.</li>
<li><b>Duda comments waiting</b> — clients have left comments nobody has answered.</li>
<li><b>Scans finishing</b> — a scan you started, or a rescan of a website you completed.</li>
<li><b>False alarm reports</b> — somebody reports an item, or answers a report you made.</li>
<li><b>Feature suggestions</b> — a suggestion is sent, answered or commented on.</li>
<li><b>Accounts and admin</b> (admins only) — someone signs up and needs approving, or an audit is removed.</li>
</ul>
<p>The columns are <b>Bell</b>, <b>Pop-up</b> (the card on screen, or a desktop alert when the app is minimized), <b>Slack</b> and <b>Email</b>. A dash means that notification has never used that channel and never will, so there's nothing to switch.</p>
<p><b>Everything is on unless you turn it off</b>, and anything added to the app later starts out reaching everybody — a new notification going quietly to nobody is the worse mistake. Your choices only change what reaches <b>you</b>; nobody else's notifications are affected, and nobody is told what you switched off.</p>
<p>One exception: <b>a mention always reaches your bell</b>. You can stop the Slack message, the pop-up and the email for mentions, but the bell row is always written — so a teammate who tags you and waits is never waiting on somebody who switched themselves off. That row reads <b>Always</b> instead of a tick box.</p>
<p>The <b>Also message me on Slack</b> checkbox above the grid is the master switch for Slack. Turn it off and the whole Slack column greys out; turn it back on and your per-notification choices are exactly as you left them. Sign-in codes and “your account is approved” are not notifications and always arrive.</p>
<h3>Finding one thing in the bell</h3>
<p>Everything lands in one list, which gets hard to read once there's a lot in it. The bell is split into tabs, and a tab only appears when there's something in it:</p>
<ul>
<li><b>All</b> — everything, newest first.</li>
<li><b>Duda comments</b> — a client has been waiting for an answer. The one to check first.</li>
<li><b>Mentions & replies</b> — someone tagged you, replied to you, or assigned you an item.</li>
<li><b>Scans</b> — a scan or rescan finished.</li>
<li><b>Audits</b> — a website assigned to you, taken off you, reopened or removed, False alarms, and what an admin decided about a false alarm you reported.</li>
<li><b>Admin</b> — sign-ups waiting for approval, and feature suggestions.</li>
</ul>`,
  },
  {
    id: 'requests', group: 'Collaboration', title: 'Client tickets (questions and change requests)', audience: 'all',
    html: `<p>Instead of texting or emailing, clients <b>send a ticket</b> from their own page, on a phone or a computer. Tickets arrive on <b>Tickets</b> in the top menu.</p>
<p>The <b>✉️ Send a ticket</b> button is on their Dashboard and on <b>Tickets</b>. On a phone it also floats at the bottom of every screen. It asks which kind, and explains each one right under it:</p>
<ul>
<li><b>💬 General question</b>: anything not about the website's content or design, such as billing, the domain, email or their account. They type the question and can add a photo or screenshot.</li>
<li><b>🖍 Website change</b>: a change request for the website. They mark it on a picture of the page, as below. Each mark becomes its own ticket, with a picture of exactly where.</li>
</ul>
<h4>Marking a website change</h4>
<ol>
<li>They choose <b>Website change</b>.</li>
<li>Their website opens <b>live</b>: <b>Desktop</b> by default, the way a 1920 × 1000 screen shows it, scaled to fit. <b>Tablet</b> and <b>Phone</b> switch the view, and <b>+ −</b> zoom. They browse as usual: click through pages, open menus and pop-ups, tap slider arrows. Forms, and links to other websites, are switched off.</li>
<li>When they see what should change, they pick a tool: <b>Highlight</b> (tap a line of text or drag across it), <b>Tap item</b> (a picture, button or block), <b>Box</b>, <b>Circle</b> or <b>Arrow</b>. They draw <b>right on the live page</b>, pop-ups included, with no waiting. While a tool is on, two fingers (or the mouse wheel) scroll the page, and the marks move with it. <b>✋ Browse</b> lets them click around again. Drafts can be dragged and resized.</li>
<li>They write what should change and press <b>Send</b>. It turns green at once. The picture for the team is taken a few seconds later, in the background, with the mark drawn on. The server opens the same page and repeats their clicks, so an open menu or pop-up is in it too.</li>
</ol>
<p>If a picture could not be taken, the ticket is still there, with the page, device, and the exact text or element they marked. Open it and press <b>📷 Take the picture now</b>. For something a page can't show by itself, such as a slider that moves on its own, they can use <b>📷 My screenshot</b> instead. Unsent drafts stay with the page, and come back next time.</p>
<p class="small muted">Nothing is installed in the website. The page passes through the app with a small helper added, so real visitors are never affected. It runs locked down inside the app, so it cannot see or act on the client's account.</p>
<p><b>Layers</b> (pull the panel up) lists every mark with its number. Each one can be hidden or locked, so it does not get moved by accident. <b>Hide sent</b> clears the finished ones out of the way, and the marks fade while the page is being moved. If the connection drops, a request waits and sends itself when the connection is back. A retry never sends it twice.</p>
<h4>The daily limit</h4>
<p>Each client can send a set number of tickets a day (10 to start), questions and changes together. After that they can keep marking, and the drafts wait for the next day. Admins change the number, or set a different one for one client, under <b>Tickets → ⚙ Settings</b>.</p>
<h4>On our side</h4>
<ul>
<li>Questions have no page tools or change check: answer them and set a status. Filter the list to <b>💬 General questions</b> or <b>🖍 Website changes</b>.</li>
<li>Everyone whose role can <b>answer change requests</b> is told on the bell and in Slack, one request at a time. Admins can pick who is told in Settings instead. Turn your own off under your account → Notifications → <b>Client change requests</b>.</li>
<li>Open a request to see the picture, what they marked, and the page and device. <b>See it on the whole page</b> shows every mark on that picture. <b>Open in editor</b> goes straight to that page.</li>
<li><b>Has it changed?</b> Opening a request reads the current draft of that page and says whether the spot still says what the client marked. Use this to tell an old request from one already fixed.</li>
<li>Set a status (Received, In progress, Waiting on client, On hold, Done, No change needed), assign it, and <b>write to the client</b>, who sees it on their Change requests page. <b>Team notes</b> are never shown to the client. Several requests can be ticked and updated together.</li>
<li>When a client answers, the request comes back to <b>Received</b> and whoever it is assigned to is told.</li>
</ul>
<p class="small muted">Pictures of pages are kept for two weeks, or two months once a request points at one. The small picture on each request is kept for good.</p>`,
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
</ul>
<h3>Who counts as one of us</h3>
<p>Every comment is marked <b>client</b> or <b>team</b>, and only a client's unanswered comment ever raises an alert. Getting that right matters, and guessing from email domains fails the moment a teammate comments from a personal address — which is exactly the comment that then looks like a client waiting for an answer.</p>
<p>Four things are checked, best answer first:</p>
<ol>
<li><b>Your own correction.</b> <b>not the client?</b> beside any comment wins over everything else, for good.</li>
<li><b>They have an account in this app.</b></li>
<li><b>Duda says so.</b> Duda knows exactly who is <b>staff</b> and who is a <b>customer</b>, and it's asked automatically the first time an address turns up — nothing to set up. The answer is kept for a month.</li>
<li><b>Your Slack workspace</b>, if you've read it in (below). This is what catches someone Duda has never heard of.</li>
</ol>
<p>Only if none of those know the person does it fall back to the email domain.</p>
<h3>Ask Duda about everyone</h3>
<p>Duda has no way to list the people in an account — you can only ask about one at a time. <b>👥 Who is on the team → Ask Duda about everyone who has commented</b> does exactly that: it walks every address that has ever left a comment and asks Duda about each, which arrives at the same list from the other end. It shows who came back as staff, who came back as a customer, and who has no Duda account at all. Duda is asked in batches, so on a big account click it again to carry on.</p>
<h3>Reading Slack</h3>
<ul>
<li><b>👥 Who is on the team</b> (admins, on the Duda comments page) reads your Slack workspace once and keeps the list. Anyone in it counts as team, whatever address they comment from.</li>
<li><b>Slack guests are deliberately left as clients.</b> A client invited into a shared channel is a Slack member too, and counting them as team would silence the comments this is here to catch. The panel names them so you can check.</li>
<li>Bots, deactivated accounts and anyone whose email Slack won't share are skipped.</li>
<li><b>not the client?</b> beside any comment still wins over everything, including Slack. Use it for the odd exception.</li>
<li>It's a snapshot, not a live feed — click <b>Read Slack again</b> after someone joins or leaves.</li>
</ul>
<p class="small muted">Needs the Slack app to have the <b>users:read</b> and <b>users:read.email</b> permissions. If they're missing, the panel says so.</p>
<h3>Knowing what to answer first</h3>
<p>On a busy Monday the question isn't what came in last, it's <b>who has been waiting longest</b>. The page answers that before anything else:</p>
<ul>
<li>A line at the top says how many client comments are waiting, on how many websites, and names the one that has waited longest with the date it came in. It turns red once anyone has been waiting two days or more.</li>
<li>The list is <b>ordered by longest wait first</b>. Websites nobody is waiting on come after, most recent first.</li>
<li>Each waiting website shows <b>how long</b>: "1 waiting · 4 days". The badge gets louder at two days, and louder again at three.</li>
<li>Open a website and <b>every conversation says its own state</b> too: <b>waiting on us · 31h</b> once it's overdue, or <b>ours to answer · due in 2h</b> when the client spoke last but the clock hasn't run out. Under three days the wait counts in hours, because "31h" lands harder than "1 day".</li>
<li><b>"ours to answer" is still a client request</b> — it just isn't late yet. It says when it becomes late, and hovering explains why: a Friday-evening comment isn't overdue until Monday, because weekends don't count.</li>
<li>Threads are ordered the same way inside a website: longest wait first.</li>
<li><b>Work through them, oldest first</b> on that top line filters the list to just those.</li>
</ul>
<p class="small muted">Weekends don't count towards the wait, so a Friday-evening comment is flagged on Monday rather than on Saturday — which is why a website can hold a comment from Friday and still not be listed as waiting.</p>
<h3>Empty and deleted comments</h3>
<p>Duda opens a conversation the moment someone clicks to comment, before any words are typed, and a comment can be deleted afterwards. Either way what's left is a card with nothing on it.</p>
<ul>
<li>A conversation with nothing left in it is <b>not shown, not counted and never alerts</b>. It used to sit in the list as "Page unknown" with no text and still count towards "6 waiting".</li>
<li>Deleted comments are dropped rather than shown as "(deleted)". If the deleted one was the last, the clock stays where the last real comment left it — deleting something no longer looks like activity.</li>
</ul>
<h3>How the alert works</h3>
<p>There is <b>one message per website</b>, never one per comment. A client who leaves twenty comments in a sitting is doing one thing, and twenty Slack messages about it is the fastest way to teach everyone to ignore Slack.</p>
<ul>
<li>The message names the business, says how many are <b>overdue</b> and how long the worst one has waited, then lists the <b>five oldest</b> with their ages and counts the rest. It counts only the overdue ones, so a website can show more client comments on the page than the alert mentions — the others simply aren't late yet.</li>
<li>After that the website <b>goes quiet</b>. It speaks again only when things are genuinely worse — <b>more</b> comments overdue than last time, or the oldest has <b>crossed another day</b> — and never more than once a day.</li>
<li>The reasoning: whoever picks up the 48-hour comment is looking at the rest anyway. Repeating 46h, 30h, 29h and 28h at them is noise.</li>
<li>If more than five websites fall behind at once — a Monday after a quiet weekend — it becomes a <b>single roll-up</b> naming them worst first, rather than a message each.</li>
<li>Once a website is fully answered it's forgotten, so if it falls behind again later it alerts fresh.</li>
</ul>
<p class="small muted">Everything still appears on the page and the bell immediately — the quiet rule only governs how often Slack is interrupted.</p>`,
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
<li><b>Location pages.</b> A page whose own address names a town — <span class="mono">/car-polishing-in-aberdeen</span> — is a location page built on purpose, so naming that town in its title, headings, copy and alt text is correct and is never reported. A <b>different</b> town on that page still is, and so is any town on a page whose address names none. Words in the address that are only the business name or the service being sold don't count as a place.</li>
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
<li><b>Typefaces</b>: the website's own design settings are the reference — the font it sets for the body text, and for each heading level H1 to H6. Those are the website's fonts, and they're listed on the <b>Fonts</b> tab of each website. The audit items are then anything in a font that <b>isn't one of them</b>: one item per piece of text, naming the words ("Title in Magistral-Medium, which is not one of the website's fonts — the website's titles are set in Bai Jamjuree"), so <b>Show on page</b> takes you straight to it. A heading set in the body font is fine — it's still the website's font. Text inside one block — a menu, a banner, a section — is <b>one item</b> naming every piece of text in it, not one per link, and <b>Show on page</b> highlights the block. Text that repeats across pages is one item listing its pages; if one slip covers a lot of ground, the first 12 places are listed and a note says how many more. Also flagged: a font the website uses but never loads (visitors see something else), and a font loaded from somewhere other than Google Fonts or Envato. Icon fonts, and CSS that matches nothing, are ignored.</li>
<li><b>Thank-you page</b>: missing a call button or a way back to the home page.</li>
<li><b>Analytics</b>: no Google Analytics or Tag Manager tag on the home page, or an old UA- tag that no longer collects anything.</li>
<li><b>Contact form</b>: more than one form on a page, and a phone field that isn't required.</li>
<li><b>Buttons that go nowhere</b>: a button whose link is empty, "#" or javascript:.</li>
<li><b>Favicon</b> and <b>home screen icon</b> missing. Both are settings for the <b>whole website</b>, so they're judged once: if any page on any device carries one, nothing is reported, and when there genuinely isn't one you get a single item rather than one per page. (Duda serves the mobile version as separate HTML that usually leaves the favicon link out, which is why this has to be settled across the whole website rather than page by page.)</li>
<li><b>Mixed content</b>: images, scripts or stylesheets loaded over http:// on an https:// website.</li>
<li><b>Contact info</b>: phone numbers and click-to-call links (including buttons that show one number but dial another), email links, share-by-email buttons with no recipient address (one item per website listing every place, since they repeat on every blog post), addresses, Google Map embeds pointing to another business. <b>A map embed is judged by its place ID, not by the name in the link</b>: Google draws the pin and its current name from that ID, and the name sitting in the link is only a label from the day somebody made it, never shown to visitors. So a pin in the client's own town under an old name is <b>info</b> — a renamed Google listing, nothing to fix, and you can mark the old name correct for the website so it never returns. A pin in a different town is a <b>warning</b> to open and check. A map with no place ID at all is <b>critical</b>, because there the name really is what chooses the pin.</li>
<li><b>Business name</b>: another shop's name left over from a template. <b>Spelling</b>: every mention of the name in the page text is compared letter for letter with Business Info. "Buff &amp; Beyond" or "Buff and Beyond" where Business Info says "Buff&amp;Beyond" is a <b>warning</b> showing both spellings; a one-letter slip in a longer name ("Buff&amp;Beyon") is raised as <b>looks misspelled</b>. Not counted: the name in capitals, curly vs straight apostrophes, a possessive ("Buff&amp;Beyond's"), web and email addresses, and (for a name of two or more words) capitals alone. If the client really uses a spelling, approve it as correct for that website.</li>
<li><b>Cross-checked with comments</b>: before a phone number, email, address or business name is called wrong, the client's comments on that website in Duda are searched for it. A comment that mentions it is shown on the item, and an item nobody has touched is moved to <b>For clarification</b>. The same value marked a False alarm on another website is shown too.</li>
<li><b>Social</b>: links to another business's profiles, generic links that don't point to a profile. A Google Maps link that carries only a place ID (<code>data=!4m2!…</code>) can't be read by name, so it's only a note asking you to open it, or a warning when it's a different place than Business Info — never "another business". "Share this page" buttons on blog posts are ignored.</li>
<li><b>Links</b>: broken internal pages, broken external links, insecure http:// links, links with no readable text.</li>
<li><b>Images / Alt</b>: missing or placeholder alt text, alt text naming another business, broken images. The site's own logo is checked; brand/partner logos are accepted. <b>Our own footer badge is skipped entirely</b> — an image inside <span class="mono">id="footer-logo"</span> (or <span class="mono">agency-logo</span> / <span class="mono">credit-logo</span>) is the agency's logo, not the client's image, so it raises no alt item, isn't sent to the AI, and isn't counted as a repeated photo.</li>
<li><b>Meta / SEO</b>: missing or too long/short titles and descriptions, missing H1, social share image, canonical pointing elsewhere.</li>
<li><b>noindex</b>: normal pages set to "noindex" are <b>critical</b>. <b>Thank-you / confirmation pages must be noindex</b>; one that isn't is <b>critical</b>.</li>
<li><b>Schema</b>: structured data (JSON-LD), the hidden code in a page's head that tells Google about the business. It is not the SEO title. Only the entry describing the business itself is compared with Business Info (name, phone, email, ZIP). Entries for a service, product or FAQ are named after what they are and aren't compared with the business name.</li>
<li><b>Content</b>: lorem ipsum and template filler, copyright lines from another business.</li>
</ul>
<p class="small">Still check by hand: business hours, prices, service areas, form recipients and text inside images.</p>`,
  },
  {
    id: 'bi-history', group: 'Checks', title: 'Business Info history and "Outdated" items', audience: 'all',
    html: `<p>Business Info isn't a permanent fact — it's a fact <b>as of a date</b>. A client changes their email and everything the audit knew yesterday quietly goes wrong: the old address still on the website looks like a detail nobody recognises, and the new one gets flagged as incorrect. Every scan now records what Duda says and what changed since last time, which lets the audit tell those two apart.</p>
<h3>Outdated</h3>
<ul>
<li>A website still showing something Duda no longer carries reads <b>"Still using the old phone number — Business Info was changed on 12 Aug 2026"</b>, with the current value as <b>Expected</b>.</li>
<li>These sit at a severity of their own, <b>Outdated</b>, between Critical and Warning. A chip appears above the audit items when a website has any, so a client-change sweep is one click.</li>
<li>A value that was <i>never</i> theirs stays <b>Critical</b> — we have no idea where that one came from, which is a different problem.</li>
<li>The item keeps its number, its comments and whatever status someone gave it. It only changes what it says about itself.</li>
</ul>
<h3>The history tab</h3>
<p><b>Reference data</b> → <b>Business Info history</b> lists every change with its date and what it was before, plus everything that is no longer official. It's kept against the Duda site ID, so it survives an audit being removed from the list and added again months later — which is exactly when it's worth having.</p>
<h3>Approvals look after themselves</h3>
<ul>
<li>An approval says "this value is correct for this website even though Business Info disagrees". The moment Business Info agrees, the approval has nothing left to do — it <b>retires itself</b>, and stays visible under <b>Approvals that retired themselves</b> so nothing vanishes silently.</li>
<li>The reverse is flagged, not removed: an approval for a value that has just <b>stopped</b> being official gets a note asking you to check whether it's still right.</li>
</ul>
<p class="small muted">History starts from the next scan of each website. Until a website has been scanned twice, there's nothing to compare against and everything behaves as it always did.</p>`,
  },
  {
    id: 'fonts', group: 'Checks', title: 'Fonts used on the website', audience: 'all',
    html: `<p>On a scanned website, open <b>Reference data</b> and click the second tab, <b>Fonts used on the website</b>. It sits beside <b>Business Info</b> because it is the same kind of thing: the reference the audit is judged against.</p>
<ul>
<li><b>The website's fonts</b> — one card per font, saying what it dresses (Body text, Heading 1–6), where it's loaded from, and how many places use it. Read from the website's own design settings, so it's the design's answer, not a guess.</li>
<li><b>Not part of the design</b> — fonts that turned up on the pages but aren't in the settings. Usually a pasted widget or a leftover from a template. Nothing here means the website is consistent.</li>
<li>The places using them are <b>audit items</b>, each naming the exact text. <b>Show them in Audit items</b> filters the list below to Design.</li>
</ul>
<h4>Weights are not separate fonts</h4>
<p>An uploaded typeface is served by Duda one weight at a time, each with the weight in its file name — <b>BarcolaExpanded-Bold</b>, <b>BarcolaExpanded-SemiBold</b>, <b>BarcolaExpanded-Medium</b>. Those are <b>one typeface</b>, not three. The tab shows a single card for it with <b>Weights: Bold · SemiBold · Medium</b> underneath, and nothing is flagged for using a heavier weight of a font the design already uses.</p>
<p>Audit items name the <b>family</b> — "Title in Magistral, which is not one of the website's fonts". So approving a typeface under <b>Business Info → ＋ Add or exclude a value → Typeface</b> covers <b>every weight of it</b>, whichever weight you happen to type in.</p>
<p class="small muted">A website with no global font settings to read (rare) falls back to the home page: its H1 sets the font for titles, its paragraphs set the font for body text. The tab says which of the two it used.</p>`,
  },
  {
    id: 'photos', group: 'Checks', title: 'Pictures used more than once', audience: 'all',
    html: `<p>A website where the same photo turns up in the hero, on a service page and again in the footer looks thrown together. So every picture is fingerprinted and a photo used in more than one place becomes a single audit item that names <b>every place it is used</b>.</p>
<h4>What counts as the same photo</h4>
<ul>
<li>The fingerprint comes from the <b>pixels</b>, not the file name — so the same photo <b>uploaded twice under different names</b> is caught, and so is the same photo saved at a different size or quality.</li>
<li>Both <b>&lt;img&gt; images and CSS background images</b> are read. On a Duda site most heroes and section banners are backgrounds, so an image-tag-only check would miss most of the photos.</li>
<li>"Place" means the <b>element</b>, not the number of times it was seen. A header photo appears on every page and on three devices; that is one place.</li>
<li><b>The item lists every place it found the photo</b> — the part of the page, the element, and the pages that element is on — right on the audit row, each with its own <b>👁 Show on page</b>. Open the item to see them all when there are more than four.</li>
</ul>
<h4>What is deliberately left alone</h4>
<p>Design elements are supposed to repeat. A picture is set aside when it is:</p>
<ul>
<li>a <b>vector graphic</b> (.svg), or named like a design element — icon, logo, pattern, texture, divider, badge, arrow and so on;</li>
<li>a <b>tiled background</b>, which is a pattern by definition;</li>
<li><b>smaller than 150px</b> on either side;</li>
<li><b>mostly transparent</b>, which is how logos and cut-out graphics are saved;</li>
<li><b>too flat</b> — a photograph has thousands of slightly different colours and plenty of edges, a graphic has a handful of flat ones.</li>
</ul>
<p>None of those is a guess you have to take on trust: open <b>Reference data → Pictures on the website</b> and every picture set aside is listed with the reason. If something there looks wrong, mark an item <b>False alarm</b> and say so — that is exactly what the report queue is for.</p>
<h4>When the repeat is on purpose</h4>
<p>Plenty of clients have one signature shot they want everywhere. Approve it under <b>Business Info → ＋ Add or exclude a value → Picture</b>, by file name or full address, and it stops being flagged on that website. Approving one name covers the photo however many times it was uploaded.</p>
<p class="small muted">Pictures are fingerprinted once and remembered, so a rescan downloads nothing, and a stock photo already seen on another website is recognised immediately.</p>`,
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
<li><b>Publish</b> the site in Duda. The box shows the live domain and when it was last published.</li>
<li>Click <b>🌐 Verify N Done items</b>. The button is greyed out while nothing is marked Done.</li>
</ol>
<h4>Reading the result</h4>
<p>The result is a row of counts, and each Done item is in exactly one of them. <b>Show item numbers</b> opens the full lists.</p>
<ul>
<li><b>✓ fixed on live site</b>: really gone from the published website.</li>
<li><b>⚠ still on live site</b>: the item numbers are shown right away, with <b>Reopen these</b>, because this one needs action.</li>
<li><b>⏳ waiting for publish</b>: marked Done after the last publish, so the fix can't be live yet. Publish, then verify again. These are never offered for reopening.</li>
<li><b>? couldn't check</b>: the AI was busy for an AI-flagged item. Try again later.</li>
<li><b>• not checked yet</b>: marked Done since the last live check.</li>
</ul>
<p>When every item is Done or False alarm, the box says <b>🎉 All items are cleared</b>. The result is saved on the page and in the Activity log. Only one live check or scan per website runs at a time.</p>`,
  },
  {
    id: 'approved', group: 'Checks', title: 'Our additions and exceptions', audience: 'all',
    html: `<p>Business Info comes from Duda and is <b>never edited here</b> — what Duda says is what the page shows, and every scan takes it fresh. Editing a local copy would quietly become a second source of truth and force a "yours or Duda's?" decision on every rescan.</p>
<p>Instead there's a layer beside it, under <b>Reference data → Business Info</b>, owned by your team and <b>never touched by a rescan</b>. It works both ways.</p>
<h3>Correct for this website</h3>
<ul>
<li>A value the client really uses that Duda doesn't carry: a second shop line, an owner's personal email, a social account, or a <b>typeface</b> a designer chose on purpose.</li>
<li>It's never flagged again, on this website only.</li>
<li>Approving it <b>closes the open items that flagged it</b> — see below.</li>
</ul>
<h3>Not correct for this website</h3>
<ul>
<li>The opposite: a value Duda <i>does</i> carry that shouldn't appear on the client's site. The classic is <b>your own agency email</b> sitting in a client's Business Info — Duda calls it truth, and it's a bug if it reaches their website.</li>
<li>It's struck out of the reference at scan time, so the ordinary checks flag it. Duda's copy on screen still shows it, struck through, so you can see both what Duda says and what you've decided.</li>
</ul>
<h3>What happens to items that already flagged it</h3>
<ul>
<li>Before you save, it tells you <b>how many open items will close</b> and lets you see them.</li>
<li>They close as <b>False alarm</b> with the reason written on the item: "Closed automatically: (610) 349-8299 was approved as correct for this website by Euch — Second shop line, confirmed with the owner."</li>
<li>They're <b>kept and reversible</b> — reopen one if the decision turns out to be wrong — and they stay out of the admins' False alarms review list, because there's nothing to learn about the check.</li>
</ul>
<h3>Rescans</h3>
<p>Nothing to reconcile and nothing to confirm. Duda's copy refreshes, your layer stays. The only automatic change is one that was already there: an <b>approval</b> whose value later becomes official in Business Info retires itself, since it has nothing left to do. An <b>exception</b> never retires — it exists precisely because Duda still carries the value.</p>
<p class="small muted">Every entry records who added it, when, and why, and keeps a history of changes. Removing one puts the value back to being checked normally from the next scan.</p>`,
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
<li><b>404 Not found</b>, <b>Not responding</b>, <b>Connection refused</b>, <b>Could not open</b>: the domain has a technical problem.</li>
<li><b>No custom domain</b>: the site only has its Duda address.</li>
</ul>
<p>Each check also reads things that still work today but need somebody before they stop working. Hover the badge to see them:</p>
<ul>
<li><b>Domain registration</b>: when the client must renew the domain with their registrar (and which registrar). Shown as <b>⚠ Domain expires in N days</b> from 60 days out, and in red <b>Domain EXPIRED</b> once it has lapsed. Some country domains don't publish a date; those are counted as <b>Expiry unknown</b>.</li>
<li><b>Speed</b>: <b>⚠ Slow</b> when the home page takes more than 6 seconds to answer.</li>
<li><b>Security certificate</b>: shown as <b>ⓘ Certificate: N days left</b> for information only. Duda issues and renews certificates by itself, so a certificate is <b>never a problem</b>, never counted in Domain problems and never alerted.</li>
</ul>
<p>The <b>Domain expiring or expired</b> filter lists the registrations running out. Every live domain is checked <b>once a day automatically</b>, whether or not anyone has the app open, and again whenever Duda reports the website's domain changed.</p>
<h4>🌐 Domain monitoring (on Trends)</h4>
<p>A row of cards at the top of <b>Trends</b>. Click a card to list the websites behind it; click it again to close the list.</p>
<ul>
<li><b>Domain expiring</b>: registrations ending within 60 days, with how many are already expired, within 7, 30 and 60 days. <b>Always the current picture</b>; the date range does not change it.</li>
<li><b>Redirected issue</b>: the domain no longer shows this website (it sends visitors elsewhere, or loads something else). <b>Follows the date range</b>: it counts problems that started in the range, plus any still happening now.</li>
<li><b>Domain down</b>: the site doesn't load (DNS, errors, no answer). Follows the date range the same way.</li>
<li><b>Domain unpublished</b>: websites with a custom domain that were switched off in the range, and how many are still off.</li>
<li><b>Expiry unknown</b>: domains whose registry publishes no renewal date, so they can't be watched for renewal.</li>
<li><b>Certificate ending</b>: information only, since Duda renews it.</li>
</ul>
<p>Domain history is recorded from the day this started, with problems already open counted from when they were first seen.</p>
<h4>Domain alerts (admins)</h4>
<p>Admins are told, on the bell, as a pop-up and on Slack. Urgent ones start with 🚨.</p>
<ul>
<li>🚨 A domain that <b>worked</b> on its last check <b>goes down</b> or <b>stops showing the website</b>. It is checked a second time a few seconds later first, so a one-off blip is never reported.</li>
<li>🚨 A website <b>launched in the last two weeks</b> whose domain doesn't work.</li>
<li>✅ A domain that was reported broken <b>works again</b>.</li>
<li>⚠️ A <b>domain registration</b> running out: told at 60, 30, 14, 7, 3 and 1 days, in red from 7 days. 🚨 The moment it <b>expires</b>, then a reminder every 3 days until it is renewed.</li>
<li>📋 One <b>Daily domain report</b> each morning listing everything still open (expired, expiring, down, showing another site). Nothing open means no report.</li>
</ul>
<p>Security certificates are not alerted at all. Problems that were already there are not reported again. When more than three arrive at once they come as one message. Clicking an alert opens Live DR Sites on that website. Each admin can switch these off under their account → Notifications → <b>Domain problems on live websites</b>.</p>
<h4>📈 Trends</h4>
<p>The <b>Trends</b> tab shows how the account is growing.</p>
<ul>
<li><b>Range</b>: last 30 or 90 days, last 12 months, this year, all time, or your own dates. <b>Weekly / Monthly / Yearly</b> sets one point per week, month or year.</li>
<li><b>Only websites with a custom domain</b> (on by default) leaves out websites that only have a Duda address, such as tests and demos.</li>
<li><b>Launched</b>: first published, from Duda's own dates, so it goes back to the very first website.</li>
<li><b>Re-published</b> counts live websites updated at least once in the range; <b>Not updated</b> counts live websites with <b>no</b> publish since the start of the range (so it follows the range you pick). They are two sides of the same question.</li>
<li><b>Unpublished</b>, <b>Came back</b> (published again after being unpublished) and <b>Re-published</b> (a live website updated): recorded as they happen, from the day the Duda connection was made. Earlier periods show as not recorded rather than as zero. A website deleted outright is still noticed, by comparing each pull of the list with the last one.</li>
<li><b>Live websites over time</b> is an estimate: a website that left before records began counts as live until its last publish.</li>
<li><b>Days to launch</b>: the median days from a website being created in Duda to going live. <b>Audited before launch</b>: of the websites launched in the range, how many were added to Audits before they went live.</li>
<li>Hover a chart for the numbers; click a period to list the websites behind it. <b>Show as table</b> gives every number.</li>
<li><b>Domain health right now</b>: click a bar to open those websites on the list.</li>
<li><b>Domain monitoring</b> cards sit above the numbers; see <b>Domain monitoring (on Trends)</b> above.</li>
</ul>
<h4>Published, not yet, or gone</h4>
<p>Duda keeps two lists — the websites that are <b>published</b> and the ones still <b>drafts</b> — and the Audits page reads both, because most audits happen <b>before</b> a website launches.</p>
<ul>
<li>In the published list — nothing is shown. Normal.</li>
<li>In the draft list — <b>Not published yet</b>, in grey. That is the expected state for a pre-launch audit and is not a problem: every check works as usual, and only <b>Verify on live site</b> needs the website published first.</li>
<li>In neither — <b>Not found in Duda</b>, in orange. It looks deleted or moved to another account. The audit is kept for reference.</li>
</ul>
<p>The <b>Live or not</b> filter on Audits has an entry for each, with a count.</p>`,
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
    html: `<p><b>Suggest a feature</b> (in the light-bulb menu, top left, and on About) sends an idea to the app owner. You can follow what happens to it under <b>My suggestions</b>.</p>
<h3>A False alarm is a bug report against a check</h3>
<p>When you mark an item <b>False alarm</b>, the reason you type is not filed away somewhere — it is a report saying <i>this check got it wrong</i>, and it is the most useful thing the app ever learns about itself. So it is treated like a task, and you stay part of it.</p>
<ul>
<li>Your reason is posted as a <b>comment on the audit item</b>, so the next person to open it reads why it was dismissed.</li>
<li>The item shows <b>you reported this as a false alarm</b> with its current status, and the audit list carries a small <b>Reported:</b> chip, so nobody re-does the argument.</li>
<li><b>My false alarms</b> (in the light-bulb menu) lists everything you have reported and where each one got to.</li>
<li>When an admin moves it you are <b>told</b> — bell, desktop, Slack and email — <b>with their note</b>, not just a status.</li>
<li>You can <b>reply</b> on your own report. If you think the verdict is wrong, say so; the admins are told.</li>
</ul>
<h3>The statuses</h3>
<table class="help-table"><tbody>
<tr><td><b>New</b></td><td>Nobody has looked at it yet.</td></tr>
<tr><td><b>Checking</b></td><td>An admin is investigating.</td></tr>
<tr><td><b>Audit Adjusted</b></td><td>The check really was wrong and has been fixed. <b>Every website scanned before that moment</b> is flagged for a rescan and its affected items are marked — see <a href="#/help/scan">Scanning and rescanning</a>.</td></tr>
<tr><td><b>True False Alarm</b></td><td>You were right that it isn't a problem here, but the check was right to look — it catches real ones elsewhere, so it stays as it is.</td></tr>
<tr><td><b>Won't change</b></td><td>Noted, and the check is deliberately being left alone. The note says why.</td></tr>
<tr><td><b>Not a false alarm</b></td><td>The other direction: the check was right and the item is real work. <b>The audit item goes back to Open</b>, the reason is written on it so nobody re-closes it for the same reason, and the person who reported it is told why.</td></tr>
</tbody></table>
<p class="small muted">Admins are asked for a note on every move except back to New, because "True False Alarm" with no explanation tells the person who reported it nothing.</p>
<h3>For admins</h3>
<ul>
<li><b>False alarms</b> in the light-bulb menu is the full queue. It opens on <b>New + Checking</b>.</li>
<li><b>Most reported checks</b> at the top groups the open reports by check, so the one worth fixing next is the one at the front.</li>
<li><b>📋 Copy open items as text</b> exports them, reasons and notes included.</li>
<li>Anyone in the thread can write on a report — you, the person who reported it, and anyone who has already written on it. Each note reaches the others and is copied onto the audit item.</li>
<li>Every move and every note is written to the website's <b>Activity log</b>, so the triage is part of the website's history rather than something that happened somewhere else.</li>
<li>Clicking a <b>False alarm</b> notification opens the queue <b>on that report</b> — it is scrolled to, outlined, and its notes are already open. If a filter would have hidden it, the filter gives way rather than showing you an empty list.</li>
</ul>
<h3>Somebody closed a real item as a False alarm</h3>
<p>It happens. Open the item, read the reason, and if you disagree, set the report to <b>Not a false alarm</b> with a note saying what you found. The audit item goes back to <b>Open</b>, your note is on it, and they are told — so it is a conversation with a record, not a silent reversal. You can also simply set the item's status back to <b>Open</b> yourself from the item; the report is then marked as changed back.</p>`,
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
    id: 'projects', group: 'Collaboration', title: 'Projects — running a build', audience: 'all',
    html: `<p><b>Projects</b> is the build itself, from the client's files to the client's comments. An <b>audit</b> is one scan of one website; a <b>project</b> is the whole job, and it can exist before the website does.</p>
<h3>Starting one</h3>
<p><b>+ Add project</b> (admins and project managers) takes a name, the client, the <b>Dropbox folder link</b>, who it goes to first and when it is due. Everyone ticked as involved sees it in their list and hears anything written in its channel.</p>
<h3>The client's brief becomes the reference</h3>
<p>With Dropbox connected, <b>Read the folder</b> lists what is in it and picks out the PDFs most likely to be the brief. <b>Read it</b> pulls out the business name, phone, email, address, hours and website and shows them for checking — each marked <b>answered</b> (the document had a label for it) or <b>guessed</b> (matched out of the text). Nothing is saved until somebody presses <b>Use these details</b>.</p>
<p>Once saved, <b>those details are what every audit of that website is checked against</b>, ahead of Duda's own Business Info — during a build Duda often still carries the template's values, while the brief is what the customer actually wrote. Duda's values stay acceptable, so nothing is flagged for using one of them. Correct anything by hand; <b>↺ Reset to the brief</b> puts back exactly what the document said.</p>
<p>A scanned or photographed PDF has no text in it at all. The app says so rather than guessing, and the details are typed in.</p>
<h3>The phases</h3>
<p>Data collection → Dev (design) → Dev (pre-check) → QA (design and audit) → Dev (revisions) → QA (approval) → Cleanup (admin) → Cleanup → Domain access → With the client → Jaguars.</p>
<p><b>Hand on</b> moves it: which phase, to whom, by when, and anything they should know. Going backwards is normal — revisions are a phase, not a failure. Whoever is holding a project can always hand it on; reassigning one you are not on needs <b>Start and run projects</b>.</p>
<p>Every handover is kept with who, to whom, when and why. That trail is the point: not "where is it" but "who has had it, for how long, and who is late".</p>
<h3>Deadlines</h3>
<p>A phase past its date tells the project manager and whoever is holding it — <b>once per deadline</b>, so it does not nag. The board calls it out at the top and the Projects link in the bar carries a dot.</p>
<h3>Audit items written by hand</h3>
<p>The scanner is blind to anything needing an eye — spacing, hierarchy, a logo at the wrong size, copy that reads badly. <b>+ Add item</b> on the audit items tab writes one, with a severity, a page, a device and an explanation. It gets a number like any other item, can be assigned and marked Done, and <b>survives every rescan</b>.</p>
<p><b>The explanation is rich text</b>: bold, italic, lists and links (<b>🔗 Link</b>, after selecting the words). <b>Paste a screenshot straight in</b> with Cmd/Ctrl+V — no saving it to disk and uploading. Click a pasted picture to mark it up.</p>
<h3>Marking up a screenshot</h3>
<p><b>✏️ Screenshot</b> (in the item explanation and next to <b>📎 Image</b> in every comment box) opens a mark-up window:</p>
<ul>
<li>Take a screenshot to the clipboard (Cmd+Ctrl+Shift+4 on a Mac, Win+Shift+S on Windows), then paste it in. Or drop a file, or use <b>Open…</b>.</li>
<li>Draw <b>▭ boxes</b>, <b>◯ circles</b>, <b>↗ arrows</b> and <b>T text</b>, as many as you like, in six colours and three thicknesses. Hold Shift for a perfect square or circle.</li>
<li><b>↖ Move</b> selects a shape: drag it to move it, drag a corner to resize it, press Delete to remove it. Cmd/Ctrl+Z undoes.</li>
<li><b>⧉ Copy picture</b> puts the marked-up picture on the clipboard to paste anywhere. <b>Download</b> saves it. <b>Add to item</b> / <b>Attach</b> puts it straight where you were writing.</li>
<li>A picture already attached to a comment can be clicked to mark it up; the marked-up copy replaces it.</li>
<li>Shortcuts: V move, R box, O circle, A arrow, T text, Esc to deselect or close.</li>
</ul>
<h3>Disagreeing with a call</h3>
<p>An item marked <b>Done</b> that is still wrong, or a <b>False alarm</b> that was real, can be reopened from the item itself: <b>↺ This is not done — reopen it</b>. A reason is required, because the person who closed it is told by name and reads it. "Reopened" on its own starts an argument; "the footer still shows the old number on mobile" ends it.</p>`,
  },
  {
    // Owner only. Nobody else is shown this page, and the Help assistant is not given it either.
    id: 'health', group: 'More', title: 'System health', audience: 'owner',
    html: `<p><b>Your account → ⚑ System health</b> answers three questions before any of them becomes a problem: is anything about to run out, is anything that should be arriving not arriving, and how long have you got.</p>
<h3>Storage and allowances</h3>
<p>Four meters, each a figure against its ceiling, with a word as well as a colour:</p>
<ul>
<li><b>Main database.</b> Everything the app holds except enquiries — websites, audits, comments, people, sessions. This is the one that matters: if it fills, <b>the whole app stops writing</b>, not one feature. Nothing can measure it in a single step, so it is measured when you ask: press <b>⟳ Measure storage now</b>. Each measurement is kept, which is what lets the page tell you how fast it is growing and roughly how many days are left.</li>
<li><b>Commands this month.</b> Every read and write counted exactly, not estimated, and projected to month end from where the month is now. The projection is what to watch — being 40% through the allowance on day 10 is a problem the total alone does not show.</li>
<li><b>Analysis database.</b> Where enquiries live. It measures itself exactly, every load, and estimates how many months it has at the rate enquiries are arriving.</li>
<li><b>Enquiries written this month.</b> Against the monthly write allowance. One thing is <i>not</i> on this page and cannot be: enquiries <b>read</b> are charged too, and only the provider's own dashboard knows that figure. If anything ever runs out unexpectedly, that is where to look first.</li>
</ul>
<h3>Is everything arriving</h3>
<p>One line per outside connection, each with a mark, a name and a plain note. A tick means set up and recent, a triangle means set up but nothing has come in for days, a dot means not set up at all.</p>
<p>The one worth reading every time is the <b>Duda webhook</b>. A webhook that was never registered, or that quietly stopped, looks <i>exactly</i> like a slow week from inside the app: comments stop appearing and nothing anywhere says why. That is the whole reason this line exists.</p>
<h3>What needs attention</h3>
<p>The band at the top is the page in one glance. It is empty — "Nothing needs attention" — most of the time, and that is the point: anything there is worth acting on. A store past 70% full, a month projected to overrun its allowance, a connection that has gone quiet, or a pile of enquiries waiting to be sorted.</p>
<h3>Catching up with Duda</h3>
<p>Three bulk jobs, each with when it last ran and whether a person asked for it: the website list, the domain checks, and the form-submission history. The same stamps sit under their buttons on Live DR Sites, which is where the question is actually asked.</p>
<p><b>Form submission history</b> says whether the backfill queue is empty. It drains itself while people use the app and is not scheduled, so it does nothing overnight and nothing at the weekend — by design. Ongoing enquiries do not depend on it: those arrive the moment they are submitted.</p>
<h3>The early warning on pace</h3>
<p>Besides the thresholds below, you are told the moment the month is <b>on course</b> to overrun the main database's command allowance — checked continuously, from day one, at no cost. A warning that the store is 90% used on the 5th of the month is a warning three weeks late; the pace is knowable on day one or two.</p>
<h3>What gets sent to you, and what does not</h3>
<p>A page nobody has open is no use when something runs out at 3am, so these reach your bell, and Slack if it is set up: the main database over 70% and again over 85%, a month on course to overrun its command allowance, the analysis database over 85%, nothing arriving from Duda for three days, and a website whose history could not be fetched after three tries. Each kind is sent at most once in several hours — a problem that persists must not become noise. <b>Already sent to you</b> on this page is the record of them.</p>
<h3>Reading the states</h3>
<p><b>Healthy</b> under 50% · <b>Keep an eye on it</b> from 50% · <b>Watch closely</b> from 70% · <b>Act now</b> from 85%. Nothing breaks at 85% — it is deliberately early, so there is time to tidy up rather than a morning of the app refusing to save.</p>
<p>This page is yours alone. It does not appear for anyone else, including other admins, and it is not part of what the Help assistant can read.</p>`,
  },
  {
    id: 'faq', group: 'More', title: 'Common questions', audience: 'all',
    html: `<h4>The Rescan button is greyed out</h4><p>A teammate has that website queued or is scanning it (hover to see who). It frees up when they finish.</p>
<h4>A scan shows "Interrupted, rescan"</h4><p>The tab running it was closed. Click Rescan.</p>
<h4>An item keeps coming back after I marked it Done</h4><p>Rescans keep your status. If a live check says "Still on live site", the fix isn't published yet or didn't work.</p>
<h4>The AI says "check pending"</h4><p>The daily AI allowance ran out. It resumes by itself when credits are back (see AI Status).</p>
<h4>"Show on page" can't find the element on Mobile</h4><p>It may only exist on another device, or inside the side panel. Check the device chips under "Where".</p>
<h4>An item moved to For clarification and nobody touched it</h4><p>A client asked about that value in a Duda comment. Items nobody has worked on are moved out of the default list when there's a question outstanding — the item says so, and shows the comment. It never overrides a status someone already set.</p>
<h4>The list says "No audit items match these filters" but the counts aren't zero</h4><p>A filter is still on from earlier — often <b>Design</b>, left behind by <b>Show them in Audit items</b> on the Fonts tab. The empty message names which filters are hiding things and has a <b>Clear filters</b> button. Filters that are doing something are outlined, and they reset when you open a different website.</p>
<h4>Why is one audit item covering five links?</h4><p>Because it's one fix. If a whole menu or section is in the wrong font, the item points at the block and lists every piece of text inside it. Separate blocks stay separate items.</p>
<h4>Can two people work on the same website?</h4><p>Yes. You'll see a pop-up and a "… is also here" bar. Agree who takes which items.</p>
<h4>A website says "new checks available" — do I have to rescan?</h4><p>No. It's an offer, not a warning. The audit keeps exactly the items it has until you rescan, and a rescan keeps your Done, False alarm and On hold items untouched — it only adds new Open ones. <b>Not now</b> hides the note on that website.</p>
<h4>Will new checks reopen an audit I already marked Complete?</h4><p>No. The Complete stamp stays, and nothing changes unless someone rescans. If you do rescan, the website stays Complete but will show the new items as Open, so you'd see something like 24/31 instead of 24/24.</p>`,
  },
];

/** `adminish` is now a permission, not a role name — any role granted it sees the admin pages. */
/**
 * The Guide, filtered to one person.
 *
 * Three audiences: everybody, admins, and the one account that runs the app. The last one is the
 * reason `owner` is a separate flag rather than "is an admin" — an admin is not the owner, and a
 * page written for the owner should not appear for anyone else, nor reach the Help assistant.
 */
export function helpFor(role, adminish, owner) {
  const ok = adminish === undefined ? role === 'admin' : !!adminish;
  return HELP_SECTIONS.filter((s) => s.audience === 'all' || (s.audience === 'admin' && ok) || (s.audience === 'owner' && !!owner));
}
export function helpText(role) {
  return helpFor(role).map((s) => `## ${s.group} › ${s.title}\n` + s.html
    .replace(/<\/(p|li|h4|tr|ol|ul)>/g, '\n').replace(/<(td|th)>/g, ' | ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim()).join('\n\n');
}
