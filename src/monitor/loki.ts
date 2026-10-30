/**
 * @file src/monitor/loki.ts
 * @description Grafana Loki integration layer and in-memory error deduplication engine.
 * Handles HTTP Basic Authentication for Grafana Cloud Loki, transforms Loki's matrix/stream
 * nested response schema into flat structured log entries, and provides stable error fingerprinting
 * to prevent alert fatigue during cascading failures.
 */

import { ENV } from "../config";

/**
 * Normalized log record extracted from Loki streams.
 */
export interface LokiLogEntry {
  timestamp: string;
  timeNano: string;
  level: "info" | "warn" | "error";
  service: string;
  message: string;
  errorCode?: string;
  traceId?: string;
  metadata?: Record<string, any>;
  rawLine: string;
}

export interface LokiStreamResult {
  stream: Record<string, string>;
  values: Array<[string, string]>; // [unix_nano_string, line_content]
}

export interface LokiQueryResponse {
  status: "success" | "error";
  data?: {
    resultType: "streams" | "matrix" | "vector";
    result: LokiStreamResult[];
  };
  error?: string;
}

/**
 * Client for executing LogQL queries against Grafana Loki HTTP REST API.
 */
export class LokiClient {
  private baseUrl: string;
  private authHeader?: string;

  constructor(baseUrl = ENV.LOKI_URL, authHeader = ENV.LOKI_AUTH_HEADER) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.authHeader = authHeader;
  }

  /**
   * Generates authorization headers when targeting authenticated Loki clusters.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.authHeader) {
      headers["Authorization"] = this.authHeader;
    }
    return headers;
  }

  /**
   * Probes Loki readiness.
   * Tries `/ready` first (standard on open-source local Loki), falling back to `/loki/api/v1/labels`
   * with credentials (required on Grafana Cloud Loki where `/ready` is blocked by cloud gateways).
   */
  async isReady(): Promise<boolean> {
    const headers = this.getHeaders();
    try {
      const res = await fetch(`${this.baseUrl}/ready`, { headers });
      if (res.status === 200) return true;

      const labelsRes = await fetch(`${this.baseUrl}/loki/api/v1/labels`, { headers });
      return labelsRes.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Queries Loki for recent error-level logs within a given timestamp boundary.
   *
   * @param sinceNano - Lower time boundary in nanoseconds (omitted defaults to last 5 minutes)
   * @param limit - Max entries to retrieve per batch
   */
  async queryErrors(sinceNano?: string, limit = 50): Promise<LokiLogEntry[]> {
    const query = '{level="error"}';
    const params = new URLSearchParams({
      query,
      limit: limit.toString(),
      direction: "forward",
    });

    if (sinceNano) {
      params.append("start", sinceNano);
    } else {
      const fiveMinutesAgo = (BigInt(Date.now() - 5 * 60 * 1000) * 1_000_000n).toString();
      params.append("start", fiveMinutesAgo);
    }

    return this.executeQuery(params);
  }

  /**
   * Queries correlated context logs matching a service or trace ID to reconstruct failure timeline.
   *
   * @param options.traceId - Distributed trace ID to correlate microservice operations
   * @param options.service - Service identifier to isolate scope
   */
  async queryContext(options: {
    traceId?: string;
    service?: string;
    startNano?: string;
    endNano?: string;
    limit?: number;
  }): Promise<LokiLogEntry[]> {
    let logql = '{app="test-app"}';
    if (options.service) {
      logql = `{app="test-app", service="${options.service}"}`;
    }

    if (options.traceId) {
      logql += ` |= "${options.traceId}"`;
    }

    const params = new URLSearchParams({
      query: logql,
      limit: (options.limit ?? 30).toString(),
      direction: "backward",
    });

    if (options.startNano) {
      params.append("start", options.startNano);
    }
    if (options.endNano) {
      params.append("end", options.endNano);
    }

    return this.executeQuery(params);
  }

  /**
   * Executes query_range against Loki and unpacks stream batches.
   * Gracefully parses JSON log lines, falling back to raw line formatting if unformatted.
   */
  private async executeQuery(params: URLSearchParams): Promise<LokiLogEntry[]> {
    try {
      const url = `${this.baseUrl}/loki/api/v1/query_range?${params.toString()}`;
      const res = await fetch(url, { headers: this.getHeaders() });

      if (!res.ok) {
        console.warn(`[LokiClient] Query failed (${res.status} ${res.statusText})`);
        return [];
      }

      const json = (await res.json()) as LokiQueryResponse;
      if (json.status !== "success" || !json.data || !json.data.result) {
        return [];
      }

      const entries: LokiLogEntry[] = [];

      for (const streamObj of json.data.result) {
        for (const [timeNano, rawLine] of streamObj.values) {
          try {
            const parsed = JSON.parse(rawLine);
            entries.push({
              timestamp: parsed.timestamp || new Date(Number(BigInt(timeNano) / 1_000_000n)).toISOString(),
              timeNano,
              level: parsed.level || streamObj.stream.level || "info",
              service: parsed.service || streamObj.stream.service || "unknown",
              message: parsed.message || rawLine,
              errorCode: parsed.error_code || parsed.errorCode || streamObj.stream.error_code,
              traceId: parsed.trace_id || parsed.traceId,
              metadata: parsed.metadata,
              rawLine,
            });
          } catch {
            // Unstructured non-JSON fallback
            entries.push({
              timestamp: new Date(Number(BigInt(timeNano) / 1_000_000n)).toISOString(),
              timeNano,
              level: (streamObj.stream.level as any) || "error",
              service: streamObj.stream.service || "unknown",
              message: rawLine,
              errorCode: streamObj.stream.error_code,
              rawLine,
            });
          }
        }
      }

      // Order ascending chronologically for linear investigation
      return entries.sort((a, b) => a.timeNano.localeCompare(b.timeNano));
    } catch (error) {
      console.warn("[LokiClient] Error fetching logs from Loki:", (error as Error).message);
      return [];
    }
  }
}

/**
 * Sliding-window error deduplicator.
 * Generates composite fingerprints for incoming error logs to suppress notification storming
 * while still capturing repeat occurrence counters.
 */
export class ErrorDeduplicator {
  private seen = new Map<string, { firstSeen: number; lastSeen: number; count: number }>();
  private windowMs: number;

  constructor(windowMs = ENV.DEDUP_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /**
   * Constructs a stable fingerprint based on affected service and error signature.
   */
  getFingerprint(entry: LokiLogEntry): string {
    const service = entry.service || "unknown";
    const code = entry.errorCode || entry.message.slice(0, 40);
    return `${service}:${code}`;
  }

  /**
   * Assesses if the given log entry is a duplicate within the current sliding window.
   */
  checkAndRecord(entry: LokiLogEntry): { isDuplicate: boolean; count: number } {
    const now = Date.now();
    const fp = this.getFingerprint(entry);
    const existing = this.seen.get(fp);

    if (existing && now - existing.firstSeen < this.windowMs) {
      existing.count += 1;
      existing.lastSeen = now;
      return { isDuplicate: true, count: existing.count };
    }

    this.seen.set(fp, { firstSeen: now, lastSeen: now, count: 1 });
    return { isDuplicate: false, count: 1 };
  }

  /**
   * Prunes entries older than 2x the deduplication window to prevent unbounded memory growth.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.seen.entries()) {
      if (now - record.firstSeen > this.windowMs * 2) {
        this.seen.delete(key);
      }
    }
  }
}

export const lokiClient = new LokiClient();
export const errorDeduplicator = new ErrorDeduplicator();
