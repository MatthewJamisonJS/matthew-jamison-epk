# Supply-chain remediation: 2026-11-12

## Scope and outcome

Repository: `MatthewJamisonJS/matthew-jamison-epk`, website `matthewjamison.dev`. Baseline: clean `main` checkout at `8b234d3fa30c4ac5fbbc0d00a871fceb8ed51bd3`, matching the two supplied Semgrep exports. All findings target `worker/package-lock.json`.

**84 distinct finding IDs** were retained: 41 high, 33 medium, 10 low. Their original states were 31 Open, 28 Fixing, and 25 Provisionally_Ignored_App. The two inputs contain 31 and 53 rows respectively. Repeated CVEs across versions/platforms remain separate rows; no finding was dropped merely because it was marked unreachable.

**Locally remediated and verified; Semgrep rescan and deployment remain pending.** The reported vulnerable versions have been removed from the edited lockfile and replaced with versions outside the baseline npm advisory ranges. Native Brotli coverage was checked separately against the exact workerd release source. This is not a claim that Semgrep has closed its alerts, that production has received these changes, or that the application has no other vulnerabilities.

The companion [`2026-11-12-findings.csv`](2026-11-12-findings.csv) is the complete per-finding ledger: source file, original ID/state/severity/reachability, package, advisory, reported version, every replacement path/version, scope, evidence, and remaining verification.

## Root cause and debugging sequence

1. Read both reports and matched their commit to the untouched checkout. Captured the original lock and audits before editing. Baseline typecheck and all 169 tests passed, demonstrating that ordinary functional checks did not detect the dependency exposure. The full baseline npm audit nevertheless reported 13 vulnerable package groups (not 13 individual CVEs).
2. Traced dependencies through the installed tree and lockfile. Old top-level Wrangler and the deprecated `@cloudflare/vitest-pool-workers` integration retained different Miniflare/workerd generations and duplicate vulnerable dependency trees. Updating a top-level package alone could leave nested pins behind. Stripe separately retained the production `qs` dependency.
3. Tested upgrading the old pool integration with a latest-Miniflare override. This failed because the old integration imported `getNodeCompat`, which the new dependency no longer exported. The override was rejected rather than treating a clean audit as sufficient proof of compatibility.
4. Migrated to the supported `@cloudflare/vitest-plugin` integration, updated its configuration/type references, and selected compatible Wrangler, Vitest, and Worker types. Removed overrides instead of forcing incompatible internals. Kept the existing application, database schema, business logic, and production settings outside this change.
5. Verified every supplied package/version against all current lockfile paths, including optional platform binaries and nested esbuild instances. Added dependency regression protection, a real Stripe SDK serialization regression, and a read-only CI verification workflow. Reinstalled cleanly and reran all final checks after migration.

The named `/systematic-debugging` skill was unavailable in the accessible catalog and checkout. The work nevertheless followed a systematic baseline, dependency-path/root-cause analysis, failed-hypothesis investigation, supported correction, and regression-verification sequence; it does not claim to have executed that unavailable skill.

## Dependency resolution

| Reported package | Reported versions | Replacement version(s) | Scope | Findings |
|---|---|---|---|---:|
| `@cloudflare/workerd-darwin-64` | `1.20260426.1`, `1.20260815.1` | `1.20261110.1` | Dev/test/build | 2 |
| `@cloudflare/workerd-darwin-arm64` | `1.20260426.1`, `1.20260815.1` | `1.20261110.1` | Dev/test/build | 2 |
| `@cloudflare/workerd-linux-64` | `1.20260426.1`, `1.20260815.1` | `1.20261110.1` | Dev/test/build | 2 |
| `@cloudflare/workerd-linux-arm64` | `1.20260426.1`, `1.20260815.1` | `1.20261110.1` | Dev/test/build | 2 |
| `@cloudflare/workerd-windows-64` | `1.20260426.1`, `1.20260815.1` | `1.20261110.1` | Dev/test/build | 2 |
| `@vitest/mocker` | `4.1.11` | `4.1.12` | Dev/test/build | 2 |
| `esbuild` | `0.27.3` | `0.28.2` | Dev/test/build | 1 |
| `qs` | `6.15.3` | `6.17.1` | Production via Stripe | 3 |
| `sharp` | `0.34.5`, `0.35.2` | `0.35.5` | Dev/test/build | 5 |
| `source-map-js` | `1.2.1` | `1.2.2` | Dev/test/build | 1 |
| `undici` | `7.24.8`, `7.29.0` | `7.30.1` | Dev/test/build | 51 |
| `vite` | `8.2.2` | `8.3.8` | Dev/test/build | 6 |
| `workerd` | `1.20260426.1`, `1.20260815.1` | `1.20261110.1` | Dev/test/build | 2 |
| `ws` | `8.18.0` | `8.21.0` | Dev/test/build | 2 |
| `zod` | `4.4.3` | `4.6.6` | Dev/test/build | 1 |

## Exposure and evidence

- **qs:** the only reported package present as a non-dev dependency. Stripe imports it in `worker/node_modules/stripe/esm/utils.js` for request serialization (`stringify`). That is not proof that every reported parser/stringifier condition is reachable from a public route. It was upgraded to 6.17.1 regardless; existing Stripe behavior must remain covered by application tests.
- **Development tooling:** every matching lock entry for ws, undici, Vite, Vitest mocker, esbuild, sharp, source-map-js, Zod, workerd, and its platform binaries has `dev: true`. They still execute locally or in CI, so malicious images, source maps, HTTP/WebSocket data, or dev-server requests can matter. They are not automatically production runtime dependencies merely because the scanner reports Always Reachable.
- **Hosted runtime distinction:** Cloudflare operates its production Workers runtime. The local npm `workerd` binary is used by development and tests; upgrading it does not independently prove or change the hosted runtime patch level.
- **Sharp native libraries:** the maintainer advisories fix libvips at sharp 0.35.0, libheif at 0.35.4, and librsvg at 0.35.5. The selected 0.35.5 covers all three when using the supplied prebuilt binaries. The installed native versions were verified: sharp 0.35.5, libvips 8.18.7, libheif 1.23.5, and librsvg 2.63.2. No vulnerable custom global-library substitution was found in that installed configuration. Other machines should verify any custom native-library setup separately.
- **Custom Brotli rule:** `GHSA-cust-0000-0034` did not resolve to a public GitHub advisory. Its supplied description matches Brotli CVE-2026-111497. The exact selected workerd `1.20261110.1` declares Brotli **1.2.1** in its release-tagged build dependencies, fixing that underlying flaw. All five platform package entries and the workerd wrapper now resolve to that same version. An additional workerd override is unnecessary.

Primary evidence:

* [Sharp libvips advisory](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj)
* [Sharp libheif advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)
* [Sharp librsvg advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)
* [Zod fixed at 4.6.6](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
* [source-map-js maintainer confirms 1.2.2](https://github.com/7rulnik/source-map-js/issues/76)
* [Exact selected workerd Brotli declaration](https://github.com/cloudflare/workerd/blob/v1.20261110.1/build/deps/gen/deps.MODULE.bazel#L25)
* [Brotli underlying vulnerability and fixed version](https://github.com/advisories/GHSA-9v8h-qqgm-4m35)
* [Cloudflare production versus open-source patch discussion](https://github.com/cloudflare/workerd/issues/8004)

The ledger includes the baseline npm advisory URLs for each affected package. For package families with several CVEs, its evidence column intentionally supplies the complete relevant package advisory set rather than inventing a one-to-one CVE alias mapping. The custom Brotli finding uses source-level release evidence because npm audit alone does not establish native-binary coverage.

## Verification record

| Check | Result |
|---|---|
| Baseline TypeScript typecheck | Passed |
| Baseline functional suite | 169 tests passed |
| Baseline full npm audit | 13 vulnerable package groups |
| Clean dependency installation | `npm ci --ignore-scripts` passed |
| Aggregate Worker verification | `npm run verify` passed |
| Dependency guard | Passed for all 16 current package copies; 57 guard tests passed |
| Guard negative control | Original lock rejected with exit 1 and 23 vulnerable package copies |
| Final TypeScript typecheck | Passed |
| Final Worker functional suite | 170 tests passed across 14 files, including actual Stripe SDK serialization regression |
| Worker dry-run bundle | Passed: 352.30 KiB total / 72.34 KiB gzip; no deployment |
| Final full npm audit | `npm audit --json`: zero vulnerabilities |
| Final production npm audit | `npm audit --omit=dev --json`: zero vulnerabilities |
| Dependency-tree consistency | `npm ls --all` exited 0 |
| Content build tests | `node scripts/build.test.mjs`: 47 passed, 8 skipped because corpus fixtures were absent |
| Player tests | `node scripts/player.test.mjs`: 102 passed |
| Whitespace/diff validation | `git diff --check` passed |
| Installed Sharp native libraries | sharp 0.35.5; vips 8.18.7; heif 1.23.5; rsvg 2.63.2 |
| Live smoke script | Not run: requires services/credentials |
| Browser QA | Not run: dependency-only changes, with no UI implementation changes |
| GitHub security workflow | Initial push and PR runs passed at `0b2053f`; review-fix head must pass again before merge (see PR #11) |
| All supplied IDs retained | 84 unique IDs in companion ledger |
| All reported vulnerable versions removed | Verified across all current matching lock paths |
| Hosted Semgrep rescan | Automatically queued on PR #11; completion is a separate pre-merge gate |
| Production deployment / live smoke | Not performed |

## Completion boundary and follow-through

The initial remediation was repository-local. The owner subsequently requested a full check, separate commits per fix, and a push. The complete local checks were rerun successfully and the seven initial commits were pushed on `fix/security-supply-chain-20261112`. The owner then authorized PR #11, independent review, correction, re-review, and merge only after all checks pass. This snapshot is recorded before the review-fix push and conditional merge. Merging to main triggers the existing Pages deployment; the Worker deploys separately. No live database mutation, security-setting change, manual Worker deployment, or Semgrep status mutation is included. Final local checks passed as recorded above; skipped/unrun stages are not represented as passed. Rerun Semgrep against the resulting commit and reconcile every finding ID before marking the external findings fixed. Review any remaining custom-rule matches against the exact workerd build evidence rather than suppressing them on reachability alone.

Keep local development servers private and avoid untrusted test/build inputs until the updated dependencies are installed. Use the committed lockfile with a clean `npm ci` so another machine or CI does not retain the obsolete nested tree.

## Regression prevention

`.github/workflows/worker-security.yml` runs a clean install, `npm run verify`, and a live npm audit on pull requests and pushes. It requests read-only repository contents permission and contains no deployment step. Initial push and PR runs both passed on GitHub. The workflow pins checkout and setup-node to verified immutable commits. Final-head checks remain a merge gate after review fixes. The lockfile guard rejects the original vulnerable tree and checks current resolved package copies; the native Brotli mapping remains backed by release-source evidence rather than an npm-only result. npm advisory coverage and Semgrep rules differ, so a zero npm audit is not a substitute for the pending Semgrep rescan.

## Publication review

A fresh independent review confirmed all 84 IDs and replacement path/version mappings. Full clean-install checks, both audits, all runnable automated test suites and diff validation were repeated before committing. The optional browser suite could not run because its required full FFmpeg binary is unavailable; an installed Playwright package alone is insufficient. The live smoke script was deliberately not run: it can create Stripe sessions, trigger/resend events, and execute email/outbox processing even with localhost as its base URL. These are not claimed as passed.

Independent fixes are separated into commits for qs/Stripe serialization, source-map-js, Vite, Vitest mocker, and the coordinated Cloudflare toolchain. Cloudflare dependency fixes must stay together because maintained Wrangler/Miniflare/test-plugin versions pin mutually compatible dependencies and runtime APIs. Regression automation and the 84-finding evidence ledger receive separate commits. The new verification workflow also runs on feature-branch pushes; the existing main-only deployment workflow is unchanged.

## Independent PR review correction

A fresh Astra review of `0b2053f` found one P2: comparing every version to a single numeric floor incorrectly accepted vulnerable later release lines (Vite 8.3.2, Vitest mocker 5.0.2, Undici 8.12.1). Installed versions were already patched; the defect was in the new regression gate. The guard now uses explicit reviewed release-line ranges, rejects unknown major lines (and unknown Vite/zero-major minor lines), and has 57 passing tests including exact negative/positive boundaries. Local aggregate verification and both npm audits passed again after this correction. Final independent re-review and checks on the resulting SHA are required before merge.

Review evidence and live status: [PR #11](https://github.com/MatthewJamisonJS/matthew-jamison-epk/pull/11), [initial push verification](https://github.com/MatthewJamisonJS/matthew-jamison-epk/actions/runs/43269756085), [initial PR verification](https://github.com/MatthewJamisonJS/matthew-jamison-epk/actions/runs/43274824547). These linked runs apply to their stated commit, not automatically to later changes.

Future coverage assessment: Dependabot currently updates only GitHub Actions. The existing Dependabot workflow can fall back to a direct squash merge. Adding npm updates without changing that policy could therefore merge dependencies without the intended review gate. This PR does not broaden Dependabot or enable automatic dependency merges. A separately approved report-only scheduled audit or reviewed npm-update process would address newly published advisories between code changes.
