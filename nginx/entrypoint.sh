#!/bin/bash
set -e

SSL_DIR="/etc/ssl/ham-shack-cockpit"
CERT="$SSL_DIR/cert.pem"
KEY="$SSL_DIR/key.pem"

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "Generating self-signed SSL certificate..."
    mkdir -p "$SSL_DIR"
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$KEY" \
        -out "$CERT" \
        -subj "/C=US/ST=State/L=City/O=ShackWeather/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,DNS:ham-shack-cockpit"
    echo "SSL certificate generated."
else
    echo "SSL certificate already exists, skipping generation."
fi

# Process the nginx config template with envsubst
TEMPLATE="/etc/nginx/templates/default.conf.template"
OUTPUT="/etc/nginx/conf.d/default.conf"

echo "Processing nginx config template..."
envsubst '${APP_HOST} ${APP_PORT}' < "$TEMPLATE" > "$OUTPUT"
echo "nginx config written to $OUTPUT"

# Remove default nginx config if it exists separately
rm -f /etc/nginx/conf.d/default.conf.bak

exec nginx -g "daemon off;"
