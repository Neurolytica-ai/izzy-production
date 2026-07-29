# Deploy runbook — Izzy Yogev Production System

First-time deployment to the client's Hostinger server, over HTTPS, with Docker.

- **Server:** `62.72.35.209`
- **Host / domain:** `srv1859122.hstgr.cloud` (Hostinger per-server DNS; A record already points at the server)
- **Database:** Supabase — already deployed and seeded. **Nothing to migrate.** The app just connects to it.
- **Approach:** Docker Compose (Arad's preference). Three containers: `app` (Node API), `assets` (one-shot that publishes the built front end), `nginx` (serves the site, terminates TLS).

You run every command over SSH; nothing here touches your Windows machine. If a step's output doesn't match "**Expect:**", stop and check *Troubleshooting* at the bottom before continuing.

---

## Before you start — have these ready

1. The **current root password** for `62.72.35.209` (work plan §10.1).
2. A **new strong password** for the `neurolytica` server user you're about to create. Generate one and save it in your password manager — you'll also share it with Arad ("document the password").
3. The **GitHub repo URL** under the Neurolytica-ai org, and a way to authenticate a private clone (a GitHub Personal Access Token works over HTTPS).
4. An **email address** for Let's Encrypt expiry notices (yours is fine).
5. The **app admin login** (already created): `admin` / the password from your manager.

Throughout, replace anything in `<angle brackets>`.

---

## Step 1 — First login and server hardening

> Do the hardening **first**, exactly as Arad asked: a `neurolytica` sudo user, then disable root login. Follow the order below so you can't lock yourself out.

**1a. Log in as root** (from your machine's terminal / PowerShell):

```bash
ssh root@62.72.35.209
```

Enter the §10.1 root password.

**1b. Create the `neurolytica` user with sudo:**

```bash
adduser neurolytica                 # set the new strong password when prompted
usermod -aG sudo neurolytica        # grant sudo
```

**1c. Rotate the old root password** (it was shared in plain text — change it even though you'll disable root login next):

```bash
passwd root                         # set a new root password, save it too
```

**1d. TEST the new user before locking root out.** Open a **second** terminal (leave the root session open) and confirm you can log in and use sudo:

```bash
ssh neurolytica@62.72.35.209
sudo whoami          # Expect: root
```

Only if that works, continue.

**1e. Disable root SSH login.** Back in the root session:

```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd
```

**Expect:** `ssh root@62.72.35.209` is now refused; `ssh neurolytica@62.72.35.209` still works. From here on, work as `neurolytica` and prefix admin commands with `sudo`.

---

## Step 2 — Install Docker

As `neurolytica`:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker neurolytica
```

Log out and back in (so the `docker` group applies), then verify:

```bash
docker --version
docker compose version
```

**Expect:** both print a version, no "permission denied".

---

## Step 3 — Get the code

```bash
cd ~
git clone https://github.com/Neurolytica-ai/<repo>.git izzy-production
cd izzy-production
```

For a private repo, when prompted for a password paste your **GitHub Personal Access Token** (not your account password).

---

## Step 4 — Configure the environment

```bash
cp .env.production.example .env
nano .env
```

Fill in:

- `DATABASE_URL` — the **same Supabase session-pooler URI** the project already uses (copy it from your dev `.env`).
- `SESSION_SECRET` — generate a fresh one:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
  (No Node on the server? Use: `openssl rand -base64 48`.)
- Leave `COOKIE_SECURE=true`, `UI_LANG=he`, `NODE_ENV=production` as they are.

Save and exit nano (`Ctrl+O`, `Enter`, `Ctrl+X`).

> **Note:** because `COOKIE_SECURE=true`, **login only works once HTTPS is live** (Step 7). Don't test the login over plain HTTP in Step 5 — it will silently fail by design. Verifying the *page loads* in Step 5 is enough.

---

## Step 5 — First bring-up (HTTP, to get the certificate)

Select the HTTP bootstrap config and start everything:

```bash
cp nginx/default.conf nginx/active.conf
docker compose up -d --build
```

The build takes a few minutes the first time. Check status:

```bash
docker compose ps
```

**Expect:** `app` and `nginx` are `running`; `assets` is `exited (0)` (it's a one-shot — that's correct).

Confirm the site is being served:

```bash
curl -I http://srv1859122.hstgr.cloud
```

**Expect:** `HTTP/1.1 200 OK`. (In a browser you'd see the login page — but don't log in yet; see the note above.)

---

## Step 6 — Issue the TLS certificate

```bash
docker compose run --rm certbot certonly --webroot \
  -w /var/www/certbot \
  -d srv1859122.hstgr.cloud \
  --email <you@example.com> --agree-tos --no-eff-email
```

**Expect:** "Successfully received certificate" and a path under `/etc/letsencrypt/live/srv1859122.hstgr.cloud/`. If it fails, see *Troubleshooting*.

---

## Step 7 — Switch to HTTPS

```bash
cp nginx/https.conf nginx/active.conf
docker compose restart nginx
```

Verify:

```bash
curl -I https://srv1859122.hstgr.cloud
curl -I http://srv1859122.hstgr.cloud     # Expect: 301 redirect to https
```

**Expect:** the HTTPS request returns `200 OK`; the HTTP request returns `301`.

Now open **https://srv1859122.hstgr.cloud** in a browser: valid padlock, Hebrew interface, and you can **log in as `admin`**. That's the system live.

---

## Step 8 — Automatic certificate renewal

Let's Encrypt certs last 90 days. Add a host cron job to renew and reload nginx:

```bash
sudo crontab -e
```

Add this line (adjust the path if you cloned elsewhere):

```
0 3 * * * cd /home/neurolytica/izzy-production && docker compose run --rm certbot renew && docker compose exec -T nginx nginx -s reload
```

`certbot renew` is a no-op until a cert is within 30 days of expiry, so it's safe to run daily.

---

## Updating the app later

When there's new code to ship:

```bash
cd ~/izzy-production
git pull
docker compose up -d --build      # rebuilds app + refreshes the front end, restarts
```

`nginx/active.conf` is gitignored, so `git pull` never disturbs your HTTPS config.

---

## Troubleshooting

**`docker compose ps` shows `app` restarting** — bad `.env`. Check logs:
```bash
docker compose logs app --tail 50
```
A config error (e.g. missing `SESSION_SECRET`, or a `DATABASE_URL` typo) is printed at startup.

**Certbot fails with "challenge failed" / connection refused** — nginx isn't reachable on port 80 from the internet.
- Confirm Step 5 works: `curl -I http://srv1859122.hstgr.cloud` returns 200.
- Check the host firewall allows 80 and 443:
  ```bash
  sudo ufw status
  sudo ufw allow 80 && sudo ufw allow 443   # if ufw is active
  ```
- Also check Hostinger's panel firewall for the server.

**nginx won't start after Step 7** — the cert isn't where https.conf expects. Confirm it exists:
```bash
sudo ls /etc/letsencrypt/live/srv1859122.hstgr.cloud/
```
If it's missing, go back to Step 6. To get the site back up meanwhile:
```bash
cp nginx/default.conf nginx/active.conf && docker compose restart nginx
```

**Login "succeeds" then immediately logs you out** — you're on HTTP with `COOKIE_SECURE=true`. Use the HTTPS URL. If it happens on HTTPS, confirm nginx is sending `X-Forwarded-Proto https` (it is, in the provided config).

**The page is blank / 404s for assets** — the `assets` one-shot didn't populate the web root. Re-run it:
```bash
docker compose up -d --build assets nginx
docker compose ps      # assets should show exited (0)
```

---

## What this deploy does and doesn't touch

- **Does:** create a `neurolytica` sudo user, disable root SSH, rotate the root password, install Docker, run the app + nginx, obtain a TLS cert.
- **Doesn't:** touch any database on the server (there isn't one — data is on Supabase), and doesn't run migrations (already applied).
- **Credentials to document** (per Arad): the new `neurolytica` password and the new `root` password. Store them in the password manager and share with Arad over a trusted channel.
