import type { Ctx, Env } from './types';
import { generic404, json, SECURITY_HEADERS } from './lib/http';
import { Router } from './lib/router';
import { handleCheckout, handleCheckoutPreflight } from './routes/checkout';
import { handleWebhook } from './routes/webhook';
import { handleFile, handleFileHead, handleLanding, handleReissue } from './routes/download';
import { handleVerify, handleVerifyResend } from './routes/verify';
import { handleUnsubscribe } from './routes/unsubscribe';
import { handleExport } from './routes/admin';
import { handleMpu } from './routes/upload';
import { handlePreview, handleStream, handleStreamPreflight } from './routes/preview';
import { scheduled } from './scheduled';

const router = new Router()
  .get('/health', () => json({ ok: true, service: 'mj-music' }))

  .options('/checkout', (req, env) => handleCheckoutPreflight(req, env))
  .post('/checkout', handleCheckout)

  .post('/webhook', handleWebhook)

  // Landing page consumes nothing. The file route consumes exactly one.
  .get('/d/:token', handleLanding)
  .get('/d/:token/file', handleFile)
  .head('/d/:token/file', () => handleFileHead())
  .post('/d/:token/reissue', handleReissue)

  .get('/verify/:token', handleVerify)
  .post('/verify/:token/resend', handleVerifyResend)

  // GET for the link in the email, POST for RFC 8058 one-click.
  .get('/unsubscribe/:token', handleUnsubscribe)
  .post('/unsubscribe/:token', handleUnsubscribe)

  // Public streams for the on-site player: /p/ = 128k MP3 previews (legacy +
  // fallback), /s/ = lossless FLAC full tracks.
  .get('/p/:slug/:track', handlePreview)
  // preflight for the player's ranged throughput probe -- media loads are
  // no-cors and never send OPTIONS
  .options('/s/:slug/:track', (req, env) => handleStreamPreflight(req, env))
  .get('/s/:slug/:track', handleStream)

  .get('/admin/export', handleExport)

  // Admin-only R2 multipart upload for objects past wrangler's single-PUT cap.
  .post('/admin/mpu', handleMpu)
  .add('PUT', '/admin/mpu', handleMpu);

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    const match = router.match(req.method, url.pathname);

    // No partial matches and no method-specific hints: an unrouted request
    // gets the same 404 as a bad token.
    if (!match) return generic404();

    try {
      return await match.handler(req, env, ctx, match.params);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          at: 'unhandled',
          method: req.method,
          path: url.pathname,
          err: String(err),
        }),
      );
      return new Response('internal error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
      });
    }
  },

  scheduled,
} satisfies ExportedHandler<Env>;
