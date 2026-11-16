#!/bin/sh
# Upload the chat's cleaned docs (chat-docs/) to the R2 bucket the chat's
# search_docs tool reads, remove the old copies, and re-index.
#
# chat-docs/ holds cleaned copies of the user-facing docs: no setup steps,
# internal references or to-do notes, and the numbers checked against
# frontend/public/data/landing.json. The repo docs themselves are unchanged.
# R2 keys are the repo paths with "/" flattened to "_"
# (frontend/functions/api/docs-search.js maps them back for citations).
#
# The chat's copy of the Assumptions page is generated first
# (scripts/build_chat_assumptions.mjs).
#
# Run from the repo root. Needs a wrangler login. Set SKIP_REMOVE=1 to skip
# removing the old keys (they only need removing once).
set -e
BUCKET=lunar-navigator-docs
INSTANCE=lunar-lander
NAMESPACE=lunar-navigator-search
cd "$(dirname "$0")/.."

# Keys that may hold older docs and aren't part of the chat set any more.
OLD="data_phase-7_README.md data_phase-7_assumptions.csv data_phase-7_site_resources.csv
data_phase-4_README.md data_phase-4_assumptions.csv docs_deploy.md docs_tech-debt.md docs_firebase-data.md docs_phase-2-plan.md
docs_full-moon-walkthrough-chunking.md docs_space-apps_chat-tools.md docs_space-apps_lunar-landing-site-navigator.md
lunarsky_README.md data_textures_README.md PRESENTATION-DETAILS.md TODO.md todo-phase-2-ashwin.md chat-docs-audit.md"

node scripts/build_chat_assumptions.mjs

[ -n "$SKIP_REMOVE" ] && OLD=""
for key in $OLD; do
  npx --prefix frontend wrangler r2 object delete "$BUCKET/$key" --remote >/dev/null 2>&1 \
    && echo "removed $key (if it was there)" || echo "couldn't remove $key"
done

find chat-docs -type f \( -name '*.md' -o -name '*.csv' \) | sort | while read -r f; do
  key=$(echo "${f#chat-docs/}" | tr '/' '_')
  case "$f" in *.csv) type=text/csv ;; *) type=text/markdown ;; esac
  # The upload sometimes fails on the network; try three times before giving up.
  n=0
  until npx --prefix frontend wrangler r2 object put "$BUCKET/$key" --file "$f" --content-type "$type" --remote >/dev/null 2>&1; do
    n=$((n + 1))
    if [ "$n" -ge 3 ]; then echo "FAILED $key"; exit 1; fi
    sleep 2
  done
  echo "uploaded $key"
done

npx --prefix frontend wrangler ai-search jobs create "$INSTANCE" -n "$NAMESPACE"
echo "Re-index started; check with: npx wrangler ai-search stats $INSTANCE -n $NAMESPACE"
