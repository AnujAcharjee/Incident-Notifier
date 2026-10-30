/**
 * @file src/agent/graph.ts
 * @description LangGraph StateGraph compilation and public investigation invocation wrapper.
 * Connects START -> investigate -> (conditional: tools | generateReport) -> END
 * into a compiled executable agent runtime with typed input/output boundaries.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState, type IncidentReport } from "./state";
import { investigateNode, toolsNode, generateReportNode, shouldContinue } from "./nodes";
import type { LokiLogEntry } from "../monitor/loki";

/**
 * Incident Investigation State Machine Definition.
 * Formulates a cyclic ReAct graph that loops between investigation reasoning and tool execution
 * until the LLM decides sufficient evidence is gathered to construct the final IncidentReport.
 */
export const workflow = new StateGraph(AgentState)
  .addNode("investigate", investigateNode)
  .addNode("tools", toolsNode)
  .addNode("generateReport", generateReportNode)
  .addEdge(START, "investigate")
  .addConditionalEdges("investigate", shouldContinue, {
    tools: "tools",
    generateReport: "generateReport",
  })
  .addEdge("tools", "investigate")
  .addEdge("generateReport", END);

/**
 * Compiled executable LangGraph workflow instance.
 */
export const incidentAgent = workflow.compile();

/**
 * High-level orchestration entry point.
 * Accepts a raw Loki error entry, seeds the graph state, runs autonomous investigation,
 * and returns the validated IncidentReport.
 *
 * @param errorLog - Triggering error log entry captured from Loki
 * @returns Strongly-typed IncidentReport with verified facts and remediation guidance
 */
export async function runIncidentInvestigation(errorLog: LokiLogEntry): Promise<IncidentReport> {
  const result = await incidentAgent.invoke({
    errorLog,
    messages: [],
    contextLogs: [],
    runbookContext: [],
    report: null,
  });

  if (!result.report) {
    throw new Error("Incident investigation did not produce a valid report");
  }

  return result.report;
}
