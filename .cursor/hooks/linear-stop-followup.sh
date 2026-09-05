#!/usr/bin/env bash
# If a push queued Linear sync, force one follow-up turn to finish it.
set -euo pipefail

python3 - <<'PY'
import json, sys
from pathlib import Path

pending = Path(".cursor/hooks/state/pending-linear-done.json")
if not pending.exists():
    print("{}")
    raise SystemExit(0)

try:
    data = json.loads(sys.stdin.read() or "{}")
except Exception:
    data = {}

loop_count = data.get("loop_count") or 0
try:
    loop_count = int(loop_count)
except Exception:
    loop_count = 0

if loop_count != 0:
    print("{}")
    raise SystemExit(0)

msg = (
    "A successful git push was detected. Sync Linear now for Nexuses Unified Portal: "
    "move related In Progress issues to Done, set milestone to \"Shipped on master\", "
    "update milestone descriptions, then delete .cursor/hooks/state/pending-linear-done.json."
)
print(json.dumps({"followup_message": msg}))
PY
