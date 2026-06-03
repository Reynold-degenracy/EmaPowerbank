import type { Lang } from "../i18n";
import type { Numberish } from "../types";

type CurrencyFormatOptions = {
  fractionDigits?: number;
  symbol?: string;
};

export function localeFor(lang: Lang) {
  return lang === "zh" ? "zh-CN" : "en-US";
}

export function formatNumber(value: Numberish, lang: Lang) {
  return new Intl.NumberFormat(localeFor(lang)).format(Number(value || 0));
}

export function formatDurationMs(value: Numberish, lang: Lang) {
  const duration = Number(value || 0);
  if (!Number.isFinite(duration) || duration <= 0) return "-";

  if (duration < 1000) {
    const decimals = duration < 10 ? 2 : duration < 100 ? 1 : 0;
    return `${new Intl.NumberFormat(localeFor(lang), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(duration)} ms`;
  }

  return `${new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(duration / 1000)} s`;
}

export function formatCurrency(
  value: Numberish,
  lang: Lang,
  { fractionDigits = 2, symbol = "$" }: CurrencyFormatOptions = {},
) {
  const formatted = new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value || 0));
  return `${symbol}${formatted}`;
}

export function formatStatCurrency(value: Numberish, lang: Lang) {
  return formatCurrency(value, lang, { fractionDigits: 2 });
}

export function formatPreciseCurrency(value: Numberish, lang: Lang) {
  return formatCurrency(value, lang, { fractionDigits: 4 });
}

export function formatCurrencyInputValue(value: Numberish, fractionDigits = 4) {
  return Number(value || 0).toFixed(fractionDigits);
}

export function formatPricePerMillion(value: Numberish, lang: Lang) {
  return `${formatPreciseCurrency(value, lang)}/M`;
}

export function formatMillion(value: Numberish, lang: Lang) {
  return `${new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0) / 1_000_000)}M`;
}

export function formatCostWithUsage(cost: Numberish, usage: Numberish, lang: Lang) {
  return `${formatStatCurrency(cost, lang)} (${formatMillion(usage, lang)})`;
}

export function formatRequestRatio(successCount: Numberish, requestCount: Numberish, lang: Lang) {
  return `${formatNumber(successCount, lang)} / ${formatNumber(requestCount, lang)}`;
}

export function formatPercent(value: Numberish, lang: Lang) {
  return new Intl.NumberFormat(localeFor(lang), {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function formatDateTime(value: string | null | undefined, lang: Lang) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(localeFor(lang), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value: string | null | undefined, lang: Lang) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(localeFor(lang), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function formatDateTimeSeconds(value: string | null | undefined, lang: Lang) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(localeFor(lang), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatLogValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

export function localDateTimeToIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function maskKey(value = "") {
  if (!value) return "";
  if (value.length <= 18) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}
