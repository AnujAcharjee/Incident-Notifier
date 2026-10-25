import { ENV } from "../config";

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
  values: Array<[string, string]>;
}

export interface LokiQueryResponse {
  status: "success" | "error";
  data?: {
    resultType: "streams" | "matrix" | "vector";
    result: LokiStreamResult[];
  };
  error?: string;
}

export class LokiClient {
  private baseUrl: string;

  constructor(baseUrl = ENV.LOKI_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Checks if Loki is available and ready to accept/serve queries.
   */
  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/ready`);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Queries Loki for recent error logs.
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
      // Default to last 5 minutes
      const fiveMinutesAgo = (BigInt(Date.now() - 5 * 60 * 1000) * 1_000_000n).toString();
      params.append("start", fiveMinutesAgo);
    }

    return this.executeQuery(params);
  }

  /**
   * Queries Loki for context logs (info, warn, error) matching a traceId or service.
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
   * Low-level helper to execute a query_range against Loki and parse JSON log lines.
   */
  private async executeQuery(params: URLSearchParams): Promise<LokiLogEntry[]> {
    try {
      const url = `${this.baseUrl}/loki/api/v1/query_range?${params.toString()}`;
      const res = await fetch(url);

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
            // Not a JSON log line, create structured entry from raw
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

      // Sort by timestamp ascending
      return entries.sort((a, b) => a.timeNano.localeCompare(b.timeNano));
    } catch (error) {
      console.warn("[LokiClient] Error fetching logs from Loki:", (error as Error).message);
      return [];
    }
  }
}

/**
 * Deduplicator to prevent alert spam for recurring identical errors.
 */
export class ErrorDeduplicator {
  private seen = new Map<string, { firstSeen: number; lastSeen: number; count: number }>();
  private windowMs: number;

  constructor(windowMs = ENV.DEDUP_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /**
   * Generates a stable fingerprint for an error log.
   */
  getFingerprint(entry: LokiLogEntry): string {
    const service = entry.service || "unknown";
    const code = entry.errorCode || entry.message.slice(0, 40);
    return `${service}:${code}`;
  }

  /**
   * Checks if an error should be alerted or suppressed as duplicate.
   * Returns { isDuplicate, count }.
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

    // New error or window expired
    this.seen.set(fp, { firstSeen: now, lastSeen: now, count: 1 });
    return { isDuplicate: false, count: 1 };
  }

  /**
   * Prune expired entries from memory.
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
