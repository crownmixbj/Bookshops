import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/admin/AdminShell';
import {
  StatRow, StatTile, Tabs, SearchBox, Badge, TableSkeleton, EmptyRow, ErrorBanner, InfoBanner,
  tableStyles as t, pageStyles as page, type Tone,
} from '../../components/admin/AdminTable';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import {
  useAdminOrders, useOrderItems,
  type AdminOrderRow, type PaymentStatus, type FulfillmentStatus,
} from '../../hooks/useAdminOps';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

type Filter = 'all' | 'pending' | 'held' | 'dispatched' | 'delivered' | 'cancelled';

const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending Payment' },
  { key: 'held', label: 'Paid, undelivered' },
  { key: 'dispatched', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled / Refunded' },
];

const PAYMENT: Record<PaymentStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warn' },
  escrow_held: { label: 'In escrow', tone: 'info' },
  escrow_released: { label: 'Released', tone: 'good' },
  paid: { label: 'Paid', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  refunded: { label: 'Refunded', tone: 'bad' },
};

const FULFILMENT: Record<FulfillmentStatus, { label: string; tone: Tone }> = {
  processing: { label: 'Processing', tone: 'warn' },
  ready: { label: 'Ready', tone: 'info' },
  dispatched: { label: 'Shipped', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

/**
 * Orders Overview.
 *
 * A note on "Escrow" and "Released", which the brief asks for as payment
 * statuses: the database has none. payment_status is pending / paid /
 * failed / refunded, and LOCI holds no client money in a separate
 * account. What is real is that a paid order which has not been
 * delivered is money the vendor cannot draw on yet — shown as "Held"
 * beside the payment badge, and never as a settled escrow balance.
 */
export default function AdminOrdersScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role } = useShell();
  const { rows, stats, loading, error, refresh } = useAdminOrders();

  const [tab, setTab] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<AdminOrderRow | null>(null);
  const { items, loading: itemsLoading } = useOrderItems(open?.quote_id ?? null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        switch (tab) {
          case 'all': return true;
          case 'pending': return r.payment_status === 'pending' || r.payment_status === 'failed';
          case 'held': return r.held;
          case 'dispatched': return r.fulfillment_status === 'dispatched';
          case 'delivered': return r.fulfillment_status === 'delivered';
          case 'cancelled': return r.fulfillment_status === 'cancelled' || r.payment_status === 'refunded';
        }
      })
      .filter((r) =>
        q
          ? r.reference.toLowerCase().includes(q) ||
            (r.buyer_name ?? '').toLowerCase().includes(q) ||
            (r.vendor_name ?? '').toLowerCase().includes(q)
          : true
      );
  }, [rows, tab, search]);

  if (role !== 'admin') {
    return (
      <View style={page.gate}>
        <Ionicons name="lock-closed-outline" size={30} color={colors.textFaint} />
        <Text style={page.gateTitle}>This area is for administrators</Text>
        <Pressable onPress={() => router.replace('/')} style={page.gateBtn} accessibilityRole="button">
          <Text style={page.gateBtnText}>Back to my dashboard</Text>
        </Pressable>
      </View>
    );
  }

  const itemsTotal = items.reduce((sum, i) => sum + Number(i.unit_price ?? 0) * i.quantity, 0);

  return (
    <ScrollView
      style={page.scroll}
      contentContainerStyle={[page.content, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={page.heading}>
        <Text style={page.h1}>Orders Overview</Text>
        <Text style={page.h2}>Fulfilment and payment across the marketplace</Text>
      </View>

      {!!error && <ErrorBanner message={error.message} onRetry={refresh} />}

      <StatRow>
        <StatTile label="Pending Payment" value={stats.pendingPayment} tone="warn" loading={loading} />
        <StatTile label="Paid, undelivered" value={stats.held} tone="info" loading={loading} hint="Not withdrawable yet" />
        <StatTile label="In Transit" value={stats.inTransit} tone="info" loading={loading} />
        <StatTile label="Delivered" value={stats.delivered} tone="good" loading={loading} />
        <StatTile label="Cancelled / Refunded" value={stats.cancelled} tone="bad" loading={loading} />
      </StatRow>

      <Panel
        title="Orders"
        right={<SearchBox value={search} onChange={setSearch} placeholder="Order ID, buyer or vendor" label="Search orders" />}
      >
        <Tabs tabs={TABS} value={tab} onChange={setTab} />

        {loading ? (
          <TableSkeleton />
        ) : visible.length === 0 ? (
          <EmptyRow>
            {rows.length === 0
              ? 'No orders have been placed yet.'
              : search.trim() ? `Nothing matches “${search.trim()}”.` : 'Nothing in this tab.'}
          </EmptyRow>
        ) : (
          <View>
            {!isMobile && (
              <View style={[t.tr, t.th]}>
                <Text style={[t.cell, s.cRef, t.thText]}>Order</Text>
                <Text style={[t.cell, s.cName, t.thText]}>Buyer</Text>
                <Text style={[t.cell, s.cName, t.thText]}>Bookshop</Text>
                <Text style={[t.cell, s.cNum, t.thText]}>Items</Text>
                <Text style={[t.cell, s.cAmt, t.thText]}>Total</Text>
                <Text style={[t.cell, s.cPay, t.thText]}>Payment</Text>
                <Text style={[t.cell, s.cShip, t.thText]}>Delivery</Text>
                <Text style={[t.cell, s.cAct, t.thText]}>Actions</Text>
              </View>
            )}

            {visible.map((r) => {
              // Defensive: a status this build has not heard of should render as
              // itself rather than crash the whole orders table.
              const pay = PAYMENT[r.payment_status] ?? { label: r.payment_status, tone: 'warn' as Tone };
              const ship = FULFILMENT[r.fulfillment_status];
              const view = (
                <Pressable
                  onPress={() => setOpen(r)}
                  style={({ pressed }) => [t.btn, pressed && t.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`View order details for ${r.reference}`}
                >
                  <Text style={t.btnText}>Details</Text>
                </Pressable>
              );

              return isMobile ? (
                <View key={r.id} style={t.mRow}>
                  <View style={t.mTop}>
                    <Text style={t.strong}>{formatNaira(r.amount)}</Text>
                    <Badge label={ship.label} tone={ship.tone} />
                  </View>
                  <Text style={t.mMeta}>{r.buyer_name ?? 'Unknown buyer'} → {r.vendor_name ?? 'Unknown shop'}</Text>
                  <Text style={t.mMeta}>
                    {r.reference} · {r.itemCount} item{r.itemCount === 1 ? '' : 's'} · {pay.label}
                    {r.held ? ' (held)' : ''}
                  </Text>
                  <View style={t.actions}>{view}</View>
                </View>
              ) : (
                <View key={r.id} style={t.tr}>
                  <Text style={[t.cell, s.cRef, t.mono]}>{r.reference}</Text>
                  <Text style={[t.cell, s.cName]} numberOfLines={1}>{r.buyer_name ?? '—'}</Text>
                  <Text style={[t.cell, s.cName]} numberOfLines={1}>{r.vendor_name ?? '—'}</Text>
                  <Text style={[t.cell, s.cNum]}>{r.itemCount}</Text>
                  <Text style={[t.cell, s.cAmt, t.strong]}>{formatNaira(r.amount)}</Text>
                  <View style={s.cPay}>
                    <Badge label={pay.label} tone={pay.tone} />
                    {r.held && <Text style={s.heldTag}>Held</Text>}
                  </View>
                  <View style={s.cShip}><Badge label={ship.label} tone={ship.tone} /></View>
                  <View style={s.cAct}>{view}</View>
                </View>
              );
            })}
          </View>
        )}
      </Panel>

      <InfoBanner>
        &quot;Held&quot; means paid but not yet delivered, so the shop cannot withdraw it. It is a
        derived label, not a payment status — LOCI holds no money in a separate escrow account.
      </InfoBanner>

      <Footer audience="admin" />

      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={s.scrim} onPress={() => setOpen(null)} accessibilityLabel="Close" />
        <View style={s.modalWrap} pointerEvents="box-none">
          <View style={s.modal}>
            <View style={s.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>Order {open?.reference}</Text>
                <Text style={s.modalSub}>
                  {open ? new Date(open.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                </Text>
              </View>
              <Pressable onPress={() => setOpen(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}>
              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>Items</Text>
                {itemsLoading ? (
                  <TableSkeleton />
                ) : items.length === 0 ? (
                  <Text style={s.note}>No line items recorded on the quote behind this order.</Text>
                ) : (
                  <>
                    {items.map((i) => (
                      <View key={i.id} style={s.itemRow}>
                        <Text style={s.itemQty}>{i.quantity}×</Text>
                        <Text style={s.itemTitle} numberOfLines={2}>{i.title}</Text>
                        <Text style={s.itemPrice}>
                          {i.unit_price == null ? '—' : formatNaira(Number(i.unit_price) * i.quantity)}
                        </Text>
                      </View>
                    ))}
                    <View style={s.totalRow}>
                      <Text style={s.totalLabel}>Items subtotal</Text>
                      <Text style={s.totalValue}>{formatNaira(itemsTotal)}</Text>
                    </View>
                    {open && Math.abs(itemsTotal - open.amount) > 0.5 && (
                      <View style={s.totalRow}>
                        <Text style={s.totalLabel}>
                          Adjustment (delivery, discount or a price changed after the quote)
                        </Text>
                        <Text style={s.totalValue}>{formatNaira(open.amount - itemsTotal)}</Text>
                      </View>
                    )}
                    <View style={[s.totalRow, s.grandRow]}>
                      <Text style={s.grandLabel}>Order total</Text>
                      <Text style={s.grandValue}>{formatNaira(open?.amount ?? 0)}</Text>
                    </View>
                  </>
                )}
              </View>

              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>Delivery</Text>
                <Text style={s.note}>
                  {open?.delivery_name ?? open?.buyer_name ?? '—'}
                  {open?.delivery_phone ? `\n${open.delivery_phone}` : ''}
                  {open?.delivery_address ? `\n${open.delivery_address}` : '\nNo address recorded'}
                  {open?.delivery_city ? `\n${open.delivery_city}` : ''}
                </Text>
              </View>

              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>Payment split</Text>
                <View style={s.splitRow}>
                  <Text style={s.note}>Bookshop receives</Text>
                  <Text style={s.splitValue}>{formatNaira(open?.amount ?? 0)}</Text>
                </View>
                <View style={s.splitRow}>
                  <Text style={s.note}>Platform commission</Text>
                  <Text style={s.splitValue}>{formatNaira(0)}</Text>
                </View>
                <Text style={s.footnote}>
                  Commission is 0% until a rate is set in payout_settings, so the shop is owed the
                  whole amount.
                </Text>
              </View>

              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>Contacts</Text>
                <Text style={s.note}>
                  Buyer: {open?.buyer_name ?? '—'}{open?.buyer_phone ? ` · ${open.buyer_phone}` : ''}
                  {'\n'}Bookshop: {open?.vendor_name ?? '—'}
                  {open?.vendor_phone ? ` · ${open.vendor_phone}` : ''}
                  {open?.vendor_email ? ` · ${open.vendor_email}` : ''}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  cRef: { flex: 0.8 },
  cName: { flex: 1.3 },
  cNum: { flex: 0.5 },
  cAmt: { flex: 1 },
  cPay: { flex: 1, alignItems: 'flex-start', gap: 2 },
  cShip: { flex: 1, alignItems: 'flex-start' },
  cAct: { flex: 0.9, alignItems: 'flex-start' },
  heldTag: { fontSize: font.xs, color: colors.warning, fontWeight: '700' },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.4)' },
  modalWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  modalHead: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  modalSub: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  sectionTitle: {
    fontSize: font.xs, fontWeight: '800', color: colors.textFaint,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  note: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  footnote: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },
  itemRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  itemQty: { width: 32, fontSize: font.md, fontWeight: '700', color: colors.navy },
  itemTitle: { flex: 1, fontSize: font.md, color: colors.text },
  itemPrice: { fontSize: font.md, color: colors.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: 4 },
  totalLabel: { flex: 1, fontSize: font.sm, color: colors.textMuted },
  totalValue: { fontSize: font.sm, color: colors.text },
  grandRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  grandLabel: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  grandValue: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  splitValue: { fontSize: font.md, fontWeight: '700', color: colors.text },
});
