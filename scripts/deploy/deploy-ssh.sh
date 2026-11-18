#!/usr/bin/env bash
# Forced command for the GitHub Actions deploy key (see docs/deploy.md). Whatever the key asks
# to run, it can only do this: "deploy <commit sha>" or "rollback".
set -euo pipefail
cmd=${SSH_ORIGINAL_COMMAND:-}
if [[ "$cmd" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  exec /var/www/nexgos/bin/deploy.sh "${BASH_REMATCH[1]}"
fi
if [[ "$cmd" == "rollback" ]]; then
  exec /var/www/nexgos/bin/deploy.sh rollback
fi
echo "This key can only run: deploy <40-char commit sha> | rollback" >&2
exit 2
