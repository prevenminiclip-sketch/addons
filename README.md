# Movy.sx Stremio Addon (Standalone Portainer Stack)

A standalone, ultra-lightweight Stremio Addon server (~50MB Docker image) that serves direct CDN HLS streams (`4K`, `1080p`, `720p`, `480p`) from `movy.sx` / `wecollege.net`.

Connected to your EasyNews stack via Docker network `stremio_net` to share your **DuckDNS HTTPS domain** and Let's Encrypt certificate.

---

## ⚡ How It Works with DuckDNS & EasyNews Caddy

Your EasyNews stack runs a custom Caddy container with `caddy-dns/duckdns` on port 443.

When both stacks share the `stremio_net` Docker network:

1. **Both Addons live on the same DuckDNS domain:**
   - **EasyNews Addon:** `https://<your-subdomain>.duckdns.org/manifest.json`
   - **Movy Addon:** `https://<your-subdomain>.duckdns.org/movy/manifest.json`
2. **Zero Port Conflicts:** Movy runs internally on port 7000 and is routed through Caddy on port 443.
3. **100% Stremio Web Compatible:** Works seamlessly on `web.stremio.com`, Android TV, FireStick, iOS, and PC.
4. **Pure Direct CDN Streams:** Only lightweight JSON requests go through Caddy; actual video streams directly from `moon.goldenkite.top` CDN to your Stremio player.

---

## 🚀 Portainer Deployment

### Step 1: Update Your EasyNews Stack in Portainer
1. In Portainer, go to your existing **stremio-easynews-addon** stack.
2. Pull the latest git changes (or click **Update the stack** with repo pull enabled).
3. This creates the shared `stremio_net` network and updates Caddy to route `/movy*`.

### Step 2: Deploy Movy Addon Stack
1. In Portainer, go to **Stacks** ➔ **Add stack**.
2. Name: `movy-stremio-addon`
3. Build method: **Repository**
4. Repository URL:
   ```text
   https://github.com/charlietrp77-cmd/movy-stremio-addon.git
   ```
5. Reference: `refs/heads/main`
6. Click **Deploy the stack**.

---

## 📺 Stremio Install URLs

- **Over DuckDNS (HTTPS - Recommended for all devices):**
  ```text
  https://<your-subdomain>.duckdns.org/movy/manifest.json
  ```
- **Local LAN (HTTP fallback):**
  ```text
  http://<DOCKER-HOST-IP>:7000/manifest.json
  ```
