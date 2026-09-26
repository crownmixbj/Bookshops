/**
 * Open a Paystack charge for a quote.
 *
 * Deploy with JWT verification ON (the default) — the caller must be a
 * signed-in buyer.
 *
 *   POST { quote_id, delivery: {...}, callback_url }
 *   ->   { authorization_url, reference, amount, order_id }
 *
 *   POST { quote_ids: [...], delivery: {...}, callback_url }   (a bundle)
 *   ->   { authorization_url, reference, amount, order_id, order_ids, group_id }
 *
 * A bundle is one charge for several quotes (bookshops_buyer_portal.sql).
 * Each quote still becomes its own order, so each shop's escrow is
 * released on its own delivery; the reference Paystack sees belongs to
 * the checkout_groups row, and finalize_escrow_order settles every order
 * in the group when it arrives.
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
    const quoteIds: string[] | null = Array.isArray(body?.quote_ids)
      ? [...new Set((body.quote_ids as unknown[]).map(String).filter(Boolean))]
      : null;
    if (quoteIds && (quoteIds.length === 0 || quoteIds.length > 12)) {
      return fail('Choose between 1 and 12 quotes to pay for together.');
    }
    if (!quoteIds && !body?.quote_id) return fail('quote_id is required.');

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

    const deliveryArgs = {
      p_delivery_name: String(d.name).trim(),
      p_delivery_phone: String(d.phone).trim(),
      p_delivery_address: String(d.address).trim(),
      p_delivery_city: String(d.city).trim(),
      p_delivery_state: d.state ? String(d.state).trim() : null,
      p_delivery_notes: d.notes ? String(d.notes).trim() : null,
    };

    let order_id: string;
    let order_ids: string[] | undefined;
    let group_id: string | undefined;
    let payment_reference: string;
    let amount: number;

    if (quoteIds) {
      // One pending order per quote under one checkout group, priced by
      // bundle_lines() — the same function the buyer's summary used.
      const { data: opened, error: openError } = await admin
        .rpc('begin_escrow_bundle', { p_buyer_id: buyerId, p_quote_ids: quoteIds, ...deliveryArgs })
        .single();

      if (openError) {
        // 23505 carries the per-list reasons ("Corona: already_paid").
        const conflict = openError.code === '23505';
        return fail(
          conflict
            ? `Some of these lists cannot be paid for right now — ${openError.message.replace(/^.*?: /, '')}. Refresh checkout.`
            : 'Those quotes could not be opened for payment.',
          conflict ? 409 : 400,
        );
      }

      const row = opened as { group_id: string; payment_reference: string; amount: number; order_ids: string[] };
      group_id = row.group_id;
      order_ids = row.order_ids;
      order_id = row.order_ids[0];
      payment_reference = row.payment_reference;
      amount = Number(row.amount);
    } else {
      // Creates the pending order, or resumes the one this buyer abandoned
      // last time. Either way it hands back the reference and the amount.
      const { data: opened, error: openError } = await admin
        .rpc('begin_escrow_checkout', { p_buyer_id: buyerId, p_quote_id: body.quote_id, ...deliveryArgs })
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

      const row = opened as { order_id: string; payment_reference: string; amount: number };
      order_id = row.order_id;
      payment_reference = row.payment_reference;
      amount = Number(row.amount);
    }

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
      metadata: group_id
        ? {
            group_id,
            order_ids,
            quote_ids: quoteIds,
            buyer_id: buyerId,
            custom_fields: [
              { display_name: 'Checkout', variable_name: 'group_id', value: group_id },
              { display_name: 'Booklists', variable_name: 'list_count', value: String(order_ids?.length ?? 0) },
            ],
          }
        : {
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
      order_ids,
      group_id,
      amount,
    });
  } catch (e) {
    console.error('[paystack-initialize]', e);
    return fail(e instanceof Error ? e.message : 'Could not start the payment.', 500);
  }
});
