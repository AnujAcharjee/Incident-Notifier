import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { LokiLogEntry } from "../monitor/loki";

export const IncidentReportSchema = z.object({
  incidentId: z.string().describe("Unique identifier for the incident, e.g. INC-DB-1001"),
  title: z.string().describe("Short descriptive headline of the incident"),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).describe("Severity level"),
  affectedService: z.string().describe("Service name affected"),
  errorCode: z.string().describe("Error code or identifier"),
  timestamp: z.string().describe("Timestamp of occurrence"),
  summary: z.string().describe("Executive summary of the incident"),
  rootCauseAnalysis: z.object({
    likelyCause: z.string().describe("Primary identified root cause"),
    facts: z.array(z.string()).describe("Direct facts proven by log evidence"),
    hypotheses: z.array(z.string()).describe("Probable contributing factors or architectural hypotheses"),
  }),
  evidence: z.object({
    logSnippets: z.array(z.string()).describe("Log lines verifying the incident"),
    runbookReferences: z.array(z.string()).describe("Referenced runbook specs or policy documentation"),
  }),
  remediationSteps: z.array(z.string()).describe("Actionable steps to resolve or mitigate the incident"),
});

export type IncidentReport = z.infer<typeof IncidentReportSchema>;

/**
 * LangGraph Agent State
 */
export const AgentState = Annotation.Root({
  // Chat history with the LLM
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => curr.concat(update),
    default: () => [],
  }),
  // The raw error entry that triggered the incident
  errorLog: Annotation<LokiLogEntry>({
    reducer: (_, update) => update,
  }),
  // Surrounding context logs fetched during investigation
  contextLogs: Annotation<LokiLogEntry[]>({
    reducer: (curr, update) => (update ? curr.concat(update) : curr),
    default: () => [],
  }),
  // Runbook documentation gathered from Qdrant/docs
  runbookContext: Annotation<string[]>({
    reducer: (curr, update) => (update ? curr.concat(update) : curr),
    default: () => [],
  }),
  // Final validated incident report
  report: Annotation<IncidentReport | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;