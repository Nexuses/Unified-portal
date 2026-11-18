#!/usr/bin/env bash
# Deploy one commit of master to the VPS. Runs ON the server (GitHub Actions calls it over SSH).
#
#   deploy.sh <40-char commit sha>          build, switch, restart, health-check
#   BUILD_ONLY=1 deploy.sh <sha>            build the release but do not switch to it
#   deploy.sh rollback                      switch back to the previous release
#
# Each commit is built in its own folder under releases/. The live app is only touched after
# the build has passed: "current" is pointed at the new folder and pm2 restarts (a few seconds).
# If the app does not answer after the restart, it switches back to the previous release.
# Layout (ROOT=/var/www/nexgos):
#   repo.git/            bare clone of GitHub, fetched each deploy
#   releases/<time>-<sha>/  one folder per deploy, the last KEEP are kept
#   shared/.env          the app's secrets (never in git); linked into every release
#   current -> releases/...  what pm2 runs
#   deploy.log           every deploy's output
set -euo pipefail

ROOT=/var/www/nexgos
REPO_URL=https://github.com/Nexuses/Unified-portal.git
BRANCH=master
APP=myapp
PORT=3000
HEALTH_URL="http://127.0.0.1:${PORT}/login"
KEEP=3

export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
export NEXT_TELEMETRY_DISABLED=1
# The build shares 2 CPUs with the live app; run it at the lowest CPU and disk priority so the
# live app keeps answering (otherwise Apache times out on it and returns 502s mid-build).
LOW="nice -n 19 ionice -c 3"

mkdir -p "$ROOT/releases" "$ROOT/shared"
exec > >(tee -a "$ROOT/deploy.log") 2>&1
# One deploy at a time; a second merge waits for the first.
exec 9>"$ROOT/deploy.lock"
flock 9

log() { echo "[deploy $(date -u +%FT%TZ)] $*"; }

healthy() {
  for _ in $(seq 1 45); do
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || true)
    if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then return 0; fi
    sleep 2
  done
  return 1
}

switch_to() {
  local dir=$1
  ln -sfn "$dir" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  local cwd
  cwd=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.pm_cwd:"")})' "$APP")
  if [[ "$cwd" == "$ROOT/current" ]]; then
    pm2 restart "$APP" --update-env >/dev/null
  else
    # First run: move pm2 from the old in-place folder to the "current" link.
    log "pm2: moving $APP from '${cwd:-none}' to $ROOT/current"
    pm2 delete "$APP" >/dev/null 2>&1 || true
    pm2 start npm --name "$APP" --cwd "$ROOT/current" -- start >/dev/null
  fi
  pm2 save >/dev/null
}

previous_release() {
  local now
  now=$(readlink -f "$ROOT/current" 2>/dev/null || true)
  ls -1dt "$ROOT"/releases/*/ 2>/dev/null | sed 's#/$##' | grep -vx "$now" | head -1
}

if [[ "${1:-}" == "rollback" ]]; then
  prev=$(previous_release)
  [[ -n "$prev" ]] || { log "no previous release to roll back to"; exit 1; }
  log "rolling back to $prev"
  switch_to "$prev"
  healthy && log "rollback done, app is up" || { log "app still not answering after rollback"; exit 1; }
  exit 0
fi

SHA=${1:-}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: deploy.sh <40-char commit sha> | rollback" >&2; exit 2; }
[[ -f "$ROOT/shared/.env" ]] || { log "missing $ROOT/shared/.env"; exit 1; }

log "deploying $SHA"
if [[ ! -d "$ROOT/repo.git" ]]; then git clone -q --bare "$REPO_URL" "$ROOT/repo.git"; fi
git --git-dir="$ROOT/repo.git" fetch -q --force origin "+refs/heads/$BRANCH:refs/heads/$BRANCH"
if ! git --git-dir="$ROOT/repo.git" merge-base --is-ancestor "$SHA" "$BRANCH"; then
  log "$SHA is not on $BRANCH; refusing to deploy it"
  exit 1
fi

DIR="$ROOT/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}"
mkdir -p "$DIR"
cleanup_failed() { log "deploy FAILED; the live app was not changed"; rm -rf "$DIR"; }
trap cleanup_failed ERR

git --git-dir="$ROOT/repo.git" archive "$SHA" | tar -x -C "$DIR"
ln -s "$ROOT/shared/.env" "$DIR/.env"
echo "$SHA" >"$DIR/REVISION"

CUR=$(readlink -f "$ROOT/current" 2>/dev/null || true)
[[ -n "$CUR" && -d "$CUR" ]] || CUR=/var/www/Unified-portal # before the first switch
# Same lockfile as the running release: copy its node_modules instead of a 2-minute npm ci.
if [[ -d "$CUR/node_modules" ]] && cmp -s "$CUR/package-lock.json" "$DIR/package-lock.json" \
  && [[ "$CUR" != /var/www/Unified-portal ]]; then
  log "dependencies unchanged; copying node_modules"
  cp -a "$CUR/node_modules" "$DIR/node_modules"
else
  log "installing dependencies (npm ci)"
  (cd "$DIR" && $LOW npm ci --no-audit --no-fund --loglevel=error)
fi
# Reuse the build cache so the build only redoes what changed.
if [[ -d "$CUR/.next/cache" ]]; then
  mkdir -p "$DIR/.next"
  cp -a "$CUR/.next/cache" "$DIR/.next/cache"
fi

log "building"
(cd "$DIR" && $LOW npm run build)
trap - ERR

if [[ "${BUILD_ONLY:-}" == "1" ]]; then
  log "BUILD_ONLY: built $DIR, live app not changed"
  exit 0
fi

PREV=$(readlink -f "$ROOT/current" 2>/dev/null || true)
log "switching to $DIR"
switch_to "$DIR"
if ! healthy; then
  log "new release is not answering on $HEALTH_URL"
  if [[ -n "$PREV" && -d "$PREV" ]]; then
    log "rolling back to $PREV"
    switch_to "$PREV"
    healthy || log "previous release is not answering either"
  else
    # First deploy failed: put pm2 back on the old in-place folder exactly as it was.
    log "rolling back to the old /var/www/Unified-portal setup"
    rm -f "$ROOT/current"
    pm2 delete "$APP" >/dev/null 2>&1 || true
    pm2 start npm --name "$APP" --cwd /var/www/Unified-portal -- start >/dev/null
    pm2 save >/dev/null
    healthy || log "old setup is not answering either"
  fi
  exit 1
fi

# Keep this script in step with the repo for the next deploy.
install -m 755 "$DIR/scripts/deploy/deploy.sh" "$ROOT/bin/deploy.sh" 2>/dev/null || true
install -m 755 "$DIR/scripts/deploy/deploy-ssh.sh" "$ROOT/bin/deploy-ssh.sh" 2>/dev/null || true

# Keep the newest KEEP releases (the live one always stays).
LIVE=$(readlink -f "$ROOT/current")
ls -1dt "$ROOT"/releases/*/ | sed 's#/$##' | tail -n +$((KEEP + 1)) | while read -r old; do
  [[ "$old" == "$LIVE" ]] || rm -rf "$old"
done

log "deployed $SHA ($DIR), app is up"
