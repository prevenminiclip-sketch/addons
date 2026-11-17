# Movy.sx Stremio Addon (Standalone Portainer Stack)

A standalone, ultra-lightweight Stremio Addon server (~50MB Docker image) that serves direct CDN HLS streams (`4K`, `1080p`, `720p`, `480p`) from `movy.sx` / `wecollege.net`.

Connected to CineStream's Docker network (`cinestream_net`) to share **Caddy** and **DuckDNS** with automatic HTTPS (SSL).

---

## ⚡ How It Works with DuckDNS & CineStream

Because this container connects to `cinestream_net`:

1. **Direct HTTPS Stremio URL via CineStream Caddy:**
   ```text
   https://<your-subdomain>.duckdns.org/movy/manifest.json
   ```
   Caddy automatically handles the Let's Encrypt SSL certificate, enabling full compatibility with **Stremio Web** (`web.stremio.com`), mobile, and TV.
2. **Or Add into CineStream's Built-in AIOStreams:**
   Inside CineStream's AIOStreams web dashboard, add custom addon:
   ```text
   http://movy-stremio-addon:7000/manifest.json
   ```
3. **Pure Direct CDN Streams:**
   The addon only returns lightweight JSON metadata through Caddy; actual video playback streams directly from `moon.goldenkite.top` CDN to Stremio.

---

## 🚀 Portainer Deployment

1. In Portainer, go to **Stacks** ➔ **Add stack**.
2. Name the stack: `movy-stremio-addon`
3. Under **Build method**, select **Repository**.
4. Set:
   - **Repository URL:** `https://github.com/charlietrp77-cmd/movy-stremio-addon.git`
   - **Repository reference:** `refs/heads/main`
   - **Compose path:** `docker-compose.yml`
5. Click **Deploy the stack**.

---

## 📺 Stremio Install URLs

- **Over DuckDNS (HTTPS - Recommended):**
  ```text
  https://<your-subdomain>.duckdns.org/movy/manifest.json
  ```
- **Local LAN (HTTP):**
  ```text
  http://<DOCKER-HOST-IP>:7000/manifest.json
  ```
