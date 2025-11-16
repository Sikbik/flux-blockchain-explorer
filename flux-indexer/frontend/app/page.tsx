'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Database,
  Server,
  Zap,
  HardDrive,
  Clock,
  Users,
  Blocks,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react'

interface IndexerStatus {
  name: string
  version: string
  network: string
  consensus: string
  indexer: {
    syncing: boolean
    synced: boolean
    currentHeight: number
    chainHeight: number
    progress: string
    blocksIndexed?: number
    transactionsIndexed?: number
    lastSyncTime?: string
  }
  daemon: {
    version: string
    protocolVersion: number
    blocks: number
    headers: number
    bestBlockHash: string
    difficulty: number
    chainwork: string
    consensus: string
    connections: number
    networkActive: boolean
  }
  timestamp: string
  uptime: number
}

interface SyncStatusResponse {
  indexer: {
    syncing: boolean
    synced: boolean
    currentHeight: number
    chainHeight: number
    progress: string
    percentage: number
    lastSyncTime: string
  }
  timestamp: string
}

interface ProducerStats {
  totalProducers: number
  producers: Array<{
    fluxnode: string
    blocksProduced: number
    totalRewards: string
  }>
}

export default function Dashboard() {
  const [status, setStatus] = useState<IndexerStatus | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null)
  const [producers, setProducers] = useState<ProducerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Use relative URL when served from same origin (bundled), or env var for development
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, syncRes, producersRes] = await Promise.all([
          fetch(`${apiUrl}/api/v1/status`),
          fetch(`${apiUrl}/api/v1/sync`),
          fetch(`${apiUrl}/api/v1/producers?limit=5`),
        ])

        if (statusRes.ok) {
          const statusData = await statusRes.json()
          setStatus(statusData)
        }

        if (syncRes.ok) {
          const syncData = await syncRes.json()
          setSyncStatus(syncData)
        }

        if (producersRes.ok) {
          const producersData = await producersRes.json()
          setProducers(producersData)
        }

        setLoading(false)
      } catch (err) {
        setError('Failed to connect to FluxIndexer API')
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 10000) // Refresh every 10s

    return () => clearInterval(interval)
  }, [apiUrl])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading FluxIndexer Dashboard...</p>
        </div>
      </div>
    )
  }

  if (error || !status) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Connection Error
            </CardTitle>
            <CardDescription>{error || 'Unable to connect to FluxIndexer'}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Make sure FluxIndexer is running on {apiUrl}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const syncPercentage = syncStatus?.indexer.percentage || 0
  const isSynced = status?.indexer.synced || false

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600 bg-clip-text text-transparent">
                FluxIndexer Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">
                Monitoring Flux Blockchain Indexer v{status.version}
              </p>
            </div>
            <Badge variant={isSynced ? "success" : "warning"} className="text-sm px-3 py-1">
              {isSynced ? (
                <><CheckCircle2 className="h-4 w-4 mr-1" /> Synced</>
              ) : (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Syncing...</>
              )}
            </Badge>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Sync Progress */}
        {!isSynced && syncStatus && (
          <Card className="mb-6 border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg">Synchronization Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-mono">{syncPercentage.toFixed(2)}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600 transition-all duration-500"
                    style={{ width: `${syncPercentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Block {syncStatus.indexer.currentHeight.toLocaleString()}</span>
                  <span>of {syncStatus.indexer.chainHeight.toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Current Height */}
          <Card className="border-primary/5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500" />
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Current Height
                </CardTitle>
                <Blocks className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {status.indexer.currentHeight.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Indexed blocks
              </p>
            </CardContent>
          </Card>

          {/* Chain Height */}
          <Card className="border-primary/5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-pink-500" />
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Chain Height
                </CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {status.daemon.blocks.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Daemon blocks
              </p>
            </CardContent>
          </Card>

          {/* Consensus */}
          <Card className="border-primary/5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-red-500" />
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Consensus
                </CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {status.consensus}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Proof of Node
              </p>
            </CardContent>
          </Card>

          {/* Last Block Time */}
          <Card className="border-primary/5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal-500 to-cyan-500" />
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Last Sync
                </CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {status.indexer.lastSyncTime ? new Date(status.indexer.lastSyncTime).toLocaleTimeString() : 'Never'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {status.indexer.lastSyncTime ? new Date(status.indexer.lastSyncTime).toLocaleDateString() : 'Not synced yet'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* System Info */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Indexer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                Indexer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Version</span>
                <span className="text-sm font-mono">{status.version}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-mono">{status.name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Network</span>
                <span className="text-sm font-mono">{status.network}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={isSynced ? "success" : "warning"}>
                  {isSynced ? "In Sync" : "Syncing"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Daemon Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-accent" />
                Flux Daemon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Version</span>
                <span className="text-sm font-mono">
                  {status.daemon.version || 'v9.0.0'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Protocol</span>
                <span className="text-sm font-mono">
                  {status.daemon.protocolVersion}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Best Block</span>
                <span className="text-sm font-mono truncate max-w-[200px]">
                  {status.daemon.bestBlockHash.slice(0, 16)}...
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Running
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Producers */}
        {producers && producers.producers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Top Block Producers
              </CardTitle>
              <CardDescription>
                Leading FluxNodes producing blocks (PoN)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {producers.producers.map((producer, idx) => (
                  <div
                    key={producer.fluxnode}
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                        #{idx + 1}
                      </div>
                      <div>
                        <p className="font-mono text-sm">{producer.fluxnode}</p>
                        <p className="text-xs text-muted-foreground">
                          Blocks: {producer.blocksProduced.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-bold text-accent">
                        {parseFloat(producer.totalRewards).toFixed(2)} FLUX
                      </p>
                      <p className="text-xs text-muted-foreground">Total Rewards</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            FluxIndexer Dashboard • Updates every 10 seconds • 
            <a href={apiUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-1">
              API Endpoint
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
