# FluxIndexer

A custom blockchain indexer built specifically for **Flux v9.0.0+** with **Proof of Node (PoN)** consensus.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)](https://www.postgresql.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com/)

## Why FluxIndexer?

Flux v9.0.0 introduces a **hard fork** with major changes:
- ️ **PoW mining discontinued** →  **PoN (Proof of Node)** consensus
- ⏱️ **30-second block times** (was 2 minutes)
- ️ **FluxNodes produce blocks** instead of miners

**Traditional indexers like FluxIndexer:**
- Built for PoW chains
- Pending PR for v9.0.0 support
- Lack PoN-specific features (FluxNode producer tracking)

**FluxIndexer is:**
-  Built specifically for PoN Flux
-  Tracks FluxNode block producers
-  Optimized for 30-second blocks
-  FluxIndexer-compatible API
-  No external dependencies

---

## Features

### Core Blockchain Indexing
-  Full block indexing with transaction details
-  UTXO tracking (unspent transaction outputs)
-  Address balance calculations
-  Transaction history
-  Mempool monitoring
-  Reorg handling (up to 100 blocks deep)

### PoN-Specific Features
-  **FluxNode producer tracking** - Which node produced which block
-  **Producer statistics** - Blocks produced, rewards earned, performance
-  **Producer leaderboard** - Top block producers
-  **Block production analytics** - Time between blocks, distribution

### API
-  **FluxIndexer-compatible** REST API
-  Block queries (by height or hash)
-  Transaction lookups
-  Address balance and history
-  UTXO queries
-  FluxNode producer endpoints
-  Sync status and health checks

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FluxIndexer Stack                     │
│                                                          │
│  ┌──────────────┐      ┌──────────────┐      ┌────────┐ │
│  │  Flux Daemon │──────▶│ FluxIndexer  │──────▶│  REST  │ │
│  │   v9.0.0+    │  RPC │   Service    │  API  │  API   │ │
│  │   (PoN)      │      │              │       │        │ │
│  └──────────────┘      └──────┬───────┘      └────────┘ │
│                               │                          │
│                               ▼                          │
│                       ┌──────────────┐                   │
│                       │  PostgreSQL  │                   │
│                       │   Database   │                   │
│                       └──────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

### Components

1. **Flux RPC Client** - Communicates with Flux daemon v9.0.0+
2. **Sync Engine** - Indexes blocks continuously, handles reorgs
3. **Block Indexer** - Parses blocks, transactions, UTXOs
4. **Database Layer** - PostgreSQL with optimized indexes
5. **API Server** - FluxIndexer-compatible REST API

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Flux daemon v9.0.0+ running with RPC enabled

### Installation

```bash
# Clone repository
cd flux-indexer

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

### Docker Quick Start

```bash
# Copy environment file
cp .env.example .env

# Edit .env with your Flux RPC credentials
# FLUX_RPC_URL=http://your-flux-daemon:16124
# FLUX_RPC_USER=your_rpc_user
# FLUX_RPC_PASSWORD=your_rpc_password

# Start with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f indexer

# Check health
curl http://127.0.0.1:42067/health
```

#### Zcash Parameters

FluxIndexer automatically downloads Zcash cryptographic parameters (~900MB) on first run:
- `sapling-spend.params` (~46 MB)
- `sapling-output.params` (~3.4 MB)
- `sprout-groth16.params` (~692 MB)

**Parameters are persisted** in a Docker volume and only downloaded once.

**Optional: Use existing params** (if you already have them from FluxIndexer or other Zcash software):

```bash
# Copy the example override file
cp docker-compose.override.yml.example docker-compose.override.yml

# Edit to point to your local params directory
# Then start normally
docker-compose up -d
```

This avoids re-downloading the parameters.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **Flux RPC** |
| `FLUX_RPC_URL` | Yes | `http://127.0.0.1:16124` | Flux daemon RPC endpoint |
| `FLUX_RPC_USER` | No | - | RPC username (if auth enabled) |
| `FLUX_RPC_PASSWORD` | No | - | RPC password (if auth enabled) |
| **Database** |
| `DB_HOST` | Yes | `127.0.0.1` | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | Yes | `fluxindexer` | Database name |
| `DB_USER` | Yes | `flux` | Database user |
| `DB_PASSWORD` | Yes | - | Database password |
| **Indexer** |
| `INDEXER_BATCH_SIZE` | No | `100` | Blocks to index per batch |
| `INDEXER_POLLING_INTERVAL` | No | `5000` | Polling interval (ms) |
| `INDEXER_START_HEIGHT` | No | - | Start indexing from height |
| `INDEXER_MAX_REORG_DEPTH` | No | `100` | Max reorg depth to handle |
| **API** |
| `API_PORT` | No | `42067` | API server port |
| `API_HOST` | No | `0.0.0.0` | API server host |

---

## API Endpoints

### Status

```bash
# Indexer + daemon status
GET /api/v1/status

# Sync progress
GET /api/v1/sync
```

### Blocks

```bash
# Latest block summaries
GET /api/v1/blocks/latest

# Recent block list (paged)
GET /api/v1/blocks

# Block by height or hash
GET /api/v1/blocks/:heightOrHash
```

### Transactions

```bash
# Transaction by txid
GET /api/v1/transactions/:txid
```

### Addresses

```bash
# Summary + balances
GET /api/v1/addresses/:address

# Paginated transaction history
GET /api/v1/addresses/:address/transactions

# UTXO list
GET /api/v1/addresses/:address/utxos
```

### Stats & Network Data

```bash
# Rich list + supply
GET /api/v1/richlist
GET /api/v1/supply

# Producers & FluxNodes
GET /api/v1/producers
GET /api/v1/producers/:identifier
GET /api/v1/nodes
GET /api/v1/nodes/:ip

# Network / mempool / dashboard
GET /api/v1/network
GET /api/v1/mempool
GET /api/v1/stats/dashboard
```

### Response Examples

**Status:**
```json
{
  "fluxindexer": {
    "coin": "Flux",
    "version": "1.0.0",
    "bestHeight": 2500000,
    "inSync": true,
    "consensus": "PoN"
  },
  "backend": {
    "chain": "main",
    "blocks": 2500000,
    "bestBlockHash": "abc123..."
  }
}
```

**Block:**
```json
{
  "height": 2500000,
  "hash": "abc123...",
  "time": 1729513200,
  "txCount": 15,
  "producer": "192.168.1.100",
  "producerReward": "7.5",
  "txs": [...]
}
```

**Producer:**
```json
{
  "fluxnode": "192.168.1.100",
  "blocksProduced": 1250,
  "totalRewards": "9375.00",
  "firstBlock": 2400000,
  "lastBlock": 2500000
}
```

---

## Database Schema

### Tables

- **blocks** - Indexed blocks with PoN producer info
- **transactions** - All transactions
- **utxos** - UTXO set (spent and unspent)
- **address_summary** - Cached address balances
- **producers** - FluxNode producer statistics
- **sync_state** - Indexer synchronization state
- **reorgs** - Blockchain reorganization history

### Performance

- Optimized indexes for fast queries
- Address balance materialized view
- Transaction pagination support
- UTXO spent/unspent tracking

---

## Development

### Project Structure

```
flux-indexer/
├── src/
│   ├── api/              # REST API server
│   ├── database/         # Database layer
│   │   ├── connection.ts
│   │   ├── migrate.ts
│   │   └── schema.sql
│   ├── indexer/          # Core indexing logic
│   │   ├── block-indexer.ts
│   │   └── sync-engine.ts
│   ├── rpc/              # Flux RPC client
│   │   └── flux-rpc-client.ts
│   ├── types/            # TypeScript types
│   │   └── index.ts
│   ├── utils/            # Utilities
│   │   └── logger.ts
│   ├── config.ts         # Configuration
│   └── index.ts          # Main entry point
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

### Scripts

```bash
# Development
npm run dev              # Start with auto-reload
npm run build            # Build TypeScript
npm start                # Run production build

# Database
npm run db:migrate       # Run migrations
npm run db:reset         # Reset database (caution!)

# Testing
npm test                 # Run tests
```

---

## Deployment

### Docker

```bash
# Build image
docker build -t fluxindexer:latest .

# Run container
docker run -d \
  --name fluxindexer \
  -p 42067:42067 \
  -e FLUX_RPC_URL=http://flux-daemon:16124 \
  -e DB_HOST=postgres \
  -e DB_PASSWORD=your_password \
  fluxindexer:latest
```

### Flux Cloud

For deployment on Flux cloud platform:

**Component Spec:**
```json
{
  "name": "indexer",
  "description": "Flux blockchain indexer",
  "repotag": "yourusername/fluxindexer:latest",
  "port": 42067,
  "containerPort": 42067,
  "environmentParameters": [
    "FLUX_RPC_URL=http://fluxdaemon_yourappname:16124",
    "DB_HOST=postgres_yourappname",
    "DB_NAME=fluxindexer",
    "DB_USER=flux",
    "DB_PASSWORD=your_password",
    "INDEXER_BATCH_SIZE=100",
    "LOG_LEVEL=info"
  ],
  "containerData": "/home/flux/.flux",
  "cpu": 4.0,
  "ram": 4096,
  "hdd": 200
}
```

**Note:** Ensure PostgreSQL and Flux daemon components are deployed first.

---

## Monitoring

### Health Check

```bash
curl http://127.0.0.1:42067/health
# Returns: {"status":"ok","timestamp":"2025-10-21T..."}
```

### Sync Status

```bash
curl http://127.0.0.1:42067/api/v1/sync
```

```json
{
  "currentHeight": 2500000,
  "chainHeight": 2500100,
  "percentage": 99.96,
  "isSyncing": true,
  "lastSyncTime": "2025-10-21T14:30:00Z"
}
```

### Logs

```bash
# Docker
docker-compose logs -f indexer

# Native
tail -f /var/log/fluxindexer.log  # if LOG_FILE is set
```

---

## Performance

### Sync Speed

- **Initial sync:** Optimized blockchain synchronization (depends on hardware)
- **Real-time sync:** Keeps up with 30-second blocks easily
- **Database size:** ~260GB current size (grows continuously as new blocks are indexed)

### Resource Requirements

**FluxIndexer (includes Flux daemon):**
- CPU: 4 cores
- RAM: 4 GB
- Storage: 200 GB (~45GB blockchain + Zcash params)

**PostgreSQL Database:**
- CPU: 2 cores
- RAM: 20 GB
- Storage: 400 GB (~260GB current database size, grows over time)

**Note:** These are production-grade specifications from the Flux deployment spec. The database size grows continuously as new blocks are indexed.

---

## Troubleshooting

### Indexer won't start

**Check RPC connection:**
```bash
curl -u user:pass http://127.0.0.1:16124 \
  -d '{"method":"getblockcount","params":[],"id":1}'
```

**Check database:**
```bash
psql -h 127.0.0.1 -U flux -d fluxindexer -c "SELECT * FROM sync_state;"
```

### Sync is slow

- Increase `INDEXER_BATCH_SIZE` (try 200-500)
- Check database performance (add indexes if needed)
- Ensure SSD storage for database
- Increase PostgreSQL `shared_buffers` and `work_mem`

### Reorg detected

- Check logs for reorg details
- Indexer automatically handles reorgs up to `MAX_REORG_DEPTH` (default 100)
- Deep reorgs may require manual intervention

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## License

MIT License

---

## Acknowledgments

- Built for [Flux](https://runonflux.io/) blockchain network
- Crafted specifically for FluxIndexer API v1
- PostgreSQL for reliable data storage

---

## Support

- **Issues:** https://github.com/Sikbik/flux-blockchain-explorer/issues
- **Flux Discord:** https://discord.com/invite/runonflux

---
