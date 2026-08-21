import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests run inside workerd via @cloudflare/vitest-pool-workers, against
 * Miniflare's real D1 (SQLite). That matters: the atomic-consume guard is a
 * WHERE clause, so it is only meaningful if a real SQLite engine evaluates it
 * -- a mocked `env.DB` would happily "pass" a query SQLite would reject.
 *
 * No account, no auth, no network.
 *
 * Note the shape: pool-workers 0.22 replaced `defineWorkersConfig` +
 * `test.poolOptions.workers` with the `cloudflareTest()` Vite plugin.
 */
export default defineConfig(async () => {
  const migrationsDir = fileURLToPath(new URL('./migrations', import.meta.url));
  const migrations = await readD1Migrations(migrationsDir);

  return {
    plugins: [
      cloudflareTest({
        singleWorker: true,
        isolatedStorage: true,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
