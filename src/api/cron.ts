/**
 * @file src/api/cron.ts
 * @description Scheduled Vercel Serverless Function entry point triggered periodically.
 * Queries Grafana Loki for error logs emitted in the trailing 10-minute sliding window,
 * investigates novel incidents using the LangGraph SRE agent, and dispatches incident
 * reports to Telegram.
 *
 * Supports both Web Standard Request/Response and Node.js (req, res) Serverless environments.
 */

import { lokiClient, errorDeduplicator } from "../monitor/loki";
import { runIncidentInvestigation } from "../agent/graph";
import { notifyIncident } from "../notifications/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60-second execution allowance for LangGraph AI investigation

/**
 * Core cron job execution engine.
 *
 * @param authHeader - Optional Authorization header to enforce CRON_SECRET security.
 * @returns Status code and payload object.
 */
async function executeCron(authHeader?: string | null) {
  // Optional security barrier: verify Vercel Cron secret token
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const startTime = Date.now();
  // 10-minute trailing window converted to Loki nanosecond string
  const tenMinutesAgoNano = (BigInt(Date.now() - 10 * 60 * 1000) * 1_000_000n).toString();

  try {
    const errorLogs = await lokiClient.queryErrors(tenMinutesAgoNano, 30);

    if (errorLogs.length === 0) {
      return {
        status: 200,
        body: {
          status: "ok",
          message: "No error logs detected in the trailing 10-minute window.",
          window: "10m",
          errorsDetected: 0,
          incidentsInvestigated: 0,
          durationMs: Date.now() - startTime,
        },
      };
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

    return {
      status: 200,
      body: {
        status: "ok",
        window: "10m",
        errorsDetected: errorLogs.length,
        incidentsInvestigated: investigations.length,
        investigations,
        durationMs: Date.now() - startTime,
      },
    };
  } catch (error) {
    console.error("[Vercel Cron] Incident investigation job failed:", error);
    return {
      status: 500,
      body: {
        status: "error",
        message: (error as Error).message,
        durationMs: Date.now() - startTime,
      },
    };
  }
}

/**
 * Web Standard GET handler (Next.js / Web standard Vercel functions).
 */
export async function GET(request: Request) {
  const authHeader = request.headers?.get ? request.headers.get("authorization") : null;
  const result = await executeCron(authHeader);
  return Response.json(result.body, { status: result.status });
}

/**
 * Standard Node.js Serverless Function handler (req, res).
 */
export default async function handler(req: any, res: any) {
  const authHeader =
    req?.headers?.["authorization"] ||
    (req?.headers?.get ? req.headers.get("authorization") : null);

  const result = await executeCron(authHeader);

  if (res && typeof res.status === "function") {
    return res.status(result.status).json(result.body);
  }
  return Response.json(result.body, { status: result.status });
}
