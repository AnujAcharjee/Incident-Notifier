/**
 * @file test-app/src/logger.ts
 * @description Structured application logger formatting log events with trace IDs.
 * Concurrently outputs colored ANSI lines to stdout and forwards typed events to LokiPusher
 * for batch ingestion into Grafana Loki.
 */

import { lokiPusher, type LogEntry } from "./loki";

export interface LogPayload {
  service: string;
  message: string;
  errorCode?: string;
  traceId?: string;
  metadata?: Record<string, any>;
}

/**
 * Generates an 8-character pseudo-random distributed trace identifier.
 */
function generateTraceId(): string {
  return "tr-" + Math.random().toString(36).substring(2, 10);
}

export const logger = {
  info(payload: LogPayload): void {
    const entry: LogEntry = {
      level: "info",
      service: payload.service,
      message: payload.message,
      traceId: payload.traceId || generateTraceId(),
      metadata: payload.metadata,
      timestamp: new Date().toISOString(),
    };
    console.log(`\x1b[32m[INFO]\x1b[0m [${entry.service}] [${entry.traceId}] ${entry.message}`);
    lokiPusher.push(entry);
  },

  warn(payload: LogPayload): void {
    const entry: LogEntry = {
      level: "warn",
      service: payload.service,
      message: payload.message,
      errorCode: payload.errorCode,
      traceId: payload.traceId || generateTraceId(),
      metadata: payload.metadata,
      timestamp: new Date().toISOString(),
    };
    console.warn(`\x1b[33m[WARN]\x1b[0m [${entry.service}] [${entry.traceId}] ${entry.message}`);
    lokiPusher.push(entry);
  },

  error(payload: LogPayload): void {
    const entry: LogEntry = {
      level: "error",
      service: payload.service,
      message: payload.message,
      errorCode: payload.errorCode,
      traceId: payload.traceId || generateTraceId(),
      metadata: payload.metadata,
      timestamp: new Date().toISOString(),
    };
    console.error(`\x1b[31m[ERROR]\x1b[0m [${entry.service}] [${entry.errorCode || "ERR"}] [${entry.traceId}] ${entry.message}`);
    lokiPusher.push(entry);
  },
};
