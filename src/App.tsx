import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CloudUpload,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Languages,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Save,
  Send,
  Shield,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { api } from "./api";
import { messages, type Lang, type Messages } from "./i18n";
import { getErrorMessage } from "./lib/errors";
import {
  createFeedbackAttachmentPreviews,
  FEEDBACK_IMAGE_ACCEPT,
  hasFeedbackDragFiles,
  mergeFeedbackAttachmentSelection,
  revokeFeedbackAttachmentPreviews,
} from "./lib/feedbackAttachments";
import { getFeedbackApprovalDecision } from "./lib/feedbackReview";
import { navigationItemsForRole, normalizeActivePage, type AppPage } from "./lib/navigation";
import {
  formatCostWithUsage,
  formatCurrencyInputValue,
  formatDate,
  formatDateTime,
  formatDateTimeSeconds,
  formatDurationMs,
  formatJson,
  formatLogValue,
  formatNumber,
  formatPercent,
  formatPreciseCurrency,
  formatPricePerMillion,
  formatRequestRatio,
  formatStatCurrency,
  localDateTimeToIso,
  maskKey,
  normalizeCurrencyDraftInput,
} from "./lib/format";
import {
  defaultTestBodyForModel,
  preferredTestModel,
  testPathForModel,
} from "./lib/models";
import {
  chartColors,
  chartDepth,
  aggregateDailyRows,
  costParts,
  emptyStats,
  requestLogUsage,
  sumParts,
  usageParts,
} from "./lib/usage";
import {
  sortedTimingEntries,
  timingSegmentColor,
  timingSegmentLabels,
} from "./lib/timing";
import type {
  AdminData,
  ApiKey,
  AvailableModel,
  Numberish,
  Overview,
  PricingItem,
  ProviderInfo,
  FeedbackSubmitResponse,
  FeedbackListResponse,
  FeedbackReviewActionResponse,
  FeedbackReviewItem,
  FeedbackReviewStatus,
  ReloadFn,
  RequestLogDetailResponse,
  RequestLogDetailState,
  RequestLogListResponse,
  RequestLogSummary,
  RequestTiming,
  SegmentKey,
  ThemeMode,
  UsageRow,
  UsageSummary,
  User,
} from "./types";

const FEEDBACK_REWARD_TIERS = [1, 3, 5, 10];

function Stat({ label, value, tone = "blue" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`stat stat-${tone}`} aria-label={`${label}: ${value}`} title={label}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatPriceOrUnavailable(value: Numberish, lang: Lang, t: Messages): ReactNode {
  if (Number(value || 0) > 0) return formatPreciseCurrency(value, lang);
  return <span className="price-unavailable" title={t.unavailable} aria-label={t.unavailable}>-</span>;
}

function modelPriceParts(item: AvailableModel, t: Messages, lang: Lang) {
  return [
    [t.uncachedTokens, item.inputPrice],
    [t.output, item.outputPrice],
    [t.cachedTokens, item.cachePrice],
    [t.embeddingInput, item.embeddingInputPrice],
  ]
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([label, value]) => `${label} ${formatPricePerMillion(value, lang)}`);
}

function PreferenceControls({
  lang,
  setLang,
  themeMode,
  setThemeMode,
  t,
}: {
  lang: Lang;
  setLang: (value: Lang) => void;
  themeMode: ThemeMode;
  setThemeMode: (value: ThemeMode) => void;
  t: Messages;
}) {
  return (
    <div className="preference-controls" aria-label="preferences">
      <div className="mini-segment" aria-label={t.language}>
        <Languages size={15} aria-hidden="true" />
        <button className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")} type="button">中</button>
        <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")} type="button">EN</button>
      </div>
      <div className="mini-segment" aria-label={t.theme}>
        <button className={themeMode === "system" ? "active" : ""} onClick={() => setThemeMode("system")} title={t.system} type="button">
          <Monitor size={15} aria-hidden="true" />
        </button>
        <button className={themeMode === "light" ? "active" : ""} onClick={() => setThemeMode("light")} title={t.light} type="button">
          <Sun size={15} aria-hidden="true" />
        </button>
        <button className={themeMode === "dark" ? "active" : ""} onClick={() => setThemeMode("dark")} title={t.dark} type="button">
          <Moon size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function AuthScreen({
  onAuthed,
  lang,
  setLang,
  themeMode,
  setThemeMode,
  t,
}: {
  onAuthed: (user: User) => void;
  lang: Lang;
  setLang: (value: Lang) => void;
  themeMode: ThemeMode;
  setThemeMode: (value: ThemeMode) => void;
  t: Messages;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmPassword) {
      setError(t.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ user: User }>(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: { username, password },
      });
      onAuthed(data.user);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-topline">
          <PreferenceControls lang={lang} setLang={setLang} themeMode={themeMode} setThemeMode={setThemeMode} t={t} />
        </div>
        <h1>Ema Powerbank</h1>
        <div className="segmented" role="tablist" aria-label="auth mode">
          <button className={mode === "login" ? "active" : ""} onClick={() => {
            setMode("login");
            setError("");
          }} type="button">
            {t.login}
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => {
            setMode("register");
            setError("");
          }} type="button">
            {t.register}
          </button>
        </div>
        <form key={mode} onSubmit={submit} className={`form-stack auth-form auth-form-${mode}`}>
          <div className="field">
            <label htmlFor="auth-username">{t.username}</label>
            <input
              id="auth-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">{t.password}</label>
            <div className="password-control">
              <input
                id="auth-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <button
                aria-label={showPassword ? t.hidePassword : t.showPassword}
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                title={showPassword ? t.hidePassword : t.showPassword}
                type="button"
              >
                {showPassword ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="auth-confirm-password">{t.confirmPassword}</label>
              <div className="password-control">
                <input
                  id="auth-confirm-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button
                  aria-label={showPassword ? t.hidePassword : t.showPassword}
                  className="password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  title={showPassword ? t.hidePassword : t.showPassword}
                  type="button"
                >
                  {showPassword ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}
          {error && <div className="inline-error">{error}</div>}
          <button className="primary-btn full" disabled={busy} type="submit">
            <ChevronRight size={18} aria-hidden="true" />
            {busy ? t.processing : mode === "login" ? t.login : t.register}
          </button>
        </form>
      </section>
    </main>
  );
}

function CostBarChart({ rows = [], t, lang }: { rows?: UsageRow[]; t: Messages; lang: Lang }) {
  const [activeSegment, setActiveSegment] = useState<SegmentKey | "">("");
  const chartRows = [...rows].reverse().slice(-14);
  const prepared = chartRows.map((row) => {
    const costs = costParts(row);
    const tokens = usageParts(row);
    const componentTotal = sumParts(costs);
    const total = componentTotal || Number(row.cost || 0);
    const tokenTotal = sumParts(tokens);
    return { row, costs, tokens, total, tokenTotal };
  });
  const maxTotal = Math.max(10, ...prepared.map((item) => item.total));
  const segments: Array<[SegmentKey, string]> = [
    ["embedding", t.embeddingTokens],
    ["cached", t.cachedTokens],
    ["uncached", t.uncachedTokens],
    ["output", t.outputTokens],
  ];

  if (prepared.length === 0) {
    return <div className="chart-empty">{t.noData}</div>;
  }

  return (
    <div className="usage-chart">
      <div className="chart-legend">
        {segments.map(([key, label]) => (
          <button
            aria-pressed={activeSegment === key}
            className={`legend-item legend-${key} ${activeSegment === key ? "active" : ""} ${activeSegment && activeSegment !== key ? "dimmed" : ""}`}
            key={key}
            onFocus={() => setActiveSegment(key)}
            onBlur={() => setActiveSegment("")}
            onMouseEnter={() => setActiveSegment(key)}
            onMouseLeave={() => setActiveSegment("")}
            onPointerEnter={() => setActiveSegment(key)}
            onPointerLeave={() => setActiveSegment("")}
            type="button"
          >
            <i style={{ backgroundColor: chartColors[key] }} />
            {label}
          </button>
        ))}
      </div>
      <div className="chart-bars">
        {prepared.map(({ row, costs, tokens, total, tokenTotal }, index) => {
          const barHeight = Math.max(total === 0 ? 0 : 10, Math.round((total / maxTotal) * 180));
          const rawLabel = row.date || "";
          const label = rawLabel.slice(5);
          return (
            <div className="chart-day" key={`cost-${rawLabel}-${index}`}>
              <div className="bar-value" title={formatCostWithUsage(total, tokenTotal, lang)}>{formatStatCurrency(total, lang)}</div>
              <div className="bar-shell">
                <div className="bar-stack" style={{ height: `${barHeight}px` }} title={`${rawLabel}: ${formatCostWithUsage(total, tokenTotal, lang)}`}>
                  {segments.map(([key, label]) => {
                    const value = costs[key];
                    if (!value || !total) return null;
                    return (
                      <div
                        key={key}
                        aria-label={`${label}: ${formatCostWithUsage(value, tokens[key], lang)}`}
                        className={`bar-segment segment-${key} ${activeSegment === key ? "active" : ""} ${activeSegment && activeSegment !== key ? "dimmed" : ""}`}
                        onFocus={() => setActiveSegment(key)}
                        onBlur={() => setActiveSegment("")}
                        onMouseEnter={() => setActiveSegment(key)}
                        onMouseLeave={() => setActiveSegment("")}
                        onPointerEnter={() => setActiveSegment(key)}
                        onPointerLeave={() => setActiveSegment("")}
                        role="button"
                        style={{
                          height: `${Math.max(2, (value / total) * 100)}%`,
                          backgroundColor: chartColors[key],
                          zIndex: chartDepth[key],
                        }}
                        tabIndex={0}
                        title={`${rawLabel} ${label}: ${formatCostWithUsage(value, tokens[key], lang)}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="bar-label" title={rawLabel}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UsageTable({ rows = [], t, lang }: { rows?: UsageRow[]; t: Messages; lang: Lang }) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "date", direction: "desc" });
  const [selectedDate, setSelectedDate] = useState("");
  const columns = [
    { key: "date", label: t.date, align: "" },
    { key: "requestCount", label: t.requestSuccessTotal, align: "right" },
    { key: "cost", label: t.totalCost, align: "right" },
    { key: "cachedCost", label: t.cachedTokens, align: "right" },
    { key: "uncachedCost", label: t.uncachedTokens, align: "right" },
    { key: "outputCost", label: t.outputTokens, align: "right" },
    { key: "embeddingCost", label: t.embeddingTokens, align: "right" },
  ];
  const preparedRows = useMemo(() => rows.map((row) => {
    const tokens = usageParts(row);
    const costs = costParts(row);
    return {
      ...row,
      requestCount: Number(row.requestCount || 0),
      successCount: Number(row.successCount || 0),
      cached: tokens.cached,
      uncached: tokens.uncached,
      output: tokens.output,
      embedding: tokens.embedding,
      totalTokens: sumParts(tokens),
      cachedCost: costs.cached,
      uncachedCost: costs.uncached,
      outputCost: costs.output,
      embeddingCost: costs.embedding,
      cost: Number(row.cost || 0) || sumParts(costs),
    };
  }), [rows]);
  const sortedRows = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...preparedRows].sort((a, b) => {
      const left = a[sort.key as keyof typeof a];
      const right = b[sort.key as keyof typeof b];
      if (sort.key === "date") {
        return String(left).localeCompare(String(right)) * direction;
      }
      return (Number(left || 0) - Number(right || 0)) * direction;
    });
  }, [preparedRows, sort]);

  function changeSort(key: string) {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "date" ? "desc" : "desc" }
    ));
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.align} key={column.key}>
                <button className="table-sort" onClick={() => changeSort(column.key)} type="button">
                  {column.label}
                  <span>{sort.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-cell">{t.noData}</td>
            </tr>
          ) : sortedRows.map((row) => (
              <tr className={selectedDate === row.date ? "selected" : ""} key={row.date} onClick={() => setSelectedDate(row.date || "")}>
                <td>{row.date}</td>
                <td className="right">{formatRequestRatio(row.successCount, row.requestCount, lang)}</td>
                <td className="right">{formatStatCurrency(row.cost, lang)}</td>
                <td className="right">{formatCostWithUsage(row.cachedCost, row.cached, lang)}</td>
                <td className="right">{formatCostWithUsage(row.uncachedCost, row.uncached, lang)}</td>
                <td className="right">{formatCostWithUsage(row.outputCost, row.output, lang)}</td>
                <td className="right">{formatCostWithUsage(row.embeddingCost, row.embedding, lang)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelUsageTable({ rows = [], t, lang }: { rows?: UsageRow[]; t: Messages; lang: Lang }) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "cost", direction: "desc" });
  const columns = [
    { key: "modelId", label: t.model, align: "" },
    { key: "requestCount", label: t.requestCount, align: "right" },
    { key: "cached", label: t.cachedTokens, align: "right" },
    { key: "uncached", label: t.uncachedTokens, align: "right" },
    { key: "output", label: t.outputTokens, align: "right" },
    { key: "embedding", label: t.embeddingTokens, align: "right" },
    { key: "cost", label: t.cost, align: "right" },
  ];
  const preparedRows = useMemo(() => rows.map((row) => {
    const parts = usageParts(row);
    return {
      ...row,
      modelId: row.modelId || "unknown",
      requestCount: Number(row.requestCount || 0),
      cached: parts.cached,
      uncached: parts.uncached,
      output: parts.output,
      embedding: parts.embedding,
      cost: Number(row.cost || 0),
    };
  }), [rows]);
  const sortedRows = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...preparedRows].sort((a, b) => {
      const left = a[sort.key as keyof typeof a];
      const right = b[sort.key as keyof typeof b];
      if (sort.key === "modelId") return String(left).localeCompare(String(right)) * direction;
      return (Number(left || 0) - Number(right || 0)) * direction;
    });
  }, [preparedRows, sort]);

  function changeSort(key: string) {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "modelId" ? "asc" : "desc" }
    ));
  }

  return (
    <div className="model-usage-block">
      <h3>{t.modelDetails}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th className={column.align} key={column.key}>
                  <button className="table-sort" onClick={() => changeSort(column.key)} type="button">
                    {column.label}
                    <span>{sort.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">{t.noData}</td>
              </tr>
            ) : sortedRows.map((row) => (
              <tr key={row.modelId}>
                <td><code>{row.modelId}</code></td>
                <td className="right">{formatNumber(row.requestCount, lang)}</td>
                <td className="right">{formatNumber(row.cached, lang)}</td>
                <td className="right">{formatNumber(row.uncached, lang)}</td>
                <td className="right">{formatNumber(row.output, lang)}</td>
                <td className="right">{formatNumber(row.embedding, lang)}</td>
                <td className="right">{formatStatCurrency(row.cost, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsageStatsPanel({
  dailyRows = [],
  dailyModelRows = [],
  modelRows = [],
  t,
  lang,
}: {
  dailyRows?: UsageRow[];
  dailyModelRows?: UsageRow[];
  modelRows?: UsageRow[];
  t: Messages;
  lang: Lang;
}) {
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [modelSelectionReady, setModelSelectionReady] = useState(false);
  const modelSourceRows = dailyModelRows.length ? dailyModelRows : modelRows;
  const sourceRows = dailyModelRows.length ? dailyModelRows : dailyRows;
  const modelOptions = useMemo<string[]>(() => (
    [...new Set(modelSourceRows.map((row) => row.modelId).filter((modelId): modelId is string => Boolean(modelId)))]
      .sort((left, right) => String(left).localeCompare(String(right)))
  ), [modelSourceRows]);
  const filteredRows = useMemo(() => {
    const selectedSet = new Set(selectedModels);
    const rows = modelOptions.length === 0 || selectedModels.length === modelOptions.length
      ? sourceRows
      : sourceRows.filter((row) => row.modelId ? selectedSet.has(row.modelId) : false);
    return aggregateDailyRows(rows);
  }, [modelOptions, selectedModels, sourceRows]);

  useEffect(() => {
    setSelectedModels((current) => {
      if (modelOptions.length === 0) return [];
      if (!modelSelectionReady) return modelOptions;
      const next = current.filter((modelId) => modelOptions.includes(modelId));
      return next.length === current.length ? current : next;
    });
    if (modelOptions.length > 0 && !modelSelectionReady) setModelSelectionReady(true);
    if (modelOptions.length === 0 && modelSelectionReady) setModelSelectionReady(false);
  }, [modelOptions, modelSelectionReady]);

  function toggleModel(modelId: string, checked: boolean) {
    setSelectedModels((current) => {
      if (checked) return [...new Set([...current, modelId])];
      return current.filter((item) => item !== modelId);
    });
  }

  return (
    <>
      <div className="usage-controls">
        <div className="model-checkboxes" role="group" aria-label={t.model}>
          <span className="usage-control-label">{t.model}</span>
          {modelOptions.map((modelId) => (
            <label key={modelId}>
              <input
                checked={selectedModels.includes(modelId)}
                onChange={(event) => toggleModel(modelId, event.target.checked)}
                type="checkbox"
              />
              <span>{modelId}</span>
            </label>
          ))}
        </div>
      </div>
      <CostBarChart rows={filteredRows} t={t} lang={lang} />
      <UsageTable rows={filteredRows} t={t} lang={lang} />
    </>
  );
}

function ApiTestPanel({
  apiKeys = [],
  availableModels = [],
  reload,
  t,
}: {
  apiKeys?: ApiKey[];
  availableModels?: AvailableModel[];
  reload: ReloadFn;
  t: Messages;
}) {
  const usableKeys = apiKeys.filter((item): item is ApiKey & { key: string } => Boolean(item.key));
  const modelOptions = useMemo<string[]>(() => availableModels.map((item) => item.modelId).filter(Boolean), [availableModels]);
  const initialModel = preferredTestModel(availableModels);
  const [selectedKey, setSelectedKey] = useState(usableKeys[0]?.key || "");
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [requestBody, setRequestBody] = useState(formatJson(defaultTestBodyForModel(initialModel)));
  const [responseText, setResponseText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestPath = testPathForModel(selectedModel);

  useEffect(() => {
    if (!usableKeys.some((item) => item.key === selectedKey)) {
      setSelectedKey(usableKeys[0]?.key || "");
    }
  }, [apiKeys]);

  useEffect(() => {
    const nextModel = modelOptions.includes(selectedModel) ? selectedModel : preferredTestModel(availableModels);
    if (nextModel !== selectedModel) {
      setSelectedModel(nextModel);
      setRequestBody(formatJson(defaultTestBodyForModel(nextModel)));
    }
  }, [availableModels, modelOptions, selectedModel]);

  function changeModel(modelId: string) {
    setSelectedModel(modelId);
    setRequestBody(formatJson(defaultTestBodyForModel(modelId)));
    setError("");
    setResponseText("");
  }

  async function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResponseText("");
    let payload;
    try {
      payload = JSON.parse(requestBody);
    } catch {
      setError(t.invalidJson);
      return;
    }

    const trimmedPath = requestPath.trim();
    const url = trimmedPath.startsWith("http") ? trimmedPath : trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": selectedKey,
        },
        body: JSON.stringify(payload),
      });
      const raw = await response.text();
      let formatted = raw;
      try {
        formatted = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        formatted = raw || "";
      }
      setResponseText(`HTTP ${response.status} ${response.statusText}\n${formatted}`);
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel test-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t.testApi}</span>
          <h2>{t.testApi}</h2>
        </div>
      </div>
      <form className="api-test-form" onSubmit={sendTest}>
        <label>
          {t.selectKey}
          <select disabled={usableKeys.length === 0} value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
            {usableKeys.length === 0 ? (
              <option value="">{t.noUsableKey}</option>
            ) : usableKeys.map((item) => (
              <option key={item.id} value={item.key}>{item.name} · {item.keyPrefix}...</option>
            ))}
          </select>
        </label>
        <label>
          {t.model}
          <select value={selectedModel} onChange={(event) => changeModel(event.target.value)}>
            {(modelOptions.length ? modelOptions : [selectedModel]).map((modelId) => (
              <option key={modelId} value={modelId}>{modelId}</option>
            ))}
          </select>
        </label>
        <label>
          {t.requestBody}
          <textarea value={requestBody} onChange={(event) => setRequestBody(event.target.value)} />
        </label>
        {error && <div className="inline-error">{error}</div>}
        <button className="primary-btn" disabled={!selectedKey || busy} type="submit">
          <ChevronRight size={18} aria-hidden="true" />
          {busy ? t.processing : t.sendTest}
        </button>
      </form>
      {responseText && (
        <div className="response-box">
          <span>{t.response}</span>
          <pre>{responseText}</pre>
        </div>
      )}
    </section>
  );
}

function FeedbackPanel({ t, lang }: { t: Messages; lang: Lang }) {
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState(() => createFeedbackAttachmentPreviews([]));
  const [dragOverlayVisible, setDragOverlayVisible] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const dragDepthRef = useRef(0);

  const applyAttachmentSelection = useCallback((files: File[]) => {
    setError("");
    setSubmitted(false);

    const result = mergeFeedbackAttachmentSelection(attachments, files);
    if (!result.ok) {
      setFileInputKey((current) => current + 1);
      if (result.reason === "tooMany") setError(t.feedbackAttachmentsTooMany);
      if (result.reason === "invalidType") setError(t.feedbackImageInvalid);
      if (result.reason === "tooLarge") setError(t.feedbackImageTooLarge);
      return;
    }

    setAttachments(result.attachments);
    setFileInputKey((current) => current + 1);
  }, [attachments, t.feedbackAttachmentsTooMany, t.feedbackImageInvalid, t.feedbackImageTooLarge]);

  useEffect(() => {
    const previews = createFeedbackAttachmentPreviews(attachments);
    setAttachmentPreviews(previews);
    return () => revokeFeedbackAttachmentPreviews(previews);
  }, [attachments]);

  useEffect(() => {
    function resetDragOverlay() {
      dragDepthRef.current = 0;
      setDragOverlayVisible(false);
    }

    function handleDragEnter(event: DragEvent) {
      if (!hasFeedbackDragFiles(event.dataTransfer?.types)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragOverlayVisible(true);
    }

    function handleDragOver(event: DragEvent) {
      if (!hasFeedbackDragFiles(event.dataTransfer?.types)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragOverlayVisible(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (!hasFeedbackDragFiles(event.dataTransfer?.types)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragOverlayVisible(false);
    }

    function handleDrop(event: DragEvent) {
      if (!hasFeedbackDragFiles(event.dataTransfer?.types)) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files || []);
      resetDragOverlay();
      applyAttachmentSelection(files);
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [applyAttachmentSelection]);

  function selectAttachments(event: ChangeEvent<HTMLInputElement>) {
    applyAttachmentSelection(Array.from(event.target.files || []));
  }

  function removeAttachment(fileToRemove: File) {
    setAttachments((current) => current.filter((file) => file !== fileToRemove));
    setFileInputKey((current) => current + 1);
    setError("");
    setSubmitted(false);
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDescription = description.trim();
    setError("");
    setSubmitted(false);

    if (!trimmedDescription) {
      setError(t.feedbackDescriptionRequired);
      return;
    }

    if (!window.confirm(t.confirmSubmitFeedback)) return;

    const formData = new FormData();
    formData.append("description", trimmedDescription);
    for (const attachment of attachments) formData.append("attachment", attachment);

    setBusy(true);
    try {
      await api<FeedbackSubmitResponse>("/api/feedback", {
        method: "POST",
        body: formData,
      });
      setDescription("");
      setAttachments([]);
      setFileInputKey((current) => current + 1);
      setSubmitted(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-grid">
      <section className="panel wide feedback-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t.feedback}</span>
            <h2>{t.feedback}</h2>
          </div>
        </div>
        <div className="inline-info feedback-reward-notice">{t.feedbackRewardNotice}</div>
        <form className="feedback-form" onSubmit={submitFeedback}>
          <label>
            {t.feedbackDescription}
            <textarea
              maxLength={5000}
              required
              value={description}
              placeholder={t.feedbackDescriptionPlaceholder}
              onChange={(event) => {
                setDescription(event.target.value);
                setError("");
                setSubmitted(false);
              }}
            />
          </label>
          <div className="feedback-field">
            <span className="feedback-field-label">{t.feedbackAttachment}</span>
            <span className="feedback-upload-control">
              <label className="feedback-upload-button">
                {t.feedbackChooseFiles}
                <input
                  accept={FEEDBACK_IMAGE_ACCEPT}
                  className="feedback-upload-input"
                  key={fileInputKey}
                  multiple
                  onChange={selectAttachments}
                  type="file"
                />
              </label>
              <span className="feedback-upload-hint">{t.feedbackDragPrompt}</span>
            </span>
          </div>
          <div className="feedback-meta-row">
            <span>{formatNumber(description.length, lang)} / {formatNumber(5000, lang)}</span>
          </div>
          {attachmentPreviews.length > 0 && (
            <div className="feedback-local-preview" aria-label={t.feedbackPreview}>
              {attachmentPreviews.map((preview) => (
                <figure className="feedback-local-preview-item" key={preview.key}>
                  <img alt={preview.file.name} src={preview.url} />
                  <figcaption>
                    <span>{preview.file.name}</span>
                    <button
                      aria-label={`${t.feedbackRemoveAttachment}: ${preview.file.name}`}
                      className="feedback-file-remove"
                      onClick={() => removeAttachment(preview.file)}
                      title={t.feedbackRemoveAttachment}
                      type="button"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {error && <div className="inline-error">{error}</div>}
          <button className="primary-btn" disabled={!description.trim() || busy} type="submit">
            <Send size={18} aria-hidden="true" />
            {busy ? t.processing : t.feedbackSubmit}
          </button>
          {submitted && (
            <div className="inline-success" aria-live="polite">
              <strong>{t.feedbackSubmitted}</strong>
            </div>
          )}
        </form>
      </section>
      {dragOverlayVisible && (
        <div className="feedback-drop-overlay" aria-hidden="true">
          <div className="feedback-drop-target">
            <CloudUpload size={42} aria-hidden="true" />
            <strong>{t.feedbackDropTitle}</strong>
            <span>{t.feedbackDropHint}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  overview,
  reload,
  t,
  lang,
}: {
  overview: Overview;
  reload: ReloadFn;
  t: Messages;
  lang: Lang;
}) {
  const [keyName, setKeyName] = useState("default");
  const [isKeyDialogOpen, setIsKeyDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const baseUrl = `${window.location.origin}/api`;
  const usageSummary: UsageSummary = overview.usageSummary || {
    requestCount: 0,
    successCount: 0,
    totalCost: 0,
    todayCost: 0,
    successRate: 0,
  };

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalizedName = keyName.trim() || "Default key";
    if (overview.apiKeys.some((item) => item.name === normalizedName)) {
      setError(t.duplicateAlias);
      return;
    }
    try {
      await api("/api/keys", {
        method: "POST",
        body: { name: normalizedName },
      });
      setIsKeyDialogOpen(false);
      setKeyName("default");
      await reload();
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message === "API key alias already exists" ? t.duplicateAlias : message);
    }
  }

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function revokeKey(id: number) {
    await api(`/api/keys/${id}`, { method: "DELETE" });
    setDeleteTarget(null);
    await reload();
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setToast(t.copied);
  }

  return (
    <div className="page-grid">
      <section className="panel wide account-panel">
        <div className="account-strip account-summary-strip">
          <div className="stats-grid account-stats account-summary-stats">
            <Stat label={t.balance} value={formatStatCurrency(overview.user.balance, lang)} />
            <Stat label={t.totalCost} value={formatStatCurrency(usageSummary.totalCost, lang)} tone="rose" />
            <Stat label={t.todayConsumed} value={formatStatCurrency(usageSummary.todayCost, lang)} tone="amber" />
            <Stat label={t.requestSuccessRate} value={formatPercent(usageSummary.successRate, lang)} tone="green" />
          </div>
        </div>
      </section>

      <section className="panel credentials-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t.apiKeys}</span>
            <h2>{t.apiKeys}</h2>
          </div>
          <button className="icon-btn primary" title={t.newKey} onClick={() => {
            setError("");
            setIsKeyDialogOpen(true);
          }} type="button">
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        {error && !isKeyDialogOpen && <div className="inline-error">{error}</div>}
        {overview.apiKeys.length === 0 && <div className="inline-error key-warning">{t.apiKeyRequired}</div>}
        <div className="key-list">
          {overview.apiKeys.map((item) => (
            <div className="key-row" key={item.id}>
              <KeyRound size={16} aria-hidden="true" />
              <div>
                <strong>{item.name}</strong>
                {item.key ? <code>{maskKey(item.key)}</code> : <span>{item.keyPrefix}... · {t.fullKeyUnavailable}</span>}
                <span>{t.createdAt}: {formatDateTime(item.createdAt, lang)}</span>
              </div>
              {item.key && (
                <button className="icon-btn" title={t.copy} onClick={() => copy(item.key || "")} type="button">
                  <Copy size={16} aria-hidden="true" />
                </button>
              )}
              <button className="icon-btn danger" title={t.revoke} onClick={() => setDeleteTarget(item)} type="button">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <div className="base-url-block">
          <div className="section-head compact-head">
            <h2>{t.baseUrl}</h2>
          </div>
          <p className="panel-note">{t.baseUrlHelp}</p>
          <div className="endpoint-box">
            <code>{baseUrl}</code>
            <button className="icon-btn" title={t.copy} onClick={() => copy(baseUrl)} type="button">
              <Copy size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="model-id-block">
          <div className="section-head compact-head">
            <h2>{t.availableModels}</h2>
          </div>
          <div className="model-id-list">
            {(overview.availableModels || []).length === 0 ? (
              <div className="empty-model-list">{t.noData}</div>
            ) : (overview.availableModels || []).map((item) => (
              <div className="model-id-row" key={item.modelId}>
                <code>{item.modelId}</code>
                <div className="model-price-line">
                  {modelPriceParts(item, t, lang).map((part) => (
                    <span key={part}>{part}</span>
                  ))}
                </div>
                <button className="icon-btn" title={t.copy} onClick={() => copy(item.modelId)} type="button">
                  <Copy size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ApiTestPanel apiKeys={overview.apiKeys} availableModels={overview.availableModels || []} reload={reload} t={t} />

      <section className="panel wide usage-panel">
        <div className="section-head">
          <div>
            <h2>{t.usageStats}</h2>
          </div>
        </div>
        <UsageStatsPanel
          dailyRows={overview.dailyStats || []}
          dailyModelRows={overview.dailyModelStats || []}
          modelRows={overview.modelStats || []}
          t={t}
          lang={lang}
        />
      </section>
      {isKeyDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-key-title">
            <div className="section-head">
              <h2 id="new-key-title">{t.newKey}</h2>
            </div>
            <form className="modal-form" onSubmit={createKey}>
              <label>
                {t.keyName}
                <input
                  autoFocus
                  aria-label={t.keyName}
                  value={keyName}
                  onChange={(event) => {
                    setKeyName(event.target.value);
                    setError("");
                  }}
                />
              </label>
              {error && <div className="inline-error">{error}</div>}
              <div className="modal-actions">
                <button className="icon-btn" title={t.cancel} onClick={() => {
                  setIsKeyDialogOpen(false);
                  setError("");
                }} type="button">
                  <X size={16} aria-hidden="true" />
                </button>
                <button className="primary-btn" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  {t.create}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-key-title">
            <div className="section-head">
              <h2 id="delete-key-title">{t.confirmDelete}</h2>
            </div>
            <p className="modal-copy">{deleteTarget.name}</p>
            <div className="modal-actions">
              <button className="icon-btn" title={t.cancel} onClick={() => setDeleteTarget(null)} type="button">
                <X size={16} aria-hidden="true" />
              </button>
              <button className="primary-btn danger-action" onClick={() => revokeKey(deleteTarget.id)} type="button">
                <Trash2 size={18} aria-hidden="true" />
                {t.revoke}
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function ProviderForm({
  provider,
  reload,
  t,
}: {
  provider?: ProviderInfo | null;
  reload: ReloadFn;
  t: Messages;
}) {
  const [mode, setMode] = useState<"ai_studio" | "vertex">(provider?.mode || "ai_studio");
  const [location, setLocation] = useState(provider?.location || "global");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const configuredModeLabel = provider?.mode === "vertex" ? "Vertex AI" : "AI Studio";
  const editingModeLabel = mode === "vertex" ? "Vertex AI" : "AI Studio";
  const aiStudioPlaceholder = provider?.mode === "ai_studio" && provider?.keyPreview && !provider.keyPreview.trim().startsWith("{")
    ? provider.keyPreview
    : "AIza...";
  const vertexPlaceholder = provider?.mode === "vertex" ? provider?.keyPreview || "" : '{\n  "type": "service_account",\n  "project_id": "..."\n}';

  useEffect(() => {
    setMode(provider?.mode || "ai_studio");
    setLocation(provider?.location || "global");
  }, [provider]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!key.trim()) {
      setError(t.providerKeyRequired);
      return;
    }
    if (!window.confirm(t.confirmSaveProvider)) return;
    try {
      await api("/api/admin/provider", {
        method: "POST",
        body: { mode, location: mode === "vertex" ? location : "", key },
      });
      setKey("");
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function clearConfig() {
    setError("");
    if (!window.confirm(t.confirmClearProvider)) return;
    try {
      await api("/api/admin/provider", { method: "DELETE" });
      setKey("");
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t.provider}</span>
          <h2>{t.upstreamConfig}</h2>
        </div>
        {provider?.configured ? (
          <button className="pill ok clear-provider-btn" onClick={clearConfig} type="button">
            {t.clearProvider}
          </button>
        ) : (
          <span className="pill">{t.notConfigured}</span>
        )}
      </div>
      <form className="form-stack" onSubmit={save}>
        {provider?.configured && (
          <div className="provider-summary">
            <span>{t.currentProvider}</span>
            <strong>{configuredModeLabel}</strong>
            {provider.mode === "vertex" && (
              <small>
                {provider.projectId ? `Project: ${provider.projectId}` : ""}
                {provider.location ? `${provider.projectId ? " · " : ""}${t.location}: ${provider.location}` : ""}
              </small>
            )}
          </div>
        )}
        <div className="segmented compact provider-mode-toggle" role="tablist" aria-label="provider type">
          <button className={mode === "ai_studio" ? "active" : ""} onClick={() => setMode("ai_studio")} type="button">
            AI Studio
          </button>
          <button className={mode === "vertex" ? "active" : ""} onClick={() => setMode("vertex")} type="button">
            Vertex AI
          </button>
        </div>
        {mode === "vertex" && (
          <label>
            {t.location}
            <input value={location} onChange={(event) => setLocation(event.target.value)} />
          </label>
        )}
        <label>
          {mode === "vertex" ? t.vertexServiceAccountJson : t.apiKey}
          {mode === "vertex" ? (
            <textarea value={key} onChange={(event) => setKey(event.target.value)} rows={6} placeholder={vertexPlaceholder} />
          ) : (
            <input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={aiStudioPlaceholder} />
          )}
        </label>
        {error && <div className="inline-error">{error}</div>}
        <button className="primary-btn" type="submit">
          <Save size={18} aria-hidden="true" />
          {t.save} {editingModeLabel}
        </button>
      </form>
    </section>
  );
}

interface PricingFormState {
  modelId: string;
  inputPrice: string;
  outputPrice: string;
  cachePrice: string;
  embeddingInputPrice: string;
}

const emptyPricingForm: PricingFormState = {
  modelId: "",
  inputPrice: "",
  outputPrice: "",
  cachePrice: "",
  embeddingInputPrice: "",
};

function PricingPanel({
  pricing,
  reload,
  t,
  lang,
}: {
  pricing: PricingItem[];
  reload: ReloadFn;
  t: Messages;
  lang: Lang;
}) {
  const [form, setForm] = useState<PricingFormState>(emptyPricingForm);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setError("");
    const modelId = form.modelId.trim();
    if (pricing.some((item) => item.modelId === modelId)) {
      setError(t.modelExists);
      return;
    }
    if (!window.confirm(t.confirmAddPrice)) return;
    try {
      await api("/api/admin/pricing", { method: "POST", body: { ...form, modelId } });
      setForm(emptyPricingForm);
      await reload();
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message === "Pricing model already exists" ? t.modelExists : message);
    }
  }

  async function remove(id: number) {
    setError("");
    if (!window.confirm(t.confirmDeletePrice)) return;
    try {
      await api(`/api/admin/pricing/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function update(field: keyof PricingFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="panel wide">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t.pricing}</span>
          <h2>{t.modelPricing}</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table className="pricing-table">
          <thead>
            <tr>
              <th>{t.model}</th>
              <th>{t.uncachedTokens}</th>
              <th>{t.output}</th>
              <th>{t.cachedTokens}</th>
              <th>{t.embeddingInput}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pricing.map((item) => (
              <tr key={item.id}>
                <td><code>{item.modelId}</code></td>
                <td>{formatPriceOrUnavailable(item.inputPrice, lang, t)}</td>
                <td>{formatPriceOrUnavailable(item.outputPrice, lang, t)}</td>
                <td>{formatPriceOrUnavailable(item.cachePrice, lang, t)}</td>
                <td>{formatPriceOrUnavailable(item.embeddingInputPrice, lang, t)}</td>
                <td className="right">
                  <button className="icon-btn danger" title={t.deletePrice} onClick={() => remove(item.id)} type="button">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            <tr className="pricing-add-row">
              <td>
                <input aria-label={t.model} value={form.modelId} onChange={(event) => update("modelId", event.target.value)} />
              </td>
              <td>
                <input aria-label={t.uncachedTokens} type="number" step="0.000001" value={form.inputPrice} onChange={(event) => update("inputPrice", event.target.value)} />
              </td>
              <td>
                <input aria-label={t.output} type="number" step="0.000001" value={form.outputPrice} onChange={(event) => update("outputPrice", event.target.value)} />
              </td>
              <td>
                <input aria-label={t.cachedTokens} type="number" step="0.000001" value={form.cachePrice} onChange={(event) => update("cachePrice", event.target.value)} />
              </td>
              <td>
                <input aria-label={t.embeddingInput} type="number" step="0.000001" value={form.embeddingInputPrice} onChange={(event) => update("embeddingInputPrice", event.target.value)} />
              </td>
              <td className="right">
                <button className="primary-btn compact-action" title={t.addPrice} onClick={save} type="button">
                  <Plus size={17} aria-hidden="true" />
                  {t.addPrice}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}

function UsersPanel({
  users,
  reload,
  t,
  lang,
  currentUser,
}: {
  users: User[];
  reload: ReloadFn;
  t: Messages;
  lang: Lang;
  currentUser: User;
}) {
  const [balances, setBalances] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    setBalances(Object.fromEntries(users.map((user) => [user.id, formatCurrencyInputValue(user.balance, 4)])));
  }, [users]);

  function normalizeBalanceEdit(userId: number) {
    setBalances((current) => ({
      ...current,
      [userId]: formatCurrencyInputValue(current[userId], 4),
    }));
  }

  async function save(userId: number) {
    setError("");
    if (!window.confirm(t.confirmSaveBalance)) return;
    try {
      await api(`/api/admin/users/${userId}/balance`, {
        method: "PATCH",
        body: { balance: balances[userId] },
      });
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function remove(userId: number) {
    setError("");
    if (userId === currentUser?.id) {
      setError(t.cannotDeleteSelf);
      return;
    }
    if (!window.confirm(t.confirmDeleteUser)) return;
    try {
      await api(`/api/admin/users/${userId}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <section className="panel wide">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t.users}</span>
          <h2>{t.userManagement}</h2>
        </div>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div className="table-wrap">
        <table className="users-table">
          <colgroup>
            <col className="users-col-name" />
            <col className="users-col-role" />
            <col className="users-col-date" />
            <col className="users-col-money" />
            <col className="users-col-balance" />
            <col className="users-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>{t.username}</th>
              <th>{t.role}</th>
              <th>{t.registeredAt}</th>
              <th>{t.totalSpent}</th>
              <th className="balance-heading">{t.balance}</th>
              <th className="right" aria-label={t.actions}></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={6}>{t.noData}</td>
              </tr>
            ) : users.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong className="user-name">{item.username}</strong>
                </td>
                <td>
                  <span className={`role-badge ${item.role === "admin" ? "admin" : "user"}`}>
                    {item.role === "admin" ? t.admin : t.userRole}
                  </span>
                </td>
                <td className="date-cell">{formatDate(item.createdAt, lang)}</td>
                <td>{formatPreciseCurrency(item.totalSpent || 0, lang)}</td>
                <td className="balance-cell">
                  <div className="balance-edit">
                    <div className="currency-input-wrap">
                      <span className="currency-prefix" aria-hidden="true">$</span>
                      <input
                        className="cell-input currency-input"
                        aria-label={`${item.username} ${t.balance}`}
                        type="number"
                        step="0.1"
                        value={balances[item.id] ?? 0}
                        onChange={(event) => setBalances((current) => ({
                          ...current,
                          [item.id]: normalizeCurrencyDraftInput(event.target.value),
                        }))}
                        onBlur={() => normalizeBalanceEdit(item.id)}
                      />
                    </div>
                    <button className="icon-btn primary" title={t.saveBalance} onClick={() => save(item.id)} type="button">
                      <Save size={16} aria-hidden="true" />
                    </button>
                  </div>
                </td>
                <td className="right">
                  <button className="icon-btn danger" disabled={item.id === currentUser?.id} title={item.id === currentUser?.id ? t.cannotDeleteSelf : t.deleteUser} onClick={() => remove(item.id)} type="button">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function feedbackStatusLabel(status: FeedbackReviewStatus, t: Messages) {
  if (status === "approved") return t.feedbackStatusApproved;
  if (status === "rejected") return t.feedbackStatusRejected;
  return t.feedbackStatusPending;
}

function NavigationIcon({ page }: { page: AppPage }) {
  if (page === "admin") return <Shield size={18} aria-hidden="true" />;
  if (page === "requestLogs") return <FileText size={18} aria-hidden="true" />;
  if (page === "feedback") return <MessageSquare size={18} aria-hidden="true" />;
  if (page === "feedbackReview") return <ClipboardCheck size={18} aria-hidden="true" />;
  return <UserRound size={18} aria-hidden="true" />;
}

function FeedbackReviewPanel({
  reload,
  t,
  lang,
}: {
  reload: ReloadFn;
  t: Messages;
  lang: Lang;
}) {
  const [status, setStatus] = useState<FeedbackReviewStatus>("pending");
  const [feedbacks, setFeedbacks] = useState<FeedbackReviewItem[]>([]);
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("page", String(page));

    setLoading(true);
    setError("");
    api<FeedbackListResponse>(`/api/admin/feedbacks?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const rows = data.feedbacks || [];
        setFeedbacks(rows);
        setPage(data.page || 1);
        setPageSize(data.pageSize || 10);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setRewardDrafts((current) => ({
          ...Object.fromEntries(rows.filter((item) => item.review.status === "pending").map((item) => [item.id, current[item.id] || "5"])),
        }));
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, refreshToken, page]);

  function changeStatus(value: FeedbackReviewStatus) {
    setStatus(value);
    setPage(1);
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function updateReward(id: string, value: string) {
    setRewardDrafts((current) => ({ ...current, [id]: normalizeCurrencyDraftInput(value) }));
    setError("");
  }

  async function approve(item: FeedbackReviewItem) {
    setError("");
    const decision = getFeedbackApprovalDecision(
      rewardDrafts[item.id],
      () => window.confirm(t.confirmApproveFeedback),
    );
    if (!decision.ok) {
      if (decision.reason === "cancelled") return;
      setError(t.feedbackRewardRequired);
      return;
    }
    setBusy(item.id, true);
    try {
      await api<FeedbackReviewActionResponse>(`/api/admin/feedbacks/${item.id}/approve`, {
        method: "POST",
        body: { rewardAmount: decision.rewardAmount },
      });
      await reload();
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(item.id, false);
    }
  }

  async function reject(item: FeedbackReviewItem) {
    setError("");
    if (!window.confirm(t.confirmRejectFeedback)) return;
    setBusy(item.id, true);
    try {
      await api<FeedbackReviewActionResponse>(`/api/admin/feedbacks/${item.id}/reject`, { method: "POST" });
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(item.id, false);
    }
  }

  const paginationText = lang === "zh"
    ? `第 ${formatNumber(page, lang)} / ${formatNumber(totalPages, lang)} 页 · 共 ${formatNumber(total, lang)} 条 · 每页 ${formatNumber(pageSize, lang)} 条`
    : `Page ${formatNumber(page, lang)} / ${formatNumber(totalPages, lang)} · ${formatNumber(total, lang)} total · ${formatNumber(pageSize, lang)} per page`;

  return (
    <section className="panel wide feedback-review-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t.feedback}</span>
          <h2>{t.feedbackReview}</h2>
        </div>
        <a className="primary-btn compact-action" href="/api/admin/feedbacks/export.csv" download="feedback-export.csv">
          <Download size={17} aria-hidden="true" />
          {t.feedbackExportCsv}
        </a>
      </div>
      <div className="feedback-review-filters segmented compact" role="tablist" aria-label={t.feedbackReviewStatus}>
        {(["pending", "approved", "rejected"] as FeedbackReviewStatus[]).map((item) => (
          <button
            className={status === item ? "active" : ""}
            key={item}
            onClick={() => changeStatus(item)}
            type="button"
          >
            {feedbackStatusLabel(item, t)}
          </button>
        ))}
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div className="feedback-review-list" aria-busy={loading}>
        {loading && feedbacks.length === 0 ? (
          <div className="request-log-empty">{t.processing}</div>
        ) : feedbacks.length === 0 ? (
          <div className="request-log-empty">{t.noData}</div>
        ) : feedbacks.map((item) => {
          const isBusy = busyIds.has(item.id);
          const reviewed = item.review.status !== "pending";
          return (
            <article className={`feedback-review-card${item.attachments.length === 0 ? " feedback-review-card-no-attachments" : ""}`} key={item.id}>
              <div className="feedback-review-main">
                <div className="feedback-review-head">
                  <div>
                    <strong>{item.user.username}</strong>
                  </div>
                  <span className={`feedback-status feedback-status-${item.review.status}`}>
                    {feedbackStatusLabel(item.review.status, t)}
                  </span>
                </div>
                <label className="feedback-review-description">
                  <span>{t.feedbackDescription}</span>
                  <textarea readOnly value={item.description} />
                </label>
                <div className="feedback-review-description-meta">
                  <span><strong>{t.feedbackReviewSubmittedAt}</strong>{formatDateTimeSeconds(item.timestamp, lang)}</span>
                  <span><strong>{t.feedbackPackageName}</strong><code>{item.packageName}</code></span>
                </div>
                <div className="feedback-review-meta">
                  {item.attachments.length > 0 ? (
                    <span><strong>{t.feedbackAttachment}</strong><code>{item.attachments.map((attachment) => attachment.originalName).join(", ")}</code></span>
                  ) : (
                    <span><strong>{t.feedbackAttachment}</strong>{t.noData}</span>
                  )}
                  {reviewed && (
                    <span><strong>{t.feedbackReward}</strong>{formatNumber(item.review.rewardAmount, lang)}</span>
                  )}
                  {item.review.reviewedBy && (
                    <span><strong>{t.admin}</strong>{item.review.reviewedBy.username}</span>
                  )}
                  {item.review.reviewedAt && (
                    <span><strong>{t.feedbackReviewedAt}</strong>{formatDateTimeSeconds(item.review.reviewedAt, lang)}</span>
                  )}
                </div>
                {item.review.status === "pending" && (
                  <div className="feedback-review-actions">
                    <div className="reward-controls">
                      <span>{t.feedbackReviewTiers}</span>
                      <div className="reward-tier-list">
                        {FEEDBACK_REWARD_TIERS.map((tier) => (
                          <button
                            className={Number(rewardDrafts[item.id] || 0) === tier ? "active" : ""}
                            key={tier}
                            onClick={() => updateReward(item.id, String(tier))}
                            type="button"
                          >
                            ${formatCurrencyInputValue(tier, 2)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="reward-manual">
                      {t.feedbackRewardManual}
                      <div className="currency-input-wrap">
                        <span className="currency-prefix" aria-hidden="true">$</span>
                        <input
                          className="currency-input"
                          min="0"
                          step="0.1"
                          type="number"
                          value={rewardDrafts[item.id] ?? "5"}
                          onChange={(event) => updateReward(item.id, event.target.value)}
                        />
                      </div>
                    </label>
                    <button className="primary-btn compact-action" disabled={isBusy} onClick={() => approve(item)} type="button">
                      <Check size={17} aria-hidden="true" />
                      {t.feedbackReviewApprove}
                    </button>
                    <button className="primary-btn danger-action compact-action" disabled={isBusy} onClick={() => reject(item)} type="button">
                      <X size={17} aria-hidden="true" />
                      {t.feedbackReviewReject}
                    </button>
                  </div>
                )}
              </div>
              {item.attachments.length > 0 && (
                <div className="feedback-preview">
                  {item.attachments.map((attachment) => (
                    <img
                      alt={attachment.originalName}
                      key={attachment.fileName}
                      src={`/api/admin/feedbacks/${item.id}/attachments/${encodeURIComponent(attachment.fileName)}`}
                    />
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="request-log-pagination">
        <button className="icon-btn" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} title="Previous page" type="button">
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <span>{paginationText}</span>
        <button className="icon-btn" disabled={loading || page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} title="Next page" type="button">
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function RequestLogBlock({ title, text, tone = "blue" }: { title: string; text: string; tone?: "blue" | "amber" | "green" | "red" }) {
  return (
    <div className={`request-log-block log-tone-${tone}`}>
      <h3>{title}</h3>
      <pre>{text}</pre>
    </div>
  );
}

function RequestTimingBar({ timing, t, lang }: { timing: RequestTiming; t: Messages; lang: Lang }) {
  const entries = sortedTimingEntries(timing);
  const denominator = Number(timing.totalMs || 0) || entries.reduce((total, [, value]) => total + Number(value || 0), 0);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  if (entries.length === 0 || denominator <= 0) {
    return null;
  }

  return (
    <div className="request-log-block request-timing-block">
      <div className="request-timing-head">
        <h3>{t.timing}</h3>
        <span>{formatDurationMs(timing.totalMs, lang)}</span>
      </div>
      <div className="request-timing-bar" aria-label={`${t.totalDuration}: ${formatDurationMs(timing.totalMs, lang)}`}>
        {entries.map(([key, rawValue]) => {
          const value = Number(rawValue || 0);
          const percent = denominator > 0 ? (value / denominator) * 100 : 0;
          const label = timingSegmentLabels[key]?.[lang] || key;
          const activeClass = activeKey ? (activeKey === key ? "active" : "dimmed") : "";
          return (
            <span
              aria-label={`${label}: ${formatDurationMs(value, lang)}`}
              className={`request-timing-segment ${activeClass}`}
              key={key}
              onBlur={() => setActiveKey(null)}
              onFocus={() => setActiveKey(key)}
              onMouseEnter={() => setActiveKey(key)}
              onMouseLeave={() => setActiveKey(null)}
              style={{ backgroundColor: timingSegmentColor(key), flexBasis: `${percent}%` }}
              tabIndex={0}
              title={`${label}: ${formatDurationMs(value, lang)} (${formatPercent(value / denominator, lang)})`}
            />
          );
        })}
      </div>
      <div className="request-timing-legend">
        {entries.map(([key, rawValue]) => {
          const value = Number(rawValue || 0);
          const label = timingSegmentLabels[key]?.[lang] || key;
          const activeClass = activeKey ? (activeKey === key ? "active" : "dimmed") : "";
          return (
            <div
              className={`request-timing-item ${activeClass}`}
              key={key}
              onBlur={() => setActiveKey(null)}
              onFocus={() => setActiveKey(key)}
              onMouseEnter={() => setActiveKey(key)}
              onMouseLeave={() => setActiveKey(null)}
              tabIndex={0}
              title={`${label}: ${formatDurationMs(value, lang)} (${formatPercent(value / denominator, lang)})`}
            >
              <span className="request-timing-swatch" style={{ backgroundColor: timingSegmentColor(key) }} />
              <span>{label}</span>
              <strong>{formatDurationMs(value, lang)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequestLogsPanel({
  users = [],
  t,
  lang,
  canFilterUsers = false,
}: {
  users?: User[];
  t: Messages;
  lang: Lang;
  canFilterUsers?: boolean;
}) {
  const [logs, setLogs] = useState<RequestLogSummary[]>([]);
  const [filterUsers, setFilterUsers] = useState<User[]>(users);
  const [selectedUser, setSelectedUser] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Record<number, RequestLogDetailState>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    setFilterUsers(users);
  }, [users]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (canFilterUsers && selectedUser) params.set("userId", selectedUser);
    const startTime = localDateTimeToIso(startDate);
    const endTime = localDateTimeToIso(endDate);
    if (startTime) params.set("startTime", startTime);
    if (endTime) params.set("endTime", endTime);
    params.set("page", String(page));

    setLoading(true);
    setError("");
    api<RequestLogListResponse>(`/api/request-logs${params.toString() ? `?${params.toString()}` : ""}`)
      .then((data) => {
        if (cancelled) return;
        setLogs(data.logs || []);
        if (data.users) setFilterUsers(data.users);
        setPage(data.page || 1);
        setPageSize(data.pageSize || 20);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canFilterUsers, selectedUser, startDate, endDate, page]);

  async function loadDetail(logId: number) {
    setDetails((current) => ({ ...current, [logId]: { loading: true } }));
    try {
      const data = await api<RequestLogDetailResponse>(`/api/request-logs/${logId}`);
      setDetails((current) => ({
        ...current,
        [logId]: { detail: data.detail, raw: data.raw },
      }));
    } catch (err) {
      setDetails((current) => ({
        ...current,
        [logId]: { error: getErrorMessage(err) },
      }));
    }
  }

  function toggleLog(logId: number) {
    const shouldOpen = !openIds.has(logId);
    setOpenIds((current) => {
      const next = new Set(current);
      if (shouldOpen) next.add(logId);
      else next.delete(logId);
      return next;
    });
    if (shouldOpen && !details[logId]) {
      loadDetail(logId).catch((err) => {
        setDetails((current) => ({
          ...current,
          [logId]: { error: getErrorMessage(err) },
        }));
      });
    }
  }

  function clearFilters() {
    setSelectedUser("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  function changeUser(value: string) {
    setSelectedUser(value);
    setPage(1);
    setOpenIds(new Set());
  }

  function changeStartDate(value: string) {
    setStartDate(value);
    setPage(1);
    setOpenIds(new Set());
  }

  function changeEndDate(value: string) {
    setEndDate(value);
    setPage(1);
    setOpenIds(new Set());
  }

  const paginationText = lang === "zh"
    ? `第 ${formatNumber(page, lang)} / ${formatNumber(totalPages, lang)} 页 · 共 ${formatNumber(total, lang)} 条 · 每页 ${formatNumber(pageSize, lang)} 条`
    : `Page ${formatNumber(page, lang)} / ${formatNumber(totalPages, lang)} · ${formatNumber(total, lang)} total · ${formatNumber(pageSize, lang)} per page`;

  return (
    <section className="panel wide request-log-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">{canFilterUsers ? t.admin : t.account}</span>
          <h2>{t.requestLogs}</h2>
        </div>
      </div>
      <div className={`request-log-filters ${canFilterUsers ? "" : "compact"}`}>
        {canFilterUsers && (
          <label>
            {t.users}
            <select value={selectedUser} onChange={(event) => changeUser(event.target.value)}>
              <option value="">{t.allUsers}</option>
              {filterUsers.map((user) => (
                <option key={user.id} value={user.id}>{user.username}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t.startDate}
          <input type="datetime-local" value={startDate} onChange={(event) => changeStartDate(event.target.value)} />
        </label>
        <label>
          {t.endDate}
          <input type="datetime-local" value={endDate} onChange={(event) => changeEndDate(event.target.value)} />
        </label>
        <button className="icon-btn request-log-clear" title={t.clearFilters} onClick={clearFilters} type="button">
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div className="request-log-list" aria-busy={loading}>
        {loading && logs.length === 0 ? (
          <div className="request-log-empty">{t.processing}</div>
        ) : logs.length === 0 ? (
          <div className="request-log-empty">{t.noData}</div>
        ) : logs.map((log) => {
          const opened = openIds.has(log.id);
          const detailState = details[log.id];
          const detail = detailState?.detail;
          const timing = log.timing || detail?.timing;
          const durationText = formatDurationMs(log.durationMs, lang);
          const statusOk = log.statusCode >= 200 && log.statusCode < 300;
          const responseText = detail?.response?.error
            ? formatLogValue(detail.response.error)
            : formatLogValue(detail?.response?.body);
          const billingCost = detail?.billing?.cost;

          return (
            <article className={`request-log-card ${opened ? "open" : ""}`} key={log.id}>
              <button className="request-log-header" onClick={() => toggleLog(log.id)} type="button">
                <div className="request-log-title">
                  <strong>{log.username || `user-${log.userId}`}</strong>
                  <span>· {formatDateTimeSeconds(log.createdAt, lang)}</span>
                  <span>· <code>{log.modelId || "unknown"}</code></span>
                  {durationText !== "-" && <span className="request-log-duration" title={t.totalDuration}>{durationText}</span>}
                  <span className={`request-log-status ${statusOk ? "ok" : "error"}`}>HTTP {log.statusCode}</span>
                </div>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              {opened && (
                <div className="request-log-body">
                  <div className="request-log-meta">
                    <span><strong>{t.requestPath}</strong><code>{log.requestPath}</code></span>
                    <span><strong>{t.apiKey}</strong><code>{log.apiKeyPrefix ? `${log.apiKeyPrefix}...` : "-"}</code></span>
                    <span><strong>{t.cost}</strong>{formatPreciseCurrency(log.cost, lang)}</span>
                    <span><strong>{t.duration}</strong>{durationText}</span>
                    <span><strong>{t.cumulativeTokens}</strong>{formatNumber(requestLogUsage(log), lang)}</span>
                    <span><strong>{t.fileName}</strong><code>{log.auditFileName || "-"}</code></span>
                  </div>
                  {detailState?.loading && <div className="request-log-empty compact">{t.processing}</div>}
                  {detailState?.error && <div className="inline-error">{detailState.error}</div>}
                  {detailState?.raw && <RequestLogBlock title={t.requestLogs} text={detailState.raw} tone="amber" />}
                  {timing && <RequestTimingBar timing={timing} t={t} lang={lang} />}
                  {detail && (
                    <div className="request-log-sections">
                      <RequestLogBlock title={t.headers} text={formatLogValue(detail.request?.headers)} tone="amber" />
                      <RequestLogBlock title={t.requestBody} text={formatLogValue(detail.request?.body)} tone="blue" />
                      <RequestLogBlock title={t.response} text={responseText} tone={statusOk ? "green" : "red"} />
                      <RequestLogBlock
                        title={t.usage}
                        text={formatLogValue({
                          cost: billingCost === undefined || billingCost === null ? undefined : formatPreciseCurrency(billingCost, lang),
                          usage: detail.billing?.usage,
                        })}
                        tone="blue"
                      />
                      <RequestLogBlock
                        title={t.upstream}
                        text={formatLogValue({ upstreamUrl: detail.upstreamUrl, provider: detail.provider })}
                        tone="amber"
                      />
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="request-log-pagination">
        <button className="icon-btn" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} title="Previous page" type="button">
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <span>{paginationText}</span>
        <button className="icon-btn" disabled={loading || page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} title="Next page" type="button">
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function AdminPanel({
  data,
  reload,
  t,
  lang,
  currentUser,
}: {
  data: AdminData;
  reload: ReloadFn;
  t: Messages;
  lang: Lang;
  currentUser: User;
}) {
  const totals = data.totals || emptyStats;
  const parts = usageParts(totals);
  const cacheHitDenominator = parts.cached + parts.uncached;
  const cacheHitRate = cacheHitDenominator > 0 ? parts.cached / cacheHitDenominator : 0;
  const totalTokens = parts.cached + parts.uncached + parts.output + parts.embedding;
  const requestCount = Number(totals.requestCount || 0);
  const successRate = requestCount > 0 ? Number(totals.successCount || 0) / requestCount : 0;
  return (
    <div className="page-grid">
      <div className="admin-top-row">
        <section className="panel admin-stats-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t.admin}</span>
              <h2>{t.globalStats}</h2>
            </div>
          </div>
          <div className="stats-grid">
            <Stat label={t.totalCost} value={formatStatCurrency(totals.totalCost, lang)} tone="rose" />
            <Stat label={t.todayConsumed} value={formatStatCurrency(totals.todayCost, lang)} tone="amber" />
            <Stat label={t.requestCount} value={formatNumber(totals.requestCount, lang)} />
            <Stat label={t.requestSuccessRate} value={formatPercent(successRate, lang)} tone="green" />
            <Stat label={t.cumulativeTokens} value={formatNumber(totalTokens, lang)} tone="blue" />
            <Stat label={t.cacheHitRate} value={formatPercent(cacheHitRate, lang)} tone="blue" />
          </div>
        </section>
        <ProviderForm provider={data.provider} reload={reload} t={t} />
      </div>
      <PricingPanel pricing={data.pricing || []} reload={reload} t={t} lang={lang} />
      <UsersPanel users={data.users || []} reload={reload} t={t} lang={lang} currentUser={currentUser} />
      <section className="panel wide usage-panel">
        <div className="section-head">
          <div>
            <h2>{t.usageStats}</h2>
          </div>
        </div>
        <UsageStatsPanel
          dailyRows={data.dailyStats || []}
          dailyModelRows={data.dailyModelStats || []}
          modelRows={data.modelStats || []}
          t={t}
          lang={lang}
        />
      </section>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<AppPage>("dashboard");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("relay_lang") === "en" ? "en" : "zh"));
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem("relay_theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const t: Messages = messages[lang] || messages.zh;
  const pageTitle = active === "admin"
    ? t.adminConsole
    : active === "requestLogs"
      ? t.requestLogs
      : active === "feedback"
        ? t.feedback
        : active === "feedbackReview"
          ? t.feedbackReview
      : t.userDashboard;

  function setLang(value: Lang) {
    localStorage.setItem("relay_lang", value);
    setLangState(value);
  }

  function setThemeMode(value: ThemeMode) {
    localStorage.setItem("relay_theme", value);
    setThemeModeState(value);
  }

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const resolved = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = themeMode;
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [themeMode, systemDark, lang]);

  async function loadSession() {
    setLoading(true);
    try {
      const data = await api<{ user: User | null }>("/api/session");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboard() {
    if (!user) return;
    const data = await api<Overview>("/api/me/overview");
    setOverview(data);
  }

  async function loadAdmin() {
    if (user?.role !== "admin") return;
    const data = await api<AdminData>("/api/admin/overview");
    setAdminData(data);
  }

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (!user) return;
    setError("");
    const normalizedActive = normalizeActivePage(user.role, active);
    if (normalizedActive !== active) setActive(normalizedActive);
    loadDashboard().catch((err) => setError(getErrorMessage(err)));
    if (user.role === "admin") loadAdmin().catch((err) => setError(getErrorMessage(err)));
  }, [user]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setOverview(null);
    setAdminData(null);
    setActive("dashboard");
  }

  if (loading) return <div className="loading">Loading</div>;
  if (!user) {
    return (
      <AuthScreen
        onAuthed={setUser}
        lang={lang}
        setLang={setLang}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        t={t}
      />
    );
  }

  const navigationLabels: Record<AppPage, string> = {
    dashboard: t.dashboard,
    admin: t.admin,
    requestLogs: t.requestLogs,
    feedback: t.feedback,
    feedbackReview: t.feedbackReview,
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="app-title">
          <span>Ema Powerbank</span>
        </div>
        <nav>
          {navigationItemsForRole(user.role).map((item) => (
            <button className={active === item.id ? "active" : ""} key={item.id} onClick={() => setActive(item.id)} type="button">
              <NavigationIcon page={item.id} />
              {navigationLabels[item.id]}
            </button>
          ))}
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">{t.signedIn}</span>
            <h1>{pageTitle}</h1>
          </div>
          <div className="topbar-actions">
            <PreferenceControls lang={lang} setLang={setLang} themeMode={themeMode} setThemeMode={setThemeMode} t={t} />
            <span className="user-chip">
              <strong>{user.username}</strong>
            </span>
            <button className="icon-btn" title={t.logout} onClick={logout} type="button">
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        {error && <div className="inline-error">{error}</div>}
        {active === "admin" && user.role === "admin"
          ? adminData && <AdminPanel data={adminData} reload={loadAdmin} t={t} lang={lang} currentUser={user} />
          : active === "requestLogs"
            ? (
                <div className="page-grid">
                  <RequestLogsPanel
                    users={user.role === "admin" ? adminData?.users || [] : [user]}
                    t={t}
                    lang={lang}
                    canFilterUsers={user.role === "admin"}
                  />
                </div>
              )
            : active === "feedback"
              ? <FeedbackPanel t={t} lang={lang} />
              : active === "feedbackReview" && user.role === "admin"
                ? <div className="page-grid"><FeedbackReviewPanel reload={loadAdmin} t={t} lang={lang} /></div>
            : overview && <Dashboard overview={overview} reload={loadDashboard} t={t} lang={lang} />}
      </section>
    </main>
  );
}
