import type { RequestLogSummary, SegmentKey, SegmentParts, UsageRow } from "../types";

export const emptyStats: UsageRow = {
  requestCount: 0,
  successCount: 0,
  cachedContentTokenCount: 0,
  promptTokenCount: 0,
  thoughtsTokenCount: 0,
  candidatesTokenCount: 0,
  billableCharacterCount: 0,
  cost: 0,
  totalCost: 0,
  todayCost: 0,
  cachedCost: 0,
  uncachedCost: 0,
  outputCost: 0,
  embeddingCost: 0,
};

export const chartColors: Record<SegmentKey, string> = {
  embedding: "#bfdbfe",
  cached: "#60a5fa",
  uncached: "#2563eb",
  output: "#1e3a8a",
};

export const chartDepth: Record<SegmentKey, number> = {
  embedding: 1,
  cached: 2,
  uncached: 3,
  output: 4,
};

export function usageParts(row: UsageRow = {}): SegmentParts {
  const cached = Number(row.cachedContentTokenCount || 0);
  const prompt = Number(row.promptTokenCount || 0);
  const thoughts = Number(row.thoughtsTokenCount || 0);
  const candidates = Number(row.candidatesTokenCount || 0);
  return {
    cached,
    uncached: Math.max(prompt - cached, 0),
    output: thoughts + candidates,
    embedding: Number(row.billableCharacterCount || 0),
  };
}

export function rawCostParts(row: UsageRow = {}): SegmentParts {
  return {
    cached: Number(row.cachedCost || 0),
    uncached: Number(row.uncachedCost || 0),
    output: Number(row.outputCost || 0),
    embedding: Number(row.embeddingCost || 0),
  };
}

export function costParts(row: UsageRow = {}): SegmentParts {
  const parts = rawCostParts(row);
  const componentTotal = parts.cached + parts.uncached + parts.output + parts.embedding;
  const recordedTotal = Number(row.cost || 0);
  if (componentTotal === 0 && recordedTotal > 0) {
    return { ...parts, output: recordedTotal };
  }
  return parts;
}

export function sumParts(parts: Record<string, number>) {
  return Object.values(parts).reduce((acc, value) => acc + Number(value || 0), 0);
}

export function aggregateDailyRows(rows: UsageRow[] = []): UsageRow[] {
  const byDate = new Map<string, UsageRow>();
  for (const row of rows) {
    const date = row.date || "";
    if (!date) continue;
    const existing = byDate.get(date) || {
      date,
      requestCount: 0,
      successCount: 0,
      cachedContentTokenCount: 0,
      promptTokenCount: 0,
      thoughtsTokenCount: 0,
      candidatesTokenCount: 0,
      billableCharacterCount: 0,
      cost: 0,
      cachedCost: 0,
      uncachedCost: 0,
      outputCost: 0,
      embeddingCost: 0,
    };
    existing.requestCount = Number(existing.requestCount || 0) + Number(row.requestCount || 0);
    existing.successCount = Number(existing.successCount || 0) + Number(row.successCount || 0);
    existing.cachedContentTokenCount = Number(existing.cachedContentTokenCount || 0) + Number(row.cachedContentTokenCount || 0);
    existing.promptTokenCount = Number(existing.promptTokenCount || 0) + Number(row.promptTokenCount || 0);
    existing.thoughtsTokenCount = Number(existing.thoughtsTokenCount || 0) + Number(row.thoughtsTokenCount || 0);
    existing.candidatesTokenCount = Number(existing.candidatesTokenCount || 0) + Number(row.candidatesTokenCount || 0);
    existing.billableCharacterCount = Number(existing.billableCharacterCount || 0) + Number(row.billableCharacterCount || 0);
    existing.cost = Number(existing.cost || 0) + Number(row.cost || 0);
    existing.cachedCost = Number(existing.cachedCost || 0) + Number(row.cachedCost || 0);
    existing.uncachedCost = Number(existing.uncachedCost || 0) + Number(row.uncachedCost || 0);
    existing.outputCost = Number(existing.outputCost || 0) + Number(row.outputCost || 0);
    existing.embeddingCost = Number(existing.embeddingCost || 0) + Number(row.embeddingCost || 0);
    byDate.set(date, existing);
  }
  return [...byDate.values()].sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

export function outputTokens(row: UsageRow = {}) {
  return Number(row.thoughtsTokenCount || 0) + Number(row.candidatesTokenCount || 0);
}

export function requestLogUsage(log: RequestLogSummary) {
  return Number(log.cachedContentTokenCount || 0)
    + Math.max(Number(log.promptTokenCount || 0) - Number(log.cachedContentTokenCount || 0), 0)
    + Number(log.thoughtsTokenCount || 0)
    + Number(log.candidatesTokenCount || 0)
    + Number(log.billableCharacterCount || 0);
}
