/**
 * @file src/rag/ingest.ts
 * @description Ingestion pipeline script chunking runbook documents and populating Qdrant collections.
 * Recursively scans `./ingest-files`, segments documents into overlapping token-aware chunks via
 * RecursiveCharacterTextSplitter, computes vector embeddings, and bulk-upserts them to Qdrant.
 */

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getVectorStore } from "./qdrant";
import { ENV } from "../config";
import { loadLocalDirectory, loadRemoteUrls } from "./load-docs";

export interface IngestOptions {
  collectionName?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  localDir?: string;
  remoteUrls?: string[];
}

export interface IngestResult {
  success: boolean;
  totalDocs: number;
  totalChunks: number;
  collectionName: string;
}

/**
 * Loads, splits, and ingests documents into the Qdrant vector database.
 * Supports composite sources including local filesystem directories and remote HTTP URLs.
 *
 * @param customDocs - In-memory documents to index
 * @param options - Ingestion tuning parameters (chunk size, overlap, target collection)
 */
export async function ingestDocuments(
  customDocs?: Document[],
  options: IngestOptions = {}
): Promise<IngestResult> {
  const collectionName = options.collectionName ?? ENV.QDRANT_COLLECTION;
  const chunkSize = options.chunkSize ?? 1000;
  const chunkOverlap = options.chunkOverlap ?? 200;

  const allDocs: Document[] = [];

  if (customDocs && customDocs.length > 0) {
    allDocs.push(...customDocs);
  }

  const localDir = options.localDir ?? "./ingest-files";
  const localDocs = await loadLocalDirectory(localDir);
  if (localDocs.length > 0) {
    console.log(`[RAG] Loaded ${localDocs.length} documents from local directory "${localDir}".`);
    allDocs.push(...localDocs);
  }

  if (options.remoteUrls && options.remoteUrls.length > 0) {
    const remoteDocs = await loadRemoteUrls(options.remoteUrls);
    if (remoteDocs.length > 0) {
      console.log(`[RAG] Loaded ${remoteDocs.length} documents from remote URLs.`);
      allDocs.push(...remoteDocs);
    }
  }

  if (allDocs.length === 0) {
    console.warn(`[RAG] No documents found to ingest.`);
    return {
      success: true,
      totalDocs: 0,
      totalChunks: 0,
      collectionName,
    };
  }

  console.log(`[RAG] Preparing to ingest ${allDocs.length} total documents into collection "${collectionName}"...`);

  // Split on paragraph and sentence boundaries while preserving 20% overlap for semantic coherence
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const chunks = await splitter.splitDocuments(allDocs);
  console.log(
    `[RAG] Split into ${chunks.length} chunks. Generating embeddings and storing in ${ENV.IS_QDRANT_CLOUD ? "Qdrant Cloud" : "Qdrant"} (${ENV.QDRANT_URL})...`
  );

  const store = getVectorStore(collectionName);
  await store.addDocuments(chunks);

  console.log(`[RAG] Successfully ingested ${chunks.length} chunks into Qdrant collection "${collectionName}".`);

  return {
    success: true,
    totalDocs: allDocs.length,
    totalChunks: chunks.length,
    collectionName,
  };
}

try {
  const result = await ingestDocuments();
  console.log(`[RAG] Ingestion completed:`, result);
} catch (error) {
  console.error(`[RAG] Ingestion failed:`, error);
  process.exit(1);
}
