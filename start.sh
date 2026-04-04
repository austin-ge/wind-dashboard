#!/bin/sh
set -e

# Start Node backend (polls pi3, serves /api/windows)
node /app/server.js &

# Start nginx in foreground
nginx -g "daemon off;"
