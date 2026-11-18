# Movy Stremio Addon

Direct HLS stream provider (4K / 1080p) for Stremio from Movy / WeCollege clusters, with automated in-RAM segment prefetching and zero-conflict DuckDNS HTTPS.

---

## 🏆 Why Local Portainer Hosting is the Preferred Method

Hosting Movy locally on your home server (Portainer, Docker, Raspberry Pi, NAS, Unraid, TrueNAS, or mini PC) is strongly recommended over cloud providers:

| Feature | 🏠 Local Portainer Hosting (Recommended) | ☁️ Cloud VPS (AWS / OCI) |
| :--- | :--- | :--- |
| **Bandwidth Cost** | **$0 / Month** (Home fiber is unmetered) | **~$80–$100 / Month** (AWS charges \$0.09/GB egress after 100 GB; 1 TB = \$81+) |
| **Streaming Latency** | **0–1 ms** (Direct local Gigabit LAN / Wi-Fi) | 50–180 ms across the internet |
| **Cloudflare WAF** | **Never blocked** (Residential IPs are trusted) | **Blocked** (Datacenter IPs are challenged/blocked by WAF) |
| **Port Safety** | **Port 80 untouched** (Safe with Solar Assistant, Pi-hole, Home Assistant) | Requires dedicated ports 80 & 443 |

---

## 🚀 1-Click Portainer Deployment (Preferred)

### Method 1: Web Editor (Fastest)

1. Open your **Portainer Web UI**.
2. Go to **Stacks** ➔ **Add stack**.
3. Name your stack: `movy-stremio-addon`
4. Select **Web editor** and paste the following compose file:

```yaml
version: "3.8"

services:
  movy-stremio-addon:
    build:
      context: https://github.com/charlietrp77-cmd/movy-stremio-addon.git#v1.0.0-stable
    container_name: movy-stremio-addon
    restart: unless-stopped
    network_mode: "host"
    environment:
      - PORT=7000
      - NODE_ENV=production
      # Optional: Secret access token to protect your instance (leave empty for public)
      - ACCESS_KEY=

  caddy:
    build:
      context: https://github.com/charlietrp77-cmd/movy-stremio-addon.git#v1.0.0-stable
      dockerfile: Dockerfile.caddy
    container_name: movy-caddy-ssl
    restart: unless-stopped
    network_mode: "host"
    environment:
      - DOMAIN=my-domain.duckdns.org
      - DUCKDNS_TOKEN=your_duckdns_token_here
    volumes:
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - movy-stremio-addon

volumes:
  caddy_data:
  caddy_config:
```

> **Configuration Notes:**
> * Replace `my-domain.duckdns.org` with your DuckDNS domain.
> * Replace `your_duckdns_token_here` with your token from [duckdns.org](https://www.duckdns.org).
> * **No Port 80 Conflict:** Caddy uses DuckDNS DNS-01 validation and binds only to port **443** (HTTP uses port 7080). Port 80 is untouched for your existing services (Solar Assistant, etc.).

5. Click **Deploy the stack**. Portainer will build the lightweight containers and start them automatically.

---

### Method 2: Plain HTTP (No Domain / No SSL Required)

If you only use Stremio on your home Wi-Fi (Android TV, Firestick, PC, or mobile app), Stremio natively supports plain HTTP without needing a domain or SSL:

```yaml
version: "3.8"

services:
  movy-stremio-addon:
    build:
      context: https://github.com/charlietrp77-cmd/movy-stremio-addon.git#v1.0.0-stable
    container_name: movy-stremio-addon
    restart: unless-stopped
    ports:
      - "7000:7000"
    environment:
      - PORT=7000
      - NODE_ENV=production
```

---

## 📺 Adding Movy to Stremio

Paste your manifest URL directly into the search bar at the top of Stremio:

* **With DuckDNS HTTPS (Port 443):**
  ```text
  https://my-domain.duckdns.org/movy/manifest.json
  ```
  *(or `https://my-domain.duckdns.org/manifest.json`)*

* **With Local LAN HTTP (Port 7000):**
  ```text
  http://<YOUR_LOCAL_IP>:7000/manifest.json
  ```
  *(Example: `http://192.168.1.50:7000/manifest.json`)*

Click **Install**.

---

## 🔝 How to Make Movy Streams Show Up First

Stremio determines stream order based on the **installation order** of your addons:

1. Open Stremio ➔ Go to **Addons** (the puzzle piece icon).
2. Find **Torrentio** (or other streaming addons) ➔ Click **Uninstall**.
3. Install **Movy**.
4. Re-install **Torrentio**.

Because Movy was installed *before* Torrentio, all Movy streams will appear at the very top of your stream list!

*(Alternatively, you can drag and re-order addons without reinstalling via [Stremio Addon Manager](https://stremio-addon-manager.vercel.app/)).*

---

## ✨ Features & Architecture

* **Clean UI & Metadata:** Zero emojis. Clean badge name `Movy`. Structured 2-line title:
  ```text
  1080p • GoldenKite CDN (Miami)
  5.4 GB • HLS • 5.1 / AAC • SDR
  ```
* **HLS Multi-Stream Accelerator:** Built-in ahead-of-time (AOT) segment prefetcher (`hls-accelerator.ts`) caches upcoming video chunks into RAM, delivering 0ms seeking and playback latency.
* **Universal Upstream Tunnel:** Resilient direct/proxy engine (`upstream.ts`) supporting HTTP/HTTPS with SNI, streaming pipelining, and range-seeking support.
* **DuckDNS DNS-01 SSL:** Automatic Let's Encrypt certificates without opening or conflicting with port 80.
* **Multi-Cluster Resolution:** Simultaneously queries GoldenKite CDN (Miami, Boise), Cloudflare Edge (Chicago, Reno, Oakland), WeCollege Direct (Atlanta), WarmSquare CDN (Seattle, Phoenix, Dallas), and Vidmoly (Vegas).

---

## 📁 Repository Structure

```text
movy-stremio-addon/
├── portainer-stack.yml         # Production Portainer Stack (Recommended)
├── docker-compose.local.yml    # Standalone local Docker Compose (HTTP :7000)
├── docker-compose.yml          # Dual-service Compose (Movy + Caddy SSL)
├── Dockerfile                  # Multi-stage lightweight Node 20 image
├── Dockerfile.caddy            # Caddy builder with github.com/caddy-dns/duckdns
├── entrypoint-caddy.sh         # Auto-SSL generator (DuckDNS DNS-01 challenge)
├── cloudformation.yaml         # Archived AWS CloudFormation template
├── oci-resource-manager/       # Archived Oracle Cloud Resource Manager stack
└── src/                        # Core TypeScript engine (Zero npm runtime dependencies)
    ├── crypto.ts               # Reversed Murmur3 + ROL keystream decryption
    ├── hls-accelerator.ts      # Multi-stream in-RAM segment prefetcher
    ├── provider.ts             # Parallel cluster queries & stream ranking
    ├── server.ts               # Stremio v3 protocol server & HLS proxy
    └── upstream.ts             # SOCKS5 & Direct HTTP/HTTPS streaming client
```

---

## ⚠️ Cloud Hosting (AWS / OCI) — Why It Does Not Make Sense

While cloud deployment templates ([`cloudformation.yaml`](cloudformation.yaml) for AWS and [`oci-resource-manager/`](oci-resource-manager/) for Oracle) are preserved in this repository for historical reference, cloud hosting is **strongly discouraged** for video streaming:

1. **Bandwidth Pricing:** AWS charges **$0.09 per GB** of outbound internet transfer after the first 100 GB. Watching 1 TB of video per month costs **~$81/month** in bandwidth alone.
2. **Datacenter Blocks:** Cloudflare WAF aggressively blocks commercial cloud IP ranges (AWS ASN 16509, Oracle ASN 31898), requiring continuous proxy workarounds.
3. **Local Home Hosting is 100% Free:** Running this addon on a local server, Raspberry Pi, or NAS costs $0 in bandwidth, has zero Cloudflare blocks, and provides instant gigabit LAN playback.
