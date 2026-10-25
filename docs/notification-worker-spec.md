# Notification Worker & Webhooks API Specification

## Service Identity
- **Identifier**: `notification-worker`
- **Queue Consumer**: BullMQ worker on Redis queue `notifications:dispatch`
- **Egress Targets**: Slack Webhooks, Telegram Bot API, Twilio SMS

## Rate Quotas & Throttle Constraints
Downstream providers enforce sliding-window request quotas. Workers must adhere to the limits below to prevent account suspensions and throttles:

```yaml
quotas:
  slack_webhooks:
    requests_per_minute: 60
    burst_limit: 10
  telegram_bot_api:
    messages_per_second: 30
    messages_per_chat_minute: 20
  partner_custom_webhooks:
    sliding_window_seconds: 60
    max_requests: 100
```

## Response Codes & Handling
- **HTTP 429 Too Many Requests**:
  - Received when outbound dispatch exceeds the provider's active request quota window.
  - Workers must parse the `Retry-After` response header (seconds to wait) and defer job execution in the queue until the window resets.
  - Immediate retries without delay will trigger temporary IP bans from the destination host.
