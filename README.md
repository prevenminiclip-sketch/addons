# Movy.sx Stremio Addon (Standalone Portainer Stack)

A standalone, ultra-lightweight Stremio Addon server (~50MB Docker image) that serves direct CDN HLS streams (`4K`, `1080p`, `720p`, `480p`) from `movy.sx` / `wecollege.net`.

No AIOStreams needed. No iframe embeds, ads, or popups. Just pure Stremio streaming.

---

## ⚡ How It Works in Stremio

Stremio's built-in catalog (**Cinemeta**) already handles movie and series search, posters, trailers, and cast lists.

When you install this addon and click on **any movie or TV episode** in Stremio:
1. Stremio asks the addon for streams.
2. The addon queries the WeCollege backend, decrypts the session keystream, and returns the stream list:
   - `Movy [Auto]` (Auto-adaptive HLS master playlist)
   - `Movy [4K]` (2160p direct HLS stream)
   - `Movy [1080P]` (1080p direct HLS stream)
   - `Movy [720P]` (720p direct HLS stream)
   - `Movy [480P]` (480p direct HLS stream)
3. Stremio's native media player streams directly from the CDN edge.

---

## 📁 Stack Structure

```text
C:\movy-stremio-addon\
├── docker-compose.yml          # Docker Compose spec
├── portainer-stack.yml         # Portainer-ready Stack file
├── Dockerfile                  # Multi-stage lightweight Alpine build
├── .env                        # Port configuration
├── README.md                   # Guide
└── src/
    ├── crypto.ts               # Reversed Murmur3 + ROL keystream cipher
    ├── provider.ts             # Metadata resolution, seed retrieval, cluster failover
    ├── server.ts               # Stremio v3 protocol server (/manifest.json, /stream/...)
    └── test.ts                 # CLI stream tester
```

---

## 🚀 Portainer Deployment

### Method 1: Deploy with Portainer Web Editor

1. On your Docker host or NAS, build the image once:
   ```bash
   cd movy-stremio-addon
   docker build -t movy-stremio-addon:latest .
   ```
2. In Portainer, go to **Stacks** ➔ **Add stack**.
3. Name the stack: `movy-stremio-addon`
4. Paste the following into the **Web editor**:
   ```yaml
   version: "3.8"

   services:
     movy-stremio-addon:
       image: movy-stremio-addon:latest
       container_name: movy-stremio-addon
       restart: unless-stopped
       ports:
         - "7000:7000"
       environment:
         - PORT=7000
         - NODE_ENV=production
   ```
5. Click **Deploy the stack**.

---

### Method 2: Docker Compose CLI

On your Docker host:
```bash
cd movy-stremio-addon
docker compose up -d --build
```

To view logs:
```bash
docker compose logs -f
```

---

## 📺 How to Add to Stremio

1. Open **Stremio** on your PC, TV, phone, or tablet.
2. Go to **Addons** (the puzzle piece icon).
3. In the search/URL input field at the top, paste your addon's manifest URL:
   ```text
   http://<YOUR-DOCKER-HOST-IP>:7000/manifest.json
   ```
   *(For example: `http://192.168.1.100:7000/manifest.json`)*
4. Click **Install**.
5. Done! Search for any movie or TV series in Stremio, and Movy streams will appear on the right side.

---

## 🧪 CLI Testing

You can test stream resolution on the host before running Docker:
```bash
# Test a Movie (Inception - tt1375666)
node dist/test.js tt1375666

# Test a TV Episode (The Rings of Power S01E01 - tt7631058:1:1)
node dist/test.js tt7631058:1:1 series
```
