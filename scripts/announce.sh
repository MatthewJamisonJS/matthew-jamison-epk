#!/usr/bin/env bash
#
# announce.sh — mail the confirmed list through POST /admin/broadcast.
#
# Manual trigger. Only `status = 'confirmed'` subscribers ever receive this;
# the Worker enforces that and there is no flag here or there to widen it.
#
# Usage:
#   scripts/announce.sh --subject "new record out friday" --body note.txt --dry-run
#   scripts/announce.sh --subject "new record out friday" --body note.txt \
#                       --url https://matthewjamison.dev/#catalog
#
# Options:
#   --subject <text>   Subject line. Also half the idempotency key: the same
#                      subject on the same UTC day is refused with 409.
#   --body <file>      Plain-text body. A file, not an argument, so newlines
#                      and apostrophes survive the shell.
#   --html <file>      Optional HTML body. Sent as-is (you are the admin).
#   --url <url>        Optional link; renders as the button in the email.
#   --dry-run          Ask for the recipient count and send nothing.
#
# FILL THESE IN before first use — the item and field holding the Worker's
# ADMIN_BEARER_TOKEN in the Private vault. Nothing here ever prints the value.
OP_ITEM="${OP_ITEM:-CHANGE_ME_ITEM}"      # e.g. "mj-music worker admin"
OP_FIELD="${OP_FIELD:-CHANGE_ME_FIELD}"   # e.g. "credential"
OP_ACCOUNT="my.1password.com"
OP_VAULT="Private"

API="${API:-https://api.matthewjamison.dev}"

# Cloudflare's edge 403s non-browser User-Agents, so curl needs a real one.
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

set -euo pipefail

subject=""
body_file=""
html_file=""
url=""
dry_run=false

while [ $# -gt 0 ]; do
  case "$1" in
    --subject)  subject="$2"; shift 2 ;;
    --body)     body_file="$2"; shift 2 ;;
    --html)     html_file="$2"; shift 2 ;;
    --url)      url="$2"; shift 2 ;;
    --dry-run)  dry_run=true; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *)          echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$subject" ]   || { echo "--subject is required" >&2; exit 2; }
[ -n "$body_file" ] || { echo "--body <file> is required" >&2; exit 2; }
[ -r "$body_file" ] || { echo "cannot read $body_file" >&2; exit 2; }
[ "$OP_ITEM" != "CHANGE_ME_ITEM" ] || { echo "set OP_ITEM/OP_FIELD at the top of this script" >&2; exit 2; }

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

# Build the JSON with jq so the body is escaped correctly no matter what is in it.
payload=$(
  jq -n \
    --arg subject "$subject" \
    --rawfile text "$body_file" \
    --arg url "$url" \
    --argjson dry_run "$dry_run" \
    '{subject: $subject, text: $text, dry_run: $dry_run}
     + (if $url == "" then {} else {url: $url} end)'
)

if [ -n "$html_file" ]; then
  [ -r "$html_file" ] || { echo "cannot read $html_file" >&2; exit 2; }
  payload=$(printf '%s' "$payload" | jq --rawfile html "$html_file" '. + {html: $html}')
fi

# The token is read into a subshell env and never echoed, never written to a
# file, never passed as an argv element (argv is world-readable in `ps`).
(
  export ADMIN_TOKEN
  ADMIN_TOKEN="$(op read "op://${OP_VAULT}/${OP_ITEM}/${OP_FIELD}" --account "${OP_ACCOUNT}")"
  printf '%s' "$payload" | curl -sS -X POST "${API}/admin/broadcast" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H 'Content-Type: application/json' \
    -H "User-Agent: ${UA}" \
    --data-binary @- \
    -w '\nHTTP %{http_code}\n'
)
