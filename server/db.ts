import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type {
  PricingDto,
  PricingPayload,
  PricingRow,
  ProviderConfig,
  ProviderPublicConfig,
  UserRow,
} from "./types.js";

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const REQUEST_LOG_DIR = path.join(ROOT_DIR, "request-logs");
export const FEEDBACK_DIR = path.join(ROOT_DIR, "feedback");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(REQUEST_LOG_DIR, { recursive: true });
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "relay.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const now = () => new Date().toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_value TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL UNIQUE,
  input_price REAL NOT NULL DEFAULT 0,
  output_price REAL NOT NULL DEFAULT 0,
  cache_price REAL NOT NULL DEFAULT 0,
  embedding_input_price REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  model_id TEXT,
  endpoint TEXT NOT NULL,
  request_path TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  cached_content_token_count INTEGER NOT NULL DEFAULT 0,
  prompt_token_count INTEGER NOT NULL DEFAULT 0,
  thoughts_token_count INTEGER NOT NULL DEFAULT 0,
  candidates_token_count INTEGER NOT NULL DEFAULT 0,
  billable_character_count INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  duration_ms REAL NOT NULL DEFAULT 0,
  timing_json TEXT,
  audit_file TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_id_usage_date
  ON usage_records(user_id, usage_date);
`);

const ensureColumn = (table: string, column: string, definition: string) => {
  const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((item) => item.name);
  if (!columns.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  }
};

ensureColumn("api_keys", "key_value", "key_value TEXT");
ensureColumn("usage_records", "duration_ms", "duration_ms REAL NOT NULL DEFAULT 0");
ensureColumn("usage_records", "timing_json", "timing_json TEXT");

const seedAdmin = () => {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: number } | undefined;
  if (existingAdmin) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123456";
  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, balance, created_at, updated_at)
    VALUES (?, ?, 'admin', 0, ?, ?)
  `).run(username, passwordHash, now(), now());
};

const seedPricing = () => {
  const seedVersion = "2026-06-03-default-pricing";
  const currentSeedVersion = (db.prepare("SELECT value FROM settings WHERE key = ?").get("pricing_seed_version") as { value: string } | undefined)?.value;
  if (currentSeedVersion === seedVersion) return;

  const defaultPricing = [
    {
      modelId: "gemini-3.5-flash",
      inputPrice: 1.5,
      outputPrice: 9,
      cachePrice: 0.15,
      embeddingInputPrice: 0,
    },
    {
      modelId: "gemini-3.1-pro-preview",
      inputPrice: 2,
      outputPrice: 12,
      cachePrice: 0.2,
      embeddingInputPrice: 0,
    },
    {
      modelId: "gemini-embedding-001",
      inputPrice: 0,
      outputPrice: 0,
      cachePrice: 0,
      embeddingInputPrice: 0.15,
    },
    {
      modelId: "gemini-embedding-2",
      inputPrice: 0,
      outputPrice: 0,
      cachePrice: 0,
      embeddingInputPrice: 0.2,
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO pricing
      (model_id, input_price, output_price, cache_price, embedding_input_price, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      input_price = excluded.input_price,
      output_price = excluded.output_price,
      cache_price = excluded.cache_price,
      embedding_input_price = excluded.embedding_input_price,
      updated_at = excluded.updated_at
  `);
  const deleteLegacyZeroRows = db.prepare(`
    DELETE FROM pricing
    WHERE model_id IN ('gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-embedding-2-preview')
      AND input_price = 0
      AND output_price = 0
      AND cache_price = 0
      AND embedding_input_price = 0
  `);

  db.transaction(() => {
    for (const row of defaultPricing) {
      stmt.run(
        row.modelId,
        row.inputPrice,
        row.outputPrice,
        row.cachePrice,
        row.embeddingInputPrice,
        now(),
        now(),
      );
    }
    deleteLegacyZeroRows.run();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('pricing_seed_version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(seedVersion, now());
  })();
};

seedAdmin();
seedPricing();

db.prepare(`
  UPDATE usage_records
  SET
    billable_character_count = CASE
      WHEN billable_character_count > 0 THEN billable_character_count
      ELSE prompt_token_count + thoughts_token_count + candidates_token_count
    END,
    cached_content_token_count = 0,
    prompt_token_count = 0,
    thoughts_token_count = 0,
    candidates_token_count = 0
  WHERE LOWER(COALESCE(model_id, '')) LIKE '%embedding%'
    AND (
      cached_content_token_count != 0
      OR prompt_token_count != 0
      OR thoughts_token_count != 0
      OR candidates_token_count != 0
    )
`).run();

export function getSetting(key: string): string | null {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now());
}

export function publicUser(row: UserRow | undefined | null) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    balance: Number(row.balance ?? 0),
    createdAt: row.created_at,
  };
}

export function getProviderConfig(options: { includeSecret: true }): ProviderConfig | null;
export function getProviderConfig(options?: { includeSecret?: false }): ProviderPublicConfig | null;
export function getProviderConfig(options: { includeSecret?: boolean } = {}): ProviderConfig | ProviderPublicConfig | null {
  const { includeSecret = false } = options;
  const raw = getSetting("provider_config");
  if (!raw) return null;
  const config = JSON.parse(raw) as ProviderConfig;
  if (includeSecret) return config;
  const mode = config.mode === "vertex" ? "vertex" : "ai_studio";
  return {
    mode,
    location: mode === "vertex" ? config.location : "",
    projectId: mode === "vertex" ? config.projectId : "",
    configured: Boolean(config.key),
    keyPreview: config.key ? maskSecret(config.key) : "",
    updatedAt: config.updatedAt,
  };
}

export function saveProviderConfig(config: ProviderConfig) {
  setSetting("provider_config", JSON.stringify({ ...config, updatedAt: now() }));
}

export function clearProviderConfig() {
  db.prepare("DELETE FROM settings WHERE key = 'provider_config'").run();
}

export function listPricing(): PricingDto[] {
  return (db.prepare("SELECT * FROM pricing ORDER BY model_id").all() as PricingRow[]).map((row) => ({
    id: row.id,
    modelId: row.model_id,
    inputPrice: Number(row.input_price),
    outputPrice: Number(row.output_price),
    cachePrice: Number(row.cache_price),
    embeddingInputPrice: Number(row.embedding_input_price),
    updatedAt: row.updated_at,
  }));
}

export function getPricingForModel(modelId: string): PricingRow | undefined {
  return db.prepare("SELECT * FROM pricing WHERE model_id = ?").get(modelId) as PricingRow | undefined;
}

export function upsertPricing(payload: PricingPayload) {
  const ts = now();
  db.prepare(`
    INSERT INTO pricing
      (model_id, input_price, output_price, cache_price, embedding_input_price, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      input_price = excluded.input_price,
      output_price = excluded.output_price,
      cache_price = excluded.cache_price,
      embedding_input_price = excluded.embedding_input_price,
      updated_at = excluded.updated_at
  `).run(
    payload.modelId,
    Number(payload.inputPrice || 0),
    Number(payload.outputPrice || 0),
    Number(payload.cachePrice || 0),
    Number(payload.embeddingInputPrice || 0),
    ts,
    ts,
  );
  return getPricingForModel(payload.modelId);
}

export function createPricing(payload: PricingPayload) {
  const ts = now();
  try {
    db.prepare(`
      INSERT INTO pricing
        (model_id, input_price, output_price, cache_price, embedding_input_price, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.modelId,
      Number(payload.inputPrice || 0),
      Number(payload.outputPrice || 0),
      Number(payload.cachePrice || 0),
      Number(payload.embeddingInputPrice || 0),
      ts,
      ts,
    );
  } catch (error) {
    if (String((error as { code?: string }).code || "").includes("SQLITE_CONSTRAINT")) {
      const conflict = new Error("Pricing model already exists") as Error & { code?: string };
      conflict.code = "PRICING_MODEL_CONFLICT";
      throw conflict;
    }
    throw error;
  }
  return getPricingForModel(payload.modelId);
}

export function deletePricing(id: string | number) {
  db.prepare("DELETE FROM pricing WHERE id = ?").run(id);
}

export function maskSecret(value: string) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (trimmed.length <= 12) return `${trimmed.slice(0, 3)}...`;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function isoNow() {
  return now();
}
