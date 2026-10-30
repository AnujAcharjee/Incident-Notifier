import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required"),
  OPENROUTER_API_KEY: z.string().optional(),

  // Vector Database (Qdrant - Local or Cloud)
  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default("incident-knowledge"),

  // Log Aggregator (Loki - Local or Grafana Cloud)
  LOKI_URL: z.string().default("http://localhost:3100"),
  LOKI_USERNAME: z.string().optional(),
  LOKI_PASSWORD: z.string().optional(),

  // Notifications & Agents
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  POLL_INTERVAL_MS: z.coerce.number().default(4000),
  DEDUP_WINDOW_MS: z.coerce.number().default(300000),
  INVESTIGATION_COOLDOWN_MS: z.coerce.number().default(15000),
  NODE_ENV: z.string().default("development"),
});

const parsed = envSchema.parse(process.env);

// Normalize Qdrant URL
const normalizedQdrantUrl = parsed.QDRANT_URL.trim().replace(/\/+$/, "");

// Normalize Loki URL (strips trailing /loki/api/v1/push or /loki/api/v1 if pasted from Grafana Cloud)
const normalizedLokiUrl = parsed.LOKI_URL
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/loki\/api\/v1(\/push)?\/?$/, "")
  .replace(/\/+$/, "");

// Generate Basic Auth header if credentials are provided (for Grafana Cloud / protected Loki)
const lokiUsername = (parsed.LOKI_USERNAME || "").trim();
const lokiPassword = (parsed.LOKI_PASSWORD || "").trim();
let lokiAuthHeader: string | undefined = undefined;

if (lokiUsername && lokiPassword) {
  const credentials = Buffer.from(`${lokiUsername}:${lokiPassword}`).toString("base64");
  lokiAuthHeader = `Basic ${credentials}`;
}

const isLokiCloud = Boolean(
  normalizedLokiUrl.includes("grafana.net") || (lokiUsername && lokiPassword)
);

const isQdrantCloud = Boolean(
  parsed.QDRANT_API_KEY || normalizedQdrantUrl.includes("qdrant.io")
);

export const ENV = {
  ...parsed,
  QDRANT_URL: normalizedQdrantUrl,
  LOKI_URL: normalizedLokiUrl,
  LOKI_AUTH_HEADER: lokiAuthHeader,
  IS_LOKI_CLOUD: isLokiCloud,
  IS_QDRANT_CLOUD: isQdrantCloud,
};

export type EnvConfig = typeof ENV;
