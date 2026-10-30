import { ENV } from "./config";
import { lokiClient, errorDeduplicator, type LokiLogEntry } from "./monitor/loki";
import { runIncidentInvestigation } from "./agent/graph";
import { notifyIncident } from "./notifications/telegram";

let isRunning = true;
let isInvestigating = false;
let lastInvestigationTime = 0;
let lastSeenNano: string = (BigInt(Date.now() - 30 * 1000) * 1_000_000n).toString();

let stats = {
  polledCount: 0,
  errorsDetected: 0,
  incidentsReported: 0,
  duplicatesSuppressed: 0,
};

async function checkInfrastructure(): Promise<void> {
  const lokiReady = await lokiClient.isReady();
  const lokiName = ENV.IS_LOKI_CLOUD ? "Grafana Cloud Loki" : "Loki";
  if (lokiReady) {
    console.log(`\x1b[32m✔ [Infrastructure] ${lokiName} is online and ready at ${ENV.LOKI_URL}\x1b[0m`);
  } else {
    console.warn(
      `\x1b[33m▲ [Infrastructure] ${lokiName} not reachable at ${ENV.LOKI_URL}. Waiting for logs...${ENV.IS_LOKI_CLOUD ? " (check LOKI_URL and LOKI_USERNAME/LOKI_PASSWORD)" : " (run 'docker compose up -d' if not started)"}\x1b[0m`
    );
  }

  const qdrantHeaders: Record<string, string> = {};
  if (ENV.QDRANT_API_KEY) {
    qdrantHeaders["api-key"] = ENV.QDRANT_API_KEY;
  }

  let qdrantOnline = false;
  try {
    const qdrantRes = await fetch(`${ENV.QDRANT_URL}/readyz`, { headers: qdrantHeaders });
    if (qdrantRes.ok) qdrantOnline = true;
  } catch {}

  if (!qdrantOnline) {
    try {
      const collectionsRes = await fetch(`${ENV.QDRANT_URL}/collections`, { headers: qdrantHeaders });
      if (collectionsRes.ok) qdrantOnline = true;
    } catch {}
  }

  const qdrantName = ENV.IS_QDRANT_CLOUD ? "Qdrant Cloud" : "Qdrant";
  if (qdrantOnline) {
    console.log(`\x1b[32m✔ [Infrastructure] ${qdrantName} is online at ${ENV.QDRANT_URL}\x1b[0m`);
  } else {
    console.warn(`\x1b[33m▲ [Infrastructure] ${qdrantName} not reachable at ${ENV.QDRANT_URL}.\x1b[0m`);
  }
}

async function monitorPollCycle(): Promise<void> {
  stats.polledCount++;

  // Periodic deduplication cleanup
  if (stats.polledCount % 50 === 0) {
    errorDeduplicator.cleanup();
  }

  try {
    const errors: LokiLogEntry[] = await lokiClient.queryErrors(lastSeenNano, 20);

    if (errors.length === 0) {
      return;
    }

    for (const errorLog of errors) {
      // Update high-watermark timestamp
      if (BigInt(errorLog.timeNano) > BigInt(lastSeenNano)) {
        lastSeenNano = (BigInt(errorLog.timeNano) + 1n).toString();
      }

      stats.errorsDetected++;

      // Check for duplicate suppression
      const { isDuplicate, count } = errorDeduplicator.checkAndRecord(errorLog);

      if (isDuplicate) {
        stats.duplicatesSuppressed++;
        const dim = "\x1b[90m";
        const reset = "\x1b[0m";
        console.log(
          `${dim}[Deduplicator] Suppressed duplicate error for "${errorLog.service}" (${errorLog.errorCode || "NO_CODE"}) [Occurrence #${count}]${reset}`
        );
        continue;
      }

      // Check API cooldown to prevent rate limit exhaustion during traffic spikes
      const timeSinceLast = Date.now() - lastInvestigationTime;
      if (timeSinceLast < ENV.INVESTIGATION_COOLDOWN_MS) {
        const waitSec = Math.ceil((ENV.INVESTIGATION_COOLDOWN_MS - timeSinceLast) / 1000);
        console.log(
          `\x1b[90m[Rate Limiter] Cooldown active (${waitSec}s remaining). Skipping burst error in "${errorLog.service}" to protect API quota.\x1b[0m`
        );
        continue;
      }

      console.log(
        `\n\x1b[31m[Monitor] 🚨 New error detected in "${errorLog.service}" [${errorLog.errorCode || "ERR"}]: ${errorLog.message.slice(0, 80)}\x1b[0m`
      );
      console.log(`\x1b[36m[Agent] Launching LangGraph AI investigation (${ENV.GEMINI_MODEL})...\x1b[0m`);

      try {
        isInvestigating = true;
        lastInvestigationTime = Date.now();
        const report = await runIncidentInvestigation(errorLog);
        stats.incidentsReported++;
        await notifyIncident(report, count);
      } catch (agentError) {
        console.error("\x1b[31m[Agent] Failed to investigate incident:\x1b[0m", (agentError as Error).message);
      } finally {
        isInvestigating = false;
      }
    }
  } catch (pollError) {
    console.warn(`\x1b[33m[Monitor] Error during poll cycle:\x1b[0m`, (pollError as Error).message);
  }
}

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("   🚀  INCIDENT NOTIFIER - AI SRE LOG MONITOR & ROOT CAUSE AGENT");
  console.log("=".repeat(70));
  console.log(`📡 Loki:                 ${ENV.IS_LOKI_CLOUD ? "Grafana Cloud Loki" : "Local Loki"} (${ENV.LOKI_URL})`);
  console.log(`🧠 Qdrant:               ${ENV.IS_QDRANT_CLOUD ? "Qdrant Cloud" : "Local Qdrant"} (${ENV.QDRANT_URL} [${ENV.QDRANT_COLLECTION}])`);
  console.log(`🤖 LLM Model:            ${ENV.GEMINI_MODEL}`);
  console.log(`⏱️  Poll Interval:        ${ENV.POLL_INTERVAL_MS}ms`);
  console.log(`🛡️  Deduplication Window: ${ENV.DEDUP_WINDOW_MS / 1000}s`);
  console.log(`📱 Notifications:        Terminal Output (Telegram ${ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token' ? 'Enabled' : 'Disabled'})`);
  console.log("-".repeat(70) + "\n");

  await checkInfrastructure();

  console.log(`\n\x1b[32m[Monitor] Listening for incoming application logs and errors...\x1b[0m`);
  console.log(`\x1b[90mTip: Run 'bun run test-app' in another terminal to generate simulated traffic.\x1b[0m\n`);

  // Monitor polling loop
  const interval = setInterval(async () => {
    if (!isRunning) return;
    if (isInvestigating) return; // Prevent overlapping runs while agent is investigating
    await monitorPollCycle();
  }, ENV.POLL_INTERVAL_MS);

  // Graceful shutdown handling
  const shutdown = () => {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(interval);
    console.log("\n\n" + "-".repeat(70));
    console.log("🛑 [Incident Notifier] Shutting down gracefully...");
    console.log(`📊 Session Summary:`);
    console.log(`   • Poll Cycles:          ${stats.polledCount}`);
    console.log(`   • Errors Detected:      ${stats.errorsDetected}`);
    console.log(`   • Incidents Reported:   ${stats.incidentsReported}`);
    console.log(`   • Duplicates Filtered:  ${stats.duplicatesSuppressed}`);
    console.log("-".repeat(70) + "\n");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("⚠️ Failed to start Incident Notifier:", error);
  process.exit(1);
});