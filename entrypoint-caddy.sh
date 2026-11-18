#!/bin/sh
set -e

# Target domain priority: DOMAIN -> DUCKDNS_DOMAIN -> :80
TARGET_DOMAIN="${DOMAIN:-${DUCKDNS_DOMAIN:-:80}}"

if [ "$TARGET_DOMAIN" != ":80" ]; then
    echo "[Caddy] Configuring automatic Let's Encrypt HTTPS for domain: ${TARGET_DOMAIN}"
    cat <<EOF > /etc/caddy/Caddyfile
${TARGET_DOMAIN} {
    reverse_proxy movy-stremio-addon:7000
}
EOF
else
    echo "[Caddy] No domain provided, running on plain HTTP :80"
    cat <<EOF > /etc/caddy/Caddyfile
:80 {
    reverse_proxy movy-stremio-addon:7000
}
EOF
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
