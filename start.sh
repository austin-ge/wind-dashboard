#!/bin/sh
set -e

# Start Tailscale daemon in background
tailscaled --tun=userspace-networking --socks5-server=localhost:1055 &
sleep 2

# Auth with Tailscale (TS_AUTHKEY must be set as env var in Dokploy)
tailscale up --authkey="${TS_AUTHKEY}" --hostname="wind-dashboard" --accept-routes

echo "Tailscale connected"

# Start nginx in foreground
nginx -g "daemon off;"
