# Tests

End-to-end tests: each starts the app with a fake Redis, fake Duda and fake AI (no real keys, no real websites), drives it with Playwright, and writes screenshots next to the test (`tests/tk/*.png`, not committed).

All: `bash tests/run-all.sh` from the repo root. One: `python3 -I tests/tk/e2e_polish.py "$PWD" "$PWD/tests"`.
