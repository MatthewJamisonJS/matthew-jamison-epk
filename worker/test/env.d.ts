import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerEnv } from '../src/types';

/**
 * `env` from "cloudflare:test" is typed as `Cloudflare.Env`, so the Worker's
 * own bindings are declared onto that namespace here. TEST_MIGRATIONS is
 * injected by vitest.config.ts and exists only under test.
 */
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
