#!/bin/sh
set -e

# Target domain priority: DOMAIN -> DUCKDNS_DOMAIN -> :80
TARGET_DOMAIN="${DOMAIN:-${DUCKDNS_DOMAIN:-:80}}"

if [ -n "$DUCKDNS_TOKEN" ] && [ "$TARGET_DOMAIN" != ":80" ]; then
    echo "[Caddy] Configuring DuckDNS DNS-01 challenge for ${TARGET_DOMAIN}"
    cat <<EOF > /etc/caddy/Caddyfile
{
    http_port 7080
}

${TARGET_DOMAIN} {
    tls {
        dns duckdns ${DUCKDNS_TOKEN}
    }
    reverse_proxy 127.0.0.1:7000
}
EOF
elif [ "$TARGET_DOMAIN" != ":80" ]; then
    echo "[Caddy] Configuring automatic Let's Encrypt HTTPS for domain: ${TARGET_DOMAIN}"
    cat <<EOF > /etc/caddy/Caddyfile
${TARGET_DOMAIN} {
    reverse_proxy 127.0.0.1:7000
}
EOF
else
    echo "[Caddy] No domain provided, running on plain HTTP :7080"
    cat <<EOF > /etc/caddy/Caddyfile
:7080 {
    reverse_proxy 127.0.0.1:7000
}
EOF
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
