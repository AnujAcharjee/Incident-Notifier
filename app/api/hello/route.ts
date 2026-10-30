/**
 * @file app/api/hello/route.ts
 * @description Scheduled Vercel Serverless Function triggered every 10 minutes by Vercel Cron.
 * Queries Grafana Loki for error logs emitted in the trailing 10-minute sliding window,
 * investigates novel incidents using the LangGraph SRE agent, and dispatches incident
 * reports to Telegram.
 */

import { lokiClient, errorDeduplicator } from "../../../src/monitor/loki";
import { runIncidentInvestigation } from "../../../src/agent/graph";
import { notifyIncident } from "../../../src/notifications/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Maximum allowed function timeout for AI investigations

/**
 * HTTP GET Handler invoked by Vercel Cron.
 *
 * Execution flow:
 * 1. Validates CRON_SECRET authorization header if configured.
 * 2. Calculates a 10-minute trailing timestamp window in nanoseconds.
 * 3. Fetches error logs from Loki within the window.
 * 4. Deduplicates burst occurrences to protect LLM token budget.
 * 5. Runs LangGraph root-cause analysis for each unique failure.
 * 6. Dispatches structured incident reports via Telegram.
 */
export async function GET(request: Request) {
  // Optional security barrier: verify Vercel Cron secret token
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  // 10-minute trailing window converted to Loki nanosecond string
  const tenMinutesAgoNano = (BigInt(Date.now() - 10 * 60 * 1000) * 1_000_000n).toString();

  try {
    const errorLogs = await lokiClient.queryErrors(tenMinutesAgoNano, 30);

    if (errorLogs.length === 0) {
      return Response.json({
        status: "ok",
        message: "No error logs detected in the trailing 10-minute window.",
        window: "10m",
        errorsDetected: 0,
        incidentsInvestigated: 0,
        durationMs: Date.now() - startTime,
      });
    }

    const investigations = [];

    for (const errorLog of errorLogs) {
      // Deduplicate recurring errors to prevent duplicate LLM calls and alert fatigue
      const { isDuplicate, count } = errorDeduplicator.checkAndRecord(errorLog);
      if (isDuplicate) {
        continue;
      }

      // Execute full LangGraph SRE investigation (Loki context logs + Qdrant RAG + Gemini)
      const report = await runIncidentInvestigation(errorLog);

      // Notify engineering channels via Telegram
      await notifyIncident(report, count);

      investigations.push({
        service: errorLog.service,
        errorCode: errorLog.errorCode,
        summary: report.summary,
        likelyCause: report.rootCauseAnalysis.likelyCause,
        severity: report.severity,
      });
    }

    return Response.json({
      status: "ok",
      window: "10m",
      errorsDetected: errorLogs.length,
      incidentsInvestigated: investigations.length,
      investigations,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error("[Vercel Cron] Incident investigation job failed:", error);
    return Response.json(
      {
        status: "error",
        message: (error as Error).message,
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
