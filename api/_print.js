// Turns a report page (HTML the app built) into a PDF, with the same Chrome that takes page pictures.
//
// The page is only allowed to load what a report needs: its own inline pictures (data: addresses) and
// the two Google Fonts addresses. Everything else is refused, so a report can never be used to make
// this server open other addresses.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromePath, Pipe, sleep, within } from './_shoot.js';

const ALLOWED = /^(data:|about:blank|https:\/\/fonts\.googleapis\.com\/|https:\/\/fonts\.gstatic\.com\/)/;

/**
 * html: a whole document. header / footer: Chrome's header and footer templates (they may use the
 * classes pageNumber and totalPages). Returns the PDF as a Buffer.
 */
export async function htmlToPdf(html, { header = '', footer = '', timeout = 60000 } = {}) {
  const { exe, args } = await chromePath();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const proc = spawn(exe, [...args, '--remote-debugging-pipe', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', `--user-data-dir=${prof}`, '--window-size=1200,1600', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: process.env });
  const cdp = new Pipe(proc);
  const killAll = () => { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* tmp */ } };
  const deadline = setTimeout(killAll, timeout + 5000);
  try {
    const { targetId } = await within(cdp.send('Target.createTarget', { url: 'about:blank' }), 20000, 'The PDF maker did not start in time.');
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const call = (m, p) => cdp.send(m, p, s);
    await call('Page.enable'); await call('Runtime.enable');
    await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    cdp.on((m) => {
      if (m.sessionId !== s || m.method !== 'Fetch.requestPaused') return;
      const id = m.params.requestId;
      if (ALLOWED.test(m.params.request.url)) call('Fetch.continueRequest', { requestId: id }).catch(() => {});
      else call('Fetch.failRequest', { requestId: id, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    const { frameTree } = await call('Page.getFrameTree');
    await call('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    // Fonts and pictures: wait until they are in (at most a few seconds; the system font is the fallback).
    await within(call('Runtime.evaluate', { expression: `Promise.race([Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; }))]), new Promise((r) => setTimeout(r, 8000))]).then(() => true)`, awaitPromise: true, returnByValue: true }), 15000, 'slow').catch(() => {});
    await sleep(150);
    const r = await within(call('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true, displayHeaderFooter: !!(header || footer),
      headerTemplate: header || '<span></span>', footerTemplate: footer || '<span></span>',
      marginTop: 0.75, marginBottom: 0.7, marginLeft: 0, marginRight: 0, paperWidth: 8.5, paperHeight: 11,
    }), 45000, 'Making the PDF took too long.');
    return Buffer.from(r.data, 'base64');
  } finally {
    clearTimeout(deadline);
    try { await within(cdp.send('Browser.close'), 2000); } catch (e) { /* kill below */ }
    killAll();
  }
}
