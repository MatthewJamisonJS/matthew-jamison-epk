import { applyD1Migrations, env } from 'cloudflare:test';

// Same migration files the real deploy applies. If a migration is malformed,
// the whole suite fails here rather than at 2am.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
