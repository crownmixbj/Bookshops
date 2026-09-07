import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../utils/supabase';

/**
 * The buyer's side of a Paystack charge.
 *
 * Deliberately thin. This module opens a checkout page and asks the
 * server what happened; it never decides an amount, never writes an
 * order, and never sees the secret key. Everything that matters happens
 * in supabase/functions/paystack-*.
 *
 * The shape of the flow is what makes it survivable:
 *
 *   1. initialise  — the server creates a pending order and hands back a
 *                    reference it generated. We now know the reference
 *                    BEFORE any money moves.
 *   2. pay         — the buyer goes to Paystack.
 *   3. verify      — whatever happens next, success, cancel, dead
 *                    battery, we ask the server about that reference.
 *
 * Because step 1 gives us the reference, step 3 does not depend on the
 * redirect coming back. That is the difference between a checkout that
 * works and one that works on your phone.
 *
 * No new dependencies on purpose. expo-linking and AsyncStorage are
 * already here; expo-web-browser would have been a nicer in-app sheet
 * and a package to install, and the flow above does not need one — the
 * reference is remembered, so the system browser is enough.
 */

/** Where a half-finished attempt is remembered across a redirect or a backgrounding. */
const PENDING_KEY = 'loci.checkout.reference';

export interface DeliveryDetails {
  name: string;
  phone: string;
  address: string;
  city: string;
  state?: string | null;
  notes?: string | null;
}

export interface CheckoutSummary {
  quote_id: string;
  request_id: string;
  vendor_id: string;
  store_name: string | null;
  school_name: string | null;
  quote_status: string;
  items_total: number;
  delivery_fee: number;
  total: number;
  existing_order_id: string | null;
  existing_payment_status: string | null;
}

export type PaymentOutcome =
  | { status: 'paid'; orderId: string }
  /** Native only: the browser is open and the answer is not in yet. */
  | { status: 'awaiting_return'; reference: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/**
 * True when this build has a Paystack public key.
 *
 * Only used to decide what the screen offers. It is NOT a security
 * boundary — the test-payment path is refused by the database unless
 * payout_settings.allow_test_payments is on, which is a property of the
 * project rather than of whoever ran the build.
 */
export const hasPaystackKey = !!process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY;

/** What the buyer is paying, priced by the server so the screen cannot drift from the charge. */
export async function loadCheckoutSummary(quoteId: string): Promise<CheckoutSummary> {
  const { data, error } = await supabase.rpc('checkout_quote', { p_quote_id: quoteId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('That quote is not available to pay for.');
  return {
    ...row,
    items_total: Number(row.items_total ?? 0),
    delivery_fee: Number(row.delivery_fee ?? 0),
    total: Number(row.total ?? 0),
  } as CheckoutSummary;
}

/** Where Paystack should send the buyer back to. */
function callbackUrl(quoteId: string): string {
  if (Platform.OS === 'web') {
    // Paystack appends ?trxref=&reference= to whatever is here, so the
    // quote id has to survive as a query parameter of our own.
    return `${window.location.origin}/checkout?quote=${encodeURIComponent(quoteId)}`;
  }
  // bookshops://checkout — the scheme is set in app.json.
  return Linking.createURL('/checkout', { queryParams: { quote: quoteId } });
}

/**
 * Remember the reference before leaving.
 *
 * sessionStorage on web because the tab is about to be torn down;
 * AsyncStorage on native because the app may be killed in the
 * background while the buyer is in their bank's app. Either way this is
 * a second chance — the reference also comes back in the URL — and both
 * can fail without breaking anything.
 */
async function rememberReference(reference: string): Promise<void> {
  try {
    if (Platform.OS === 'web') window.sessionStorage.setItem(PENDING_KEY, reference);
    else await AsyncStorage.setItem(PENDING_KEY, reference);
  } catch {
    /* private mode, or storage disabled */
  }
}

/** Read and clear a remembered reference. */
export async function takeRememberedReference(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const value = window.sessionStorage.getItem(PENDING_KEY);
      if (value) window.sessionStorage.removeItem(PENDING_KEY);
      return value;
    }
    const value = await AsyncStorage.getItem(PENDING_KEY);
    if (value) await AsyncStorage.removeItem(PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}

/** Look without consuming — for the "check again" button, which may need to retry. */
export async function peekRememberedReference(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return window.sessionStorage.getItem(PENDING_KEY);
    return await AsyncStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export async function clearRememberedReference(): Promise<void> {
  try {
    if (Platform.OS === 'web') window.sessionStorage.removeItem(PENDING_KEY);
    else await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Ask the server whether a reference was actually paid.
 *
 * Safe to call more than once and safe to call on a reference that was
 * abandoned — the function is idempotent and an unpaid reference simply
 * comes back as not paid.
 */
export async function confirmPayment(reference: string): Promise<PaymentOutcome> {
  const { data, error } = await supabase.functions.invoke('paystack-verify', {
    body: { reference },
  });

  if (error) {
    // functions.invoke gives a generic FunctionsHttpError; the message
    // the function wrote is in the response body, which is worth digging
    // out because "Edge Function returned a non-2xx status code" tells
    // the buyer nothing.
    const detail = await readFunctionError(error);
    return { status: 'failed', message: detail ?? 'We could not confirm that payment.' };
  }

  if (data?.order_id) return { status: 'paid', orderId: data.order_id as string };
  return { status: 'failed', message: 'That payment has not completed.' };
}

/**
 * Start a charge.
 *
 * On web this never returns: the page navigates to Paystack, and the
 * buyer comes back to /checkout with a reference in the URL.
 *
 * On native it returns 'awaiting_return' as soon as the browser opens.
 * The screen then watches for the app coming back to the foreground and
 * confirms the reference itself — which covers the deep link firing,
 * the deep link NOT firing, and the buyer simply swiping back.
 */
export async function startPayment(
  quoteId: string,
  delivery: DeliveryDetails,
): Promise<PaymentOutcome> {
  const { data, error } = await supabase.functions.invoke('paystack-initialize', {
    body: { quote_id: quoteId, delivery, callback_url: callbackUrl(quoteId) },
  });

  if (error) {
    const detail = await readFunctionError(error);
    return { status: 'failed', message: detail ?? 'We could not start that payment.' };
  }

  const authorizationUrl = data?.authorization_url as string | undefined;
  const reference = data?.reference as string | undefined;
  if (!authorizationUrl || !reference) {
    return { status: 'failed', message: 'Paystack did not return a checkout page.' };
  }

  await rememberReference(reference);

  if (Platform.OS === 'web') {
    // A full navigation rather than a popup: popups are blocked often
    // enough that a checkout depending on one is a checkout that
    // sometimes silently does nothing.
    window.location.assign(authorizationUrl);
    // Unreachable in practice; the document is being torn down.
    return { status: 'awaiting_return', reference };
  }

  const opened = await Linking.canOpenURL(authorizationUrl);
  if (!opened) return { status: 'failed', message: 'No browser could open the payment page.' };
  await Linking.openURL(authorizationUrl);

  return { status: 'awaiting_return', reference };
}

/**
 * The development shortcut.
 *
 * Refused by the database unless payout_settings.allow_test_payments is
 * true, so this is safe to leave in the bundle.
 */
export async function simulatePayment(
  quoteId: string,
  delivery: DeliveryDetails,
): Promise<PaymentOutcome> {
  const { data, error } = await supabase.rpc('simulate_escrow_payment', {
    p_quote_id: quoteId,
    p_delivery_name: delivery.name,
    p_delivery_phone: delivery.phone,
    p_delivery_address: delivery.address,
    p_delivery_city: delivery.city,
    p_delivery_state: delivery.state ?? null,
    p_delivery_notes: delivery.notes ?? null,
  });

  if (error) {
    // Postgres puts the useful half in `hint`. simulate_escrow_payment
    // raises with the exact SQL that turns it on, and dropping that on
    // the floor is how a switched-off switch reads as a broken button.
    const hint = (error as { hint?: string | null }).hint;
    const details = (error as { details?: string | null }).details;
    return {
      status: 'failed',
      message: [error.message, hint, details].filter(Boolean).join(' — '),
    };
  }
  if (!data) return { status: 'failed', message: 'No order was created.' };
  return { status: 'paid', orderId: data as string };
}

/** Pull the function's own message out of a FunctionsHttpError. */
async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      /* not JSON */
    }
  }
  const message = (error as { message?: string })?.message;
  return message && !message.includes('non-2xx') ? message : null;
}
