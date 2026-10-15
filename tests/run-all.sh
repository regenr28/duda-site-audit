#!/bin/bash
# Runs every test. Needs: node 20+, python3 with playwright (pip install playwright), Chromium.
# Usage (from the repo root): bash tests/run-all.sh
A="$(cd "$(dirname "$0")/.." && pwd)"; T="$A/tests"
cd "$T"
for f in tk/e2e_nav.py tk/e2e_menu.py tk/e2e_search.py tk/e2e_team.py tk/e2e_profile.py tk/e2e_analytics.py tk/e2e_health.py tk/e2e_contacts.py tk/e2e_tk.py tk/e2e_portal.py tk/e2e_customers.py tk/e2e_live.py tk/e2e_watch.py tk/e2e_fix.py tk/e2e_usage.py tk/e2e_presence.py tk/e2e_polish.py tk/e2e_aicheck.py tk/e2e_131.py tk/e2e_jags.py tk/e2e_signup_slack.py tk/e2e_exempt.py tk/e2e_head.py tk/e2e_people.py tk/e2e_copy.py tk/e2e_migrate.py tk/e2e_migrate_real.py tk/e2e_instant.py tk/e2e_desk.py trends_e2e.py e2e.py tk/sweep.py; do
  [ -f "$f" ] || continue
  for p in 3998 8078 8097 8111 8090 8091 8095 8096 8098 8099; do fuser -k $p/tcp >/dev/null 2>&1; done; echo "######## $f"
  timeout 420 python3 -I $f "$A" "$T" 2>&1 | grep -E "^(FAIL|ALL PASS|SOME FAILED|Traceback|.*Error|no page|errors:|light |dark )" | head -20
done
echo "######## unit"
node tk/api_test.mjs "$A" "$T" 2>&1 | tail -3
node tk/watch_unit.mjs "$A" 2>&1 | tail -1
node domains.mjs "$A" 2>&1 | tail -1; node tk/analytics_shapes.mjs "$A" 2>&1 | tail -1; node tk/psi_key.mjs "$A" 2>&1 | tail -1; node tk/contacts_spam.mjs "$A" 2>&1 | tail -1
cd "$A" && node scripts/check-search.mjs
echo ALLDONE
