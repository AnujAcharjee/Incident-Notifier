import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState, type IncidentReport } from "./state";
import { investigateNode, toolsNode, generateReportNode, shouldContinue } from "./nodes";
import type { LokiLogEntry } from "../monitor/loki";

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

export const incidentAgent = workflow.compile();

/**
 * Executes full agentic investigation on a detected Loki error log.
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