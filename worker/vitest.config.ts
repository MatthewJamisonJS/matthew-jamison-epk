import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Tests run inside workerd via @cloudflare/vitest-plugin, against
 * Miniflare's real D1 (SQLite). That matters: the atomic-consume guard is a
 * WHERE clause, so it is only meaningful if a real SQLite engine evaluates it
 * -- a mocked `env.DB` would happily "pass" a query SQLite would reject.
 *
 * No account, no auth, no network.
 *
 * The maintained @cloudflare/vitest-plugin replaces the deprecated
 * pool-workers package and keeps the cloudflareTest() configuration shape.
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
      // Node-only dependency guard tests run via test:dependencies, not workerd.
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
