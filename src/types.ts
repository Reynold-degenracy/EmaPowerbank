export type ThemeMode = "system" | "light" | "dark";
export type SegmentKey = "embedding" | "cached" | "uncached" | "output";
export type Numberish = number | string | null | undefined;
export type SegmentParts = Record<SegmentKey, number>;
export type ReloadFn = () => Promise<void> | void;

export interface UsageRow {
  date?: string;
  modelId?: string;
  requestCount?: Numberish;
  successCount?: Numberish;
  cachedContentTokenCount?: Numberish;
  promptTokenCount?: Numberish;
  thoughtsTokenCount?: Numberish;
  candidatesTokenCount?: Numberish;
  billableCharacterCount?: Numberish;
  cost?: Numberish;
  totalCost?: Numberish;
  todayCost?: Numberish;
  cachedCost?: Numberish;
  uncachedCost?: Numberish;
  outputCost?: Numberish;
  embeddingCost?: Numberish;
}

export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  balance: number;
  totalSpent?: number;
  createdAt?: string;
}

export interface ApiKey {
  id: number;
  name: string;
  key: string | null;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

export interface AvailableModel {
  modelId: string;
  inputPrice: number;
  outputPrice: number;
  cachePrice: number;
  embeddingInputPrice: number;
}

export interface UsageSummary {
  requestCount: number;
  successCount: number;
  totalCost: number;
  todayCost: number;
  successRate: number;
}

export interface Overview {
  user: User;
  apiKeys: ApiKey[];
  dailyStats?: UsageRow[];
  dailyModelStats?: UsageRow[];
  modelStats?: UsageRow[];
  usageSummary?: UsageSummary;
  availableModels?: AvailableModel[];
  recentUsage?: unknown[];
}

export interface ProviderInfo {
  mode?: "ai_studio" | "vertex";
  location?: string;
  projectId?: string;
  configured?: boolean;
  keyPreview?: string;
  updatedAt?: string;
}

export interface PricingItem extends AvailableModel {
  id: number;
  updatedAt?: string;
}

export interface AdminData {
  users?: User[];
  provider?: ProviderInfo | null;
  pricing?: PricingItem[];
  dailyStats?: UsageRow[];
  dailyModelStats?: UsageRow[];
  modelStats?: UsageRow[];
  totals?: UsageRow;
}

export interface RequestLogSummary {
  id: number;
  userId: number;
  username: string;
  apiKeyId?: number | null;
  apiKeyPrefix?: string | null;
  modelId?: string | null;
  endpoint: string;
  requestPath: string;
  usageDate: string;
  statusCode: number;
  cachedContentTokenCount: number;
  promptTokenCount: number;
  thoughtsTokenCount: number;
  candidatesTokenCount: number;
  billableCharacterCount: number;
  cost: number;
  durationMs?: number;
  timing?: RequestTiming | null;
  auditFileName: string;
  createdAt: string;
}

export interface RequestLogListResponse {
  logs?: RequestLogSummary[];
  users?: User[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
}

export interface RequestLogDetailPayload {
  timestamp?: string;
  userId?: number;
  apiKeyId?: number;
  provider?: Record<string, unknown>;
  upstreamUrl?: string | null;
  request?: {
    method?: string;
    path?: string;
    headers?: unknown;
    body?: unknown;
  };
  response?: {
    statusCode?: number;
    body?: unknown;
    error?: unknown;
  };
  billing?: {
    usage?: unknown;
    cost?: Numberish;
  };
  timing?: RequestTiming | null;
}

export interface RequestTiming {
  totalMs: number;
  segments: Record<string, number>;
}

export interface RequestLogDetailResponse {
  log: RequestLogSummary;
  detail: RequestLogDetailPayload | null;
  raw?: string;
}

export interface RequestLogDetailState {
  loading?: boolean;
  error?: string;
  detail?: RequestLogDetailPayload | null;
  raw?: string;
}

export interface FeedbackSubmitResponse {
  feedback: {
    id: string;
    timestamp: string;
    packageName: string;
    attachment?: {
      fileName: string;
      originalName: string;
      mimeType: string;
      size: number;
    };
  };
}
