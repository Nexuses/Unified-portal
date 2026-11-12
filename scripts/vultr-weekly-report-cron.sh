#!/usr/bin/env bash
# Friday weekly all-projects report email.
#
# Crontab (UTC) — 4:30 PM IST = 11:00 UTC:
#   0 11 * * 5 /var/www/Unified-portal/scripts/vultr-weekly-report-cron.sh >>/var/log/weekly-report-cron.log 2>&1
#
# Required env (loaded from app .env if missing):
#   CRON_SECRET=...
# Prefer local origin so cron does not depend on Cloudflare SSL:
#   WEEKLY_REPORT_CRON_URL=http://127.0.0.1:3000
# Plus app env for SMTP (WEEKLY_REPORT_*).

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/Unified-portal}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(CRON_SECRET|WEEKLY_REPORT_CRON_URL)=' "$ENV_FILE" | sed 's/\r$//')
  set +a
fi

# Hit the Node app directly — avoids Cloudflare 5xx/SSL issues from the origin.
CRON_URL="${WEEKLY_REPORT_CRON_URL:-http://127.0.0.1:3000}"
CRON_SECRET="${CRON_SECRET:-}"

if [[ -z "$CRON_SECRET" ]]; then
  echo "CRON_SECRET is not set" >&2
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] weekly-report cron starting (${CRON_URL})"
curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  "${CRON_URL%/}/api/cron/weekly-report"
echo
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] weekly-report cron done"
