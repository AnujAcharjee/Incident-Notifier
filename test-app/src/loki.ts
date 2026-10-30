export interface LogEntry {
  level: "info" | "warn" | "error";
  service: string;
  message: string;
  errorCode?: string;
  traceId: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export class LokiPusher {
  private lokiUrl: string;
  private authHeader?: string;
  private isCloud: boolean;
  private queue: Array<{ entry: LogEntry; timeNano: string }> = [];
  private flushTimer: any = null;
  private isAvailable = true;

  constructor(
    lokiUrl = process.env.LOKI_URL || "http://localhost:3100",
    lokiUser = (process.env.LOKI_USERNAME || "").trim(),
    lokiPassword = (process.env.LOKI_PASSWORD || "").trim()
  ) {
    this.lokiUrl = lokiUrl
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/loki\/api\/v1(\/push)?\/?$/, "")
      .replace(/\/+$/, "");
    this.isCloud = Boolean(
      (process.env.LOKI_URL && process.env.LOKI_URL.includes("grafana.net")) ||
      (lokiUser && lokiPassword)
    );

    if (lokiUser && lokiPassword) {
      this.authHeader = `Basic ${Buffer.from(`${lokiUser}:${lokiPassword}`).toString("base64")}`;
    }

    this.startAutoFlush();
  }

  public push(entry: LogEntry): void {
    // Loki expects timestamps in nanoseconds as strings
    const nowNano = (BigInt(Date.now()) * 1_000_000n).toString();
    this.queue.push({ entry, timeNano: nowNano });

    // Flush immediately for errors, or wait for timer
    if (entry.level === "error" || this.queue.length >= 10) {
      this.flush();
    }
  }

  private startAutoFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush();
      }
    }, 2000);
  }

  public async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = [...this.queue];
    this.queue = [];

    // Group logs by stream labels for Loki push API
    const streamsMap = new Map<string, Array<[string, string]>>();

    for (const { entry, timeNano } of batch) {
      const labels = {
        app: "test-app",
        level: entry.level,
        service: entry.service,
        error_code: entry.errorCode || "NONE",
        environment: "production",
      };

      const streamKey = JSON.stringify(labels);
      const logLine = JSON.stringify({
        timestamp: entry.timestamp || new Date().toISOString(),
        level: entry.level,
        service: entry.service,
        message: entry.message,
        error_code: entry.errorCode,
        trace_id: entry.traceId,
        metadata: entry.metadata,
      });

      if (!streamsMap.has(streamKey)) {
        streamsMap.set(streamKey, []);
      }
      streamsMap.get(streamKey)!.push([timeNano, logLine]);
    }

    const streams = Array.from(streamsMap.entries()).map(([labelsJson, values]) => ({
      stream: JSON.parse(labelsJson),
      values,
    }));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authHeader) {
      headers["Authorization"] = this.authHeader;
    }

    const serviceName = this.isCloud ? "Grafana Cloud Loki" : "Loki";

    try {
      const res = await fetch(`${this.lokiUrl}/loki/api/v1/push`, {
        method: "POST",
        headers,
        body: JSON.stringify({ streams }),
      });

      if (!res.ok) {
        if (this.isAvailable) {
          const hint = res.status === 401 && this.isCloud
            ? " (verify token has 'logs:write' scope in Grafana Cloud Access Policies)"
            : "";
          console.warn(`[Loki] Push to ${serviceName} failed (${res.status} ${res.statusText})${hint}`);
          this.isAvailable = false;
        }
      } else {
        if (!this.isAvailable) {
          console.log(`[Loki] Connected and pushing logs to ${serviceName} successfully.`);
        }
        this.isAvailable = true;
      }
    } catch (err) {
      if (this.isAvailable) {
        console.warn(`[Loki] ${serviceName} server not reachable at ${this.lokiUrl}: ${(err as Error).message}`);
        this.isAvailable = false;
      }
    }
  }
}

export const lokiPusher = new LokiPusher();
