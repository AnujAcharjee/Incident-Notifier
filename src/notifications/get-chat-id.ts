import { ENV } from "../config";

async function getChatId() {
  const token = ENV.TELEGRAM_BOT_TOKEN;

  if (!token || token === "your_telegram_bot_token") {
    console.error("\x1b[31m❌ Error: Please set your TELEGRAM_BOT_TOKEN in .env first.\x1b[0m");
    process.exit(1);
  }

  console.log("\x1b[36m🔍 Checking for recent messages sent to your Telegram bot...\x1b[0m");

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const data = (await res.json()) as {
      ok: boolean;
      result?: Array<{
        message?: {
          chat: { id: number; first_name?: string; username?: string; type: string };
          text?: string;
        };
      }>;
      description?: string;
    };

    if (!data.ok) {
      console.error(`\x1b[31m❌ Telegram API error: ${data.description}\x1b[0m`);
      process.exit(1);
    }

    const messages = data.result || [];
    const directMessages = messages.filter((m) => m.message?.chat.type === "private");

    if (directMessages.length === 0) {
      console.log("\x1b[33m⚠️ No direct messages detected yet.\x1b[0m");
      console.log("\nTo connect your Telegram account to this bot:");
      console.log("1. Open Telegram and search for your bot.");
      console.log("2. Press 'Start' or send any message (e.g. 'hello').");
      console.log("3. Run this command again: \x1b[32mbun run get-chat-id\x1b[0m\n");
      return;
    }

    // Get the most recent user
    const lastUpdate = directMessages[directMessages.length - 1];
    const lastMsg = lastUpdate?.message;
    if (!lastMsg) {
      console.log("\x1b[33m⚠️ No direct messages detected yet.\x1b[0m");
      return;
    }
    const user = lastMsg.chat;

    console.log("\n\x1b[32m✔ Found user contact!\x1b[0m");
    console.log(`👤 Name:     ${user.first_name || "N/A"}`);
    if (user.username) console.log(`🏷️  Username: @${user.username}`);
    console.log(`🆔 Chat ID:  \x1b[1m\x1b[36m${user.id}\x1b[0m\n`);

    console.log("Copy and paste this into your .env file:");
    console.log(`\x1b[32mTELEGRAM_CHAT_ID=${user.id}\x1b[0m\n`);
  } catch (error) {
    console.error("\x1b[31m❌ Failed to retrieve updates:\x1b[0m", (error as Error).message);
    process.exit(1);
  }
}

getChatId();
