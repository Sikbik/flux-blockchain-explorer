#!/bin/sh
set -e

echo "FluxIndexer container starting..."

# Create log directory
mkdir -p /var/log/supervisor

# Generate flux.conf directly
echo "Configuring Flux daemon..."
# Set defaults
FLUX_RPC_USER=${FLUX_RPC_USER:-fluxrpc}
FLUX_RPC_PASSWORD=${FLUX_RPC_PASSWORD:-fluxrpc2024}

# Write config file directly
cat > /home/flux/.flux/flux.conf << EOF
server=1
rpcuser=${FLUX_RPC_USER}
rpcpassword=${FLUX_RPC_PASSWORD}
rpcport=16124
rpcallowip=127.0.0.1
rpcallowip=172.0.0.0/8
rpcallowip=::1
addressindex=1
timestampindex=1
spentindex=1
txindex=0
dbcache=1024
maxmempool=512
listen=0
listenonion=0
printtoconsole=1
logips=1
logtimestamps=1
disablewallet=1
rpcwarmup=1
EOF

# Set proper permissions
chown -R flux:flux /home/flux/.flux

# Setup Zcash parameters (pre-downloaded during Docker build or download if missing)
ZCASH_PARAMS_DIR="/home/flux/.zcash-params"
mkdir -p "$ZCASH_PARAMS_DIR"

# Copy pre-downloaded params from build stage if they exist
if [ -d "/root/.zcash-params" ] && [ "$(ls -A /root/.zcash-params 2>/dev/null)" ]; then
  echo "Copying pre-downloaded Zcash parameters from build stage..."
  cp -r /root/.zcash-params/* "$ZCASH_PARAMS_DIR/"
  chown -R flux:flux "$ZCASH_PARAMS_DIR"
fi

# Expected minimum file sizes (in bytes) to validate downloads
SAPLING_SPEND_MIN=47958396    # ~46MB
SAPLING_OUTPUT_MIN=3592860    # ~3.4MB
SPROUT_GROTH16_MIN=725523612  # ~692MB

# Function to check if file exists and has correct size
check_param_file() {
  local file="$1"
  local min_size="$2"

  if [ ! -f "$file" ]; then
    return 1
  fi

  local actual_size=$(stat -c%s "$file" 2>/dev/null || echo "0")
  if [ "$actual_size" -lt "$min_size" ]; then
    echo "  WARNING: $file is incomplete (${actual_size} bytes, expected at least ${min_size} bytes)"
    rm -f "$file"
    return 1
  fi

  return 0
}

# Check if all parameters are present and valid
need_download=0
check_param_file "$ZCASH_PARAMS_DIR/sapling-spend.params" "$SAPLING_SPEND_MIN" || need_download=1
check_param_file "$ZCASH_PARAMS_DIR/sapling-output.params" "$SAPLING_OUTPUT_MIN" || need_download=1
check_param_file "$ZCASH_PARAMS_DIR/sprout-groth16.params" "$SPROUT_GROTH16_MIN" || need_download=1

if [ "$need_download" -eq 1 ]; then
  echo "Downloading Zcash parameters (first time only, ~900MB)..."
  echo "This may take several minutes depending on your connection..."

  cd "$ZCASH_PARAMS_DIR"

  # Download with retry logic from Flux official mirror (files are split into .part.1 and .part.2)
  download_with_retry() {
    local filename="$1"
    local base_url="https://download.runonflux.io/downloads"

    echo "  - Downloading $filename from Flux mirror..."

    # Download part 1
    echo "    Downloading part 1..."
    if ! wget --timeout=120 --tries=5 --progress=dot:giga --continue --retry-connrefused --waitretry=3 \
         -O "${filename}.part.1" "${base_url}/${filename}.part.1"; then
      echo "    Failed to download part 1"
      return 1
    fi

    # Download part 2
    echo "    Downloading part 2..."
    if ! wget --timeout=120 --tries=5 --progress=dot:giga --continue --retry-connrefused --waitretry=3 \
         -O "${filename}.part.2" "${base_url}/${filename}.part.2"; then
      echo "    Failed to download part 2"
      return 1
    fi

    # Concatenate parts
    echo "    Combining parts..."
    cat "${filename}.part.1" "${filename}.part.2" > "${filename}"
    rm -f "${filename}.part.1" "${filename}.part.2"

    return 0
  }

  if ! check_param_file "sapling-spend.params" "$SAPLING_SPEND_MIN"; then
    download_with_retry "sapling-spend.params" || {
      echo "ERROR: Failed to download sapling-spend.params from all mirrors"
      echo "Please check your network connection and try again"
      exit 1
    }
  fi

  if ! check_param_file "sapling-output.params" "$SAPLING_OUTPUT_MIN"; then
    download_with_retry "sapling-output.params" || {
      echo "ERROR: Failed to download sapling-output.params from all mirrors"
      exit 1
    }
  fi

  if ! check_param_file "sprout-groth16.params" "$SPROUT_GROTH16_MIN"; then
    download_with_retry "sprout-groth16.params" || {
      echo "ERROR: Failed to download sprout-groth16.params from all mirrors"
      exit 1
    }
  fi

  chown -R flux:flux "$ZCASH_PARAMS_DIR"
  echo "Zcash parameters downloaded and validated successfully!"
else
  echo "Zcash parameters already present and validated, skipping download."
fi

# Bootstrap handling
# Support two bootstrap types:
# 1. BOOTSTRAP_URL: Flux blockchain bootstrap (blocks/chainstate)
# 2. DB_BOOTSTRAP_URL: PostgreSQL database dump bootstrap
FLUX_DATA_DIR="/home/flux/.flux"

if [ -n "$BOOTSTRAP_URL" ]; then
  echo "Bootstrap URL provided: $BOOTSTRAP_URL"

  # Check if blockchain data already exists
  if [ -d "$FLUX_DATA_DIR/blocks" ] && [ "$(ls -A $FLUX_DATA_DIR/blocks 2>/dev/null)" ]; then
    echo "Blockchain data already exists. Skipping bootstrap download."
    echo "To force bootstrap, clear the volume or set FORCE_BOOTSTRAP=true"

    if [ "$FORCE_BOOTSTRAP" = "true" ]; then
      echo "FORCE_BOOTSTRAP=true detected. Clearing existing blockchain data..."
      rm -rf "$FLUX_DATA_DIR/blocks" "$FLUX_DATA_DIR/chainstate" "$FLUX_DATA_DIR/database"
    else
      echo "Proceeding with existing blockchain data."
    fi
  fi

  # Download and extract bootstrap if needed
  if [ ! -d "$FLUX_DATA_DIR/blocks" ] || [ -z "$(ls -A $FLUX_DATA_DIR/blocks 2>/dev/null)" ]; then
    echo "Downloading blockchain bootstrap from $BOOTSTRAP_URL..."
    echo "This may take a while depending on file size and network speed..."

    cd /tmp

    # Detect file extension for proper extraction
    case "$BOOTSTRAP_URL" in
      *.tar.gz|*.tgz)
        echo "Detected tar.gz format"
        if wget --timeout=0 --tries=3 --no-check-certificate -q --show-progress -O bootstrap.tar.gz "$BOOTSTRAP_URL"; then
          echo "Extracting blockchain bootstrap..."
          tar -xzf bootstrap.tar.gz -C "$FLUX_DATA_DIR"
          rm -f bootstrap.tar.gz
          chown -R flux:flux "$FLUX_DATA_DIR"
          echo "Blockchain bootstrap extracted successfully!"
        else
          echo "ERROR: Failed to download blockchain bootstrap from $BOOTSTRAP_URL"
          echo "Continuing with normal sync from genesis..."
        fi
        ;;
      *.zip)
        echo "Detected zip format"
        if wget --timeout=0 --tries=3 --no-check-certificate -q --show-progress -O bootstrap.zip "$BOOTSTRAP_URL"; then
          echo "Extracting blockchain bootstrap..."
          unzip -q bootstrap.zip -d "$FLUX_DATA_DIR"
          rm -f bootstrap.zip
          chown -R flux:flux "$FLUX_DATA_DIR"
          echo "Blockchain bootstrap extracted successfully!"
        else
          echo "ERROR: Failed to download blockchain bootstrap"
          echo "Continuing with normal sync from genesis..."
        fi
        ;;
      *)
        echo "WARNING: Unknown bootstrap format. Supported: .tar.gz, .tgz, .zip"
        echo "Continuing with normal sync from genesis..."
        ;;
    esac
  fi
fi

# Database bootstrap handling
if [ -n "$DB_BOOTSTRAP_URL" ]; then
  echo "Database bootstrap URL provided: $DB_BOOTSTRAP_URL"

  # Wait for PostgreSQL to be ready
  echo "Waiting for PostgreSQL to be ready..."
  max_attempts=30
  attempt=0
  while ! pg_isready -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-fluxindexer}" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -ge $max_attempts ]; then
      echo "WARNING: PostgreSQL not ready after ${max_attempts} attempts. Skipping DB bootstrap."
      break
    fi
    echo "  PostgreSQL not ready yet, waiting... (attempt $attempt/$max_attempts)"
    sleep 2
  done

  if pg_isready -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-fluxindexer}" >/dev/null 2>&1; then
    # Check if database is already populated with DATA (not just schema)
    # Check if blocks table exists and has data
    block_count=$(PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-fluxindexer}" -d "${DB_NAME:-fluxindexer}" -t -c "SELECT COUNT(*) FROM blocks;" 2>/dev/null | tr -d ' ' || echo "0")

    if [ "$block_count" -gt 0 ] && [ "$FORCE_BOOTSTRAP" != "true" ]; then
      echo "Database already populated with $block_count blocks. Skipping DB bootstrap."
      echo "To force DB bootstrap, set FORCE_BOOTSTRAP=true"
    else
      echo "Downloading database bootstrap from $DB_BOOTSTRAP_URL..."

      cd /tmp

      # Detect file format from URL
      if echo "$DB_BOOTSTRAP_URL" | grep -q '\.pgdump$'; then
        # PostgreSQL custom format dump - use pg_restore
        echo "Detected PostgreSQL custom format dump (.pgdump)"
        if wget --timeout=0 --tries=3 --no-check-certificate -q --show-progress -O db_bootstrap.pgdump "$DB_BOOTSTRAP_URL"; then
          echo "Restoring database from custom format dump..."
          PGPASSWORD="${DB_PASSWORD}" pg_restore \
            --host="${DB_HOST:-postgres}" \
            --port="${DB_PORT:-5432}" \
            --username="${DB_USER:-fluxindexer}" \
            --dbname="${DB_NAME:-fluxindexer}" \
            --clean \
            --if-exists \
            --no-owner \
            --no-acl \
            --verbose \
            db_bootstrap.pgdump
          rm -f db_bootstrap.pgdump
          echo "Database bootstrap restored successfully!"
        else
          echo "ERROR: Failed to download database bootstrap from $DB_BOOTSTRAP_URL"
          echo "Continuing with empty database (migrations will run)..."
        fi
      elif echo "$DB_BOOTSTRAP_URL" | grep -q '\.sql\.gz$'; then
        # Gzipped SQL dump - decompress and pipe to psql
        echo "Detected gzipped SQL dump (.sql.gz)"
        if wget --timeout=0 --tries=3 --no-check-certificate -q --show-progress -O db_bootstrap.sql.gz "$DB_BOOTSTRAP_URL"; then
          echo "Restoring database from SQL dump..."
          gunzip -c db_bootstrap.sql.gz | PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-fluxindexer}" -d "${DB_NAME:-fluxindexer}"
          rm -f db_bootstrap.sql.gz
          echo "Database bootstrap restored successfully!"
        else
          echo "ERROR: Failed to download database bootstrap from $DB_BOOTSTRAP_URL"
          echo "Continuing with empty database (migrations will run)..."
        fi
      else
        # Unknown format
        echo "ERROR: Unsupported database bootstrap format. Expected .pgdump or .sql.gz"
        echo "Continuing with empty database (migrations will run)..."
      fi
    fi
  fi
fi

# Display configuration info
echo "Flux daemon configuration:"
echo "  RPC Port: 16124"
echo "  RPC User: ${FLUX_RPC_USER:-fluxrpc}"
echo "  Data directory: /home/flux/.flux"
echo ""
echo "FluxIndexer configuration:"
echo "  API Port: ${API_PORT:-3002}"
echo "  Database: ${DB_HOST:-postgres}:${DB_PORT:-5432}"
echo "  Flux RPC: http://localhost:16124"
echo ""

# Start supervisord
echo "Starting services (fluxd + fluxindexer)..."
exec /usr/bin/supervisord -n -c /etc/supervisord.conf
