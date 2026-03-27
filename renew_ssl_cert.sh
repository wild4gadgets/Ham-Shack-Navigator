#!/bin/bash
set -e
cd "$(dirname "$0")"
rm ssl/cert.pem ssl/key.pem
docker compose up -d nginx
