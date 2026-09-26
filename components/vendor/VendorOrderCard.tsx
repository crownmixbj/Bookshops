import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { StatusPill, shortDate } from './VendorPageParts';
import { nextActionFor, type FulfillmentAction, type VendorOrder } from '../../hooks/useVendorOrders';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import type { FulfillmentStatus } from '../../types/db';

type AdvanceResult = { ok: true } | { ok: false; message: string };

export const FULFILLMENT_COPY: Record<
  FulfillmentStatus,
  { label: string; fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  processing: { label: 'To pack', fg: colors.warning, bg: colors.warningBg, icon: 'cube-outline' },
  ready: { label: 'Packed · awaiting dispatch', fg: colors.navy, bg: '#E8EEF8', icon: 'archive-outline' },
  dispatched: { label: 'Dispatched', fg: colors.navyLight, bg: '#E8EEF8', icon: 'car-outline' },
  delivered: { label: 'Delivered', fg: colors.success, bg: '#E4F2E8', icon: 'checkmark-done-outline' },
  cancelled: { label: 'Cancelled', fg: colors.danger, bg: '#FCEAE8', icon: 'close-circle-outline' },
};

const ACTION_COPY: Record<FulfillmentAction, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  ready: { label: 'Mark as packed', icon: 'archive-outline' },
  dispatched: { label: 'Mark as dispatched', icon: 'car-outline' },
  delivered: { label: 'Mark as delivered', icon: 'checkmark-done-outline' },
};

/**
 * One won order: the summary a shop scans, and — expanded — everything
 * needed to pack it and send it.
 *
 * The packing ticks are deliberately local. They are a picking aid for
 * whoever is at the shelf, not a record: the record is the status, which
 * only moves when the shop presses the button and the database agrees.
 */
export function VendorOrderCard({
  order,
  expanded,
  onToggle,
  onAdvance,
  compact,
}: {
  order: VendorOrder;
  expanded: boolean;
  onToggle: () => void;
  onAdvance: (
    next: FulfillmentAction,
    tracking?: { carrier?: string; number?: string; url?: string }
  ) => Promise<AdvanceResult>;
  compact: boolean;
}) {
  const status = FULFILLMENT_COPY[order.fulfillment_status] ?? FULFILLMENT_COPY.processing;
  const next = nextActionFor(order.fulfillment_status);

  const [packed, setPacked] = useState<Set<string>>(new Set());
  const [showDispatch, setShowDispatch] = useState(false);
  const [confirmDelivered, setConfirmDelivered] = useState(false);
  const [carrier, setCarrier] = useState(order.tracking_carrier ?? '');
  const [trackNo, setTrackNo] = useState(order.tracking_number ?? '');
  const [trackUrl, setTrackUrl] = useState(order.tracking_url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allPacked = order.items.length > 0 && order.items.every((i) => packed.has(i.id));
  const itemsValue = Math.max(order.amount - order.delivery_fee, 0);
  const place = [order.delivery_city, order.delivery_state].filter(Boolean).join(', ');

  function togglePacked(id: string) {
    setPacked((prev) => {
      const nextSet = new Set(prev);
      nextSet.has(id) ? nextSet.delete(id) : nextSet.add(id);
      return nextSet;
    });
  }

  async function run(action: FulfillmentAction) {
    setError(null);

    let tracking: { carrier?: string; number?: string; url?: string } | undefined;
    if (action === 'dispatched') {
      const url = trackUrl.trim();
      // The column has a CHECK for https. Catch it here with a sentence
      // a shop can act on, rather than surfacing a constraint name.
      if (url && !/^https:\/\//i.test(url)) {
        setError('A tracking link must start with https://');
        return;
      }
      tracking = { carrier, number: trackNo, url };
    }

    setBusy(true);
    const result = await onAdvance(action, tracking);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setShowDispatch(false);
    setConfirmDelivered(false);
  }

  function onPrimary() {
    if (!next) return;
    if (next === 'dispatched') return setShowDispatch(true);
    if (next === 'delivered') return setConfirmDelivered(true);
    run(next);
  }

  return (
    <View style={styles.card}>
      {/* ---- summary row ---------------------------------------- */}
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.summary, pressed && styles.pressedBg]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Order ${order.reference}, ${status.label}. ${expanded ? 'Collapse' : 'Expand'}`}
      >
        <View style={[styles.summaryMain, compact && styles.summaryMainCompact]}>
          <View style={styles.refBlock}>
            <Text style={styles.ref}>{order.reference}</Text>
            <Text style={styles.meta}>Placed {shortDate(order.placed_at)}</Text>
          </View>

          <View style={styles.schoolBlock}>
            <Text style={styles.school} numberOfLines={1}>
              {order.school_name ?? 'Booklist'}
              {order.class_level ? ` · ${order.class_level}` : ''}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {order.delivery_name ?? 'Buyer'}
              {place ? ` · ${place}` : ''}
            </Text>
          </View>

          <View style={[styles.amountBlock, compact && styles.amountBlockCompact]}>
            <Text style={styles.amount}>{formatNaira(order.amount)}</Text>
            <StatusPill label={status.label} fg={status.fg} bg={status.bg} icon={status.icon} />
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          <View style={[styles.columns, compact && styles.columnsCompact]}>
            {/* ---- packing list ------------------------------------ */}
            <View style={styles.colWide}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Packing list</Text>
                {order.items.length > 0 && (
                  <Text style={styles.sectionMeta}>
                    {packed.size}/{order.items.length} lines · {order.unitCount} cop
                    {order.unitCount === 1 ? 'y' : 'ies'}
                  </Text>
                )}
              </View>

              {order.items.length === 0 ? (
                <View style={styles.lumpSum}>
                  <Ionicons name="image-outline" size={16} color={colors.navy} />
                  <Text style={styles.lumpSumText}>
                    {order.pricing_mode === 'lump_sum'
                      ? 'You priced this booklist from its photo as one total, so there are no separate lines. Pack against the booklist photo in Requests & Quotes.'
                      : 'No lines were found on this quote.'}
                  </Text>
                </View>
              ) : (
                order.items.map((item, i) => {
                  const on = packed.has(item.id);
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => togglePacked(item.id)}
                      style={({ pressed }) => [styles.line, i > 0 && styles.lineBorder, pressed && styles.pressedBg]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${item.quantity} × ${item.title}`}
                    >
                      <Ionicons
                        name={on ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={on ? colors.success : colors.textFaint}
                      />
                      <Text style={styles.qty}>{item.quantity}×</Text>
                      <Text style={[styles.lineTitle, on && styles.lineTitleDone]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.linePrice}>
                        {item.unit_price == null ? '—' : formatNaira(item.unit_price * item.quantity)}
                      </Text>
                    </Pressable>
                  );
                })
              )}

              {!!order.vendor_note && (
                <Text style={styles.note}>Your quote note: {order.vendor_note}</Text>
              )}

              <View style={styles.totals}>
                <TotalRow label="Books" value={formatNaira(itemsValue)} />
                <TotalRow label="Delivery fee (paid by buyer)" value={formatNaira(order.delivery_fee)} />
                <TotalRow label="Order total" value={formatNaira(order.amount)} strong />
              </View>

              {order.items.length > 0 && allPacked && order.fulfillment_status === 'processing' && (
                <Text style={styles.allPacked}>Everything is ticked — ready to mark as packed.</Text>
              )}
              {order.items.length > 0 && (
                <Text style={styles.hint}>Ticks help you pick; they are not saved.</Text>
              )}
            </View>

            {/* ---- delivery & payment ------------------------------ */}
            <View style={styles.colNarrow}>
              <Text style={styles.sectionTitle}>Deliver to</Text>
              <View style={styles.infoBox}>
                <Text style={styles.infoStrong}>{order.delivery_name ?? '—'}</Text>
                {!!order.delivery_phone && (
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${order.delivery_phone}`)}
                    accessibilityRole="link"
                    accessibilityLabel={`Call ${order.delivery_phone}`}
                    style={styles.phoneRow}
                  >
                    <Ionicons name="call-outline" size={14} color={colors.navy} />
                    <Text style={styles.link}>{order.delivery_phone}</Text>
                  </Pressable>
                )}
                {!!order.delivery_address && <Text style={styles.info}>{order.delivery_address}</Text>}
                {!!place && <Text style={styles.info}>{place}</Text>}
                {!!order.delivery_notes && (
                  <Text style={styles.infoNote}>“{order.delivery_notes}”</Text>
                )}
              </View>

              <Text style={[styles.sectionTitle, styles.spaced]}>Payment</Text>
              <View style={styles.infoBox}>
                {order.inEscrow ? (
                  <>
                    <StatusPill label="Held in escrow" fg={colors.navy} bg="#E8EEF8" icon="shield-checkmark-outline" />
                    <Text style={styles.info}>
                      Paid {shortDate(order.paid_at ?? order.placed_at)}. Released to you once the buyer
                      confirms they have received the books.
                    </Text>
                  </>
                ) : (
                  <>
                    <StatusPill label="Released" fg={colors.success} bg="#E4F2E8" icon="wallet-outline" />
                    <Text style={styles.info}>The money for this order has been released.</Text>
                  </>
                )}
              </View>

              {(order.tracking_carrier || order.tracking_number || order.tracking_url) && (
                <>
                  <Text style={[styles.sectionTitle, styles.spaced]}>Tracking</Text>
                  <View style={styles.infoBox}>
                    <Text style={styles.info}>
                      {[order.tracking_carrier, order.tracking_number].filter(Boolean).join(' · ') || '—'}
                    </Text>
                    {!!order.tracking_url && (
                      <Pressable onPress={() => Linking.openURL(order.tracking_url!)} accessibilityRole="link">
                        <Text style={styles.link} numberOfLines={1}>
                          Open tracking link
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </>
              )}

              <Timeline order={order} />
            </View>
          </View>

          {/* ---- dispatch form ----------------------------------- */}
          {showDispatch && (
            <View style={styles.form}>
              <Text style={styles.sectionTitle}>Dispatch details (optional)</Text>
              <Text style={styles.hint}>The buyer sees these on their order so they can follow it.</Text>
              <View style={[styles.formRow, compact && styles.formRowCompact]}>
                <Field label="Courier" value={carrier} onChangeText={setCarrier} placeholder="e.g. GIG Logistics" />
                <Field label="Tracking number" value={trackNo} onChangeText={setTrackNo} placeholder="e.g. GIG123456" />
              </View>
              <Field
                label="Tracking link"
                value={trackUrl}
                onChangeText={setTrackUrl}
                placeholder="https://…"
                keyboardType="url"
              />
            </View>
          )}

          {confirmDelivered && (
            <View style={styles.confirm}>
              <Ionicons name="information-circle" size={16} color={colors.navy} />
              <Text style={styles.confirmText}>
                Only mark this delivered once the books are in the buyer’s hands. The buyer is asked to
                confirm receipt, and escrow is released after they do.
              </Text>
            </View>
          )}

          {!!error && (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* ---- actions ----------------------------------------- */}
          <View style={[styles.actions, compact && styles.actionsCompact]}>
            <Pressable
              onPress={() => router.push({ pathname: '/vendor/messages', params: { quote: order.quote_id } })}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressedBg]}
              accessibilityRole="button"
            >
              <Ionicons name="chatbubble-outline" size={16} color={colors.navy} />
              <Text style={styles.secondaryText}>Message buyer</Text>
            </Pressable>

            <View style={styles.spacer} />

            {(showDispatch || confirmDelivered) && (
              <Pressable
                onPress={() => {
                  setShowDispatch(false);
                  setConfirmDelivered(false);
                  setError(null);
                }}
                style={styles.cancel}
                accessibilityRole="button"
                disabled={busy}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            )}

            {next && (
              <Pressable
                onPress={
                  showDispatch ? () => run('dispatched') : confirmDelivered ? () => run('delivered') : onPrimary
                }
                disabled={busy}
                style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, busy && styles.primaryBusy]}
                accessibilityRole="button"
                accessibilityState={{ busy }}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onNavy} size="small" />
                ) : (
                  <Ionicons name={ACTION_COPY[next].icon} size={16} color={colors.onNavy} />
                )}
                <Text style={styles.primaryText}>
                  {showDispatch
                    ? 'Confirm dispatch'
                    : confirmDelivered
                    ? 'Yes, it was delivered'
                    : ACTION_COPY[next].label}
                </Text>
              </Pressable>
            )}

            {!next && order.fulfillment_status === 'delivered' && (
              <Text style={styles.doneText}>Delivered {shortDate(order.delivered_at)}</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, strong && styles.totalStrong]}>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalStrong]}>{value}</Text>
    </View>
  );
}

/** Where the order has been, from the timestamps the database stamps. */
function Timeline({ order }: { order: VendorOrder }) {
  const steps: { label: string; at: string | null }[] = [
    { label: 'Paid', at: order.paid_at ?? order.placed_at },
    { label: 'Packed', at: order.ready_at },
    { label: 'Dispatched', at: order.dispatched_at },
    { label: 'Delivered', at: order.delivered_at },
  ];
  return (
    <View style={styles.timeline}>
      {steps.map((s) => (
        <View key={s.label} style={styles.step}>
          <Ionicons
            name={s.at ? 'checkmark-circle' : 'ellipse-outline'}
            size={14}
            color={s.at ? colors.success : colors.borderStrong}
          />
          <Text style={[styles.stepLabel, !s.at && styles.stepLabelPending]}>{s.label}</Text>
          <Text style={styles.stepAt}>{s.at ? shortDate(s.at) : ''}</Text>
        </View>
      ))}
    </View>
  );
}

function Field({
  label,
  ...input
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'url';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        style={styles.input}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadow.card,
  },
  pressedBg: { backgroundColor: colors.surfaceMuted },

  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  summaryMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minWidth: 0 },
  summaryMainCompact: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
  refBlock: { width: 120 },
  ref: { fontSize: font.md, fontWeight: '800', color: colors.text, letterSpacing: 0.3 },
  meta: { fontSize: font.sm, color: colors.textFaint, marginTop: 2 },
  schoolBlock: { flex: 1, minWidth: 0 },
  school: { fontSize: font.md, fontWeight: '600', color: colors.text },
  amountBlock: { alignItems: 'flex-end', gap: 6 },
  amountBlockCompact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: font.lg, fontWeight: '800', color: colors.text },

  body: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg, gap: spacing.lg },
  columns: { flexDirection: 'row', gap: spacing.xl },
  columnsCompact: { flexDirection: 'column', gap: spacing.lg },
  colWide: { flex: 3, minWidth: 0 },
  colNarrow: { flex: 2, minWidth: 0 },

  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitle: { fontSize: font.sm, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  sectionMeta: { fontSize: font.sm, color: colors.textFaint },
  spaced: { marginTop: spacing.lg },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    minHeight: 44,
  },
  lineBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  qty: { width: 30, fontSize: font.md, fontWeight: '800', color: colors.navy },
  lineTitle: { flex: 1, fontSize: font.md, color: colors.text },
  lineTitleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  linePrice: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },

  lumpSum: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  lumpSumText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 19 },
  note: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing.sm, fontStyle: 'italic' },

  totals: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm, gap: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: font.sm, color: colors.textMuted },
  totalValue: { fontSize: font.sm, color: colors.text, fontWeight: '600' },
  totalStrong: { fontSize: font.md, fontWeight: '800', color: colors.text },
  allPacked: { fontSize: font.sm, color: colors.success, fontWeight: '700', marginTop: spacing.sm },
  hint: { fontSize: font.xs, color: colors.textFaint, marginTop: spacing.xs },

  infoBox: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, gap: 4, marginTop: spacing.sm },
  infoStrong: { fontSize: font.md, fontWeight: '700', color: colors.text },
  info: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  infoNote: { fontSize: font.sm, color: colors.textMuted, fontStyle: 'italic' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  timeline: { marginTop: spacing.lg, gap: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepLabel: { flex: 1, fontSize: font.sm, color: colors.text, fontWeight: '600' },
  stepLabelPending: { color: colors.textFaint, fontWeight: '500' },
  stepAt: { fontSize: font.sm, color: colors.textFaint },

  form: { gap: spacing.md, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.lg },
  formRow: { flexDirection: 'row', gap: spacing.md },
  formRowCompact: { flexDirection: 'column' },
  field: { flex: 1, gap: 5 },
  fieldLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: font.md,
    color: colors.text,
  },

  confirm: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: '#E8EEF8',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  confirmText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 19 },

  error: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: '#FDF2F1', borderRadius: radius.md, padding: spacing.md },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  actionsCompact: { gap: spacing.sm },
  spacer: { flex: 1 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  secondaryText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
  cancel: { paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: font.md, fontWeight: '600', color: colors.textMuted },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  primaryPressed: { backgroundColor: colors.orangeDark },
  primaryBusy: { opacity: 0.7 },
  primaryText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
  doneText: { fontSize: font.sm, fontWeight: '700', color: colors.success },
});
