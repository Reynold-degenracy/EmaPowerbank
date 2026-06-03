import type { RequestTiming } from "../types";

export const timingSegmentLabels: Record<string, { zh: string; en: string }> = {
  preflightMs: { zh: "预检", en: "Preflight" },
  upstreamSetupMs: { zh: "上游准备", en: "Upstream setup" },
  vertexAccessTokenMs: { zh: "Vertex token", en: "Vertex token" },
  requestTransformMs: { zh: "请求转换", en: "Request transform" },
  upstreamHeadersMs: { zh: "上游首包", en: "Upstream headers" },
  upstreamBodyMs: { zh: "上游响应体", en: "Upstream body" },
  responseTransformMs: { zh: "响应转换", en: "Response transform" },
  downstreamResponseMs: { zh: "客户端响应", en: "Client response" },
  usageBillingMs: { zh: "用量计费", en: "Usage billing" },
  auditLogMs: { zh: "审计写入", en: "Audit write" },
  errorHandlingMs: { zh: "错误处理", en: "Error handling" },
  untrackedMs: { zh: "其他", en: "Other" },
};

const timingSegmentOrder = Object.keys(timingSegmentLabels);

const timingSegmentColors: Record<string, string> = {
  preflightMs: "#7aa2d8",
  upstreamSetupMs: "#7ab8ad",
  vertexAccessTokenMs: "#a58acb",
  requestTransformMs: "#d4a56f",
  upstreamHeadersMs: "#76aac2",
  upstreamBodyMs: "#8bbf8f",
  responseTransformMs: "#c9a36f",
  downstreamResponseMs: "#cf8fa8",
  usageBillingMs: "#8f9ed8",
  auditLogMs: "#9aa4b2",
  errorHandlingMs: "#d58b86",
  untrackedMs: "#b4bbc6",
};

export function sortedTimingEntries(timing: RequestTiming | null | undefined) {
  if (!timing) return [];
  const entries = Object.entries(timing.segments || {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort(([left], [right]) => {
      const leftIndex = timingSegmentOrder.indexOf(left);
      const rightIndex = timingSegmentOrder.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  const segmentTotal = entries.reduce((total, [, value]) => total + Number(value || 0), 0);
  const untracked = Math.max(Number(timing.totalMs || 0) - segmentTotal, 0);
  if (untracked > 0.5) {
    entries.push(["untrackedMs", Number(untracked.toFixed(2))]);
  }
  return entries;
}

export function timingSegmentColor(key: string) {
  return timingSegmentColors[key] || "#b4bbc6";
}
