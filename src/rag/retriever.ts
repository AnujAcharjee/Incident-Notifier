import { Document } from "@langchain/core/documents";
import { getVectorStore } from "./qdrant";
import { ENV } from "../config";

export interface SearchOptions {
  collectionName?: string;
  k?: number;
  filter?: Record<string, any>;
}

export interface SearchResult {
  document: Document;
  score: number;
}

/**
 * Searches the Qdrant vector database for documents relevant to an incident or error query.
 */
export async function searchIncidentKnowledge(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const collectionName = options.collectionName ?? ENV.QDRANT_COLLECTION;
  const k = options.k ?? 3;
  const store = getVectorStore(collectionName);

  const results = await store.similaritySearchWithScore(query, k, options.filter);

  return results.map(([document, score]) => ({
    document,
    score,
  }));
}

/**
 * Convenience helper that searches knowledge base and formats results as readable markdown context for LLMs.
 */
export async function getFormattedKnowledgeContext(
  query: string,
  k = 3
): Promise<string> {
  const matches = await searchIncidentKnowledge(query, { k });
  if (matches.length === 0) {
    return "No matching runbooks or incident guides found in knowledge base.";
  }

  return matches
    .map(
      ({ document, score }, idx) =>
        `### Guide [${idx + 1}] (Relevance Score: ${score.toFixed(3)})\n` +
        `Source: ${document.metadata.source ?? "unknown"} | Category: ${document.metadata.category ?? "general"}\n\n` +
        `${document.pageContent}\n`
    )
    .join("\n---\n\n");
}
