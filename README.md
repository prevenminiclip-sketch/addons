# Movy.sx Stremio Addon (Self-Contained DuckDNS Stack)

A completely self-contained Portainer stack with **Movy.sx Stremio Addon** and **Caddy** (with DuckDNS DNS-01 SSL).

- **100% Standalone:** No external network dependencies, no other stacks required.
- **HLS Multi-Stream Accelerator:** Multi-connection pipeline prefetching upcoming segments in parallel into an in-memory ring buffer (eliminates buffering on high-bitrate streams).
- **Automatic Let's Encrypt SSL:** Caddy acquires and auto-renews a trusted HTTPS certificate via DuckDNS DNS-01 challenge (works even on local LAN IPs or behind CGNAT without port forwarding).
- **Direct 4K/1080p HLS Streams:** Playable directly in Stremio Web (`web.stremio.com`), Android TV, FireStick, iOS, and Desktop.
- **Instance Security (Secret Access Token):** Built-in token protection (`ACCESS_KEY`) preventing scanners, bots, or unauthorized users from leeching your instance bandwidth.
- **Network Hardened:** Container port 7000 is bound strictly to `127.0.0.1`, ensuring all external traffic must route securely through HTTPS.

---

## 📁 Stack Structure

```text
C:\movy-stremio-addon\
├── docker-compose.yml          # Compose specification (localhost hardened)
├── portainer-stack.yml         # Portainer-ready Stack file
├── Dockerfile                  # Multi-stage lightweight Movy Node.js build
├── Dockerfile.caddy            # Caddy builder with caddy-dns/duckdns
├── Caddyfile                   # HTTPS reverse proxy configuration
├── .env                        # Domain & DuckDNS Token configuration
├── .env.example                # Example configuration
└── src/                        # Reversed cipher, HLS accelerator, & Stremio server
```

---

## 🔒 Security & Access Token Protection

To keep your cloud instance (e.g. Oracle Cloud Free Tier) completely private and prevent strangers or crawlers from using your bandwidth:

1. In your stack environment variables, set an `ACCESS_KEY`:
   ```bash
   ACCESS_KEY=my_secure_secret_token
   ```
2. Once set, the addon rejects all unauthorized requests with `401 Unauthorized`.
3. Your protected Stremio manifest URL becomes:
   ```text
   https://<your-domain>/my_secure_secret_token/manifest.json
   ```
4. All stream resolution, master HLS playlists, and pre-fetched segments automatically inherit the secret token, giving seamless playback on Android TV, Desktop, and Web.
5. If `ACCESS_KEY` is omitted or left empty, the addon runs in open/public mode.

---

## 🚀 Portainer Deployment

### 1. Stop any other stack using port 443
If you previously had another stack (like `stremio-easynews-addon`) bound to port 443, stop it in Portainer so port 443 is free for this stack.

### 2. Deploy in Portainer
1. Go to **Stacks** ➔ **Add stack**.
2. Name: `movy-stremio-addon`
3. Build method: **Repository**
4. Repository URL:
   ```text
   https://github.com/charlietrp77-cmd/movy-stremio-addon.git
   ```
5. Reference: `refs/heads/main`
6. Compose path: `docker-compose.yml`
7. In **Environment variables**, set:
   - `DUCKDNS_DOMAIN=my-easynews-plus.duckdns.org`
   - `DUCKDNS_TOKEN=0dc56872-8e37-4e5f-9d5c-6f36e8182c2b`
   - `ACCESS_KEY=your_secret_token_here` *(Optional, recommended)*
8. Click **Deploy the stack**.

---

## 📺 Stremio Manifest URL

Paste your clean HTTPS manifest URL directly into Stremio's search bar:

- **With Access Key (Protected):**
  ```text
  https://my-easynews-plus.duckdns.org/your_secret_token_here/manifest.json
  ```
- **Without Access Key (Public):**
  ```text
  https://my-easynews-plus.duckdns.org/manifest.json
  ```

*(No port `:7000` exposed, no unencrypted HTTP. Pure HTTPS root manifest ready to install).*
