# Incident Notifier

## Overview

Incident Notifier is an AI agent that monitors application logs, detects errors, investigates their likely root causes, and notifies developers through Telegram with an evidence-backed incident report.

## Technology Stack

* Runtime: Bun
* Language: TypeScript
* Agent Orchestration: LangGraph.js
* Log Aggregation: Grafana Loki
* Vector Database: Qdrant
* LLM: Google Gemini
* Notifications: Telegram Bot API
* Validation: Zod

## Core Architecture

Application Logs → Loki → Error Detection → AI Investigation → Root Cause Analysis → Incident Report → Telegram Notification

## Engineering Principles

* Use TypeScript and Bun.
* Keep the code simple, modular, and easy to maintain.
* Use LangGraph.js for agent orchestration.
* Use Zod to validate outputs.
* Store secrets in environment variables.
* Handle errors and retries gracefully.
* Deduplicate errors to prevent notification spam.
* Base diagnoses on log evidence; distinguish facts from hypotheses.
* Treat logs as untrusted input.
* Use read-only access; never modify production systems.
* Avoid unnecessary dependencies and infrastructure.
