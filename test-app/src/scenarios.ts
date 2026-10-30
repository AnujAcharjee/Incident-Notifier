/**
 * @file test-app/src/scenarios.ts
 * @description Simulated microservice telemetry scenarios mirroring production outage topologies.
 * Models normal happy-path traffic alongside real-world failure patterns:
 * - PostgreSQL TCP connection refusal (ECONNREFUSED)
 * - Stripe Payment Gateway HTTP 504 timeouts
 * - Redis cluster latency spikes and command timeouts (ETIMEDOUT)
 * - Outbound webhook rate-limit throttling (HTTP 429)
 * - Authentication JWT expiration bursts (HTTP 401)
 */

import { logger } from "./logger";

export const ERROR_CODES = {
  DB_REFUSED: "ECONNREFUSED",
  PAYMENT_TIMEOUT: "HTTP_504_GATEWAY_TIMEOUT",
  REDIS_TIMEOUT: "ETIMEDOUT",
  RATE_LIMIT: "HTTP_429_TOO_MANY_REQUESTS",
  AUTH_SPIKE: "HTTP_401_UNAUTHORIZED",
} as const;

export const scenarios = {
  /**
   * Database operation: simulates PostgreSQL pool operations vs down cluster connection refused.
   */
  simulateDatabaseQuery(forceError = false): void {
    const service = "postgres-db";
    const traceId = "tr-db-" + Math.random().toString(36).substring(2, 8);

    if (forceError) {
      logger.error({
        service,
        traceId,
        errorCode: ERROR_CODES.DB_REFUSED,
        message: "connect ECONNREFUSED 127.0.0.1:5432 - Connection rejected by target host during query execution",
        metadata: {
          host: "127.0.0.1",
          port: 5432,
          database: "ecommerce_prod",
          query: "SELECT * FROM orders WHERE status = 'pending' LIMIT 100",
          poolSize: 20,
          activeConnections: 0,
        },
      });
    } else {
      logger.info({
        service,
        traceId,
        message: "Query executed successfully: fetched 14 records in 12ms",
        metadata: { rows: 14, duration_ms: 12 },
      });
    }
  },

  /**
   * Payment gateway: simulates Stripe authorization vs external 504 gateway timeout.
   */
  simulatePaymentGateway(forceError = false): void {
    const service = "payment-service";
    const traceId = "tr-pay-" + Math.random().toString(36).substring(2, 8);

    if (forceError) {
      logger.error({
        service,
        traceId,
        errorCode: ERROR_CODES.PAYMENT_TIMEOUT,
        message: "HTTP 504 Gateway Timeout from https://api.stripe.com/v1/charges after 30000ms",
        metadata: {
          endpoint: "/v1/charges",
          provider: "stripe",
          amount: 8999,
          currency: "usd",
          timeout_ms: 30000,
        },
      });
    } else {
      logger.info({
        service,
        traceId,
        message: "Payment authorized: $89.99 for customer cus_99214 via Stripe",
        metadata: { status: "succeeded", duration_ms: 240 },
      });
    }
  },

  /**
   * In-memory cache: simulates Redis cluster cache hits vs socket timeout.
   */
  simulateCacheOperation(forceError = false): void {
    const service = "redis-cache";
    const traceId = "tr-cache-" + Math.random().toString(36).substring(2, 8);

    if (forceError) {
      logger.error({
        service,
        traceId,
        errorCode: ERROR_CODES.REDIS_TIMEOUT,
        message: "ETIMEDOUT: Redis command GET session:usr_4818 timed out after 5000ms. Main thread blocked.",
        metadata: {
          command: "GET",
          key: "session:usr_4818",
          timeout_ms: 5000,
          cluster_node: "10.0.2.14:6379",
        },
      });
    } else {
      logger.info({
        service,
        traceId,
        message: "Cache hit for key 'session:usr_4818' (1.2ms)",
        metadata: { key: "session:usr_4818", hit: true },
      });
    }
  },

  /**
   * Outbound notification worker: simulates webhook deliveries vs HTTP 429 quota exhaustion.
   */
  simulateOutboundNotification(forceError = false): void {
    const service = "notification-worker";
    const traceId = "tr-notif-" + Math.random().toString(36).substring(2, 8);

    if (forceError) {
      logger.error({
        service,
        traceId,
        errorCode: ERROR_CODES.RATE_LIMIT,
        message: "HTTP 429 Too Many Requests from external webhook endpoint. Rate quota exceeded.",
        metadata: {
          url: "https://hooks.slack.com/services/T00/B00/XXXX",
          retry_after_sec: 60,
          quota_limit: 100,
          current_window_requests: 124,
        },
      });
    } else {
      logger.info({
        service,
        traceId,
        message: "Order confirmation email & webhook delivered successfully",
        metadata: { recipient: "customer@example.com", queue_lag_ms: 45 },
      });
    }
  },

  /**
   * Authentication service: simulates token issuance vs signature failure warnings.
   */
  simulateUserAuth(forceError = false): void {
    const service = "auth-service";
    const traceId = "tr-auth-" + Math.random().toString(36).substring(2, 8);

    if (forceError) {
      logger.warn({
        service,
        traceId,
        errorCode: ERROR_CODES.AUTH_SPIKE,
        message: "401 Unauthorized: JWT signature invalid or expired for token Bearer eyJhbGci...",
        metadata: {
          ip: "198.51.100.42",
          endpoint: "/api/v1/account",
          reason: "token_expired",
        },
      });
    } else {
      logger.info({
        service,
        traceId,
        message: "User usr_7718 authenticated successfully with refreshed session token",
        metadata: { user_id: "usr_7718" },
      });
    }
  },
};
