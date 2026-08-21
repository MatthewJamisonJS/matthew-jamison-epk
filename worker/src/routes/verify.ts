import type { Ctx, Env } from '../types';
import { clientIp, generic404, html, page } from '../lib/http';
import { drainOutbox } from '../lib/outbox';
import { looksLikeToken } from '../lib/tokens';
import {
  confirmSubscriber,
  getByVerifyToken,
  isVerifyExpired,
  reissueVerify,
} from '../lib/subscribers';

/**
 * GET /verify/:token
 *
 * verify_token is never cleared on confirm, so a second click lands on
 * "already confirmed" rather than a 404. An expired link OFFERS a new one --
 * it never silently confirms, because a link that confirms after its window
 * is not a confirmation, it is a guess.
 */
export async function handleVerify(
  req: Request,
  env: Env,
  _ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';
  if (!looksLikeToken(token)) return generic404();

  const { success } = await env.DOWNLOAD_LIMITER.limit({ key: clientIp(req) });
  if (!success) return html(page('slow down', `<h1>slow down</h1><p>try again in a minute.</p>`), { status: 429 });

  const row = await getByVerifyToken(env, token);
  if (!row) return generic404();

  if (row.status === 'confirmed') {
    return html(page('already confirmed', confirmedBody()));
  }

  if (row.status === 'unsubscribed') {
    return html(
      page(
        'you are unsubscribed',
        `<h1>you're off the list</h1>
<p>this confirmation link belongs to an address that has since unsubscribed, so nothing was changed.</p>`,
      ),
    );
  }

  if (row.status === 'bounced') {
    return html(
      page(
        'that address bounced',
        `<h1>that address bounced</h1>
<p>mail to this address kept failing, so it was taken off. reply to any email from matthew and he'll re-add it by hand.</p>`,
      ),
    );
  }

  if (isVerifyExpired(row)) {
    return html(page('link expired', expiredBody(token)), { status: 403 });
  }

  await confirmSubscriber(env, row.email);
  return html(page('confirmed', confirmedBody()));
}

/**
 * POST /verify/:token/resend -- the reissue path an expired link offers.
 * Mints a fresh token and mails it to the SAME address; the address is never
 * echoed back to the page.
 */
export async function handleVerifyResend(
  req: Request,
  env: Env,
  ctx: Ctx,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';
  if (!looksLikeToken(token)) return generic404();

  const { success } = await env.DOWNLOAD_LIMITER.limit({ key: clientIp(req) });
  if (!success) return html(page('slow down', `<h1>slow down</h1><p>try again in a minute.</p>`), { status: 429 });

  const row = await getByVerifyToken(env, token);
  if (!row) return generic404();

  if (row.status === 'pending') {
    await reissueVerify(env, row.email);
    ctx.waitUntil(drainOutbox(env).catch(() => undefined));
  }

  // Same page whatever the status was: a resend endpoint that reports state
  // is a way to probe which addresses are on the list.
  return html(
    page(
      'check your email',
      `<h1>check your email</h1>
<p class="lead">if that link belonged to an address still waiting to confirm, a new one is on its way.</p>
<p>this changes nothing about your downloads &mdash; those are separate and already yours.</p>`,
    ),
  );
}

function confirmedBody(): string {
  // WORKSHOP: confirmation page copy. Placeholder.
  return `<h1>you're confirmed</h1>
<p class="lead">thank you. you'll hear from matthew when there's something worth hearing about, and not otherwise.</p>
<p>every email has a one-click unsubscribe in it.</p>`;
}

function expiredBody(token: string): string {
  const action = `/verify/${encodeURIComponent(token)}/resend`;
  return `<h1>that link expired</h1>
<p class="lead">confirmation links are only good for a few days, and this one is past it. nothing was confirmed.</p>
<form method="post" action="${action}">
  <button class="btn" type="submit">send me a new one</button>
</form>`;
}
