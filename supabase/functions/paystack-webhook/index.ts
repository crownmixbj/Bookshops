/**
 * Paystack's own report of what happened.
 *
 * Deploy with JWT verification OFF — Paystack has no Supabase token:
 *
 *   supabase functions deploy paystack-webhook --no-verify-jwt
 *
 * This exists because the app's verify call is not guaranteed to run.
 * The buyer's phone dies on the bank's 3-D Secure page, they close the
 * tab, the train goes into a tunnel — the money still moved. Without a
 * webhook those become charges with no order, which the buyer discovers
 * and you do not.
 *
 * Since JWT verification is off, the signature check IS the
 * authentication. Everything below it depends on that being right.
 */
import { serviceClient } from '../_shared/supabase.ts';
import { fromKobo, isValidSignature } from '../_shared/paystack.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // The RAW body, before any parsing. Re-serialising JSON changes key
  // order and whitespace, and the hash would never match again.
  const raw = await req.text();

  if (!(await isValidSignature(raw, req.headers.get('x-paystack-signature')))) {
    console.warn('[paystack-webhook] rejected: bad signature');
    return new Response('Invalid signature', { status: 401 });
  }

  let event: { event?: string; data?: Record<string, any> };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  // 200 for everything we are not acting on. A non-2xx tells Paystack to
  // retry, and retrying an event nobody handles is just noise.
  if (event.event !== 'charge.success') {
    return new Response('Ignored', { status: 200 });
  }

  const data = event.data ?? {};
  const reference = String(data.reference ?? '');
  if (!reference) return new Response('No reference', { status: 200 });

  try {
    const admin = serviceClient();
    const { error } = await admin
      .rpc('finalize_escrow_order', {
        p_payment_reference: reference,
        p_gateway_reference: String(data.id ?? reference),
        p_amount_paid: fromKobo(Number(data.amount ?? 0)),
        p_provider: 'paystack',
      })
      .single();

    if (error) {
      // P0002 — a reference we have never heard of. Almost always a
      // charge from another project sharing the key, or a test event.
      // Not a retryable failure on our side.
      if (error.code === 'P0002') {
        console.warn('[paystack-webhook] unknown reference', reference);
        return new Response('Unknown reference', { status: 200 });
      }
      // Anything else may be transient. 500 asks Paystack to try again.
      console.error('[paystack-webhook] finalize failed', reference, error);
      return new Response('Retry', { status: 500 });
    }

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('[paystack-webhook]', e);
    return new Response('Retry', { status: 500 });
  }
});
