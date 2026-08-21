import type { Ctx, Env } from '../types';
import { BOM, csvRow } from '../lib/csv';
import { json, SECURITY_HEADERS } from '../lib/http';
import { isoNow, timingSafeEqual } from '../lib/tokens';

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

export interface Actor {
  email: string;
  via: 'access' | 'bearer';
}

/**
 * Cloudflare Access first, long bearer token as the fallback.
 *
 * Access enforces at the edge before this code runs, so reaching here at all
 * means the request already passed the identity policy -- but Access
 * AUTHENTICATES, it does not AUTHORIZE. The email is still checked against
 * the ADMIN_EMAILS allowlist, because an Access policy widened by accident
 * must not silently widen the export too.
 *
 * The bearer fallback exists for accounts without Zero Trust. It is weaker
 * and is compared in constant time so a wrong guess leaks no prefix.
 */
export async function authenticate(
  req: Request,
  env: Env,
  ctx: Ctx,
): Promise<{ actor: Actor } | { error: Response }> {
  const allowlist = env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  try {
    const identity = await ctx.access?.getIdentity();
    if (identity?.email) {
      const email = identity.email.trim().toLowerCase();
      if (!allowlist.includes(email)) {
        return { error: json({ error: 'forbidden' }, { status: 403 }) };
      }
      return { actor: { email, via: 'access' } };
    }
  } catch (err) {
    // Access not configured on this Worker: fall through to the bearer path.
    console.warn(JSON.stringify({ level: 'warn', at: 'access', err: String(err) }));
  }

  const header = req.headers.get('Authorization') ?? '';
  const configured = env.ADMIN_BEARER_TOKEN ?? '';
  if (configured.length >= 32 && header.startsWith('Bearer ')) {
    if (timingSafeEqual(header.slice(7), configured)) {
      return { actor: { email: allowlist[0] ?? 'bearer', via: 'bearer' } };
    }
  }

  return {
    error: json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    ),
  };
}

/* ------------------------------------------------------------------ */
/* dataset whitelist                                                   */
/* ------------------------------------------------------------------ */

interface DatasetSpec {
  table: string;
  /** Output columns, in order. Interpolated into SQL -- so this list, and
   *  only this list, may ever reach the query string. */
  columns: string[];
  dateColumn: string;
  /** Unique tiebreaker for keyset pagination. */
  idColumn: string;
  statusColumn?: string;
  statusValues?: string[];
  albumColumn?: string;
  countryColumn?: string;
  /** Applied unless the caller asks for that status explicitly. */
  defaultExclude?: { column: string; value: string };
}

const DATASETS: Record<string, DatasetSpec> = {
  purchases: {
    table: 'purchases',
    columns: [
      'id',
      'payment_intent_id',
      'email',
      'album_slug',
      'amount_total_cents',
      'tax_cents',
      'currency',
      'country',
      'status',
      'created_at',
    ],
    dateColumn: 'created_at',
    idColumn: 'id',
    statusColumn: 'status',
    statusValues: ['paid', 'unpaid', 'failed', 'refunded', 'disputed'],
    albumColumn: 'album_slug',
    countryColumn: 'country',
  },
  subscribers: {
    table: 'subscribers',
    columns: [
      'email',
      'status',
      'consent_source',
      'consent_at',
      'confirmed_at',
      'unsubscribed_at',
      'first_album_slug',
      'consent_ip_country',
    ],
    dateColumn: 'consent_at',
    idColumn: 'email',
    statusColumn: 'status',
    statusValues: ['pending', 'confirmed', 'unsubscribed', 'bounced'],
    albumColumn: 'first_album_slug',
    countryColumn: 'consent_ip_country',
    // A bounced address is dead weight in a newsletter import and hurts the
    // sender reputation of whatever tool it lands in. Ask for it by name.
    defaultExclude: { column: 'status', value: 'bounced' },
  },
  downloads: {
    table: 'download_events',
    columns: ['id', 'token', 'occurred_at', 'format', 'outcome', 'ip_country', 'user_agent'],
    dateColumn: 'occurred_at',
    idColumn: 'id',
    statusColumn: 'outcome',
    statusValues: [
      'served',
      'notfound',
      'expired',
      'exhausted',
      'revoked',
      'r2_missing',
      'reissued',
      'landing_ok',
      'landing_expired',
      'landing_exhausted',
      'landing_revoked',
    ],
    countryColumn: 'ip_country',
  },
};

const FORMATS = new Set(['csv', 'json', 'ndjson']);
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10_000;
const PAGE_SIZE = 500;

/* ------------------------------------------------------------------ */
/* GET /admin/export                                                   */
/* ------------------------------------------------------------------ */

export async function handleExport(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const auth = await authenticate(req, env, ctx);
  if ('error' in auth) return auth.error;
  const actor = auth.actor;

  const url = new URL(req.url);
  const q = url.searchParams;

  const datasetName = q.get('dataset') ?? '';
  const spec = Object.prototype.hasOwnProperty.call(DATASETS, datasetName)
    ? DATASETS[datasetName]
    : undefined;
  if (!spec) {
    return json(
      { error: 'bad_dataset', allowed: Object.keys(DATASETS) },
      { status: 400 },
    );
  }

  const format = q.get('format') ?? 'csv';
  if (!FORMATS.has(format)) {
    return json({ error: 'bad_format', allowed: [...FORMATS] }, { status: 400 });
  }

  // ---- filters. Every value below is BOUND; only whitelisted column names
  // ---- from `spec` are ever concatenated into the SQL string.
  const where: string[] = [];
  const binds: unknown[] = [];
  const filters: Record<string, unknown> = { dataset: datasetName, format };

  const from = q.get('from');
  if (from) {
    if (!isDateish(from)) return json({ error: 'bad_from' }, { status: 400 });
    where.push(`datetime(${spec.dateColumn}) >= datetime(?${binds.length + 1})`);
    binds.push(from);
    filters.from = from;
  }

  const to = q.get('to');
  if (to) {
    if (!isDateish(to)) return json({ error: 'bad_to' }, { status: 400 });
    // Exclusive upper bound: `to=2026-09-01` means "everything before September".
    where.push(`datetime(${spec.dateColumn}) < datetime(?${binds.length + 1})`);
    binds.push(to);
    filters.to = to;
  }

  const albums = q.getAll('album').filter((a) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(a));
  if (albums.length > 0) {
    if (!spec.albumColumn) return json({ error: 'album_filter_unsupported' }, { status: 400 });
    const placeholders = albums.map((_, i) => `?${binds.length + 1 + i}`).join(', ');
    where.push(`${spec.albumColumn} IN (${placeholders})`);
    binds.push(...albums);
    filters.album = albums;
  }

  // `consent` is the subscribers-flavoured alias for `status`.
  const statusRaw = q.get('status') ?? q.get('consent');
  if (statusRaw) {
    if (!spec.statusColumn || !spec.statusValues?.includes(statusRaw)) {
      return json(
        { error: 'bad_status', allowed: spec.statusValues ?? [] },
        { status: 400 },
      );
    }
    where.push(`${spec.statusColumn} = ?${binds.length + 1}`);
    binds.push(statusRaw);
    filters.status = statusRaw;
  } else if (spec.defaultExclude) {
    where.push(`${spec.defaultExclude.column} != ?${binds.length + 1}`);
    binds.push(spec.defaultExclude.value);
    filters.excluded = spec.defaultExclude.value;
  }

  const country = q.get('country');
  if (country) {
    if (!/^[A-Za-z]{2}$/.test(country) || !spec.countryColumn) {
      return json({ error: 'bad_country' }, { status: 400 });
    }
    where.push(`${spec.countryColumn} = ?${binds.length + 1}`);
    binds.push(country.toUpperCase());
    filters.country = country.toUpperCase();
  }

  const limit = clampLimit(q.get('limit'));
  filters.limit = limit;

  let cursor: { d: string; i: string } | null = null;
  const cursorRaw = q.get('cursor');
  if (cursorRaw) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) return json({ error: 'bad_cursor' }, { status: 400 });
    filters.cursor = cursorRaw;
  }

  const body = streamRows(env, spec, where, binds, cursor, limit, format, actor, filters);

  const filename = `${datasetName}-${isoNow().slice(0, 10)}.${format === 'ndjson' ? 'ndjson' : format}`;
  const contentType =
    format === 'csv'
      ? 'text/csv; charset=utf-8'
      : format === 'ndjson'
        ? 'application/x-ndjson; charset=utf-8'
        : 'application/json; charset=utf-8';

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

/**
 * Keyset pagination inside a ReadableStream. The whole result set is never
 * materialised: each pull runs one bounded query and enqueues its rows, so a
 * 10k-row export cannot reach the Worker's memory ceiling.
 */
function streamRows(
  env: Env,
  spec: DatasetSpec,
  baseWhere: string[],
  baseBinds: unknown[],
  startCursor: { d: string; i: string } | null,
  limit: number,
  format: string,
  actor: Actor,
  filters: Record<string, unknown>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const cols = spec.columns.join(', ');
  let cursor = startCursor;
  let emitted = 0;
  let started = false;
  let done = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (format === 'csv') {
        controller.enqueue(enc.encode(BOM + csvRow(spec.columns)));
      } else if (format === 'json') {
        controller.enqueue(enc.encode('['));
      }
    },

    async pull(controller) {
      if (done) return;

      const remaining = limit - emitted;
      if (remaining <= 0) return finish(controller);

      const where = [...baseWhere];
      const binds = [...baseBinds];
      if (cursor) {
        const a = binds.length + 1;
        const b = binds.length + 2;
        where.push(
          `(${spec.dateColumn} > ?${a} OR (${spec.dateColumn} = ?${a} AND ${spec.idColumn} > ?${b}))`,
        );
        binds.push(cursor.d, cursor.i);
      }

      const pageSize = Math.min(PAGE_SIZE, remaining);
      const sql =
        `SELECT ${cols} FROM ${spec.table}` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ` ORDER BY ${spec.dateColumn} ASC, ${spec.idColumn} ASC LIMIT ?${binds.length + 1}`;

      let results: Row[];
      try {
        const out = await env.DB.prepare(sql)
          .bind(...binds, pageSize)
          .all<Row>();
        results = out.results;
      } catch (err) {
        controller.error(err);
        done = true;
        return;
      }

      for (const row of results) {
        const chunk =
          format === 'csv'
            ? csvRow(spec.columns.map((c) => row[c]))
            : format === 'ndjson'
              ? JSON.stringify(row) + '\n'
              : (started ? ',' : '') + JSON.stringify(row);
        started = true;
        controller.enqueue(enc.encode(chunk));
        emitted++;
      }

      const last = results[results.length - 1];
      if (results.length < pageSize || !last) return finish(controller);
      cursor = { d: String(last[spec.dateColumn] ?? ''), i: String(last[spec.idColumn] ?? '') };
    },
  });

  async function finish(controller: ReadableStreamDefaultController<Uint8Array>) {
    done = true;
    if (format === 'json') controller.enqueue(enc.encode(']'));

    // One export_log row per request, with the actor, the filters and the
    // real row count. Written after the last row so the count is truthful.
    try {
      await env.DB.prepare(
        `INSERT INTO export_log (actor_email, dataset, filters_json, row_count, exported_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
        .bind(actor.email, spec.table, JSON.stringify(filters), emitted, isoNow())
        .run();
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', at: 'export_log', err: String(err) }));
    }

    controller.close();
  }
}

function clampLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function isDateish(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([ T][\d:.]{2,12}Z?)?$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function encodeCursor(d: string, i: string): string {
  return btoa(JSON.stringify({ d, i })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw: string): { d: string; i: string } | null {
  if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(padded)) as { d?: unknown; i?: unknown };
    if (typeof parsed.d !== 'string' || typeof parsed.i !== 'string') return null;
    return { d: parsed.d, i: parsed.i };
  } catch {
    return null;
  }
}
