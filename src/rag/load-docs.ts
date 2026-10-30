/**
 * @file src/rag/load-docs.ts
 * @description Document loaders for local runbooks and remote operational documentation.
 * Parses Markdown, JSON, and plaintext files from the local filesystem or remote HTTP endpoints,
 * generating normalized LangChain Document instances equipped with file path and MIME metadata.
 */

import { Document } from "@langchain/core/documents";
import { readdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";

export interface LoadDirectoryOptions {
  extensions?: string[];
  recursive?: boolean;
}

/**
 * Loads a single local file (.md, .txt, .json) into a LangChain Document.
 *
 * @param filePath - Path to file on local disk
 * @throws Error if file does not exist
 */
export async function loadLocalFile(filePath: string): Promise<Document> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = await file.text();
  const filename = basename(filePath);
  const extension = extname(filePath);

  return new Document({
    pageContent: content.trim(),
    metadata: {
      source: filePath,
      filename,
      extension,
      type: "local_file",
    },
  });
}

/**
 * Recursively scans a directory and loads all supported runbook/architecture documentation files.
 *
 * @param dirPath - Directory path (default: ./docs)
 * @param options - Custom extension filter and recursion flags
 */
export async function loadLocalDirectory(
  dirPath: string,
  options: LoadDirectoryOptions = {}
): Promise<Document[]> {
  const extensions = options.extensions ?? [".md", ".markdown", ".txt", ".json"];
  const recursive = options.recursive ?? true;
  const docs: Document[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        const subDocs = await loadLocalDirectory(fullPath, options);
        docs.push(...subDocs);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          const doc = await loadLocalFile(fullPath);
          docs.push(doc);
        }
      }
    }
  } catch (error) {
    console.warn(`[Loader] Could not read local directory ${dirPath}:`, (error as Error).message);
  }

  return docs;
}

/**
 * Ingests documentation from a remote URL (e.g. GitHub raw, Confluence API, internal wikis).
 *
 * @param url - HTTP/HTTPS URL
 * @param extraMetadata - Optional custom metadata tags to append
 */
export async function loadRemoteUrl(
  url: string,
  extraMetadata: Record<string, any> = {}
): Promise<Document> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  const contentType = response.headers.get("content-type") ?? "text/plain";

  return new Document({
    pageContent: content.trim(),
    metadata: {
      source: url,
      contentType,
      type: "remote_url",
      ...extraMetadata,
    },
  });
}

/**
 * Fetches multiple remote documentation URLs concurrently with fail-soft allSettled semantics.
 *
 * @param urls - Array of URLs to ingest
 */
export async function loadRemoteUrls(urls: string[]): Promise<Document[]> {
  const results = await Promise.allSettled(urls.map((url) => loadRemoteUrl(url)));
  const docs: Document[] = [];

  for (let i = 0; i < results.length; i++) {
    const res = results[i]!;
    if (res.status === "fulfilled") {
      docs.push(res.value);
    } else {
      console.warn(`[Loader] Failed to load remote URL "${urls[i]}":`, res.reason);
    }
  }

  return docs;
}
