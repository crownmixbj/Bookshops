/**
 * Open a Paystack charge for a quote.
 *
 * Deploy with JWT verification ON (the default) — the caller must be a
 * signed-in buyer.
 *
 *   POST { quote_id, delivery: {...}, callback_url }
 *   ->   { authorization_url, reference, amount, order_id }
 *
 * The amount is not in the request and cannot be. begin_escrow_checkout
 * reads it from the quote and returns it, and that returned figure is
 * what gets sent to Paystack. A tampered client can change the delivery
 * address it types; it cannot change the price.
 */
import { fail, json, preflight } from '../_shared/http.ts';
import { callerId, serviceClient } from '../_shared/supabase.ts';
import { assertAllowedCallback, initializeTransaction, toKobo } from '../_shared/paystack.ts';

interface Delivery {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string | null;
  notes?: string | null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const buyerId = await callerId(req);
    if (!buyerId) return fail('Sign in to pay for a quote.', 401);

    const body = await req.json().catch(() => null);
    if (!body?.quote_id) return fail('quote_id is required.');

    const d: Delivery = body.delivery ?? {};
    for (const [field, value] of Object.entries({
      name: d.name,
      phone: d.phone,
      address: d.address,
      city: d.city,
    })) {
      if (!value || !String(value).trim()) return fail(`Delivery ${field} is required.`);
    }

    const callbackUrl = assertAllowedCallback(String(body.callback_url ?? ''));

    const admin = serviceClient();

    // Creates the pending order, or resumes the one this buyer abandoned
    // last time. Either way it hands back the reference and the amount.
    const { data: opened, error: openError } = await admin
      .rpc('begin_escrow_checkout', {
        p_buyer_id: buyerId,
        p_quote_id: body.quote_id,
        p_delivery_name: String(d.name).trim(),
        p_delivery_phone: String(d.phone).trim(),
        p_delivery_address: String(d.address).trim(),
        p_delivery_city: String(d.city).trim(),
        p_delivery_state: d.state ? String(d.state).trim() : null,
        p_delivery_notes: d.notes ? String(d.notes).trim() : null,
      })
      .single();

    if (openError) {
      // 23505 is the function's own "already paid for" signal, not a
      // constraint the buyer can do anything about.
      const alreadyPaid = openError.code === '23505';
      return fail(
        alreadyPaid
          ? 'This quote has already been paid for. Check your orders.'
          : 'That quote could not be opened for payment.',
        alreadyPaid ? 409 : 400,
      );
    }

    const { order_id, payment_reference, amount } = opened as {
      order_id: string;
      payment_reference: string;
      amount: number;
    };

    // Paystack needs an email for the receipt. It is read from auth,
    // never from the request body — a client-supplied email would send
    // someone else's receipt wherever the caller likes.
    const { data: userRow } = await admin.auth.admin.getUserById(buyerId);
    const email = userRow?.user?.email;
    if (!email) return fail('Your account has no email address for the receipt.', 400);

    const init = await initializeTransaction({
      email,
      amount: toKobo(amount),
      currency: 'NGN',
      reference: payment_reference,
      callback_url: callbackUrl,
      metadata: {
        order_id,
        quote_id: body.quote_id,
        buyer_id: buyerId,
        custom_fields: [
          { display_name: 'Order', variable_name: 'order_id', value: order_id },
          { display_name: 'Quote', variable_name: 'quote_id', value: body.quote_id },
        ],
      },
    });

    return json({
      authorization_url: init.authorization_url,
      access_code: init.access_code,
      reference: payment_reference,
      order_id,
      amount,
    });
  } catch (e) {
    console.error('[paystack-initialize]', e);
    return fail(e instanceof Error ? e.message : 'Could not start the payment.', 500);
  }
});
