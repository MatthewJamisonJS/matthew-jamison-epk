import type { Ctx, Env } from '../types';
import { clientIp, generic404, html, page } from '../lib/http';
import { looksLikeToken } from '../lib/tokens';
import { getByUnsubscribeToken, unsubscribe } from '../lib/subscribers';

/**
 * GET or POST /unsubscribe/:token
 *
 * One click. No login, no "are you sure", no second page. The token in the
 * URL does the work. POST is accepted as well so RFC 8058 one-click
 * unsubscribe (List-Unsubscribe-Post) works from the mail client directly.
 *
 * Idempotent: clicking twice is the same as clicking once.
 */
export async function handleUnsubscribe(
  req: Request,
  env: Env,
  _ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';
  if (!looksLikeToken(token)) return generic404();

  const { success } = await env.DOWNLOAD_LIMITER.limit({ key: clientIp(req) });
  if (!success) return html(page('slow down', `<h1>slow down</h1><p>try again in a minute.</p>`), { status: 429 });

  const row = await getByUnsubscribeToken(env, token);
  if (!row) return generic404();

  await unsubscribe(env, row.email);

  // WORKSHOP: unsubscribe confirmation copy. Placeholder.
  return html(
    page(
      'unsubscribed',
      `<h1>done, you're off the list</h1>
<p class="lead">no more emails. that took effect immediately.</p>
<p>your downloads are unaffected &mdash; those were never part of the list.</p>`,
    ),
  );
}
