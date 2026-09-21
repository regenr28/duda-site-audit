
/* ================= CONSOLE RUNNER =================
 * HOW TO USE
 * 1. Open the site's preview while logged in to your Duda dashboard, e.g.
 *    https://8bitcreative.responsivesiteeditor.com/preview/f981a954
 *    (the editor link works too: /home/site/f981a954/...)
 * 2. Open DevTools (Cmd+Option+J on Mac / Ctrl+Shift+J on Windows) → Console
 * 3. Paste this whole file and press Enter. Results show as a table plus a CSV download.
 * Reference = the site's schema markup, which Duda generates from Business Info.
 * To use exact Business Info values instead, fill EXPECTED below.
 */
(async () => {
  const EXPECTED = { businessName: '', phones: [], emails: [] }; // optional override, e.g. phones: ['7067057335']
  const DOWNLOAD_CSV = true;
  const MAX_PAGES = 150;

  const A = window.DudaAudit;
  const m = location.pathname.match(/\/(?:site|preview)\/([A-Za-z0-9_-]+)/);
  const siteId = m ? m[1] : prompt('Duda site ID (e.g. f981a954)?');
  if (!siteId) return console.warn('No site ID');
  const host = location.hostname;
  const fetchPage = async (path, device) => {
    const url = `https://${host}/site/${siteId}${path === '/' ? '' : path}?showOriginal=true&preview=true&insitepreview=true&dm_device=${device}`;
    const r = await fetch(url, { credentials: 'include' });
    return { status: r.status, html: await r.text(), url };
  };
  let truth = null;
  if (EXPECTED.businessName || EXPECTED.phones.length || EXPECTED.emails.length) {
    truth = A.buildTruth({ site: { site_business_info: { business_name: EXPECTED.businessName } } });
    EXPECTED.phones.forEach((p) => truth.phones.push(A.normPhone(p).slice(-10)));
    EXPECTED.emails.forEach((e) => truth.emails.push(e.toLowerCase()));
  }
  console.log(`%cDuda Site Auditor — scanning ${siteId} on desktop, tablet and mobile…`, 'font-weight:bold;color:#2563eb');
  const t0 = Date.now();
  const res = await A.runScan({
    siteId, host, truth, maxPages: MAX_PAGES,
    fetchPage,
    onProgress: (p) => { if (p.done % 10 === 0) console.log(`  ${p.done}/${p.total} ${p.message}`); },
  });
  const tr = res.truth;
  console.log('%cReference (Business Info)', 'font-weight:bold', { source: tr.source, name: tr.businessName, phones: tr.phones.map(A.fmtPhone), emails: tr.emails, address: tr.addresses, socials: tr.socials });
  console.log(`Pages scanned: ${res.pages.length} in ${Math.round((Date.now() - t0) / 1000)}s  |  Critical ${res.counts.critical} · Warning ${res.counts.warning} · Info ${res.counts.info}`);
  console.table(res.findings.map((f) => ({
    severity: f.severity, category: f.category, page: f.path + (f.pages.length > 1 ? ` (+${f.pages.length - 1})` : ''),
    where: f.location, visibleOn: f.visibleOn.map((d) => A.DEVICE_LABEL[d]).join('/') || 'hidden', selector: f.selector,
    finding: f.message, found: f.found || '', expected: f.expected || '',
  })));
  window.__dudaAudit = res;
  console.log('Full result saved to window.__dudaAudit. To find an element: document.querySelector("<selector>") inside the matching device preview.');
  if (DOWNLOAD_CSV) {
    const blob = new Blob([A.toCSV(res.findings, siteId)], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `audit-${siteId}.csv`; a.click();
  }
})();
