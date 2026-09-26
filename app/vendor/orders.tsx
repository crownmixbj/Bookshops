import { useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  VendorGate,
  PageHeading,
  FilterPills,
  MigrationNeeded,
  InlineMessage,
  pageStyles,
} from '../../components/vendor/VendorPageParts';
import { VendorOrderCard } from '../../components/vendor/VendorOrderCard';
import { WorkspaceFooter } from '../../components/layout/WorkspaceFooter';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import {
  useVendorOrders,
  VENDOR_ORDER_TABS,
  type VendorOrderTab,
  type FulfillmentAction,
} from '../../hooks/useVendorOrders';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';

/**
 * Orders & Fulfilment — the orders a shop has won, and the work left on
 * each one.
 *
 * Only orders whose payment has cleared are shown (see useVendorOrders):
 * that is the point at which a quote has genuinely been won. The status
 * buttons go through vendor_advance_fulfillment(), which owns the rules —
 * no packing an unpaid order, nothing backwards out of delivered — so
 * this screen only decides which button to draw.
 */
export default function VendorOrdersScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role, search } = useShell();
  const { counts, byTab, loading, refreshing, error, migration, refresh, advance, orders } =
    useVendorOrders();

  // Opens on the work queue when there is work, otherwise on everything —
  // an empty "To Pack" tab on arrival reads as "you have no orders".
  const [tabChoice, setTab] = useState<VendorOrderTab | null>(null);
  const tab: VendorOrderTab = tabChoice ?? (counts.to_pack > 0 ? 'to_pack' : 'all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      byTab(tab).filter((o) =>
        query
          ? [o.reference, o.school_name, o.class_level, o.delivery_name, o.delivery_phone, o.delivery_city]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(query))
          : true
      ),
    [byTab, tab, query]
  );

  const toPackValue = useMemo(
    () =>
      byTab('to_pack').reduce((sum, o) => sum + Math.max(o.amount - o.delivery_fee, 0), 0),
    [byTab]
  );

  if (role !== 'vendor') return <VendorGate area="Orders" />;

  if (migration === 'missing') {
    return (
      <ScrollView contentContainerStyle={[pageStyles.scrollContent, { padding: contentPadding }]}>
        <MigrationNeeded feature="Order fulfilment" file="bookshops_vendor_dispatch.sql" onRetry={refresh} />
        <WorkspaceFooter />
      </ScrollView>
    );
  }

  async function handleAdvance(
    orderId: string,
    reference: string,
    next: FulfillmentAction,
    tracking?: { carrier?: string; number?: string; url?: string }
  ) {
    setNotice(null);
    const result = await advance(orderId, next, tracking);
    if (result.ok) {
      setNotice(
        next === 'ready'
          ? `${reference} marked as packed. It is waiting for dispatch.`
          : next === 'dispatched'
          ? `${reference} dispatched. The buyer can now see it is on the way.`
          : `${reference} marked as delivered. The buyer will be asked to confirm receipt.`
      );
    }
    return result;
  }

  const empty = !loading && visible.length === 0;

  return (
    <ScrollView
      style={pageStyles.scroll}
      contentContainerStyle={[pageStyles.scrollContent, { padding: contentPadding }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <PageHeading
        title="Orders & Fulfilment"
        subtitle={
          loading
            ? 'Loading your orders…'
            : counts.to_pack > 0
            ? `${counts.to_pack} order${counts.to_pack === 1 ? '' : 's'} to pack and send`
            : orders.length > 0
            ? 'Nothing waiting to be packed'
            : 'Orders appear here once a buyer pays for one of your quotes'
        }
      />

      {/* ---- at a glance -------------------------------------------- */}
      <View style={styles.tiles}>
        <Tile icon="cube-outline" label="To pack" value={loading ? '—' : String(counts.to_pack)} hint={toPackValue > 0 ? `${formatNaira(toPackValue)} of books` : undefined} emphasis />
        <Tile icon="car-outline" label="In transit" value={loading ? '—' : String(counts.in_transit)} />
        <Tile icon="checkmark-done-outline" label="Delivered" value={loading ? '—' : String(counts.completed)} />
      </View>

      {!!error && <InlineMessage tone="error">{error}</InlineMessage>}
      {!!notice && <InlineMessage tone="success">{notice}</InlineMessage>}

      <FilterPills
        options={VENDOR_ORDER_TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))}
        value={tab}
        onChange={(k) => {
          setTab(k);
          setOpenId(null);
        }}
      />

      {loading ? (
        <View style={pageStyles.loading}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : empty ? (
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={28} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>
            {query
              ? 'No orders match your search'
              : tab === 'to_pack'
              ? 'Nothing to pack right now'
              : tab === 'in_transit'
              ? 'Nothing on the road'
              : tab === 'completed'
              ? 'No delivered orders yet'
              : 'No orders yet'}
          </Text>
          <Text style={styles.emptyBody}>
            {query
              ? 'Try a reference, school or buyer name.'
              : 'When a buyer accepts one of your quotes and pays, the order lands here with its packing list.'}
          </Text>
        </View>
      ) : (
        visible.map((order) => (
          <VendorOrderCard
            key={order.id}
            order={order}
            compact={isMobile}
            expanded={openId === order.id}
            onToggle={() => setOpenId((id) => (id === order.id ? null : order.id))}
            onAdvance={(next, tracking) => handleAdvance(order.id, order.reference, next, tracking)}
          />
        ))
      )}

      <WorkspaceFooter />
    </ScrollView>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  emphasis,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <View style={[styles.tile, emphasis && styles.tileEmphasis]}>
      <View style={styles.tileHead}>
        <Ionicons name={icon} size={16} color={emphasis ? colors.orangeDark : colors.textMuted} />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      {!!hint && <Text style={styles.tileHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 4,
    ...shadow.card,
  },
  tileEmphasis: { borderColor: colors.orange },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tileLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  tileValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  tileHint: { fontSize: font.xs, color: colors.textFaint },

  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  emptyBody: { fontSize: font.md, color: colors.textFaint, textAlign: 'center', maxWidth: 420, lineHeight: 21 },
});
