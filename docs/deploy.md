# Deploying

Merging into `master` deploys it. GitHub Actions (`.github/workflows/deploy.yml`):

1. **Check** (every push and pull request to master): `npm ci`, type-check, lint (lint is
   report-only until its existing errors are fixed).
2. **Deploy** (pushes to master only, after the check passes): SSH to the VPS and run
   `/var/www/nexgos/bin/deploy.sh <commit>`, which
   - builds the commit in its own folder `releases/<time>-<sha>` (the live app is untouched; a
     failed build changes nothing),
   - points `current` at it and restarts pm2 (`myapp`) — a few seconds,
   - checks `http://127.0.0.1:3000/login` answers, and switches back to the previous release
     if it does not,
   - keeps the last 3 releases.

Watch a deploy in the repo's **Actions** tab. The server log is `/var/www/nexgos/deploy.log`.
To redeploy master by hand: Actions → Check and deploy → **Run workflow**.

## Server layout

```
/var/www/nexgos/
  bin/deploy.sh, bin/deploy-ssh.sh   installed from scripts/deploy/ (updated on each deploy)
  repo.git/                          bare clone of GitHub
  releases/<time>-<sha>/             one per deploy
  shared/.env                        the app's secrets — edit here, then redeploy or `pm2 restart myapp`
  current -> releases/...            what pm2 runs (pm2 cwd: /var/www/nexgos/current)
```

`/var/www/Unified-portal` is the old in-place folder. pm2 no longer runs it; don't deploy there.

## Apache (random 502s)

Apache proxies `app.nexgos.com` and `unified.nexuses.xyz` to `127.0.0.1:3000`
(`/etc/apache2/sites-available/myapp.conf`, `myapp-le-ssl.conf`). With plain
`ProxyPass / http://127.0.0.1:3000/`, Apache reuses idle connections that Node has already closed
(Node drops idle connections after 5 s), which shows up as random 502s ("Connection reset by
peer" in `myapp-error.log`), and after a restart it treats the app as down for 60 s (503s).
Fix — on each of the four `ProxyPass /` lines:

```
ProxyPass / http://127.0.0.1:3000/ disablereuse=On retry=0
```

then `apache2ctl configtest && systemctl reload apache2`.

## Rollback

On the server: `/var/www/nexgos/bin/deploy.sh rollback` (switches to the previous release and
restarts). Or revert the commit on master and let it deploy.

## One-time setup (done once; repeat only for a new server)

1. Deploy key: `ssh-keygen -t ed25519 -N "" -f nexgos_deploy`. On the server, add the public key
   to `/root/.ssh/authorized_keys` restricted to the deploy command:
   `restrict,command="/var/www/nexgos/bin/deploy-ssh.sh" ssh-ed25519 AAAA... github-actions-deploy@nexgos`
2. `mkdir -p /var/www/nexgos/{bin,shared}`, copy `scripts/deploy/*.sh` to `bin/`, copy the app's
   `.env` to `shared/.env`.
3. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:
   - `DEPLOY_HOST` — the server IP
   - `DEPLOY_USER` — `root`
   - `DEPLOY_SSH_KEY` — the whole private key file `nexgos_deploy`
   - `DEPLOY_KNOWN_HOSTS` — output of `ssh-keyscan -t ed25519 <server ip>`
