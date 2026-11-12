import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripeClient } from '../../src/lib/stripe';

// qs is the only flagged dependency shipped with the application (via Stripe).
// Exercise its real serialization through the SDK, not a mocked SDK method.
// Every fetch is stubbed: no Stripe account, API call, or payment is involved.
afterEach(() => vi.unstubAllGlobals());

describe('patched Stripe request serialization', () => {
  it('preserves nested checkout fields and encodes untrusted delimiters as data', async () => {
    let sent: Request | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Request(input, init);
      return new Response(JSON.stringify({
        id: 'cs_test_local', object: 'checkout.session',
        url: 'https://checkout.stripe.com/c/pay/cs_test_local',
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    const metadataValue = 'album&amount=1+[nested] ☃';
    const successUrl = 'https://example.com/thanks/?session_id={CHECKOUT_SESSION_ID}';
    const stripe = stripeClient({ ...env, STRIPE_SECRET_KEY: 'sk_test_local_no_network' });
    const result = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: 'price_server_selected', quantity: 1 }],
      automatic_tax: { enabled: true },
      success_url: successUrl,
      cancel_url: 'https://example.com/#catalog',
      metadata: { album_slug: metadataValue },
      payment_intent_data: { metadata: { album_slug: metadataValue } },
    });
    expect(result.id).toBe('cs_test_local');
    expect(sent).toBeDefined();
    expect(sent!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent!.method).toBe('POST');
    const form = new URLSearchParams(await sent!.text());
    expect(form.get('mode')).toBe('payment');
    expect(form.get('line_items[0][price]')).toBe('price_server_selected');
    expect(form.get('line_items[0][quantity]')).toBe('1');
    expect(form.get('automatic_tax[enabled]')).toBe('true');
    expect(form.get('success_url')).toBe(successUrl);
    expect(form.get('metadata[album_slug]')).toBe(metadataValue);
    expect(form.get('payment_intent_data[metadata][album_slug]')).toBe(metadataValue);
    expect(form.has('amount')).toBe(false);
  });
});
