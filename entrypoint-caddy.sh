#!/bin/sh
set -e

# Target domain priority: DOMAIN -> DUCKDNS_DOMAIN -> :80
TARGET_DOMAIN="${DOMAIN:-${DUCKDNS_DOMAIN:-:80}}"

if [ -n "$DUCKDNS_TOKEN" ] && [ -n "$DUCKDNS_DOMAIN" ]; then
    echo "[Caddy] Using DuckDNS DNS-01 SSL for domain: ${DUCKDNS_DOMAIN}"
    cat <<EOF > /etc/caddy/Caddyfile
${DUCKDNS_DOMAIN} {
    tls {
        dns duckdns ${DUCKDNS_TOKEN}
    }
    reverse_proxy movy-stremio-addon:7000
}
EOF
elif [ "$TARGET_DOMAIN" != ":80" ]; then
    echo "[Caddy] Using standard Let's Encrypt HTTP-01 SSL for domain: ${TARGET_DOMAIN}"
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
