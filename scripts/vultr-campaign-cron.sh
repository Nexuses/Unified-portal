#!/usr/bin/env bash
# Optional Vultr system crontab backup for campaign sending.
# The Next.js process already runs an in-process worker via instrumentation.ts;
# use this only if you want an extra drain every minute.
#
# Crontab (as deploy user):
#   * * * * * /var/www/unified-portal/scripts/vultr-campaign-cron.sh >>/var/log/campaign-cron.log 2>&1
#
# Required env (export in the script or the crontab environment):
#   CRON_SECRET=...
#   APP_URL=https://unified.nexuses.xyz

set -euo pipefail

APP_URL="${APP_URL:-https://unified.nexuses.xyz}"
CRON_SECRET="${CRON_SECRET:-}"

if [[ -z "$CRON_SECRET" ]]; then
  echo "CRON_SECRET is not set" >&2
  exit 1
fi

curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  "${APP_URL%/}/api/cron/process-campaigns"
