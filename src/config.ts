import 'dotenv/config';
import { z } from 'zod';

const isDev = process.env.NODE_ENV === "development";

const envSchema = z.object({
    GOOGLE_API_KEY: z.string().min(1),
    OPENROUTER_API_KEY: z.string().min(1),
})

export const ENV = envSchema.parse(process.env);