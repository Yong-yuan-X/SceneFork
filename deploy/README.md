# Temporary Ubuntu recruitment demo

This deployment keeps Fastify and Nginx on loopback. Only the temporary
Cloudflare Quick Tunnel URL is public.

## 1. Build

Install Node.js 20+, npm 10+, Nginx, FFmpeg, and `cloudflared`, then build from
the repository root. Do not set `VITE_API_BASE_URL` for this production build;
the frontend will use same-origin `/api/*` and `/media/*` URLs.

```bash
unset VITE_API_BASE_URL
npm ci
npm run build
```

## 2. Install the local services

The examples assume the repository is located at `/opt/scenefork` and the
service account is named `scenefork`. Replace those values if needed. Ensure
the service account can write only the persistent directories:

```bash
sudo install -d -o scenefork -g scenefork /opt/scenefork/data /opt/scenefork/media
sudo cp deploy/nginx.scenefork.conf.example /etc/nginx/conf.d/scenefork.conf
sudo cp deploy/scenefork-api.service.example /etc/systemd/system/scenefork-api.service
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl daemon-reload
```

The API reads `/opt/scenefork/.env` through the existing `config.ts`; the
systemd unit contains no API keys. Keep `.env` readable only by the service
account. Use these deployment-specific values in addition to the provider
configuration you intend to use:

```dotenv
API_HOST=127.0.0.1
API_PORT=3000
DATABASE_URL=./data/scenefork.db
MEDIA_DIR=./media
WEB_ORIGIN=https://REPLACE-AFTER-TUNNEL-START.trycloudflare.com
```

## 3. Start the Quick Tunnel and API

Start Nginx first, then run the temporary tunnel and copy the generated HTTPS
URL:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Set that exact URL as `WEB_ORIGIN` in `.env`, then start or restart the API:

```bash
sudo systemctl enable --now scenefork-api
sudo systemctl restart scenefork-api
```

Each new Quick Tunnel can receive a different hostname. Update `WEB_ORIGIN`
and restart the API whenever it changes. Verify locally before sharing:

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:8080/api/health
```

## Security boundary

- Fastify listens only on `127.0.0.1:3000`; Nginx listens only on
  `127.0.0.1:8080`.
- Nginx serves only `apps/web/dist` and proxies `/api/` and `/media/`; the
  repository, `.env`, SQLite database, and media directory are not static roots.
- Settings requests require `X-SceneFork-Settings: 1`. Requests with an
  `Origin` must exactly match `WEB_ORIGIN`; Origin-less same-origin requests
  additionally require the Nginx-overwritten proxy marker and forwarded host.
- Temporary keys remain in Fastify process memory only. They are not returned,
  logged, written to browser storage, or stored in SQLite.
- This is CSRF/origin protection, not user authentication. Anyone who knows a
  Quick Tunnel URL can access the demo, so use a short-lived URL and stop
  `cloudflared` after the review.

Cloudflare documents Quick Tunnels as temporary testing/development links with
no uptime guarantee:
<https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/>.
