import { ENV } from './config'

const GEMINI_MODEL = "gemini-3.8-flash";


async function main() {
  console.log("🚀 Starting Incident Notifier...");


}

main().catch((error) => {
  console.error("⚠️ Failed to start Incident Notifier:", error);
  process.exit(1);
});