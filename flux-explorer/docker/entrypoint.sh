#!/bin/sh
# Flux Explorer Entrypoint Script
# Handles price database initialization and starts Next.js server

set -e

echo "=== Flux Explorer Startup ==="

# Check if price database needs population
if [ ! -f /app/data/price-cache.db ] || [ "$(stat -c%s /app/data/price-cache.db 2>/dev/null || echo 0)" -lt 1000 ]; then
    echo "Price database empty or missing - populating in background..."
    # Run price population in background (uses tsx via node_modules)
    node -e "
      const { spawn } = require('child_process');
      const child = spawn('npx', ['tsx', 'scripts/populate-price-history.ts'], {
        cwd: '/app',
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      console.log('Price population started in background (PID: ' + child.pid + ')');
    " &
else
    echo "Price database exists - checking for updates..."
    # Run daily update in background
    node -e "
      const { spawn } = require('child_process');
      const child = spawn('npx', ['tsx', 'scripts/populate-price-history.ts', 'daily'], {
        cwd: '/app',
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      console.log('Price update started in background (PID: ' + child.pid + ')');
    " &
fi

echo "Starting Next.js server on port ${PORT:-42069}..."
exec node server.js
