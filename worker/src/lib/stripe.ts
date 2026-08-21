import Stripe from 'stripe';
import type { Env } from '../types';

/**
 * Workers has no Node crypto and no Node http, so both of the Stripe SDK's
 * defaults have to be replaced:
 *   - createFetchHttpClient() for outbound API calls
 *   - createSubtleCryptoProvider() for webhook signature verification, passed
 *     as the FIFTH argument to constructEventAsync. The synchronous
 *     constructEvent() cannot work here at all.
 */
export function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    // One retry only: the webhook path must stay well inside Stripe's
    // delivery window, and everything slow already lives in the outbox.
    maxNetworkRetries: 1,
  });
}

let cryptoProvider: ReturnType<typeof Stripe.createSubtleCryptoProvider> | null = null;

export function subtleCryptoProvider() {
  cryptoProvider ??= Stripe.createSubtleCryptoProvider();
  return cryptoProvider;
}

/**
 * `rawBody` must be the exact bytes off the wire. Nothing may JSON.parse the
 * request before this runs -- a reserialized body has a different signature.
 */
export async function constructEvent(
  env: Env,
  rawBody: string,
  signature: string,
): Promise<Stripe.Event> {
  const stripe = stripeClient(env);
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
    undefined,
    subtleCryptoProvider(),
  );
}

export function expectedLivemode(env: Env): boolean {
  return env.STRIPE_LIVEMODE === 'true';
}
