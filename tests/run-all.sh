#!/bin/bash
# Runs every test. Needs: node 20+, python3 with playwright (pip install playwright), Chromium.
# Usage (from the repo root): bash tests/run-all.sh
A="$(cd "$(dirname "$0")/.." && pwd)"; T="$A/tests"
cd "$T"
for f in tk/e2e_stwhen.py tk/e2e_linkpromise.py tk/e2e_grammarfix.py tk/e2e_autoresults.py tk/e2e_scanline_auto.py tk/e2e_autoaudits.py tk/e2e_stockplaces.py tk/e2e_stock.py tk/e2e_autoassign.py tk/engine_textloc.py tk/engine_redirpage.py tk/e2e_clientpdf.py tk/engine_gplaces.py tk/engine_links.py tk/e2e_gallerybtn.py tk/engine_forms_policy.py tk/e2e_photos.py tk/engine_vendor.py tk/e2e_towns.py tk/e2e_labelai.py tk/e2e_took.py tk/e2e_hiddenbtn.py tk/e2e_livecmp.py tk/e2e_techseo.py tk/e2e_queue.py tk/e2e_dupe.py tk/e2e_pick.py tk/e2e_notifpop.py tk/engine_textai.py tk/e2e_views.py tk/e2e_proof.py tk/e2e_seo.py tk/e2e_docs.py tk/e2e_pagefit.py tk/e2e_nav.py tk/e2e_menu.py tk/e2e_search.py tk/e2e_team.py tk/e2e_profile.py tk/e2e_analytics.py tk/e2e_health.py tk/e2e_contacts.py tk/e2e_tk.py tk/e2e_portal.py tk/e2e_customers.py tk/e2e_live.py tk/e2e_watch.py tk/e2e_fix.py tk/e2e_usage.py tk/e2e_presence.py tk/e2e_polish.py tk/e2e_aicheck.py tk/e2e_131.py tk/e2e_jags.py tk/e2e_jags2.py tk/e2e_signup_slack.py tk/e2e_exempt.py tk/e2e_head.py tk/e2e_people.py tk/e2e_copy.py tk/e2e_migrate.py tk/e2e_migrate_real.py tk/e2e_instant.py tk/e2e_desk.py trends_e2e.py e2e.py tk/sweep.py; do
  [ -f "$f" ] || continue
  for p in 3998 8078 8097 8111 8090 8091 8095 8096 8098 8099; do fuser -k $p/tcp >/dev/null 2>&1; done; echo "######## $f"
  timeout 420 python3 -I $f "$A" "$T" 2>&1 | grep -E "^(FAIL|ALL PASS|SOME FAILED|Traceback|.*Error|no page|errors:|light |dark )" | head -20
done
echo "######## unit"
node tk/owner_alert.mjs "$A" "$T" 2>&1 | grep -E "^(FAIL|ALL PASS|SOME FAILED)"; node tk/net_unit.mjs "$A" 2>&1 | grep -E "^(FAIL|ALL PASS|SOME FAILED)"; node tk/stock_unit.mjs "$A" 2>&1 | grep -E "^(FAIL|ALL PASS|SOME FAILED)"; node tk/link_unit.mjs "$A" 2>&1 | grep -E "^(FAIL|ALL PASS|SOME FAILED)"
node tk/api_test.mjs "$A" "$T" 2>&1 | tail -3
node tk/watch_unit.mjs "$A" 2>&1 | tail -1
node domains.mjs "$A" 2>&1 | tail -1; node tk/analytics_shapes.mjs "$A" 2>&1 | tail -1; node tk/psi_key.mjs "$A" 2>&1 | tail -1; node tk/contacts_spam.mjs "$A" 2>&1 | tail -1
cd "$A" && node scripts/check-search.mjs
echo ALLDONE
