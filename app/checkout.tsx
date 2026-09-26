import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, AppState, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';

import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../components/buyer/BuyerPage';
import { FormField } from '../components/auth/FormField';
import { StatePicker } from '../components/settings/StatePicker';
import { AddressPicker } from '../components/household/AddressPicker';
import { useAddressBook } from '../hooks/useAddressBook';
import type { DeliveryAddress } from '../types/db';
import { useLayout } from '../hooks/useLayout';
import { supabase } from '../utils/supabase';
import {
  loadCheckoutSummary,
  startPayment,
  confirmPayment,
  simulatePayment,
  takeRememberedReference,
  peekRememberedReference,
  clearRememberedReference,
  hasPaystackKey,
  loadBundleSummary,
  startBundlePayment,
  simulateBundlePayment,
  BUNDLE_PROBLEM_COPY,
  type BundleSummary,
  type CheckoutSummary,
  type DeliveryDetails,
} from '../lib/paystack';
import { colors, spacing, radius, font, formatNaira, shadow } from '../theme';

/**
 * Checkout.
 *
 * Three things about this screen are load-bearing and easy to undo by
 * accident:
 *
 *   1. Every number shown comes from checkout_quote() in Postgres, the
 *      same function the charge is priced from. Nothing here adds up a
 *      total in JavaScript, because a total computed on the client is a
 *      total the client can change.
 *
 *   2. Nothing here writes an order. The order is created by
 *      paystack-initialize before the buyer leaves, and settled by
 *      paystack-verify or the webhook after they pay. This screen only
 *      collects an address and reports what the server decided.
 *
 *   3. It is re-entrant. Paystack sends the buyer back with ?reference=
 *      in the URL, so a mount that finds one confirms it instead of
 *      starting again. That path also covers a buyer who closed the tab
 *      and reopened it, and a phone that died on the bank's OTP page.
 *
 * The route accepts ?quote=<quote id>, or ?quotes=<id>,<id>,… for a
 * multi-list checkout (one charge, one order per quote, one delivery fee
 * per shop — priced by checkout_bundle() in Postgres, same rule as
 * above). Without either there is no priced agreement to charge for, and
 * the screen says so rather than showing an empty form.
 */

type Phase =
  | 'loading'
  | 'ready'
  | 'submitting'
  /** Native: the system browser is open and we are waiting to hear back. */
  | 'awaiting'
  | 'confirming'
  | 'done'
  | 'unavailable';

interface FormState {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  notes: string;
}

const EMPTY_FORM: FormState = { name: '', phone: '', address: '', city: '', state: '', notes: '' };

export default function CheckoutScreen() {
  const params = useLocalSearchParams<{
    quote?: string | string[];
    quotes?: string | string[];
    reference?: string | string[];
    trxref?: string | string[];
  }>();
  const quoteId = first(params.quote);
  // A bundle: several quotes, one charge. Deduplicated and capped here
  // only to keep the URL honest — the server re-checks both.
  const bundleParam = first(params.quotes);
  const bundleIds = useMemo(
    () => [...new Set((bundleParam ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 12),
    [bundleParam],
  );
  const isBundle = bundleIds.length > 0;
  // Paystack sends both; they are the same value. trxref is the legacy
  // spelling and is still what some flows come back with.
  const returnedReference = first(params.reference) ?? first(params.trxref);

  const { isMobile } = useLayout();

  const [phase, setPhase] = useState<Phase>('loading');
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [bundle, setBundle] = useState<BundleSummary | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [testAllowed, setTestAllowed] = useState(false);
  const [awaitingRef, setAwaitingRef] = useState<string | null>(null);

  // Saved addresses. The default one prefills the form (it is also what
  // the profile prefill holds, mirrored by the database), and a new
  // address typed here can be kept for next time.
  const book = useAddressBook();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [saveAddress, setSaveAddress] = useState(true);
  const addressPrefilled = useRef(false);

  const applyAddress = useCallback((a: DeliveryAddress) => {
    setAddressId(a.id);
    setErrors({});
    setForm((f) => ({
      name: a.recipient_name,
      phone: a.phone,
      address: a.address,
      city: a.city,
      state: a.state ?? '',
      // The landmark is how a rider finds the gate; the order has no
      // column of its own for it, so it travels in the notes.
      notes: a.landmark ? `Landmark: ${a.landmark}` : f.notes && f.notes.startsWith('Landmark:') ? '' : f.notes,
    }));
  }, []);

  useEffect(() => {
    if (addressPrefilled.current || book.loading) return;
    const preferred = book.addresses.find((a) => a.is_default) ?? book.addresses[0];
    if (preferred) applyAddress(preferred);
    addressPrefilled.current = true;
  }, [book.loading, book.addresses, applyAddress]);

  // A returning buyer must be confirmed exactly once. Without this an
  // effect that re-runs on a param change would verify the same
  // reference twice and race itself.
  const confirmed = useRef(false);

  /* ---------------------------------------------------------------- */
  /* Coming back from Paystack                                         */
  /* ---------------------------------------------------------------- */

  const settle = useCallback(async (reference: string) => {
    setPhase('confirming');
    const outcome = await confirmPayment(reference);
    if (outcome.status === 'paid') {
      setPhase('done');
      router.replace({ pathname: '/orders', params: { placed: outcome.orderId } });
      return true;
    }
    setProblem(
      outcome.status === 'failed'
        ? outcome.message
        : 'That payment was not completed. Nothing has been charged.',
    );
    return false;
  }, []);

  /* ---------------------------------------------------------------- */
  /* Loading what is being paid for                                    */
  /* ---------------------------------------------------------------- */

  const load = useCallback(async () => {
    setProblem(null);

    // A reference in the URL outranks everything: money may already have
    // moved, and asking the buyer to fill the form in again while their
    // card has been charged is the worst thing this screen could do.
    const pending = returnedReference ?? (await takeRememberedReference());
    if (pending && !confirmed.current) {
      confirmed.current = true;
      const settled = await settle(pending);
      if (settled) return;
      // Not paid after all — fall through and let them try again.
    }

    if (!quoteId && !isBundle) {
      setPhase('unavailable');
      return;
    }

    setPhase('loading');

    if (isBundle) {
      try {
        const [next, profile, settings] = await Promise.all([
          loadBundleSummary(bundleIds),
          loadProfileDefaults(),
          loadTestSwitch(),
        ]);
        setBundle(next);
        setTestAllowed(settings);
        setForm((current) => (current === EMPTY_FORM ? profile : current));
        if (!next.lines.some((l) => !l.problem)) {
          setProblem(
            next.lines.length
              ? 'None of these lists can be paid for any more — they have been ordered, or the quotes were withdrawn.'
              : 'Those quotes are not available to you.',
          );
          setPhase('unavailable');
          return;
        }
        setPhase('ready');
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
        setPhase('unavailable');
      }
      return;
    }

    try {
      const [next, profile, settings] = await Promise.all([
        loadCheckoutSummary(quoteId as string),
        loadProfileDefaults(),
        loadTestSwitch(),
      ]);

      setSummary(next);
      setTestAllowed(settings);
      setForm((current) => (current === EMPTY_FORM ? profile : current));

      if (next.existing_order_id && next.existing_payment_status !== 'pending') {
        setProblem('This quote has already been paid for.');
        setPhase('unavailable');
        return;
      }

      setPhase('ready');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setPhase('unavailable');
    }
    // bundleIds is derived from bundleParam, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId, bundleParam, returnedReference, settle]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------------------------------------------------------------- */
  /* Paying                                                            */
  /* ---------------------------------------------------------------- */

  const delivery = useMemo<DeliveryDetails>(
    () => ({
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim() || null,
      notes: form.notes.trim() || null,
    }),
    [form],
  );

  /** The bundle's lines that can actually be paid for. */
  const payableIds = useMemo(
    () => (bundle ? bundle.lines.filter((l) => !l.problem).map((l) => l.quote_id) : []),
    [bundle],
  );

  async function submit(mode: 'paystack' | 'test') {
    if (!quoteId && !isBundle) return;

    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setProblem(null);
    setPhase('submitting');

    // Keep a newly typed address for next time. Best effort: a failure
    // here must never stand between the buyer and paying.
    if (addressId === null && saveAddress && book.migration === 'ok') {
      await book
        .save({
          label: book.addresses.length === 0 ? 'Home' : `Address ${book.addresses.length + 1}`,
          recipient_name: delivery.name,
          phone: delivery.phone,
          address: delivery.address,
          city: delivery.city,
          state: delivery.state ?? null,
          lga: null,
          landmark: null,
          is_default: book.addresses.length === 0,
        })
        .catch(() => undefined);
    }

    const outcome = isBundle
      ? mode === 'test'
        ? await simulateBundlePayment(payableIds, delivery)
        : await startBundlePayment(payableIds, delivery)
      : mode === 'test'
        ? await simulatePayment(quoteId as string, delivery)
        : await startPayment(quoteId as string, delivery);

    if (outcome.status === 'paid') {
      setPhase('done');
      router.replace({ pathname: '/orders', params: { placed: outcome.orderId } });
      return;
    }

    // Native: the browser is open. We are not waiting on it to tell us
    // anything — we hold the reference and will ask the server instead.
    if (outcome.status === 'awaiting_return') {
      setAwaitingRef(outcome.reference);
      setPhase('awaiting');
      return;
    }

    setProblem(
      outcome.status === 'failed'
        ? outcome.message
        : 'Payment was not completed. Nothing has been charged.',
    );
    setPhase('ready');
  }

  /**
   * Check on a payment we are waiting for.
   *
   * Called when the app returns to the foreground and from the button,
   * because neither is reliable on its own: the deep link may not fire,
   * and the buyer may not press anything.
   */
  const recheck = useCallback(async () => {
    const reference = awaitingRef ?? (await peekRememberedReference());
    if (!reference) return;

    const outcome = await confirmPayment(reference);
    if (outcome.status === 'paid') {
      await clearRememberedReference();
      setPhase('done');
      router.replace({ pathname: '/orders', params: { placed: outcome.orderId } });
    }
    // Anything else: stay put. A buyer still on the bank's OTP screen is
    // not a failure, and telling them it failed would be a lie that
    // makes them pay twice.
  }, [awaitingRef]);

  useEffect(() => {
    if (phase !== 'awaiting') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') recheck();
    });
    return () => sub.remove();
  }, [phase, recheck]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (phase === 'awaiting') {
    return (
      <BuyerPage
        eyebrow="Checkout"
        title="Finish paying in your browser"
        subtitle="This page is waiting for Paystack to confirm."
      >
        <Panel>
          <View style={styles.centred}>
            <ActivityIndicator color={colors.navy} />
            <Text style={styles.centredText}>
              Complete the payment in the browser that just opened. Come back here afterwards — we
              check automatically, and nothing is lost if the browser closes early.
            </Text>
          </View>
        </Panel>

        <View style={styles.actions}>
          <Pressable
            onPress={recheck}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            accessibilityRole="button"
          >
            <Ionicons name="refresh" size={15} color={colors.onNavy} />
            <Text style={styles.ctaText}>I have paid — check now</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setAwaitingRef(null);
              setPhase('ready');
            }}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Back to checkout</Text>
          </Pressable>
        </View>
      </BuyerPage>
    );
  }

  if (phase === 'confirming' || phase === 'done') {
    return (
      <BuyerPage eyebrow="Checkout" title="Confirming your payment">
        <Panel>
          <View style={styles.centred}>
            <ActivityIndicator color={colors.navy} />
            <Text style={styles.centredText}>
              Checking with Paystack. Do not close this page — if you were charged, this is what
              records it.
            </Text>
          </View>
        </Panel>
      </BuyerPage>
    );
  }

  if (phase === 'unavailable') {
    return (
      <BuyerPage
        eyebrow="Checkout"
        title={quoteId || isBundle ? 'This cannot be paid for' : 'Nothing selected to pay for'}
        subtitle="Nothing has been charged."
      >
        <ErrorPanel
          message={
            problem ??
            'Open the quote you want to accept and press "Accept and pay" — checkout needs to know which shop it is paying.'
          }
          onRetry={quoteId || isBundle ? load : undefined}
        />
        <View style={styles.actions}>
          <Pressable
            onPress={() => router.replace('/booklists')}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Go to my booklists</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace('/orders')}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>See my orders</Text>
          </Pressable>
        </View>
      </BuyerPage>
    );
  }

  if (phase === 'loading' || (!summary && !bundle)) {
    return (
      <BuyerPage eyebrow="Checkout" title="Loading…">
        <Panel>
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={18} width="45%" />
            <Skeleton height={120} />
          </View>
        </Panel>
      </BuyerPage>
    );
  }

  const busy = phase === 'submitting';
  const showTestButton = !hasPaystackKey || testAllowed;
  const payTotal = bundle ? bundle.total : summary!.total;

  return (
    <BuyerPage
      eyebrow={bundle ? 'Household checkout' : 'Checkout'}
      title={
        bundle
          ? `Pay for ${payableIds.length} booklist${payableIds.length === 1 ? '' : 's'}`
          : `Pay ${summary!.store_name ?? 'this shop'}`
      }
      subtitle={
        bundle
          ? `One payment, delivered by ${bundle.shopCount} shop${bundle.shopCount === 1 ? '' : 's'}.`
          : summary!.school_name
            ? `Booklist for ${summary!.school_name}`
            : 'Confirm where these books should go, then pay.'
      }
    >
      {!!problem && <ErrorPanel message={problem} />}

      <View style={[styles.columns, isMobile && styles.columnsStacked]}>
        {/* ---------------- Delivery ---------------- */}
        <View style={[styles.column, !isMobile && styles.columnWide]}>
          <Panel title="Delivery Information">
            <AddressPicker
              addresses={book.addresses}
              selectedId={addressId}
              disabled={busy}
              onSelect={applyAddress}
              onNew={() => {
                setAddressId(null);
                setForm((f) => ({ ...EMPTY_FORM, name: f.name, phone: f.phone }));
              }}
            />
            <View style={styles.form}>
              <FormField
                label="Full name"
                value={form.name}
                onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                error={errors.name}
                editable={!busy}
                autoComplete="name"
                placeholder="Who is receiving the books"
              />
              <FormField
                label="Phone number"
                value={form.phone}
                onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                error={errors.phone}
                editable={!busy}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="0803 123 4567"
                hint="The shop calls this number before delivering."
              />
              <FormField
                label="Delivery address"
                value={form.address}
                onChangeText={(v) => setForm((f) => ({ ...f, address: v }))}
                error={errors.address}
                editable={!busy}
                multiline
                numberOfLines={3}
                placeholder="Street, house number, estate"
              />
              <FormField
                label="City or town"
                value={form.city}
                onChangeText={(v) => setForm((f) => ({ ...f, city: v }))}
                error={errors.city}
                editable={!busy}
                placeholder="Ikeja"
              />
              <StatePicker
                label="State"
                value={form.state}
                onChange={(v) => setForm((f) => ({ ...f, state: v }))}
              />
              <FormField
                label="Delivery notes (optional)"
                value={form.notes}
                onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                editable={!busy}
                multiline
                numberOfLines={2}
                placeholder="Landmark, gate colour, best time to call"
              />
              {addressId === null && book.migration === 'ok' && (
                <Pressable
                  onPress={() => setSaveAddress((v) => !v)}
                  style={styles.saveRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: saveAddress }}
                >
                  <Ionicons
                    name={saveAddress ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={saveAddress ? colors.navy : colors.textFaint}
                  />
                  <Text style={styles.saveText}>Save this address for next time</Text>
                </Pressable>
              )}
            </View>
          </Panel>
        </View>

        {/* ---------------- Summary ---------------- */}
        <View style={[styles.column, !isMobile && styles.columnNarrow]}>
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Order summary</Text>

            {bundle ? (
              <>
                {bundle.lines.map((l) => (
                  <View key={l.quote_id} style={[styles.bundleLine, !!l.problem && styles.bundleLineOff]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.bundleWho} numberOfLines={1}>
                        {[l.child_name, l.school_name, l.class_level].filter(Boolean).join(' · ') || 'Booklist'}
                      </Text>
                      <Text style={styles.bundleShop} numberOfLines={1}>
                        {l.store_name ?? 'Shop'}
                        {!l.problem && l.delivery_fee > 0 ? ` · delivery ${formatNaira(l.delivery_fee)}` : ''}
                        {!l.problem && l.delivery_fee === 0 && bundle.deliveryTotal > 0 ? ' · ships with the same shop' : ''}
                      </Text>
                      {!!l.problem && <Text style={styles.bundleProblem}>{BUNDLE_PROBLEM_COPY[l.problem]}</Text>}
                    </View>
                    <Text style={[styles.lineValue, !!l.problem && styles.struck]}>{formatNaira(l.items_total)}</Text>
                  </View>
                ))}
                <View style={styles.line}>
                  <Text style={styles.lineLabel}>Books</Text>
                  <Text style={styles.lineValue}>{formatNaira(bundle.itemsTotal)}</Text>
                </View>
                <View style={styles.line}>
                  <Text style={styles.lineLabel}>
                    Delivery ({bundle.shopCount} shop{bundle.shopCount === 1 ? '' : 's'})
                  </Text>
                  <Text style={styles.lineValue}>
                    {bundle.deliveryTotal > 0 ? formatNaira(bundle.deliveryTotal) : 'Free'}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.line}>
                  <Text style={styles.lineLabel}>Items from {summary!.store_name ?? 'the shop'}</Text>
                  <Text style={styles.lineValue}>{formatNaira(summary!.items_total)}</Text>
                </View>
                <View style={styles.line}>
                  <Text style={styles.lineLabel}>Delivery</Text>
                  <Text style={styles.lineValue}>
                    {summary!.delivery_fee > 0 ? formatNaira(summary!.delivery_fee) : 'Free'}
                  </Text>
                </View>
              </>
            )}

            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Total to pay</Text>
              <Text style={styles.totalValue}>{formatNaira(payTotal)}</Text>
            </View>

            <View style={styles.escrow}>
              <Ionicons name="shield-checkmark" size={18} color={colors.success} />
              <Text style={styles.escrowText}>
                {bundle
                ? 'Held in LOCI Escrow. Each shop is paid separately, when you confirm its delivery.'
                : 'Payment is safely held in LOCI Escrow until you confirm receipt of your books.'}
              </Text>
            </View>

            <Pressable
              onPress={() => submit('paystack')}
              disabled={busy || !hasPaystackKey}
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
                (busy || !hasPaystackKey) && styles.ctaDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Pay ${formatNaira(payTotal)} with Paystack`}
            >
              {busy ? (
                <ActivityIndicator color={colors.onNavy} />
              ) : (
                <>
                  <Ionicons name="lock-closed" size={15} color={colors.onNavy} />
                  <Text style={styles.ctaText}>Pay {formatNaira(payTotal)}</Text>
                </>
              )}
            </Pressable>

            {!hasPaystackKey && (
              <Text style={styles.note}>
                EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY is not set on this build, so live payment is off.
              </Text>
            )}

            {showTestButton && (
              <Pressable
                onPress={() => submit('test')}
                disabled={busy}
                style={({ pressed }) => [styles.testBtn, pressed && styles.testBtnPressed]}
                accessibilityRole="button"
              >
                <Ionicons name="flask-outline" size={15} color={colors.warning} />
                <Text style={styles.testText}>Simulate test payment</Text>
              </Pressable>
            )}

            <Text style={styles.fineprint}>
              Card details are entered on Paystack, never here. LOCI never sees your card number.
            </Text>
          </View>
        </View>
      </View>
    </BuyerPage>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Prefill from the saved profile.
 *
 * default_delivery_state only exists once bookshops_delivery_address.sql
 * or bookshops_escrow_checkout.sql has run, so it is selected separately
 * — asking for a column that is not there fails the whole select and the
 * buyer gets an empty form for no visible reason.
 */
async function loadProfileDefaults(): Promise<FormState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY_FORM;

  const { data } = await supabase
    .from('profiles')
    .select('full_name, phone_number, default_delivery_address, default_delivery_city, default_delivery_phone')
    .eq('id', user.id)
    .maybeSingle();

  const { data: withState } = await supabase
    .from('profiles')
    .select('default_delivery_state')
    .eq('id', user.id)
    .maybeSingle();

  return {
    name: data?.full_name ?? '',
    phone: data?.default_delivery_phone ?? data?.phone_number ?? '',
    address: data?.default_delivery_address ?? '',
    city: data?.default_delivery_city ?? '',
    state: (withState as { default_delivery_state?: string | null } | null)?.default_delivery_state ?? '',
    notes: '',
  };
}

/** Whether this project allows the simulated payment. Read, not assumed. */
async function loadTestSwitch(): Promise<boolean> {
  const { data } = await supabase.from('payout_settings').select('allow_test_payments').maybeSingle();
  return !!(data as { allow_test_payments?: boolean } | null)?.allow_test_payments;
}

/**
 * Validation.
 *
 * Nigerian mobile numbers are eleven digits beginning 0, or the same
 * number in +234 form. Anything shorter is a typo that a courier will
 * discover at the gate.
 */
function validate(form: FormState): Partial<Record<keyof FormState, string>> {
  const found: Partial<Record<keyof FormState, string>> = {};

  if (form.name.trim().length < 2) found.name = 'Give the name of the person receiving the books.';

  const digits = form.phone.replace(/[^\d]/g, '');
  const valid =
    (digits.length === 11 && digits.startsWith('0')) ||
    (digits.length === 13 && digits.startsWith('234')) ||
    (digits.length === 10 && !digits.startsWith('0'));
  if (!valid) found.phone = 'Enter an 11-digit Nigerian number, e.g. 0803 123 4567.';

  if (form.address.trim().length < 8) {
    found.address = 'A street and house number — enough for a courier to find it.';
  }
  if (form.city.trim().length < 2) found.city = 'Which city or town?';

  return found;
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  columnsStacked: { flexDirection: 'column' },
  column: { minWidth: 0 },
  columnWide: { flex: 3 },
  columnNarrow: { flex: 2 },

  form: { gap: spacing.lg },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  saveText: { fontSize: font.md, color: colors.text },

  bundleLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bundleLineOff: { opacity: 0.6 },
  bundleWho: { fontSize: font.md, fontWeight: '700', color: colors.text },
  bundleShop: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  bundleProblem: { fontSize: font.sm, color: colors.danger, marginTop: 2 },
  struck: { textDecorationLine: 'line-through', color: colors.textFaint },

  summary: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  summaryTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },

  line: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  lineLabel: { flex: 1, fontSize: font.md, color: colors.textMuted, lineHeight: 20 },
  lineValue: { fontSize: font.md, fontWeight: '600', color: colors.text },

  totalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  totalLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: font.xl, fontWeight: '800', color: colors.text },

  escrow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#EAF6EF',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  escrowText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },

  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.warning,
    backgroundColor: colors.warningBg,
  },
  testBtnPressed: { opacity: 0.75 },
  testText: { fontSize: font.sm, fontWeight: '700', color: colors.warning },

  note: { fontSize: font.sm, color: colors.warning, lineHeight: 17 },
  fineprint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },

  centred: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  centredText: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', maxWidth: 380, lineHeight: 20 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  secondary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  secondaryPressed: { backgroundColor: colors.surfaceMuted },
  secondaryText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
});
