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
  private queue: Array<{ entry: LogEntry; timeNano: string }> = [];
  private flushTimer: any = null;
  private isAvailable = true;

  constructor(lokiUrl = process.env.LOKI_URL || "http://localhost:3100") {
    this.lokiUrl = lokiUrl.replace(/\/$/, "");
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

    try {
      const res = await fetch(`${this.lokiUrl}/loki/api/v1/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ streams }),
      });

      if (!res.ok) {
        if (this.isAvailable) {
          console.warn(`[Loki] Push failed (${res.status} ${res.statusText})`);
          this.isAvailable = false;
        }
      } else {
        this.isAvailable = true;
      }
    } catch {
      if (this.isAvailable) {
        console.warn(`[Loki] Loki server not reachable at ${this.lokiUrl} (logs preserved on stdout)`);
        this.isAvailable = false;
      }
    }
  }
}

export const lokiPusher = new LokiPusher();
