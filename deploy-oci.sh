#!/bin/bash
set -e

echo "=========================================================="
echo "🚀 Movy.sx Stremio Addon - OCI Automated Setup"
echo "=========================================================="

# 1. Ensure Root / Sudo
if [ "$EUID" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

# 2. Open Ports in Ubuntu / Oracle Linux OS Firewall (iptables & ufw)
echo "[1/5] Configuring OS firewall (Opening ports 80 & 443)..."
$SUDO iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
$SUDO iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
if which netfilter-persistent >/dev/null 2>&1; then
  $SUDO netfilter-persistent save 2>/dev/null || true
fi
if which ufw >/dev/null 2>&1; then
  $SUDO ufw allow 80/tcp 2>/dev/null || true
  $SUDO ufw allow 443/tcp 2>/dev/null || true
fi

# 3. Install Docker & Docker Compose if missing
if ! which docker >/dev/null 2>&1; then
  echo "[2/5] Installing Docker..."
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER" 2>/dev/null || true
else
  echo "[2/5] Docker is already installed."
fi

# 4. Detect Public IP & Determine Domain
echo "[3/5] Detecting Public IP..."
PUBLIC_IP=$(curl -s --connect-timeout 5 https://api.ipify.org || curl -s --connect-timeout 5 https://ifconfig.me || echo "")

if [ -z "$PUBLIC_IP" ]; then
  echo "⚠️ Could not auto-detect public IP. Please enter it manually or use your domain."
  DOMAIN="localhost"
else
  DOMAIN="${PUBLIC_IP}.sslip.io"
  echo "✅ Public IP: ${PUBLIC_IP}"
  echo "✅ Automated Hostname: ${DOMAIN}"
fi

# 5. Access Key Configuration
if [ -z "$ACCESS_KEY" ]; then
  # Generate a secure 8-character token if not set
  ACCESS_KEY=$(openssl rand -hex 4 2>/dev/null || date +%s | tail -c 8)
fi

echo "[4/5] Generating environment configuration..."
cat <<EOF > .env
DOMAIN=${DOMAIN}
ACCESS_KEY=${ACCESS_KEY}
PORT=7000
CADDY_HTTPS_PORT=443
EOF

echo "[5/5] Building and starting containers..."
$SUDO docker compose up -d --build

echo ""
echo "=========================================================="
echo "🎉 DEPLOYMENT COMPLETE!"
echo "=========================================================="
echo "🌐 Hostname:   https://${DOMAIN}"
echo "🔒 Access Key: ${ACCESS_KEY}"
echo ""
echo "📺 Add to Stremio:"
echo "👉 https://${DOMAIN}/${ACCESS_KEY}/manifest.json"
echo "=========================================================="
echo "⚠️ Important: Make sure TCP Ports 80 and 443 are allowed in"
echo "   your Oracle Cloud VCN Security List (Ingress Rules)!"
echo "=========================================================="
