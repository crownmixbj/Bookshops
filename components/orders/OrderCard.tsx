import { useState } from 'react';
import { View, Text, Pressable, Linking, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import { ConfirmDialog } from '../booklists/ConfirmDialog';
import type { OrderView, PaymentStatus, TrackerStage } from '../../types/db';
import { SETTLED_PAYMENT_STATUSES } from '../../types/db';
import { downloadInvoice } from '../../lib/invoice';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Raw enum names are for the database. A buyer reading "escrow_held"
 * learns nothing; "In escrow" is the promise the product made them.
 */
const PAY_LABEL: Partial<Record<PaymentStatus, string>> = {
  pending: 'Awaiting payment',
  escrow_held: 'In escrow',
  escrow_released: 'Released to shop',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

/** Statuses that should read as good news rather than as a warning. */
const PAID_LOOK = new Set<string>(SETTLED_PAYMENT_STATUSES);

function shortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

/**
 * Horizontal on wide screens, vertical on mobile — a four-step tracker
 * squeezed into 390px becomes unreadable, and a vertical timeline also
 * gives each step room for its timestamp.
 */
function Tracker({ stages, cancelled }: { stages: TrackerStage[]; cancelled: boolean }) {
  const { isMobile } = useLayout();

  if (cancelled) {
    return (
      <View style={styles.cancelled}>
        <Ionicons name="close-circle" size={16} color={colors.danger} />
        <Text style={styles.cancelledText}>This order was cancelled</Text>
      </View>
    );
  }

  return (
    <View style={[styles.tracker, isMobile ? styles.trackerCol : styles.trackerRow]}>
      {stages.map((stage, i) => {
        const done = stage.state === 'done';
        const current = stage.state === 'current';
        const dotColor = done ? colors.success : current ? colors.orange : colors.border;

        return (
          <View
            key={stage.step}
            style={[styles.stage, isMobile ? styles.stageCol : styles.stageRow]}
          >
            <View style={isMobile ? styles.railCol : styles.railRow}>
              <View style={[styles.dot, { backgroundColor: dotColor }]}>
                {done && <Ionicons name="checkmark" size={11} color={colors.onNavy} />}
              </View>
              {i < stages.length - 1 && (
                <View
                  style={[
                    isMobile ? styles.connectorCol : styles.connectorRow,
                    { backgroundColor: done ? colors.success : colors.border },
                  ]}
                />
              )}
            </View>
            <View style={isMobile ? styles.stageTextCol : styles.stageTextRow}>
              <Text
                style={[styles.stageLabel, (done || current) && styles.stageLabelOn]}
                numberOfLines={2}
              >
                {stage.label}
              </Text>
              {!!stage.at && <Text style={styles.stageDate}>{shortDate(stage.at)}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  tone = 'ghost',
  busy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'ghost' | 'primary' | 'danger';
  busy?: boolean;
}) {
  const fg =
    tone === 'primary' ? colors.onNavy : tone === 'danger' ? colors.danger : colors.navy;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.action,
        tone === 'primary' && styles.actionPrimary,
        tone === 'danger' && styles.actionDanger,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Ionicons name={icon} size={15} color={fg} />
      )}
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

interface Props {
  order: OrderView;
  defaultExpanded?: boolean;
  onDispute: (order: OrderView) => void;
  /** Called after the buyer confirms receipt, so the list can re-read. */
  onChanged?: () => void;
  /** Outlined briefly — the order a notification or message linked to. */
  highlight?: boolean;
}

/**
 * Can the buyer release this order's escrow?
 *
 * Only while money is actually held, and never for a cancelled order —
 * that is a refund conversation, not a release. The database enforces
 * the same rule (confirm_order_receipt); this only decides what to show.
 */
function canConfirmReceipt(order: OrderView): boolean {
  return order.payment_status === 'escrow_held' && !order.isCancelled;
}

export function OrderCard({ order, defaultExpanded = false, onDispute, onChanged, highlight }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const [invoicing, setInvoicing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const total = order.amount ?? order.itemsTotal;
  const shop = order.vendor?.store_name ?? 'the shop';
  const releasable = canConfirmReceipt(order);
  // The shop says it has arrived, or it is on its way: this is the
  // moment to ask. Before dispatch the button still exists (a parent
  // may have collected in person) but is not pushed at them.
  const receiptDue = releasable && (order.fulfillment_status === 'dispatched' || order.fulfillment_status === 'delivered');

  async function confirmReceipt() {
    setConfirming(true);
    setConfirmError(null);
    const { error } = await supabase.rpc('confirm_order_receipt', { p_order_id: order.id });
    setConfirming(false);
    if (error) {
      const missing = ['42883', 'PGRST202'].includes(error.code ?? '');
      setConfirmError(
        missing
          ? 'Confirming receipt is not switched on yet — bookshops_buyer_portal.sql needs to be run.'
          : error.message
      );
      return;
    }
    setConfirmOpen(false);
    onChanged?.();
  }

  const openMessages = () =>
    router.push({ pathname: '/messages', params: { quote: order.quote_id } });

  async function handleInvoice() {
    setInvoicing(true);
    setNotice(null);
    const result = await downloadInvoice(order);
    setNotice(result.ok ? result.message ?? null : `Could not create the invoice: ${result.message}`);
    setInvoicing(false);
  }

  function openTracking() {
    // The https:// shape is enforced by a CHECK constraint in the
    // database, so this cannot be a javascript: or file: URL.
    if (order.tracking_url) Linking.openURL(order.tracking_url).catch(() => {});
  }

  return (
    <View style={[styles.card, highlight && styles.cardHighlight]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.reference}>{order.reference}</Text>
          <Text style={styles.vendor} numberOfLines={1}>
            {order.vendor?.store_name ?? 'Vendor unavailable'}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[
              order.request?.school_name,
              `${order.itemCount} item${order.itemCount === 1 ? '' : 's'}`,
              shortDate(order.placed_at ?? order.created_at),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View style={styles.headRight}>
          <Text style={styles.total}>{formatNaira(total)}</Text>
          <View
            style={[
              styles.payPill,
              PAID_LOOK.has(order.payment_status) && styles.payPillPaid,
              order.payment_status === 'failed' && styles.payPillFailed,
            ]}
          >
            <Text
              style={[
                styles.payPillText,
                PAID_LOOK.has(order.payment_status) && { color: colors.success },
                order.payment_status === 'failed' && { color: colors.danger },
              ]}
            >
              {PAY_LABEL[order.payment_status] ?? order.payment_status}
            </Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </Pressable>

      <View style={styles.trackerWrap}>
        <Tracker stages={order.stages} cancelled={order.isCancelled} />
      </View>

      {/* --- escrow: the buyer's one lever on the money ----------- */}
      {receiptDue && (
        <View style={styles.receipt}>
          <Ionicons name="shield-checkmark" size={18} color={colors.success} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.receiptTitle}>
              {order.fulfillment_status === 'delivered' ? 'Did everything arrive?' : 'On its way to you'}
            </Text>
            <Text style={styles.receiptBody}>
              {formatNaira(total)} is held in LOCI Escrow. Confirm once you have checked the books and it
              is released to {shop}. If something is wrong, report it instead.
            </Text>
          </View>
          <Action
            icon="checkmark-circle-outline"
            label="Confirm receipt"
            tone="primary"
            onPress={() => setConfirmOpen(true)}
          />
        </View>
      )}
      {order.payment_status === 'escrow_released' && (
        <View style={[styles.receipt, styles.receiptDone]}>
          <Ionicons name="checkmark-done-circle" size={18} color={colors.success} />
          <Text style={[styles.receiptBody, { flex: 1 }]}>
            You confirmed receipt{order.escrow_released_at ? ` on ${shortDate(order.escrow_released_at)}` : ''}.
            Payment has been released to {shop}.
          </Text>
        </View>
      )}

      {open && (
        <View style={styles.body}>
          {/* --- vendor contact ------------------------------------ */}
          <Text style={styles.sectionLabel}>Vendor</Text>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>{order.vendor?.store_name ?? '—'}</Text>
            {!!order.vendor?.address && (
              <Text style={styles.infoLine}>
                {[order.vendor.address, order.vendor.city].filter(Boolean).join(', ')}
              </Text>
            )}
            <View style={styles.contactRow}>
              {order.vendor?.phone ? (
                <Action
                  icon="call-outline"
                  label={order.vendor.phone}
                  onPress={() =>
                    Linking.openURL(`tel:${order.vendor!.phone!.replace(/[^\d+]/g, '')}`).catch(() => {})
                  }
                />
              ) : (
                <Text style={styles.infoMuted}>No phone on file for this shop</Text>
              )}
              {!!order.vendor?.email && (
                <Action
                  icon="mail-outline"
                  label={order.vendor.email}
                  onPress={() => Linking.openURL(`mailto:${order.vendor!.email}`).catch(() => {})}
                />
              )}
            </View>
          </View>

          {/* --- delivery ------------------------------------------ */}
          <Text style={styles.sectionLabel}>Delivery</Text>
          <View style={styles.infoBox}>
            {order.delivery_address ? (
              <>
                <Text style={styles.infoTitle}>{order.delivery_name ?? 'Recipient'}</Text>
                <Text style={styles.infoLine}>
                  {[order.delivery_address, order.delivery_city].filter(Boolean).join(', ')}
                </Text>
                {!!order.delivery_phone && (
                  <Text style={styles.infoLine}>{order.delivery_phone}</Text>
                )}
                {!!order.delivery_notes && (
                  <Text style={styles.infoNote}>{order.delivery_notes}</Text>
                )}
              </>
            ) : (
              <Text style={styles.infoMuted}>
                No delivery address was recorded for this order.
              </Text>
            )}

            {order.tracking_number ? (
              <View style={styles.trackingRow}>
                <Text style={styles.infoLine}>
                  {[order.tracking_carrier, order.tracking_number].filter(Boolean).join(' · ')}
                </Text>
                {!!order.tracking_url && (
                  <Action icon="open-outline" label="Track shipment" onPress={openTracking} tone="primary" />
                )}
              </View>
            ) : (
              <Text style={styles.infoMuted}>
                No tracking details yet — the vendor adds these when the parcel is dispatched.
              </Text>
            )}
          </View>

          {/* --- items --------------------------------------------- */}
          <Text style={styles.sectionLabel}>Items</Text>
          {order.items.length === 0 ? (
            <Text style={styles.infoMuted}>No itemised lines recorded for this order.</Text>
          ) : (
            order.items.map((item) => {
              const line = item.unit_price == null ? null : item.unit_price * item.quantity;
              return (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemQty}>{item.quantity}×</Text>
                  <Text style={styles.itemTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={[styles.itemPrice, line == null && styles.itemPriceMuted]}>
                    {line == null ? '—' : formatNaira(line)}
                  </Text>
                </View>
              );
            })
          )}

          {/* The agreed amount is authoritative, but it can differ from the
              sum of the lines — delivery, a discount, a substitution. Showing
              only the total next to lines that add up to something else reads
              as an arithmetic error, so the difference is spelled out. */}
          {order.amount != null && order.items.length > 0 && order.itemsTotal > 0 && (
            <>
              <View style={styles.subtotalRow}>
                <Text style={styles.subtotalLabel}>Items subtotal</Text>
                <Text style={styles.subtotalValue}>{formatNaira(order.itemsTotal)}</Text>
              </View>
              {Math.abs(order.amount - order.itemsTotal) > 0.005 && (
                <View style={styles.subtotalRow}>
                  <Text style={styles.subtotalLabel}>
                    {order.amount > order.itemsTotal ? 'Delivery & adjustments' : 'Discount'}
                  </Text>
                  <Text style={styles.subtotalValue}>
                    {order.amount > order.itemsTotal ? '+' : '−'}
                    {formatNaira(Math.abs(order.amount - order.itemsTotal))}
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total paid</Text>
            <Text style={styles.totalValue}>{formatNaira(total)}</Text>
          </View>
          {order.amount == null && (
            <Text style={styles.caveat}>
              No agreed amount was stored for this order, so this is the sum of its line items.
            </Text>
          )}

          {notice && (
            <View style={styles.notice}>
              <Ionicons name="information-circle" size={14} color={colors.warning} />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          <View style={styles.actions}>
            {releasable && !receiptDue && (
              <Action
                icon="checkmark-circle-outline"
                label="I've received these books"
                tone="primary"
                onPress={() => setConfirmOpen(true)}
              />
            )}
            <Action icon="chatbubbles-outline" label="Message shop" onPress={openMessages} />
            <Action
              icon="download-outline"
              label={invoicing ? 'Preparing…' : 'Download invoice'}
              onPress={handleInvoice}
              busy={invoicing}
            />
            <Action
              icon="alert-circle-outline"
              label="Report a problem"
              tone="danger"
              onPress={() => onDispute(order)}
            />
          </View>
        </View>
      )}

      <ConfirmDialog
        visible={confirmOpen}
        title="Confirm you received your books?"
        message={
          (order.fulfillment_status === 'processing' || order.fulfillment_status === 'ready'
            ? `${shop} has not marked this order as dispatched yet. Only confirm if the books are already in your hands. `
            : '') +
          `This releases ${formatNaira(total)} from escrow to ${shop} and cannot be undone. ` +
          'If anything is missing or damaged, cancel and use "Report a problem" instead.' +
          (confirmError ? `\n\n${confirmError}` : '')
        }
        confirmLabel="Yes, release payment"
        busy={confirming}
        onConfirm={confirmReceipt}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmError(null);
        }}
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
  cardHighlight: { borderColor: colors.orange, borderWidth: 2 },
  head: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, alignItems: 'flex-start' },
  receipt: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    backgroundColor: '#EAF6EF',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  receiptDone: { backgroundColor: '#F2F8F4' },
  receiptTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  receiptBody: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18, marginTop: 1 },
  reference: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, letterSpacing: 0.5 },
  vendor: { fontSize: font.md, fontWeight: '700', color: colors.text, marginTop: 2 },
  meta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  headRight: { alignItems: 'flex-end', gap: 4 },
  total: { fontSize: font.lg, fontWeight: '800', color: colors.navy },
  payPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  payPillPaid: { backgroundColor: '#E4F2E8' },
  payPillFailed: { backgroundColor: '#FCEAE8' },
  payPillText: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'capitalize' },

  trackerWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tracker: { gap: 0 },
  trackerRow: { flexDirection: 'row' },
  trackerCol: { flexDirection: 'column' },
  stage: { flex: 1 },
  stageRow: { flexDirection: 'column' },
  stageCol: { flexDirection: 'row', gap: spacing.md, minHeight: 44 },
  railRow: { flexDirection: 'row', alignItems: 'center' },
  railCol: { alignItems: 'center', width: 20 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorRow: { flex: 1, height: 2, marginHorizontal: 2 },
  connectorCol: { width: 2, flex: 1, marginVertical: 2 },
  stageTextRow: { marginTop: spacing.sm, paddingRight: spacing.sm },
  stageTextCol: { flex: 1, paddingBottom: spacing.md },
  stageLabel: { fontSize: font.xs, color: colors.textFaint, fontWeight: '600' },
  stageLabelOn: { color: colors.text },
  stageDate: { fontSize: font.xs, color: colors.textFaint, marginTop: 1 },

  cancelled: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancelledText: { fontSize: font.sm, color: colors.danger, fontWeight: '600' },

  body: { padding: spacing.lg },
  sectionLabel: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  infoBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  infoTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  infoLine: { fontSize: font.sm, color: colors.textMuted },
  infoNote: { fontSize: font.sm, color: colors.textFaint, fontStyle: 'italic', marginTop: 2 },
  infoMuted: { fontSize: font.sm, color: colors.textFaint },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  trackingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemQty: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, minWidth: 26 },
  itemTitle: { flex: 1, fontSize: font.md, color: colors.text },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemPriceMuted: { color: colors.textFaint, fontWeight: '500' },

  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  subtotalLabel: { fontSize: font.sm, color: colors.textMuted },
  subtotalValue: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: font.md, fontWeight: '700', color: colors.textMuted },
  totalValue: { fontSize: font.xl, fontWeight: '800', color: colors.navy },
  caveat: { fontSize: font.xs, color: colors.warning, marginTop: 4, lineHeight: 16 },

  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.warning, lineHeight: 18 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    backgroundColor: colors.surface,
  },
  actionPrimary: { backgroundColor: colors.navy, borderColor: colors.navy },
  actionDanger: { borderColor: '#F0C4BF' },
  actionText: { fontSize: font.sm, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
