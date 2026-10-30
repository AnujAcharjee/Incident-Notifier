/**
 * @file src/agent/state.ts
 * @description LangGraph state schema definition and Zod structured report validation.
 * Uses LangGraph Annotation primitives with explicit channel reducers to manage conversation history,
 * context log aggregation, RAG runbook ingestion, and the final verified IncidentReport structure.
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { LokiLogEntry } from "../monitor/loki";

/**
 * Strict schema for AI-generated incident reports.
 * Enforces separation between verified log facts and probabilistic hypotheses.
 */
export const IncidentReportSchema = z.object({
  incidentId: z.string().describe("Unique identifier for the incident, e.g. INC-DB-1001"),
  title: z.string().describe("Short descriptive headline of the incident"),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).describe("Severity classification based on impact"),
  affectedService: z.string().describe("Service name affected"),
  errorCode: z.string().describe("Error code or exception class identifier"),
  timestamp: z.string().describe("ISO-8601 timestamp of incident detection"),
  summary: z.string().describe("Executive summary of the incident and operational blast radius"),
  rootCauseAnalysis: z.object({
    likelyCause: z.string().describe("Primary identified root cause substantiated by evidence"),
    facts: z.array(z.string()).describe("Direct facts proven conclusively by log traces"),
    hypotheses: z.array(z.string()).describe("Probable contributing factors or architectural hypotheses"),
  }),
  evidence: z.object({
    logSnippets: z.array(z.string()).describe("Direct log lines substantiating the root cause"),
    runbookReferences: z.array(z.string()).describe("Referenced runbook specs or policy documentation"),
  }),
  remediationSteps: z.array(z.string()).describe("Ordered actionable steps to resolve or mitigate the incident"),
});

export type IncidentReport = z.infer<typeof IncidentReportSchema>;

/**
 * LangGraph State Definition with channel reducers for multi-turn investigative iterations.
 */
export const AgentState = Annotation.Root({
  // Message history accumulated across agent reasoning and tool executions
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => curr.concat(update),
    default: () => [],
  }),
  // Initial triggering error entry that spawned the state machine
  errorLog: Annotation<LokiLogEntry>({
    reducer: (_, update) => update,
  }),
  // Correlated log lines fetched across temporal and traceId boundaries
  contextLogs: Annotation<LokiLogEntry[]>({
    reducer: (curr, update) => (update ? curr.concat(update) : curr),
    default: () => [],
  }),
  // Matching runbook guidelines retrieved from Qdrant vector storage
  runbookContext: Annotation<string[]>({
    reducer: (curr, update) => (update ? curr.concat(update) : curr),
    default: () => [],
  }),
  // Final validated IncidentReport emitted by the report synthesis node
  report: Annotation<IncidentReport | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
