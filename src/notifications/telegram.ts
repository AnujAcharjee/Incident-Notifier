import { ENV } from "../config";
import type { IncidentReport } from "../agent/state";

/**
 * Formats an incident report for terminal display with ANSI colors and clear sections.
 */
export function formatTerminalReport(report: IncidentReport, occurrences = 1): string {
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const red = "\x1b[31m";
  const yellow = "\x1b[33m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const dim = "\x1b[2m";
  const magenta = "\x1b[35m";

  const severityColor =
    report.severity === "CRITICAL"
      ? red
      : report.severity === "HIGH"
      ? yellow
      : report.severity === "MEDIUM"
      ? cyan
      : dim;

  const severityBadge = `${severityColor}${bold}[${report.severity}]${reset}`;
  const border = "═".repeat(78);
  const subBorder = "─".repeat(78);

  const lines: string[] = [];
  lines.push(`\n${red}${bold}${border}${reset}`);
  lines.push(
    `🚨 ${bold}INCIDENT DETECTED${reset}  ${severityBadge}  ${magenta}${report.incidentId}${reset}  ${dim}(Occurrences: ${occurrences})${reset}`
  );
  lines.push(`${dim}${subBorder}${reset}`);
  lines.push(`📌 ${bold}Title:${reset}     ${report.title}`);
  lines.push(`⚙️  ${bold}Service:${reset}   ${cyan}${report.affectedService}${reset}`);
  lines.push(`⚠️  ${bold}Code:${reset}      ${yellow}${report.errorCode}${reset}`);
  lines.push(`⏱️  ${bold}Detected:${reset}  ${report.timestamp}`);
  lines.push(`${dim}${subBorder}${reset}`);

  lines.push(`\n📝 ${bold}EXECUTIVE SUMMARY:${reset}`);
  lines.push(`   ${report.summary}`);

  lines.push(`\n🔍 ${bold}ROOT CAUSE DIAGNOSIS:${reset}`);
  lines.push(`   ${report.rootCauseAnalysis.likelyCause}`);

  if (report.rootCauseAnalysis.facts?.length) {
    lines.push(`\n   ${green}${bold}Verified Facts (from Logs):${reset}`);
    for (const fact of report.rootCauseAnalysis.facts) {
      lines.push(`   • ${fact}`);
    }
  }

  if (report.rootCauseAnalysis.hypotheses?.length) {
    lines.push(`\n   ${yellow}${bold}Hypotheses (Potential Factors):${reset}`);
    for (const hyp of report.rootCauseAnalysis.hypotheses) {
      lines.push(`   ? ${hyp}`);
    }
  }

  if (report.evidence?.logSnippets?.length || report.evidence?.runbookReferences?.length) {
    lines.push(`\n📋 ${bold}EVIDENCE & RUNBOOK REFERENCES:${reset}`);
    if (report.evidence.logSnippets?.length) {
      lines.push(`   ${dim}Log Evidence:${reset}`);
      for (const log of report.evidence.logSnippets) {
        lines.push(`   [Log] ${dim}${log}${reset}`);
      }
    }
    if (report.evidence.runbookReferences?.length) {
      lines.push(`   ${dim}Knowledge Base / Runbooks:${reset}`);
      for (const ref of report.evidence.runbookReferences) {
        lines.push(`   [Doc] ${cyan}${ref}${reset}`);
      }
    }
  }

  if (report.remediationSteps?.length) {
    lines.push(`\n💡 ${bold}RECOMMENDED REMEDIATION ACTIONS:${reset}`);
    report.remediationSteps.forEach((step, idx) => {
      lines.push(`   ${idx + 1}. ${step}`);
    });
  }

  lines.push(`\n${red}${bold}${border}${reset}\n`);

  return lines.join("\n");
}

/**
 * Formats an incident report for HTML Telegram messages.
 */
export function formatTelegramHtml(report: IncidentReport, occurrences = 1): string {
  const icon =
    report.severity === "CRITICAL"
      ? "🔴"
      : report.severity === "HIGH"
      ? "🟠"
      : report.severity === "MEDIUM"
      ? "🟡"
      : "⚪";

  const escapeHtml = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let msg = `<b>${icon} INCIDENT REPORT: [${report.severity}]</b>\n`;
  msg += `<b>Incident ID:</b> <code>${escapeHtml(report.incidentId)}</code>\n`;
  msg += `<b>Service:</b> <code>${escapeHtml(report.affectedService)}</code>\n`;
  msg += `<b>Error Code:</b> <code>${escapeHtml(report.errorCode)}</code>\n`;
  msg += `<b>Occurrences:</b> ${occurrences}\n\n`;

  msg += `<b>Summary:</b>\n${escapeHtml(report.summary)}\n\n`;

  msg += `<b>🔍 Likely Root Cause:</b>\n${escapeHtml(report.rootCauseAnalysis.likelyCause)}\n\n`;

  if (report.rootCauseAnalysis.facts?.length) {
    msg += `<b>Verified Facts:</b>\n`;
    for (const fact of report.rootCauseAnalysis.facts) {
      msg += `• ${escapeHtml(fact)}\n`;
    }
    msg += `\n`;
  }

  if (report.evidence?.runbookReferences?.length) {
    msg += `<b>Referenced Runbooks:</b>\n`;
    for (const ref of report.evidence.runbookReferences) {
      msg += `• ${escapeHtml(ref)}\n`;
    }
    msg += `\n`;
  }

  if (report.remediationSteps?.length) {
    msg += `<b>🛠️ Recommended Actions:</b>\n`;
    report.remediationSteps.forEach((step, i) => {
      msg += `${i + 1}. ${escapeHtml(step)}\n`;
    });
  }

  return msg;
}

/**
 * Dispatches incident notification to terminal output, and optionally to Telegram if configured.
 */
export async function notifyIncident(report: IncidentReport, occurrences = 1): Promise<void> {
  // Always output to terminal with rich formatting
  const terminalOutput = formatTerminalReport(report, occurrences);
  console.log(terminalOutput);

  // Check if Telegram credentials are valid and configured
  const token = ENV.TELEGRAM_BOT_TOKEN;
  const chatId = ENV.TELEGRAM_CHAT_ID;

  const isTelegramConfigured =
    Boolean(token) &&
    Boolean(chatId) &&
    token !== "your_telegram_bot_token" &&
    chatId !== "your_telegram_chat_id";

  if (!isTelegramConfigured) {
    console.log(
      "\x1b[90m[Notification] Telegram notification skipped (credentials not configured or disabled). Terminal output only.\x1b[0m"
    );
    return;
  }

  // If credentials are present, attempt Telegram dispatch
  try {
    const text = formatTelegramHtml(report, occurrences);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (res.ok) {
      console.log("\x1b[32m[Notification] Telegram alert sent successfully.\x1b[0m");
    } else {
      const errText = await res.text();
      console.warn(`\x1b[33m[Notification] Telegram send failed (${res.status}): ${errText}\x1b[0m`);
    }
  } catch (error) {
    console.warn("\x1b[33m[Notification] Failed to send Telegram notification:\x1b[0m", (error as Error).message);
  }
}
