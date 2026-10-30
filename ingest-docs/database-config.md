# PostgreSQL Database Configuration & Connection Policy

## Service Identity
- **Identifier**: `postgres-db`
- **Engine**: PostgreSQL 16
- **Default Database**: `ecommerce_prod`
- **Default Port**: `5432`

## Connection Pooling Specifications
The application utilizes an internal connection pool with the following bounds:

```yaml
database:
  host: 127.0.0.1
  port: 5432
  pool:
    min_connections: 5
    max_connections: 20
    acquire_timeout_ms: 10000     # Maximum time to wait for a free connection from the pool
    idle_timeout_ms: 30000        # Reclaims connections idle for >30s
    connection_timeout_ms: 5000   # Socket connect timeout to TCP 5432
```

## Failure Modes & Behaviors
- **Refused Connection (`ECONNREFUSED`)**:
  - Indicates the PostgreSQL server daemon is not responding to TCP SYN packets on port 5432.
  - Can occur during service restarts, container termination (e.g. host OOM kill), or incorrect environment variables.
- **Acquire Timeout (`ETIMEDOUT`)**:
  - Occurs when all 20 pool connections are active and busy executing queries, and a client thread waits longer than `acquire_timeout_ms` (10s) without an available connection.
  - Common triggers: Long-running unindexed table scans or uncommitted transactional blocks.
