"""Editorial photos wherever a Duda page keeps pictures: the other slides of a slider (published pages
render only the first slide; the rest are in the slider's data), gallery data, a section hidden on every
device whose element is not in the page (its background is only in the stylesheet), one that is in the
page but hidden, a parallax and a fixed background. Runs the engine in a browser on a published-style page.
Usage: python3 -I e2e_stockplaces.py <app> <tests>"""
import json, sys, base64, urllib.parse
from playwright.sync_api import sync_playwright
APP = sys.argv[1]
CDN = 'https://irp.cdn-website.com/502483e9/dms3rep/multi/opt/'
slides = ['pexels-photo-32725851-1920w.jpeg', 'pexels-photo-32164499-1920w.jpeg', 'pexels-photo-30112423-1920w.jpeg', 'pexels-photo-39169710-1920w.jpeg', 'shutterstock_2639635421-1920w.jpg']
props = {'layout': 'LAYOUT_1', 'slidesData': [{'uuid': str(i), 'media': {'imgSrc': CDN + f, 'type': 'IMAGE'}} for i, f in enumerate(slides)], 'widgetId': '1957684864'}
model = base64.b64encode(json.dumps({'slidesData': [{'media': {'imgSrc': CDN.replace('/opt/', '/') + f.replace('-1920w', '')}} for f in slides]}).encode()).decode()
html = f'''<html><head><style>
.u_1579923690{{background-image:url({CDN}shutterstock_2530975229-1920w.jpg)!important}}
@media (max-width:767px){{.u_1700000001{{background-image:url({CDN}shutterstock_2326351331-1920w.jpg)}}}}
.u_1600000002{{background-image:url({CDN}shutterstock_2603988869-1920w.jpg);background-attachment:fixed}}
</style></head><body><div id="dm"><div class="dmInner"><div id="site_content">
<div class="dmRespRow u_1600000002" id="1600000002"><div class="dmRespCol large-12" style="background:#000;padding:200px"><h2>Covered by a solid box</h2></div></div>
<div class="dmRespRow hide-for-small hide-for-medium hide-for-large u_1700000001" id="1700000001"><p>Hidden row in the page</p></div>
<div class="dmRespRow" id="1800000003" data-parallax="true" style="background-image:url({CDN}shutterstock_2304758759-1920w.jpg)"><p>Parallax</p></div>
<div id="1957684864" data-element-type="ssrimageslider" dmle_extension="ssrimageslider" data-model="{model}">
<span id="ssrWrap-1957684864" data-initial-props="{urllib.parse.quote(json.dumps(props))}">
<div data-auto="slideSlot 0 slideSlotActive"><img data-grab="slide-media" src="{CDN}{slides[0]}"></div></span>
<script data-role="hydration">;window?.waitForDeferred?.('ssrLibrariesLoaded', () => {{window.SSRRuntime.RuntimeReactHelpers.initiateWidget({json.dumps({'type': 'SSR_IMAGE_SLIDER', 'props': props})}, true)}});</script>
</div>
<div class="dmPhotoGallery" data-element-type="dPhotoGalleryId" id="1290540967">
<div class="photoGalleryThumbs"><a data-image-url="{CDN}shutterstock_2848688513-1920w.jpg"><img id="1290540968" data-src="{CDN}gallery-one-1920w.jpg" alt="x"></a></div></div>
</div></div></div></body></html>'''
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); pg.set_content('<html></html>')
    pg.add_script_tag(content=open(APP + '/public/engine.js').read())
    rows = pg.evaluate("""(h) => { const doc = new DOMParser().parseFromString(h, 'text/html');
      return window.DudaAudit.photosUsed(doc, { pageUrl: 'https://example.com/' }, 'desktop'); }""", html)
    byName = {}
    for r in rows: byName.setdefault(r['url'].split('/')[-1], r)
    print('   found:', sorted(byName))
    s = byName.get('shutterstock_2639635421-1920w.jpg')
    check(s and s.get('fromData') and s['how'] == 'slider' and not s['hiddenBy'], 'the last slide of a slider (only in the slider’s data) is found, as a visible slider picture')
    check(all(any(n.startswith(f.replace('-1920w.jpeg', '').replace('-1920w.jpg', '')) for n in byName) for f in slides), 'every slide of the slider is found, not only the first')
    h = byName.get('shutterstock_2530975229-1920w.jpg')
    check(h and h.get('fromData') and h['hiddenBy'] and h['location'] == 'Hidden section', 'a background of a section hidden on every device (element not in the page) is found, as hidden')
    h2 = byName.get('shutterstock_2326351331-1920w.jpg')
    check(h2 and h2['hiddenBy'], 'a background of a row that is in the page but hidden on every device is found, as hidden')
    check('shutterstock_2603988869-1920w.jpg' in byName, 'a fixed background mostly covered by a solid box is found')
    check('shutterstock_2304758759-1920w.jpg' in byName, 'a parallax background is found')
    check('shutterstock_2848688513-1920w.jpg' in byName, 'a gallery picture kept only in the gallery’s data (the full-size link) is found')
    check(sum(1 for r in rows if r['url'].endswith(slides[0])) == 1, 'the first slide is not counted twice (markup and data)')
    # The editorial check reports them; the duplicate-photo check ignores data-only places.
    res = pg.evaluate("""async (rows) => { const A = window.DudaAudit;
      const photos = rows.map((r) => Object.assign({ path: '/', device: 'desktop' }, r));
      const byKey = new Map(); photos.forEach((ph) => { const k = A.imageKey(ph.url); if (!byKey.has(k)) byKey.set(k, { key: k, url: ph.url, places: [], m: null, why: '' }); byKey.get(k).places.push(ph); });
      const out = await A.editorialStockFindings(byKey, { stockList: async () => ['2639635421','2530975229','2326351331','2603988869','2304758759','2848688513'].map((id) => ({ id })) }, []);
      return out.map((f) => [f.stockId, f.severity, f.location]); }""", rows)
    print('   items:', res)
    got = {r[0]: r for r in res}
    check(len(got) == 6, 'all six editorial photos are reported')
    check(got['2639635421'][1] == 'critical' and got['2530975229'][1] == 'warning', 'the slider one is critical (visitors see it); the hidden-section one is a warning')
    br.close()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
