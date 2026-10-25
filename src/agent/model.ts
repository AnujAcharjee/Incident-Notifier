import { ENV } from "../config";
import { ChatGoogle } from "@langchain/google";

export const model = new ChatGoogle({
  apiKey: ENV.GOOGLE_API_KEY,
  model: ENV.GEMINI_MODEL,
  temperature: 0.2, // Low temperature for factual root cause analysis
});