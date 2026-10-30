/**
 * @file src/rag/qdrant.ts
 * @description Qdrant Vector Store client initialization and embedding pipeline.
 * Pairs OpenAI-compatible embedding models via OpenRouter with the official @langchain/qdrant
 * driver, supporting both local Docker instances and authenticated Qdrant Cloud clusters.
 */

import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { ENV } from "../config";

/**
 * Text embedding model configuration.
 * Routes through OpenRouter to leverage high-performance embedding models.
 */
const embeddings = new OpenAIEmbeddings({
  model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
  apiKey: ENV.OPENROUTER_API_KEY!,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

/**
 * Factory creating a QdrantVectorStore client instance scoped to a collection.
 *
 * @param collectionName - Qdrant collection name (default: incident-knowledge)
 * @returns Configured QdrantVectorStore instance
 */
export function getVectorStore(collectionName = ENV.QDRANT_COLLECTION): QdrantVectorStore {
  return new QdrantVectorStore(embeddings, {
    url: ENV.QDRANT_URL,
    apiKey: ENV.QDRANT_API_KEY,
    collectionName,
  });
}

/**
 * Singleton vector store instance bound to default collection.
 */
export const vectorStore = getVectorStore();
