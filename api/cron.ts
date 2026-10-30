/**
 * @file api/cron.ts
 * @description Standalone Vercel Serverless Function entry point for cron triggers.
 * Serves GET /api/cron for serverless projects.
 */

export { GET, dynamic, maxDuration } from "../app/api/hello/route";

