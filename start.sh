#!/bin/sh
set -e

# Start Tailscale daemon with proper TUN (requires NET_ADMIN + /dev/net/tun)
tailscaled &
sleep 2

# Auth with Tailscale (TS_AUTHKEY must be set as env var in Dokploy)
tailscale up --authkey="${TS_AUTHKEY}" --hostname="wind-dashboard" --accept-routes
echo "Tailscale connected: $(tailscale ip -4)"

# Start nginx in foreground
nginx -g "daemon off;"
