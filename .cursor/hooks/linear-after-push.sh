#!/usr/bin/env bash
# After a successful git push, queue a Linear Done sync for the agent.
set -euo pipefail

python3 - <<'PY'
import json, sys, re, datetime
from pathlib import Path

try:
    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
except Exception:
    print("{}")
    raise SystemExit(0)

command = str(data.get("command") or "")
output = str(data.get("output") or "")

if not re.search(r"git\s+push", command):
    print("{}")
    raise SystemExit(0)

if re.search(r"rejected|error:|fatal:|failed to push|permission denied", output, re.I):
    print("{}")
    raise SystemExit(0)

state_dir = Path(".cursor/hooks/state")
state_dir.mkdir(parents=True, exist_ok=True)
payload = {
    "queuedAt": datetime.datetime.utcnow().isoformat() + "Z",
    "command": command[:500],
    "outputTail": output[-2000:],
    "project": "Nexuses Unified Portal",
    "team": "Nexuses",
    "doneMilestone": "Shipped on master",
    "wipMilestone": "Local — not pushed",
}
(state_dir / "pending-linear-done.json").write_text(
    json.dumps(payload, indent=2) + "\n", encoding="utf-8"
)

ctx = (
    "LINEAR SYNC REQUIRED (automatic after git push):\n"
    "1. Find In Progress issues in project \"Nexuses Unified Portal\" related to the work just pushed.\n"
    "2. Move them to Done via save_issue (state: Done, milestone: \"Shipped on master\").\n"
    "3. Note the pushed commit(s) on each issue.\n"
    "4. Refresh milestone descriptions for \"Shipped on master\" and \"Local — not pushed\".\n"
    "5. Delete .cursor/hooks/state/pending-linear-done.json when finished.\n"
    "Do this before ending the turn."
)
print(json.dumps({"additional_context": ctx}))
PY
