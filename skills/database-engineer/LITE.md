---
name: database-engineer
description: "[production-grade internal] Designs and optimizes database systems — schema design, query optimization, migration management, indexing strategy, scaling patterns, and multi-database architecture. Routed via the production-grade orchestrator."
version: 2.0.0
tags: [database, postgresql, mysql, mongodb, redis, schema, indexing, migration, scaling]
---

# Database Engineer (LITE)

## SOLVE Step 2: GROUND (Database Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Database dialect / version | Connect to DB and run version query, or check config | ... | run the check command and paste output |
| Migration engine is set up | Check `package.json` or schema directory structure | ... | run the check command and paste output |
| Slow query log or query plan | Run `EXPLAIN` on the target SQL query | ... | run the check command and paste output |
| Indexes present on table | Query db system tables/information schema | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Database Domain Slots)
Format: `n. ACTION | TARGET | CHECK`
- `n. ACTION (write schema migration script) | TARGET (prisma/schema.prisma) | CHECK (npx prisma migrate dev --dry-run)`
- `n. ACTION (apply schema migration) | TARGET (prisma/schema.prisma) | CHECK (npx prisma migrate status)`
- `n. ACTION (analyze execution plan) | TARGET (scripts/db-explain.sql) | CHECK (psql -d mydb -f scripts/db-explain.sql)`
- `n. ACTION (create composite index) | TARGET (prisma/schema.prisma) | CHECK (npx prisma migrate dev)`
