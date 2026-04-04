# Wind Dashboard — skydivemidwestwx.com

Live wind display for Skydive Midwest, hosted on VPS via Dokploy.

## Architecture

```
Browser → skydivemidwestwx.com (VPS + Traefik + SSL)
               ↓
           nginx (serves HTML; proxies /api/* server-side)
               ↓ Tailscale (VPS→pi3 only, users never touch it)
           pi3:4000 (dropzone SDR weather receiver)
```

User traffic never hits Tailscale. The VPS nginx makes the Tailscale hop to pi3 on behalf of the user.

## Deploy via Dokploy

1. Push this folder to a GitHub repo
2. In Dokploy: **New App → Docker Compose → GitHub repo**
3. Set domain: `skydivemidwestwx.com`
4. Point DNS: `skydivemidwestwx.com` A record → VPS IP
5. Deploy — Traefik handles SSL automatically

## Requirements

- VPS must have Tailscale connected (pi3 Tailscale IP: `100.118.177.49`)
- pi3 must be running `weather-receiver-sdr.service` on port 4000
- Traefik `proxy` network must exist (Dokploy creates this automatically)

## Files

- `index.html` — single-file dashboard (Chart.js, auto-refreshes every 5s)
- `nginx.conf` — serves HTML, proxies `/api/*` to pi3 via Tailscale
- `Dockerfile` — nginx:alpine
- `docker-compose.yml` — single service with Traefik labels
