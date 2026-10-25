import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
    GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required"),
    OPENROUTER_API_KEY: z.string().optional(),
    QDRANT_URL: z.string().default("http://localhost:6333"),
    QDRANT_API_KEY: z.string().optional(),
    QDRANT_COLLECTION: z.string().default("incident-knowledge"),
    LOKI_URL: z.string().default("http://localhost:3100"),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),
    GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
    POLL_INTERVAL_MS: z.coerce.number().default(4000),
    DEDUP_WINDOW_MS: z.coerce.number().default(300000),
    INVESTIGATION_COOLDOWN_MS: z.coerce.number().default(15000),
    NODE_ENV: z.string().default("development"),
});

export const ENV = envSchema.parse(process.env);
export type EnvConfig = z.infer<typeof envSchema>;