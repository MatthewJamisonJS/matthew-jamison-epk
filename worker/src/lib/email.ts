import type { Env } from '../types';
import { escapeHtml } from './http';

/**
 * Email provider: Resend. One HTTP call, no SDK -- the SDK is a wrapper around
 * this exact request and would only add bundle weight.
 *
 * ALL COPY BELOW IS PLACEHOLDER. Every string that a customer will read is
 * marked with a `WORKSHOP:` note. Final wording comes from Matthew through the
 * content workshop, in his voice, applied verbatim. Do not polish these.
 * Find them all with: rg 'WORKSHOP' worker/src
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type TemplateName =
  | 'download_ready'
  | 'download_reissued'
  | 'verify_subscription'
  | 'payment_failed'
  | 'alert';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

export async function sendEmail(
  env: Env,
  to: string,
  rendered: Rendered,
): Promise<void> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      reply_to: env.EMAIL_REPLY_TO,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(rendered.headers ? { headers: rendered.headers } : {}),
    }),
  });

  if (!res.ok) {
    // Body is read for the outbox's last_error column. Truncated: a provider
    // error page should never be able to bloat a D1 row.
    const body = (await res.text().catch(() => '')).slice(0, 500);
    throw new EmailSendError(`resend ${res.status}: ${body}`, res.status);
  }
}

export function render(
  env: Env,
  template: TemplateName,
  payload: Record<string, unknown>,
): Rendered {
  switch (template) {
    case 'download_ready':
      return downloadReady(env, payload);
    case 'download_reissued':
      return downloadReissued(env, payload);
    case 'verify_subscription':
      return verifySubscription(env, payload);
    case 'payment_failed':
      return paymentFailed(env, payload);
    case 'alert':
      return alertMail(payload);
    default: {
      const exhaustive: never = template;
      throw new Error(`unknown template: ${String(exhaustive)}`);
    }
  }
}

function str(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const v = payload[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

function shell(bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#faf9f7;color:#1b1b1b;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:34rem;margin:0 auto;">
${bodyHtml}
</div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;background:#1b1b1b;color:#faf9f7;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

/* ------------------------------------------------------------------ */
/* transactional: sent regardless of any marketing choice              */
/* ------------------------------------------------------------------ */

function downloadReady(env: Env, p: Record<string, unknown>): Rendered {
  const title = str(p, 'album_title', 'your record');
  const url = `${env.WORKER_ORIGIN}/d/${str(p, 'token')}`;
  const hours = str(p, 'ttl_hours', '72');
  const max = str(p, 'max_downloads', '5');

  // WORKSHOP: subject line for the delivery email. Placeholder.
  const subject = `${title} is ready to download`;

  const text = [
    // WORKSHOP: opening line of the delivery email. Placeholder.
    `thank you for buying ${title}.`,
    ``,
    // WORKSHOP: the instruction line. Placeholder.
    `here is your download page. both formats are on it -- WAV and MP3 320.`,
    url,
    ``,
    // WORKSHOP: the limits line. Placeholder. Keep the numbers accurate.
    `the link works for ${hours} hours and allows ${max} downloads in total, counted across both formats.`,
    ``,
    // WORKSHOP: the support line. Placeholder.
    `if anything goes wrong, just reply to this email and it reaches me.`,
    ``,
    `-- matthew`,
  ].join('\n');

  const html = shell(
    `<!-- WORKSHOP: delivery email body. Every line below is placeholder copy. -->
<p>thank you for buying <strong>${escapeHtml(title)}</strong>.</p>
<p>here is your download page. both formats are on it &mdash; WAV and MP3&nbsp;320.</p>
${button(url, 'open your download page')}
<p style="color:#5f5f5f;font-size:14px;">the link works for ${escapeHtml(hours)} hours and allows ${escapeHtml(max)} downloads in total, counted across both formats.</p>
<p style="color:#5f5f5f;font-size:14px;">if anything goes wrong, just reply to this email and it reaches me.</p>
<p>&mdash; matthew</p>`,
  );

  return { subject, html, text };
}

function downloadReissued(env: Env, p: Record<string, unknown>): Rendered {
  const title = str(p, 'album_title', 'your record');
  const url = `${env.WORKER_ORIGIN}/d/${str(p, 'token')}`;
  const hours = str(p, 'ttl_hours', '72');
  const max = str(p, 'max_downloads', '5');

  // WORKSHOP: subject line for a re-issued download link. Placeholder.
  const subject = `a fresh download link for ${title}`;

  const text = [
    // WORKSHOP: reissue email body. Placeholder.
    `here is a new link for ${title}. the old one had run out.`,
    ``,
    url,
    ``,
    `good for another ${hours} hours and ${max} downloads.`,
    ``,
    `-- matthew`,
  ].join('\n');

  const html = shell(
    `<!-- WORKSHOP: reissue email body. Placeholder copy. -->
<p>here is a new link for <strong>${escapeHtml(title)}</strong>. the old one had run out.</p>
${button(url, 'open your download page')}
<p style="color:#5f5f5f;font-size:14px;">good for another ${escapeHtml(hours)} hours and ${escapeHtml(max)} downloads.</p>
<p>&mdash; matthew</p>`,
  );

  return { subject, html, text };
}

function paymentFailed(_env: Env, p: Record<string, unknown>): Rendered {
  const title = str(p, 'album_title', 'your order');

  // WORKSHOP: subject for a failed delayed payment (ACH etc). Placeholder.
  const subject = `your payment for ${title} didn't go through`;

  const text = [
    // WORKSHOP: failed-payment body. Placeholder. Must not sound like an
    // accusation -- delayed payment methods fail for boring bank reasons.
    `your bank didn't complete the payment for ${title}, so nothing was charged and nothing was delivered.`,
    ``,
    `you're welcome to try again whenever. reply here if you'd like a hand.`,
    ``,
    `-- matthew`,
  ].join('\n');

  const html = shell(
    `<!-- WORKSHOP: failed-payment body. Placeholder copy. -->
<p>your bank didn't complete the payment for <strong>${escapeHtml(title)}</strong>, so nothing was charged and nothing was delivered.</p>
<p>you're welcome to try again whenever. reply here if you'd like a hand.</p>
<p>&mdash; matthew</p>`,
  );

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/* consent: the ONLY email a `pending` subscriber ever receives        */
/* ------------------------------------------------------------------ */

function verifySubscription(env: Env, p: Record<string, unknown>): Rendered {
  const verifyUrl = `${env.WORKER_ORIGIN}/verify/${str(p, 'verify_token')}`;
  const unsubUrl = `${env.WORKER_ORIGIN}/unsubscribe/${str(p, 'unsubscribe_token')}`;
  const days = str(p, 'ttl_days', '7');

  // WORKSHOP: subject for the double opt-in confirmation. Placeholder.
  const subject = `one click to confirm you want the occasional note`;

  const text = [
    // WORKSHOP: double opt-in body. Placeholder. This email is NOT the
    // download -- say so plainly so nobody thinks their record is stuck here.
    `you ticked the box at checkout, so this is the confirmation step.`,
    ``,
    `confirm here:`,
    verifyUrl,
    ``,
    `this link expires in ${days} days. if you don't click it, you simply hear nothing further -- your download is unaffected and already on its way separately.`,
    ``,
    `never want this: ${unsubUrl}`,
    ``,
    `-- matthew`,
  ].join('\n');

  const html = shell(
    `<!-- WORKSHOP: double opt-in body. Placeholder copy. -->
<p>you ticked the box at checkout, so this is the confirmation step.</p>
${button(verifyUrl, 'yes, confirm')}
<p style="color:#5f5f5f;font-size:14px;">this link expires in ${escapeHtml(days)} days. if you don't click it you simply hear nothing further &mdash; your download is unaffected and already on its way separately.</p>
<p style="color:#5f5f5f;font-size:13px;"><a href="${escapeHtml(unsubUrl)}" style="color:#5f5f5f;">never want this</a></p>`,
  );

  return {
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/* ------------------------------------------------------------------ */
/* operator alerts: never customer-facing, so no WORKSHOP markers      */
/* ------------------------------------------------------------------ */

function alertMail(p: Record<string, unknown>): Rendered {
  const kind = str(p, 'kind', 'unknown');
  const detail = str(p, 'detail');
  const subject = `[mj-music] alert: ${kind}`;
  const text = `${kind}\n\n${detail}\n`;
  const html = shell(
    `<p><strong>${escapeHtml(kind)}</strong></p><pre style="white-space:pre-wrap;font:13px ui-monospace,monospace;background:#f0efec;padding:12px;border-radius:6px;">${escapeHtml(detail)}</pre>`,
  );
  return { subject, html, text };
}
