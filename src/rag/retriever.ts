/**
 * @file src/rag/retriever.ts
 * @description Similarity search retrieval engine querying Qdrant knowledge bases.
 * Converts unstructured incident queries into dense vector queries, ranks matching
 * runbook chunks by similarity score, and formats the output into markdown context for LLM prompts.
 */

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
 * Searches the Qdrant vector database for runbooks matching an error signature.
 *
 * @param query - Free-text search query (e.g. 'postgres ECONNREFUSED' or 'Redis timeout')
 * @param options - Similarity search parameters including top-k and metadata filters
 * @returns Array of matching documents paired with cosine similarity relevance scores
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
 * Convenience helper formatting top-k runbook matches into clean Markdown
 * ready for direct injection into LangGraph LLM system prompts or tool returns.
 *
 * @param query - Free-text error description
 * @param k - Number of highest-ranked chunks to return
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
