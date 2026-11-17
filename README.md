# Movy.sx Stremio Addon (Self-Contained DuckDNS Stack)

A completely self-contained Portainer stack with **Movy.sx Stremio Addon** and **Caddy** (with DuckDNS DNS-01 SSL).

- **100% Standalone:** No external network dependencies, no other stacks required.
- **Automatic Let's Encrypt SSL:** Caddy acquires and auto-renews a trusted HTTPS certificate via DuckDNS DNS-01 challenge (works even on local LAN IPs or behind CGNAT without port forwarding).
- **Direct 4K/1080p HLS Streams:** Playable directly in Stremio Web (`web.stremio.com`), Android TV, FireStick, iOS, and Desktop.

---

## 📁 Stack Structure

```text
C:\movy-stremio-addon\
├── docker-compose.yml          # Compose specification
├── portainer-stack.yml         # Portainer-ready Stack file
├── Dockerfile                  # Multi-stage lightweight Movy Node.js build
├── Dockerfile.caddy            # Caddy builder with caddy-dns/duckdns
├── Caddyfile                   # HTTPS reverse proxy configuration
├── .env                        # Domain & DuckDNS Token configuration
├── .env.example                # Example configuration
└── src/                        # Reversed cipher and Stremio HTTP server
```

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
8. Click **Deploy the stack**.

---

## 📺 Stremio Manifest URL

Once deployed, paste your clean HTTPS manifest URL directly into Stremio's search bar:

```text
https://my-easynews-plus.duckdns.org/manifest.json
```

*(No `/movy` prefix, no port `:7000`. Pure HTTPS root manifest ready to install).*
