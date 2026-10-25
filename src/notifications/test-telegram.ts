import { ENV } from "../config";
import { notifyIncident } from "./telegram";
import type { IncidentReport } from "../agent/state";

async function testTelegram() {
  console.log("\n📡 Testing Telegram Integration...");
  const token = ENV.TELEGRAM_BOT_TOKEN;
  const chatId = ENV.TELEGRAM_CHAT_ID;

  if (!token || token === "your_telegram_bot_token") {
    console.error("❌ Error: TELEGRAM_BOT_TOKEN is not configured in .env");
    process.exit(1);
  }

  if (!chatId || chatId === "your_telegram_chat_id") {
    console.error("❌ Error: TELEGRAM_CHAT_ID is not configured in .env");
    process.exit(1);
  }

  // 1. Verify Bot Token via getMe
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string; first_name: string }; description?: string };

    if (!data.ok || !data.result) {
      console.error(`❌ Bot verification failed: ${data.description || "Invalid token"}`);
      process.exit(1);
    }

    console.log(`✔ Bot authenticated: @${data.result.username} (${data.result.first_name})`);
  } catch (err) {
    console.error("❌ Network error connecting to Telegram API:", (err as Error).message);
    process.exit(1);
  }

  // 2. Dispatch a sample test incident report
  console.log(`📤 Sending test alert DM to Telegram User (Chat ID: ${chatId})...`);
  const mockReport: IncidentReport = {
    incidentId: "INC-" + Math.floor(1000 + Math.random() * 9000),
    title: "Test Alert: Incident Notifier connected",
    summary: "Telegram direct message alert integration has been successfully verified for Incident Notifier.",
    severity: "HIGH",
    affectedService: "notification-service",
    errorCode: "TEST_VERIFICATION",
    timestamp: new Date().toISOString(),
    rootCauseAnalysis: {
      likelyCause: "Manual verification trigger executed by developer.",
      facts: ["Telegram Bot API responded with HTTP 200", "Direct message delivery confirmed"],
      hypotheses: ["System is ready to relay production incidents directly to your Telegram"],
    },
    evidence: {
      logSnippets: ["[INFO] Telegram DM pipeline operational"],
      runbookReferences: ["docs/runbooks/test-verification.md"],
    },
    remediationSteps: [
      "No action required - this is an integration test.",
      "You will receive live incident reports right here whenever an issue is detected.",
    ],
  };

  await notifyIncident(mockReport, 1);
  console.log("🎉 Test completed!\n");
}

testTelegram().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
