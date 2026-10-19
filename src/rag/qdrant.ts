import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { ENV } from "../config";

const embeddings = new OpenAIEmbeddings({
  model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
  apiKey: ENV.OPENROUTER_API_KEY!,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});


export function getVectorStore(collectionName = ENV.QDRANT_COLLECTION): QdrantVectorStore {
  return new QdrantVectorStore(embeddings, {
    url: ENV.QDRANT_URL,
    apiKey: ENV.QDRANT_API_KEY,
    collectionName,
  });
}

export const vectorStore = getVectorStore();