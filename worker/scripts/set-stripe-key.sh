#!/usr/bin/env bash
# Set the mj-music Worker's STRIPE_SECRET_KEY from 1Password.
#
# The key is a restricted live key with exactly two permissions:
#   Checkout Sessions: Write   (POST /checkout)
#   Events: Read               (the nightly reconcile cron)
# Expiration: never. The first key had an expiry, it lapsed, and every
# checkout 502'd for days.
#
# Source: 1Password vault "Private", item "mj-music worker stripe key",
# field "credential", on account my.1password.com.
#
# The value is piped straight into wrangler. It is never printed, never
# stored in a variable, never written to a file. Do not add `set -x`.

set -euo pipefail

cd "$(dirname "$0")/.."

OP_REF="${OP_REF:-op://Private/mj-music worker stripe key/credential}"

command -v op >/dev/null 2>&1 || {
  echo "error: 1Password CLI (op) not found. Install it, then \`op signin --account my.1password.com\`." >&2
  exit 1
}
command -v npx >/dev/null 2>&1 || {
  echo "error: npx not found. Install Node.js (>= 20) so wrangler can run." >&2
  exit 1
}

# --no-newline: the secret value only, no trailing byte.
# env -u CLOUDFLARE_API_TOKEN: the stale env token would shadow the cached
#   OAuth session wrangler actually has.
# --config wrangler.jsonc: the Worker config; the repo-root one is Pages.
# Read first, then pipe. A bare `op read | wrangler` uploads an EMPTY secret
# when op fails (wrangler happily reads an empty stdin and prints Success);
# that happened once with the webhook secret. The value lives only in this
# subshell's memory and is never printed.
(
  SECRET="$(op read --account my.1password.com --no-newline "$OP_REF")" || exit 1
  [ -n "$SECRET" ] || { echo "error: op returned an empty value for $OP_REF" >&2; exit 1; }
  printf '%s' "$SECRET" \
    | env -u CLOUDFLARE_API_TOKEN npx wrangler secret put STRIPE_SECRET_KEY --config wrangler.jsonc
)

echo "verify (expect 200 and a \"url\"):  curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://api.matthewjamison.dev/checkout -H 'Origin: https://matthewjamison.dev' -H 'Content-Type: application/json' -d '{\"slug\":\"perspective\"}'"
