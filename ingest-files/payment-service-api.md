# Payment Gateway Client Specification

## Service Identity
- **Identifier**: `payment-service`
- **External Provider**: Stripe Payments API
- **Base URL**: `https://api.stripe.com/v1`

## API Endpoints & Request Contracts

### 1. Authorize & Capture Charge
- **Method**: `POST`
- **Path**: `/v1/charges`
- **Headers Required**:
  - `Authorization`: `Bearer <STRIPE_SECRET_KEY>`
  - `Idempotency-Key`: UUID v4 string (Mandatory on all mutations to prevent duplicate debiting)
  - `Content-Type`: `application/x-www-form-urlencoded`

## Timeout & Retry Policies
- **Client Socket Timeout**: `30000ms` (30 seconds).
  - If no TCP response packet is received within 30 seconds, the client throws `HTTP_504_GATEWAY_TIMEOUT`.
- **Retry Policy**:
  - Upstream 5xx errors (500, 502, 503, 504) are eligible for automatic retries with exponential backoff ONLY if an `Idempotency-Key` was attached to the initial payload.
  - Maximum retry attempts: 3.
  - Initial delay: 1000ms, backoff factor: 2x with ±20% jitter.
