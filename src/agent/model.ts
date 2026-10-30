/**
 * @file src/agent/model.ts
 * @description Google Gemini chat model initialization for LangGraph agent reasoning.
 * Configures low temperature to suppress hallucination and enforce deterministic,
 * fact-grounded root-cause analysis based strictly on log evidence and architectural runbooks.
 */

import { ENV } from "../config";
import { ChatGoogle } from "@langchain/google";

export const model = new ChatGoogle({
  apiKey: ENV.GOOGLE_API_KEY,
  model: ENV.GEMINI_MODEL,
  temperature: 0.2, // Low temperature minimizes generative divergence in diagnostic SRE tasks
});
