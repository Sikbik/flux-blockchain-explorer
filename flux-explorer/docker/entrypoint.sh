#!/bin/sh
# Flux Explorer Entrypoint Script
# Starts Next.js server (price cache initialization handled inside the app)

set -e

echo "=== Flux Explorer Startup ==="

echo "Starting Next.js server on port ${PORT:-42069}..."
exec node server.js
