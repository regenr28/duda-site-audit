"""A town in the words of a link to one of the website's own pages is not a wrong location (AI text check).
Usage: python3 -I engine_textloc.py <app> <tests>"""
import sys, os
from playwright.sync_api import sync_playwright
eng = open(os.path.join(sys.argv[1], 'public', 'engine.js')).read()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.set_content('<html><body></body></html>'); pg.add_script_tag(content=eng)
    r = pg.evaluate("""() => {
      const A = window.DudaAudit;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Menard Premium Detailing' } }, content: { location_data: { address: { city: 'Warminster', region: 'PA' } } } }, null, null);
      const para = 'We also offer auto detailing in Hamilton, NJ, and caliper painting services in Bucks County, PA. Contact us today!';
      const texts = [
        { text: 'auto detailing in Hamilton, NJ', selector: '[id="1235978824"] > p:nth-of-type(1) > a:nth-of-type(1)', location: 'Body', pages: ['/car-detailing-philadelphia'], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [], para },
        { text: 'Visit our shop in Dallas, TX for a free quote.', selector: '[id="9"] > p', location: 'Body', pages: ['/car-detailing-philadelphia'], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [] },
      ];
      const links = [{ text: 'auto detailing in Hamilton, NJ', to: '/car-detailing-nj', pages: ['/car-detailing-philadelphia'] }];
      const issues = [
        { i: 0, type: 'wrong_location', quote: 'auto detailing in Hamilton, NJ', confidence: 0.85, reason: 'Hamilton, NJ is not in the service areas', suggestion: '' },
        { i: 1, type: 'wrong_location', quote: 'our shop in Dallas, TX', confidence: 0.9, reason: 'Dallas is not where the shop is', suggestion: '' },
      ];
      return A.applyTextIssues([], texts, issues, truth, links).map((f) => f.code + ' | ' + f.found);
    }""")
    print('  ', r)
    check(not any('Hamilton' in x for x in r), 'a town in a link to the business’s own page ("We also offer auto detailing in Hamilton, NJ") is not reported')
    check(any('Dallas' in x for x in r), 'text that puts the shop in another town is still reported')
    r2 = pg.evaluate("""() => {
      const A = window.DudaAudit;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Menard Premium Detailing' } }, content: {} }, null, null);
      const fit = [{ path: '/high-performance-vehicles', title: 'PPF', h1: [], description: '' }];
      const para = "By applying PPF, you're investing in an additional layer of durability that helps maintain that showroom sheen.";
      const locate = (path, quote, cont) => (cont && para.toLowerCase().includes(String(quote).toLowerCase().replace(/^"|"$/g, '')) ? { selector: 'p', continues: true } : null);
      const issues = [
        { i: 0, type: 'editor_note', part: 'body', quote: 'By applying PPF,', confidence: 0.95, reason: 'Sentence fragment cut off mid-thought; appears to be incomplete copy.', suggestion: 'Complete the sentence or remove the trailing comma.' },
        { i: 0, type: 'editor_note', part: 'body', quote: '[Mike: add prices]', confidence: 0.95, reason: 'Note to the team left in the copy', suggestion: '' },
      ];
      return A.applyPageFit([], fit, issues, truth, locate).map((f) => f.code + ' | ' + f.found);
    }""")
    print('  ', r2)
    check(not any('By applying PPF' in x for x in r2), 'a sentence the AI called unfinished is not reported when the paragraph goes on after it')
    check(any('Mike' in x for x in r2), 'a real note left for the team is still reported')
    r3 = pg.evaluate("""() => {
      const A = window.DudaAudit;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Menard Premium Detailing' } }, content: {} }, null, null);
      const fit = [
        { path: '/service/enclosed-vehicle-towing-services', title: 'Enclosed Vehicle Towing Services in Warminster, PA', h1: ['Enclosed Vehicle Towing in Warminster'], description: '' },
        { path: '/locations/nolanville-tx/ceramic-coating', title: 'Expert Paint Protection Film Installation Nolanville, TX', h1: ['Ceramic Coating in Nolanville'], description: '' },
        { path: '/specials', title: 'Specials', h1: ['Our Specials'], description: '' },
      ];
      const issues = [
        { i: 0, type: 'wrong_service', part: 'title', quote: 'Enclosed Vehicle Towing Services in Warminster, PA', confidence: 0.95, reason: 'Page is about vehicle towing/transport, not a car-care service Menard Premium Detailing offers.', suggestion: '' },
        { i: 1, type: 'wrong_service', part: 'title', quote: 'Expert Paint Protection Film Installation', confidence: 0.95, reason: 'The title is about PPF but the address and H1 are about ceramic coating.', suggestion: 'Expert Ceramic Coating Nolanville, TX' },
        { i: 2, type: 'wrong_service', part: 'body', quote: 'tint, PPF and coating packages', confidence: 0.8, reason: 'Unclear which service this page is meant to sell.', suggestion: '', clarify: true },
      ];
      return A.applyPageFit([], fit, issues, truth).map((f) => [f.code, f.path, f.severity, f.clarify ? 'clarify' : ''].join(' | '));
    }""")
    print('  ', r3)
    check(not any('towing' in x for x in r3), 'a towing page whose title and H1 agree is fine (no "not a service they offer")')
    check(any('nolanville' in x and 'critical' in x for x in r3), 'a title about another service than the page is still reported')
    check(any('/specials' in x and 'clarify' in x and 'warning' in x for x in r3), 'when the AI cannot tell what a page offers, the item is a question (For clarification), not a critical mistake')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
