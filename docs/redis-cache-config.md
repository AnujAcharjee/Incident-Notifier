# Redis In-Memory Cache Architecture & Guidelines

## Service Identity
- **Identifier**: `redis-cache`
- **Engine**: Redis 7.2 (Standalone & Sentinel)
- **Port**: `6379`
- **Default Database Index**: `0`

## Key Schema & Expiration Standards

| Namespace Pattern | Purpose | Default TTL | Eviction Policy |
| :--- | :--- | :--- | :--- |
| `session:<user_id>` | User authentication token and active session metadata | 86400s (24h) | Volatile LRU |
| `cart:<cart_id>` | Active shopping cart items before checkout | 604800s (7d) | Volatile LRU |
| `rate:ip:<ip_addr>` | Sliding-window API rate limit counters | 60s (1m) | Volatile LFU |

## Operational Rules & Performance Thresholds
- **Client Command Timeout**: `5000ms` (5 seconds). Commands pending execution beyond this limit throw `ETIMEDOUT`.
- **Prohibited Commands**:
  - The `KEYS *` command is **strictly prohibited in production environments**. Because Redis operates on a single-threaded event loop, scanning millions of keys blocks all other read/write operations until completion.
  - Engineers must utilize cursor-based iteration with `SCAN <cursor> MATCH <pattern> COUNT <count>`.
- **Memory Thresholds**:
  - `maxmemory` configured at 80% host RAM.
  - `maxmemory-policy`: `allkeys-lru`.
