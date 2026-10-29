#!/usr/bin/env bash
# Friday weekly all-projects report email.
#
# Crontab (UTC) — 4:30 PM IST = 11:00 UTC:
#   0 11 * * 5 /var/www/unified-portal/scripts/vultr-weekly-report-cron.sh >>/var/log/weekly-report-cron.log 2>&1
#
# If the server timezone is Asia/Kolkata:
#   30 16 * * 5 /var/www/unified-portal/scripts/vultr-weekly-report-cron.sh >>/var/log/weekly-report-cron.log 2>&1
#
# Required env:
#   CRON_SECRET=...
#   APP_URL=https://unified.nexuses.xyz
# Plus app env for SMTP (WEEKLY_REPORT_*).

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
  "${APP_URL%/}/api/cron/weekly-report"
