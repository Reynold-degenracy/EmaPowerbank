import express from "express";
import type { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import {
  FEEDBACK_DIR,
  REQUEST_LOG_DIR,
  clearProviderConfig,
  db,
  createPricing,
  deletePricing,
  getProviderConfig,
  isoNow,
  listPricing,
  publicUser,
  saveProviderConfig,
} from "./db.js";
import {
  clearSessionCookie,
  createApiKey,
  hashPassword,
  listUserApiKeys,
  requireAdmin,
  requireSession,
  sanitizeUser,
  setSessionCookie,
  signSession,
  verifyPassword,
} from "./auth.js";
import {
  adminDailyStats,
  adminDailyModelStats,
  adminModelStats,
  recentUsage,
  userDailyStats,
  userDailyModelStats,
  userModelStats,
} from "./billing.js";
import { createGoogleGenAIClient, normalizeProviderConfig } from "./googleProvider.js";
import { proxyMiddlewares } from "./proxy.js";
import {
  FEEDBACK_MAX_BODY_BYTES,
  createFeedbackPackage,
  feedbackPayloadFromMultipart,
  multipartBoundary,
  parseMultipartFields,
  readRequestBuffer,
} from "./feedback.js";
import type { HttpError, RequestTiming, UserRow } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(cookieParser());
app.use((req, res, next) => {
  if (!/^\/api\/v1(?:alpha|beta1?)?\//.test(req.path)) return next();
  return proxyMiddlewares[0](req, res, (error) => {
    if (error) return next(error);
    return proxyMiddlewares[1](req, res, next);
  });
});
app.use(express.json({ limit: "2mb" }));

const userSelect = `
  SELECT id, username, role, balance, created_at, updated_at
  FROM users
`;

const adminUserSelect = `
  SELECT
    users.id,
    users.username,
    users.role,
    users.balance,
    users.created_at,
    users.updated_at,
    COALESCE(SUM(usage_records.cost), 0) AS totalSpent
  FROM users
  LEFT JOIN usage_records ON usage_records.user_id = users.id
  GROUP BY users.id, users.username, users.role, users.balance, users.created_at, users.updated_at
`;

type AdminUserRow = UserRow & { totalSpent: number };

function publicAdminUser(row: AdminUserRow) {
  return {
    ...publicUser(row)!,
    totalSpent: Number(row.totalSpent || 0),
  };
}

function listAdminUsers(orderBy: "created_at" | "username" = "created_at") {
  const orderSql = orderBy === "username" ? "users.username ASC" : "users.created_at DESC";
  return (db.prepare(`${adminUserSelect} ORDER BY ${orderSql}`).all() as AdminUserRow[]).map(publicAdminUser);
}

interface RequestLogRow {
  id: number;
  userId: number;
  username: string | null;
  apiKeyId: number | null;
  apiKeyPrefix: string | null;
  modelId: string | null;
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
  durationMs: number;
  timingJson: string | null;
  auditFile: string;
  createdAt: string;
}

const requestLogSelect = `
  SELECT
    u.id,
    u.user_id AS userId,
    users.username AS username,
    u.api_key_id AS apiKeyId,
    api_keys.key_prefix AS apiKeyPrefix,
    u.model_id AS modelId,
    u.endpoint,
    u.request_path AS requestPath,
    u.usage_date AS usageDate,
    u.status_code AS statusCode,
    u.cached_content_token_count AS cachedContentTokenCount,
    u.prompt_token_count AS promptTokenCount,
    u.thoughts_token_count AS thoughtsTokenCount,
    u.candidates_token_count AS candidatesTokenCount,
    u.billable_character_count AS billableCharacterCount,
    u.cost,
    u.duration_ms AS durationMs,
    u.timing_json AS timingJson,
    u.audit_file AS auditFile,
    u.created_at AS createdAt
  FROM usage_records u
  INNER JOIN users ON users.id = u.user_id
  LEFT JOIN api_keys ON api_keys.id = u.api_key_id
`;

function parseRequestTiming(value: string | null): RequestTiming | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RequestTiming;
    if (!Number.isFinite(Number(parsed?.totalMs)) || !parsed?.segments || typeof parsed.segments !== "object") {
      return null;
    }
    return {
      totalMs: Number(parsed.totalMs),
      segments: Object.fromEntries(
        Object.entries(parsed.segments)
          .filter(([, segmentValue]) => Number.isFinite(Number(segmentValue)))
          .map(([key, segmentValue]) => [key, Number(segmentValue)]),
      ),
    };
  } catch {
    return null;
  }
}

function publicRequestLog(row: RequestLogRow) {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username || `user-${row.userId}`,
    apiKeyId: row.apiKeyId,
    apiKeyPrefix: row.apiKeyPrefix,
    modelId: row.modelId,
    endpoint: row.endpoint,
    requestPath: row.requestPath,
    usageDate: row.usageDate,
    statusCode: row.statusCode,
    cachedContentTokenCount: row.cachedContentTokenCount,
    promptTokenCount: row.promptTokenCount,
    thoughtsTokenCount: row.thoughtsTokenCount,
    candidatesTokenCount: row.candidatesTokenCount,
    billableCharacterCount: row.billableCharacterCount,
    cost: row.cost,
    durationMs: Number(row.durationMs || 0),
    timing: parseRequestTiming(row.timingJson),
    auditFileName: path.basename(row.auditFile || ""),
    createdAt: row.createdAt,
  };
}

function queryValue(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function queryDate(value: unknown) {
  const raw = queryValue(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const error = new Error("Date filters must use yyyy-mm-dd") as HttpError;
  error.status = 400;
  throw error;
}

function queryTime(value: unknown) {
  const raw = queryValue(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const error = new Error("Time filters must use a valid date time") as HttpError;
  error.status = 400;
  throw error;
}

function queryPositiveInt(value: unknown, fallback: number) {
  const numberValue = Number(queryValue(value));
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function resolveAuditFilePath(auditFile: string) {
  const root = path.resolve(REQUEST_LOG_DIR);
  const candidate = path.resolve(path.isAbsolute(auditFile) ? auditFile : path.join(REQUEST_LOG_DIR, auditFile));
  if (candidate !== root && candidate.startsWith(`${root}${path.sep}`)) return candidate;
  const error = new Error("Audit file path is outside request log directory") as HttpError;
  error.status = 400;
  throw error;
}

function listAvailableModels() {
  return listPricing()
    .filter((item) => [
      item.inputPrice,
      item.outputPrice,
      item.cachePrice,
      item.embeddingInputPrice,
    ].some((value) => Number(value) > 0))
    .map((item) => ({
      modelId: item.modelId,
      inputPrice: item.inputPrice,
      outputPrice: item.outputPrice,
      cachePrice: item.cachePrice,
      embeddingInputPrice: item.embeddingInputPrice,
    }));
}

function requireFields(body: Record<string, unknown> | undefined, fields: string[]) {
  for (const field of fields) {
    if (!String(body?.[field] || "").trim()) {
      const error = new Error(`${field} is required`) as HttpError;
      error.status = 400;
      throw error;
    }
  }
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: isoNow() });
});

app.get("/api/session", (req, res) => {
  const token = req.cookies?.relay_session;
  if (!token) return res.json({ user: null });
  try {
    requireSession(req, res, () => res.json({ user: sanitizeUser(req.user) }));
  } catch {
    res.json({ user: null });
  }
});

app.post("/api/auth/register", asyncHandler(async (req, res) => {
  requireFields(req.body, ["username", "password"]);
  const username = String(req.body.username).trim();
  const password = String(req.body.password);
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-32 characters: letters, numbers, _ or -" });
  }
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const passwordHash = await hashPassword(password);
  const ts = isoNow();

  try {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, balance, created_at, updated_at)
      VALUES (?, ?, 'user', 0, ?, ?)
    `).run(username, passwordHash, ts, ts);
    const user = db.prepare(`${userSelect} WHERE id = ?`).get(result.lastInsertRowid) as UserRow;
    setSessionCookie(res, signSession(user));
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Username already exists" });
    }
    throw error;
  }
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  requireFields(req.body, ["username", "password"]);
  const username = String(req.body.username).trim();
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  if (!row || !(await verifyPassword(String(req.body.password), row.password_hash))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  setSessionCookie(res, signSession(row));
  res.json({ user: publicUser(row) });
}));

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me/overview", requireSession, (req, res) => {
  const today = isoNow().slice(0, 10);
  const user = req.user!;
  const usageSummary = db.prepare(`
    SELECT
      COUNT(*) AS requestCount,
      SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successCount,
      COALESCE(SUM(cost), 0) AS totalCost,
      COALESCE(SUM(CASE WHEN usage_date = ? THEN cost ELSE 0 END), 0) AS todayCost
    FROM usage_records
    WHERE user_id = ?
  `).get(today, user.id) as {
    requestCount: number | null;
    successCount: number | null;
    totalCost: number | null;
    todayCost: number | null;
  };
  const requestCount = Number(usageSummary.requestCount || 0);
  const successCount = Number(usageSummary.successCount || 0);

  res.json({
    user: publicUser(user),
    apiKeys: listUserApiKeys(user.id),
    dailyStats: userDailyStats(user.id),
    dailyModelStats: userDailyModelStats(user.id),
    modelStats: userModelStats(user.id),
    usageSummary: {
      requestCount,
      successCount,
      totalCost: Number(usageSummary.totalCost || 0),
      todayCost: Number(usageSummary.todayCost || 0),
      successRate: requestCount > 0 ? successCount / requestCount : 0,
    },
    availableModels: listAvailableModels(),
    recentUsage: recentUsage(user.id),
  });
});

app.post("/api/keys", requireSession, (req, res) => {
  try {
    const created = createApiKey(req.user!.id, req.body?.name);
    res.status(201).json(created);
  } catch (error) {
    const relayError = error as HttpError;
    if (relayError.code === "API_KEY_ALIAS_CONFLICT") {
      return res.status(409).json({ error: relayError.message });
    }
    throw error;
  }
});

app.delete("/api/keys/:id", requireSession, (req, res) => {
  const result = db.prepare(`
    UPDATE api_keys
    SET revoked_at = ?
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).run(isoNow(), req.params.id, req.user!.id);
  res.json({ ok: result.changes > 0 });
});

app.get("/api/admin/overview", requireSession, requireAdmin, (req, res) => {
  const users = listAdminUsers();
  const today = isoNow().slice(0, 10);
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS requestCount,
      SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successCount,
      SUM(cost) AS totalCost,
      COALESCE(SUM(CASE WHEN usage_date = ? THEN cost ELSE 0 END), 0) AS todayCost,
      SUM(prompt_token_count) AS promptTokenCount,
      SUM(cached_content_token_count) AS cachedContentTokenCount,
      SUM(thoughts_token_count) AS thoughtsTokenCount,
      SUM(candidates_token_count) AS candidatesTokenCount,
      SUM(billable_character_count) AS billableCharacterCount
    FROM usage_records
  `).get(today) as Record<string, number | null>;

  res.json({
    users,
    provider: getProviderConfig(),
    pricing: listPricing(),
    dailyStats: adminDailyStats(),
    dailyModelStats: adminDailyModelStats(),
    modelStats: adminModelStats(),
    totals,
  });
});

const listRequestLogs = (req: Request, res: Response) => {
  const where: string[] = [];
  const params: unknown[] = [];
  const userId = Number(queryValue(req.query.userId));
  const startTime = queryTime(req.query.startTime);
  const endTime = queryTime(req.query.endTime);
  const startDate = startTime ? "" : queryDate(req.query.startDate || req.query.from);
  const endDate = endTime ? "" : queryDate(req.query.endDate || req.query.to);
  const requestedPage = queryPositiveInt(req.query.page, 1);
  const pageSize = 20;

  if (req.user!.role !== "admin") {
    where.push("u.user_id = ?");
    params.push(req.user!.id);
  } else if (Number.isFinite(userId) && userId > 0) {
    where.push("u.user_id = ?");
    params.push(userId);
  }
  if (startTime) {
    where.push("u.created_at >= ?");
    params.push(startTime);
  } else if (startDate) {
    where.push("u.usage_date >= ?");
    params.push(startDate);
  }
  if (endTime) {
    where.push("u.created_at <= ?");
    params.push(endTime);
  } else if (endDate) {
    where.push("u.usage_date <= ?");
    params.push(endDate);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM usage_records u
    INNER JOIN users ON users.id = u.user_id
    LEFT JOIN api_keys ON api_keys.id = u.api_key_id
    ${whereSql}
  `).get(...params) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    ${requestLogSelect}
    ${whereSql}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as RequestLogRow[];

  res.json({
    logs: rows.map(publicRequestLog),
    users: req.user!.role === "admin"
      ? (db.prepare(`${userSelect} ORDER BY username ASC`).all() as UserRow[]).map(publicUser)
      : [publicUser(req.user!)],
    page,
    pageSize,
    total,
    totalPages,
  });
};

const getRequestLogDetail = asyncHandler(async (req: Request, res: Response) => {
  const logId = Number(req.params.id);
  if (!Number.isFinite(logId)) return res.status(400).json({ error: "Invalid request log id" });

  const row = db.prepare(`
    ${requestLogSelect}
    WHERE u.id = ?
      AND (? = 'admin' OR u.user_id = ?)
  `).get(logId, req.user!.role, req.user!.id) as RequestLogRow | undefined;
  if (!row) return res.status(404).json({ error: "Request log not found" });

  const auditPath = resolveAuditFilePath(row.auditFile);
  let raw = "";
  try {
    raw = await fs.promises.readFile(auditPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return res.status(404).json({ error: "Request log file not found" });
    }
    throw error;
  }
  try {
    res.json({ log: publicRequestLog(row), detail: JSON.parse(raw) });
  } catch {
    res.json({ log: publicRequestLog(row), detail: null, raw });
  }
});

app.get("/api/request-logs", requireSession, listRequestLogs);
app.get("/api/request-logs/:id", requireSession, getRequestLogDetail);
app.get("/api/admin/request-logs", requireSession, requireAdmin, listRequestLogs);
app.get("/api/admin/request-logs/:id", requireSession, requireAdmin, getRequestLogDetail);

app.post("/api/feedback", requireSession, asyncHandler(async (req, res) => {
  const boundary = multipartBoundary(req.headers["content-type"]);
  if (!boundary) {
    const error = new Error("feedback must use multipart/form-data") as HttpError;
    error.status = 415;
    throw error;
  }

  const body = await readRequestBuffer(req, FEEDBACK_MAX_BODY_BYTES);
  const payload = feedbackPayloadFromMultipart(parseMultipartFields(body, boundary));
  const feedback = await createFeedbackPackage({
    feedbackDir: FEEDBACK_DIR,
    user: {
      id: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
    },
    description: payload.description,
    attachment: payload.attachment,
  });

  res.status(201).json({ feedback });
}));

app.post("/api/admin/provider", requireSession, requireAdmin, (req, res) => {
  try {
    const config = normalizeProviderConfig(req.body);
    createGoogleGenAIClient(config);
    saveProviderConfig(config);
    res.json({ provider: getProviderConfig() });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete("/api/admin/provider", requireSession, requireAdmin, (req, res) => {
  clearProviderConfig();
  res.json({ provider: getProviderConfig() });
});

app.post("/api/admin/pricing", requireSession, requireAdmin, (req, res) => {
  if (!String(req.body?.modelId || "").trim()) {
    return res.status(400).json({ error: "modelId is required" });
  }
  try {
    const row = createPricing({
      modelId: String(req.body.modelId).trim(),
      inputPrice: req.body.inputPrice,
      outputPrice: req.body.outputPrice,
      cachePrice: req.body.cachePrice,
      embeddingInputPrice: req.body.embeddingInputPrice,
    });
    res.status(201).json({ pricing: listPricing(), row });
  } catch (error) {
    const relayError = error as HttpError;
    if (relayError.code === "PRICING_MODEL_CONFLICT") {
      return res.status(409).json({ error: relayError.message });
    }
    throw error;
  }
});

app.delete("/api/admin/pricing/:id", requireSession, requireAdmin, (req, res) => {
  deletePricing(String(req.params.id));
  res.json({ pricing: listPricing() });
});

app.patch("/api/admin/users/:id/balance", requireSession, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const ts = isoNow();
  if (Number.isFinite(Number(req.body?.delta))) {
    db.prepare("UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?")
      .run(Number(req.body.delta), ts, userId);
  } else if (Number.isFinite(Number(req.body?.balance))) {
    db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?")
      .run(Number(req.body.balance), ts, userId);
  } else {
    return res.status(400).json({ error: "balance or delta is required" });
  }

  const user = db.prepare(`${userSelect} WHERE id = ?`).get(userId) as UserRow | undefined;
  res.json({
    user: publicUser(user),
    users: listAdminUsers(),
  });
});

app.delete("/api/admin/users/:id", requireSession, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
  if (userId === req.user!.id) return res.status(400).json({ error: "Cannot delete the current admin user" });

  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(userId) as { id: number } | undefined;
  if (!existing) return res.status(404).json({ error: "User not found" });

  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  res.json({ users: listAdminUsers() });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

if (isProduction) {
  const distDir = path.join(process.cwd(), "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use(/^\/(?!api\/).*/, async (req, res, next) => {
    try {
      const template = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

app.use((error: HttpError, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({ error: error.message || "Internal server error" });
});

app.listen(port, () => {
  console.log(`Ema Powerbank listening on http://localhost:${port}`);
});
