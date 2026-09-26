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

    // Not an order's reference: a multi-list checkout's, perhaps. The
    // group row carries the buyer and state; its orders are settled
    // together by finalize_escrow_order below.
    let owner: string | null = order?.buyer_id ?? null;
    let alreadySettled = order ? ['escrow_held', 'escrow_released', 'paid'].includes(order.payment_status) : false;
    let knownOrderId: string | null = order?.id ?? null;
    let pendingFilter: { table: 'orders' | 'checkout_groups'; id: string } | null = order
      ? { table: 'orders', id: order.id }
      : null;

    if (!order) {
      const { data: group, error: groupError } = await admin
        .from('checkout_groups')
        .select('id, buyer_id, status')
        .eq('payment_reference', reference)
        .maybeSingle();
      // 42P01: the bundle table does not exist on this project, so the
      // reference simply is not ours.
      if (groupError && groupError.code !== '42P01') return fail('Could not look that payment up.', 500);
      if (!group) return fail('No order matches that payment reference.', 404);
      owner = group.buyer_id;
      alreadySettled = group.status === 'paid';
      pendingFilter = { table: 'checkout_groups', id: group.id };
      const { data: first } = await admin
        .from('orders')
        .select('id')
        .eq('checkout_group_id', group.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      knownOrderId = first?.id ?? null;
    }

    if (owner !== buyerId) return fail('That payment is not yours.', 403);

    // Already settled — by the webhook, or by an earlier tab. Report
    // success: the buyer paid, and that is the only fact they care about.
    if (alreadySettled && knownOrderId) {
      return json({ order_id: knownOrderId, status: order?.payment_status ?? 'escrow_held', already_finalized: true });
    }

    const tx = await verifyTransaction(reference);

    if (tx.status !== 'success') {
      // Same rule as before for single orders, applied to a bundle's
      // group and all its orders. finalize_escrow_order still honours a
      // 'failed' row if money later arrives, so this cannot lose a payment.
      if (pendingFilter) {
        if (pendingFilter.table === 'orders') {
          await admin
            .from('orders')
            .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
            .eq('id', pendingFilter.id)
            .eq('payment_status', 'pending');
        } else {
          await admin.from('checkout_groups').update({ status: 'failed' }).eq('id', pendingFilter.id).eq('status', 'pending');
          await admin
            .from('orders')
            .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
            .eq('checkout_group_id', pendingFilter.id)
            .eq('payment_status', 'pending');
        }
      }
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
