import { Document } from "@langchain/core/documents";
import { readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

export interface LoadDirectoryOptions {
  extensions?: string[];
  recursive?: boolean;
}

/**
 * Loads a single local file (.md, .txt, .json) into a LangChain Document.
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
 * Recursively scans a local directory and loads all matching documents.
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
 * Fetches document content from a remote URL (HTTP/HTTPS, GitHub Raw, etc.).
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
 * Fetches multiple remote URLs in parallel.
 */
export async function loadRemoteUrls(urls: string[]): Promise<Document[]> {
  const results = await Promise.allSettled(urls.map((url) => loadRemoteUrl(url)));
  const docs: Document[] = [];

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res && res.status === "fulfilled") {
      docs.push(res.value);
    } else if (res && res.status === "rejected") {
      console.warn(`[Loader] Failed to fetch remote URL ${urls[i]}:`, res.reason);
    }
  }

  return docs;
}
