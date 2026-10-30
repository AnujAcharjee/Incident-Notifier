/**
 * @file src/agent/nodes.ts
 * @description LangGraph graph nodes and conditional transition routers.
 * Encapsulates the core agent lifecycle:
 * - investigateNode: Context assembly and multi-turn ReAct reasoning loop with tool selection.
 * - toolsNode: Safe sandboxed execution of Loki/Qdrant tools with observation feedback.
 * - generateReportNode: Enforces Zod schema compliance on report synthesis with circuit-breaker fallback.
 * - shouldContinue: Edge router determining whether further tool invocations are needed.
 */

import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { toolsByName, modelWithTools } from "./tools";
import { model } from "./model";
import { IncidentReportSchema, type AgentStateType } from "./state";
import { INVESTIGATOR_SYSTEM_PROMPT, REPORT_GENERATION_PROMPT } from "./prompts";

/**
 * Node 1: Investigation Reasoning
 * Initializes the conversation on the first iteration using raw error metadata.
 * Prompts the model with tool definitions to formulate hypotheses and issue tool calls.
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
 * Executes tool calls emitted by the reasoning node. Wraps execution in defensive try/catch
 * blocks to prevent agent crash on transient network/provider failures and captures
 * observations into state channels.
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
 * Invokes Gemini with strict Zod structured output. Includes a deterministic fallback
 * generator to guarantee downstream alert delivery even if the LLM output violates schema constraints.
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
    // Fail-safe circuit breaker: ensures on-call engineers always receive a notification
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
 * Conditional Edge Router
 * Inspects the latest AIMessage: if pending tool calls exist, branches to 'tools',
 * otherwise transitions to 'generateReport'.
 */
export function shouldContinue(state: AgentStateType): "tools" | "generateReport" {
  const lastMessage = state.messages.at(-1);

  if (lastMessage && AIMessage.isInstance(lastMessage) && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }

  return "generateReport";
}
