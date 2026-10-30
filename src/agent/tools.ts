/**
 * @file src/agent/tools.ts
 * @description LangChain tool definitions exposed to the investigative agent.
 * Provides two primary sensory modalities:
 * 1. searchRunbooksTool: RAG retriever querying Qdrant for architectural specs and recovery procedures.
 * 2. fetchContextLogsTool: Temporal and traceId query engine querying Grafana Loki for correlated telemetry.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { model } from "./model";
import { getFormattedKnowledgeContext } from "../rag/retriever";
import { lokiClient } from "../monitor/loki";

/**
 * Semantic vector search tool connecting the agent to Qdrant.
 * Retrieves top-k matching runbook chunks to inform diagnosis and remediation steps.
 */
export const searchRunbooksTool = tool(
  async ({ query }: { query: string }) => {
    try {
      const docs = await getFormattedKnowledgeContext(query, 3);
      return docs;
    } catch (error) {
      return `Failed to search runbooks: ${(error as Error).message}`;
    }
  },
  {
    name: "search_runbooks",
    description:
      "Search the architectural specs, runbooks, and failure mode documentation for guidelines, known error causes, and mitigation policies.",
    schema: z.object({
      query: z.string().describe("Search query, e.g. 'postgres ECONNREFUSED' or 'Redis timeout' or 'payment gateway 504'"),
    }),
  }
);

/**
 * Log context extraction tool connecting the agent to Grafana Loki.
 * Fetches correlated logs matching service name and traceId to reconstruct timeline leading up to failure.
 */
export const fetchContextLogsTool = tool(
  async ({
    service,
    traceId,
    limit = 10,
  }: {
    service: string;
    traceId?: string;
    limit?: number;
  }) => {
    try {
      const logs = await lokiClient.queryContext({
        service,
        traceId,
        limit,
      });

      if (logs.length === 0) {
        return `No contextual logs found in Loki for service "${service}" and traceId "${traceId || 'none'}".`;
      }

      return logs
        .map(
          (l) =>
            `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.service}] [${l.traceId || 'no-trace'}] ${l.message} (metadata: ${JSON.stringify(l.metadata || {})})`
        )
        .join("\n");
    } catch (error) {
      return `Failed to fetch context logs from Loki: ${(error as Error).message}`;
    }
  },
  {
    name: "fetch_context_logs",
    description:
      "Retrieve related logs from Loki for a specific service or trace ID to verify what happened right before or after the failure.",
    schema: z.object({
      service: z.string().describe("The service name, e.g. postgres-db, payment-service, redis-cache"),
      traceId: z.string().optional().describe("Trace ID associated with the error transaction"),
      limit: z.number().optional().default(10).describe("Maximum number of log lines to retrieve"),
    }),
  }
);

export const toolsByName: Record<string, any> = {
  [searchRunbooksTool.name]: searchRunbooksTool,
  [fetchContextLogsTool.name]: fetchContextLogsTool,
};

export const tools = [searchRunbooksTool, fetchContextLogsTool];

/**
 * Model instance bound with tool schemas for function calling.
 */
export const modelWithTools = model.bindTools(tools);
