/**
 * Confirm a charge and put the order into escrow.
 *
 * Deploy with JWT verification ON.
 *
 *   POST { reference }  ->  { order_id, status: 'escrow_held' }
 *
 * This is the only path by which the app can mark anything paid. The
 * client tells us a reference and nothing else; the amount, the status
 * and the currency all come from asking Paystack directly. A caller who
 * invents a reference gets a 402, not an order.
 */
import { fail, json, preflight } from '../_shared/http.ts';
import { callerId, serviceClient } from '../_shared/supabase.ts';
import { fromKobo, verifyTransaction } from '../_shared/paystack.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const buyerId = await callerId(req);
    if (!buyerId) return fail('Sign in to confirm a payment.', 401);

    const body = await req.json().catch(() => null);
    const reference = String(body?.reference ?? '').trim();
    if (!reference) return fail('reference is required.');

    const admin = serviceClient();

    // The reference must belong to this buyer. Without this check anyone
    // could confirm anyone else's payment — harmless in isolation, but it
    // would let an attacker enumerate which references are real.
    const { data: order, error: lookupError } = await admin
      .from('orders')
      .select('id, buyer_id, payment_status, amount')
      .eq('payment_reference', reference)
      .maybeSingle();

    if (lookupError) return fail('Could not look that payment up.', 500);
    if (!order) return fail('No order matches that payment reference.', 404);
    if (order.buyer_id !== buyerId) return fail('That payment is not yours.', 403);

    // Already settled — by the webhook, or by an earlier tab. Report
    // success: the buyer paid, and that is the only fact they care about.
    if (['escrow_held', 'escrow_released', 'paid'].includes(order.payment_status)) {
      return json({ order_id: order.id, status: order.payment_status, already_finalized: true });
    }

    const tx = await verifyTransaction(reference);

    if (tx.status !== 'success') {
      await admin
        .from('orders')
        .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', order.id)
        .eq('payment_status', 'pending');
      return fail(`Paystack reports this payment as ${tx.status}.`, 402);
    }

    if (tx.currency !== 'NGN') return fail(`Unexpected currency ${tx.currency}.`, 402);

    const { data: settled, error: settleError } = await admin
      .rpc('finalize_escrow_order', {
        p_payment_reference: reference,
        p_gateway_reference: String(tx.id ?? tx.reference),
        p_amount_paid: fromKobo(tx.amount),
        p_provider: 'paystack',
      })
      .single();

    if (settleError) {
      console.error('[paystack-verify] finalize failed', settleError);
      // 22023 is the underpayment guard. Everything else is ours, not
      // the buyer's, and the money is real either way — so this is
      // logged loudly rather than swallowed.
      return fail(
        settleError.code === '22023'
          ? 'The amount received does not cover this order. Support has been notified.'
          : 'Payment received but the order could not be completed. Support has been notified.',
        500,
      );
    }

    const { order_id, already_finalized } = settled as {
      order_id: string;
      already_finalized: boolean;
    };
    return json({ order_id, status: 'escrow_held', already_finalized });
  } catch (e) {
    console.error('[paystack-verify]', e);
    return fail(e instanceof Error ? e.message : 'Could not confirm the payment.', 500);
  }
});
