import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { toolsByName, modelWithTools } from "./tools";
import { model } from "./model";
import { AgentState, IncidentReportSchema, type AgentStateType } from "./state";
import { INVESTIGATOR_SYSTEM_PROMPT, REPORT_GENERATION_PROMPT } from "./prompts";

/**
 * Node 1: Investigation Reasoning
 * The agent analyzes the error and decides whether to fetch logs or search runbooks.
 */
export async function investigateNode(state: AgentStateType) {
  const currentMessages = [...state.messages];
  let initialUserMessage: HumanMessage | null = null;

  if (currentMessages.length === 0) {
    const error = state.errorLog;
    const initialPrompt = `Incident Detected:
- Service: ${error.service}
- Error Code: ${error.errorCode || "N/A"}
- Message: ${error.message}
- Trace ID: ${error.traceId || "N/A"}
- Timestamp: ${error.timestamp}
- Metadata: ${JSON.stringify(error.metadata || {})}

Investigate this failure. Fetch relevant context logs from Loki and search the runbooks in the knowledge base to determine root cause and verified facts.`;

    initialUserMessage = new HumanMessage(initialPrompt);
    currentMessages.push(initialUserMessage);
  }

  const response = await modelWithTools.invoke([
    new SystemMessage(INVESTIGATOR_SYSTEM_PROMPT),
    ...currentMessages,
  ]);

  return {
    messages: initialUserMessage ? [initialUserMessage, response] : [response],
  };
}

/**
 * Node 2: Tool Execution
 * Runs tool calls made by the LLM (Loki log queries or Qdrant runbook searches).
 */
export async function toolsNode(state: AgentStateType) {
  const lastMessage = state.messages.at(-1);

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }

  const toolMessages: ToolMessage[] = [];
  const fetchedContextLogs: any[] = [];
  const fetchedRunbooks: string[] = [];

  for (const call of lastMessage.tool_calls ?? []) {
    const tool = toolsByName[call.name];
    if (tool) {
      try {
        const observation = await tool.invoke(call.args);
        const outputText = typeof observation === "string" ? observation : JSON.stringify(observation);

        toolMessages.push(
          new ToolMessage({
            tool_call_id: call.id ?? "call_0",
            name: call.name,
            content: outputText,
          })
        );

        if (call.name === "search_runbooks") {
          fetchedRunbooks.push(outputText);
        } else if (call.name === "fetch_context_logs") {
          fetchedContextLogs.push(outputText);
        }
      } catch (err) {
        toolMessages.push(
          new ToolMessage({
            tool_call_id: call.id ?? "call_0",
            name: call.name,
            content: `Error executing ${call.name}: ${(err as Error).message}`,
          })
        );
      }
    }
  }

  return {
    messages: toolMessages,
    runbookContext: fetchedRunbooks,
  };
}

/**
 * Node 3: Structured Incident Report Generator
 * Uses Gemini structured output validated by Zod.
 */
export async function generateReportNode(state: AgentStateType) {
  const structuredModel = model.withStructuredOutput(IncidentReportSchema);

  const reportPrompt = [
    new SystemMessage(REPORT_GENERATION_PROMPT),
    ...state.messages,
    new HumanMessage(
      `Synthesize all the above investigation findings, verified facts, and runbooks into the final structured Incident Report for service "${state.errorLog.service}".`
    ),
  ];

  try {
    const report = await structuredModel.invoke(reportPrompt);
    return { report };
  } catch (error) {
    // Graceful fallback with manual structure if validation encounters edge case
    console.warn("[Agent] Structured output parse warning, falling back:", (error as Error).message);
    const fallbackReport = {
      incidentId: `INC-${state.errorLog.service}-${Date.now().toString().slice(-6)}`,
      title: `${state.errorLog.service} Failure: ${state.errorLog.errorCode || "Unknown Error"}`,
      severity: "HIGH" as const,
      affectedService: state.errorLog.service,
      errorCode: state.errorLog.errorCode || "ERR",
      timestamp: state.errorLog.timestamp,
      summary: `Automated investigation for ${state.errorLog.service}: ${state.errorLog.message}`,
      rootCauseAnalysis: {
        likelyCause: state.errorLog.message,
        facts: [`Error logged at ${state.errorLog.timestamp}`, `Service: ${state.errorLog.service}`],
        hypotheses: ["Investigated automatically via Loki and runbooks"],
      },
      evidence: {
        logSnippets: [state.errorLog.rawLine || state.errorLog.message],
        runbookReferences: state.runbookContext?.slice(0, 2) || [],
      },
      remediationSteps: [
        `Inspect ${state.errorLog.service} service health and logs`,
        "Consult service runbooks for recovery procedures",
      ],
    };
    return { report: fallbackReport };
  }
}

/**
 * Conditional router: checks if the agent wants to execute more tools or produce report
 */
export function shouldContinue(state: AgentStateType): "tools" | "generateReport" {
  const lastMessage = state.messages.at(-1);

  if (lastMessage && AIMessage.isInstance(lastMessage) && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }

  return "generateReport";
}