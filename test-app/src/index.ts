import { scenarios, ERROR_CODES } from "./scenarios";
import { logger } from "./logger";

const PORT = Number(process.env.TEST_APP_PORT) || 4000;
let totalLogsCount = 0;
let totalErrorsCount = 0;

// HTTP Server for manual triggers
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        uptime_seconds: process.uptime(),
        total_logs_emitted: totalLogsCount,
        total_errors_emitted: totalErrorsCount,
      });
    }

    // Manual Error Trigger Endpoints
    if (req.method === "POST" || req.method === "GET") {
      if (url.pathname === "/simulate/db-error") {
        scenarios.simulateDatabaseQuery(true);
        totalErrorsCount++;
        return Response.json({ triggered: ERROR_CODES.DB_REFUSED, status: "emitted" });
      }

      if (url.pathname === "/simulate/payment-timeout") {
        scenarios.simulatePaymentGateway(true);
        totalErrorsCount++;
        return Response.json({ triggered: ERROR_CODES.PAYMENT_TIMEOUT, status: "emitted" });
      }

      if (url.pathname === "/simulate/redis-timeout") {
        scenarios.simulateCacheOperation(true);
        totalErrorsCount++;
        return Response.json({ triggered: ERROR_CODES.REDIS_TIMEOUT, status: "emitted" });
      }

      if (url.pathname === "/simulate/rate-limit") {
        scenarios.simulateOutboundNotification(true);
        totalErrorsCount++;
        return Response.json({ triggered: ERROR_CODES.RATE_LIMIT, status: "emitted" });
      }

      if (url.pathname === "/simulate/auth-spike") {
        scenarios.simulateUserAuth(true);
        return Response.json({ triggered: ERROR_CODES.AUTH_SPIKE, status: "emitted" });
      }
    }

    return Response.json({
      name: "Incident Notifier Test Application",
      endpoints: {
        "GET /health": "Health and stats",
        "POST /simulate/db-error": "Trigger ECONNREFUSED error",
        "POST /simulate/payment-timeout": "Trigger HTTP 504 Payment Gateway timeout",
        "POST /simulate/redis-timeout": "Trigger Redis ETIMEDOUT error",
        "POST /simulate/rate-limit": "Trigger HTTP 429 Too Many Requests error",
        "POST /simulate/auth-spike": "Trigger 401 Unauthorized warning",
      },
    });
  },
});

const targetUrl = process.env.LOKI_URL || "http://localhost:3100";
const isCloudLoki = Boolean(
  (process.env.LOKI_URL && process.env.LOKI_URL.includes("grafana.net")) ||
  process.env.LOKI_USERNAME
);

console.log(`\n🚀 [Test App] Running on http://localhost:${server.port}`);
console.log(`📡 [Test App] Pushing logs to ${isCloudLoki ? "Grafana Cloud Loki" : "Loki"} at ${targetUrl}`);
console.log(`⚡ [Test App] Manual triggers available: POST http://localhost:${server.port}/simulate/<scenario>\n`);

// Background automated traffic simulation
const trafficTimer = setInterval(() => {
  const roll = Math.random();
  totalLogsCount++;

  // 15% probability of error injection in background loop
  if (roll < 0.05) {
    scenarios.simulateDatabaseQuery(true);
    totalErrorsCount++;
  } else if (roll < 0.10) {
    scenarios.simulatePaymentGateway(true);
    totalErrorsCount++;
  } else if (roll < 0.15) {
    scenarios.simulateCacheOperation(true);
    totalErrorsCount++;
  } else {
    // Normal steady-state production traffic
    const pick = Math.floor(Math.random() * 4);
    switch (pick) {
      case 0:
        scenarios.simulateDatabaseQuery(false);
        break;
      case 1:
        scenarios.simulatePaymentGateway(false);
        break;
      case 2:
        scenarios.simulateCacheOperation(false);
        break;
      case 3:
        scenarios.simulateOutboundNotification(false);
        break;
    }
  }
}, 2500);

process.on("SIGINT", () => {
  clearInterval(trafficTimer);
  console.log("\n[Test App] Shutting down...");
  process.exit(0);
});
