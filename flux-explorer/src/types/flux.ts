// Node Types
export interface FluxNode {
  id: string;
  ip: string;
  tier: "CUMULUS" | "NIMBUS" | "STRATUS";
  status: "active" | "inactive" | "suspended";
  addedHeight: number;
  confirmedHeight: number;
  lastPaidHeight: number;
  collateral: string;
  rank: number;
  payment_address: string;
  pubkey: string;
  activesince: string;
  lastpaid: string;
  amount: string;
}

// Network Stats
export interface NetworkStats {
  totalNodes: number;
  activeNodes: number;
  cumulusNodes: number;
  nimbusNodes: number;
  stratusNodes: number;
  totalCollateral: string;
  avgUptime: number;
  networkHashrate: string;
}

// Benchmark Types
export interface BenchmarkResult {
  nodeId: string;
  timestamp: string;
  cpuScore: number;
  ramScore: number;
  diskScore: number;
  overallScore: number;
  tier: string;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  status: "success" | "error";
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
