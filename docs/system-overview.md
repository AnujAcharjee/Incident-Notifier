# System Architecture & Service Registry

## Overview
This document specifies the internal service topology, communication protocols, network boundaries, and environment configurations for the core platform.

## Service Map & Port Allocation

| Service Identifier | Type | Host / Address | Port | Protocols | Primary Responsibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `postgres-db` | Primary Relational DB | `127.0.0.1` / `db.internal` | `5432` | TCP / PostgreSQL Wire | Relational storage for users, orders, inventory |
| `redis-cache` | In-Memory Cache | `127.0.0.1` / `cache.internal` | `6379` | TCP / RESP | User sessions, cart data, rate-limiting counters |
| `payment-service` | API Gateway Client | Egress to Stripe API | `443` | HTTPS / REST | Credit card authorization, captures, refund webhooks |
| `notification-worker`| Async Worker Service | Internal Queue Consumer | - | HTTPS Egress | Outbound transactional emails, SMS, partner webhooks |
| `auth-service` | Identity Provider | Internal Module | - | JWT (RS256) | User authentication, token issuance, permission validation |

## Core Infrastructure Constraints
- **Private Subnet**: All database and cache instances are isolated in private subnets with strict firewall ingress rules.
- **Circuit Breaking**: HTTP downstream calls that exceed 3 consecutive timeouts must trip circuit breakers for 30 seconds.
- **Log Standard**: All services output structured JSON to stdout, scraped by Promtail / Loki with stream label `app="test-app"`.
