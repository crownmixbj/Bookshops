import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/vendor/VendorShell';
import { WorkspaceFooter } from '../../components/layout/WorkspaceFooter';

import { useLayout } from '../../hooks/useLayout';
import { useVendorDashboard } from '../../hooks/useVendorDashboard';
import { useVendorQuotes, stateFor } from '../../hooks/useVendorQuotes';
import { useVendorPayouts } from '../../hooks/useVendorPayouts';
import { useShell } from '../../components/layout/ShellContext';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';

/**
 * Vendor dashboard — what needs the shop owner's attention, and where.
 *
 * The request queue used to BE this screen. It moved to
 * /vendor/quotes, beside the sent quotes, because answering a request
 * and checking what came of it are one job and were split across two
 * places. What is left here is the thing a dashboard is actually for:
 * four numbers that say where the day's work is, each a link.
 *
 * Every figure is computed by a hook that already exists and is already
 * loaded elsewhere in the app — nothing here has its own query, so this
 * screen cannot disagree with the screen it links to.
 */
export default function VendorDashboardScreen() {
  const { isMobile, contentPadding } = useLayout();
  const { displayName } = useShell();

  const { vendor, isVendor, queue, loading: queueLoading, error, refresh } = useVendorDashboard();
  const { rows, counts, pendingValue, loading: quotesLoading } = useVendorQuotes();
  const { summary, loading: payoutLoading } = useVendorPayouts();

  const unanswered = queue.filter((r) => !r.my_quote_id).length;
  const targeted = queue.filter((r) => r.is_targeted && !r.my_quote_id).length;
  // Orders still to pack or send. Delivered and cancelled are finished
  // work and would pad the number with nothing to do.
  const toFulfil = rows.filter(
    (r) =>
      stateFor(r) === 'ordered' &&
      r.order_fulfillment_status !== 'delivered' &&
      r.order_fulfillment_status !== 'cancelled'
  ).length;

  const loading = queueLoading || quotesLoading;

  // ---- gate ----------------------------------------------------
  if (isVendor === false) {
    return (
      <View style={styles.safe}>
        <View style={styles.gate}>
          <Ionicons name="storefront-outline" size={34} color={colors.textFaint} />
          <Text style={styles.gateTitle}>This area is for vendors</Text>
          <Text style={styles.gateBody}>
            Your account isn't registered as a bookshop. If you sell school books, sign up with
            a vendor account and register your shop in Settings.
          </Text>
          <Pressable
            onPress={() => router.push('/')}
            style={({ pressed }) => [styles.gateBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.gateBtnText}>Back to my dashboard</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>
          {vendor?.store_name ?? (displayName ? `Hello ${displayName}` : 'Your shop')}
        </Text>
        <Text style={styles.h2}>
          {loading
            ? 'Checking what needs you…'
            : unanswered === 0 && toFulfil === 0
            ? 'Nothing is waiting on you right now.'
            : [
                unanswered > 0 ? `${unanswered} request${unanswered === 1 ? '' : 's'} to quote` : null,
                toFulfil > 0 ? `${toFulfil} order${toFulfil === 1 ? '' : 's'} to fulfil` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error.message}</Text>
          <Pressable onPress={refresh} hitSlop={6}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* isVendor === false already returned above, so reaching here
          with no vendor row means the shop has not been registered yet. */}
      {!vendor && (
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle" size={16} color={colors.warning} />
          <Text style={styles.noticeText}>
            Your shop isn't set up yet. Add your business details in Settings and requests will
            start appearing here.
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : (
        <View style={[styles.tiles, isMobile && styles.tilesMobile]}>
          <Tile
            icon="pricetags-outline"
            label="Requests to quote"
            value={String(unanswered)}
            // Direct requests were addressed to this shop alone. If one
            // goes unanswered nobody else picks it up, so it is worth
            // calling out rather than folding into the total.
            note={targeted > 0 ? `${targeted} sent to you only` : 'In your incoming queue'}
            tone={unanswered > 0 ? 'urgent' : 'calm'}
            onPress={() => router.push('/vendor/quotes')}
          />
          <Tile
            icon="paper-plane-outline"
            label="Awaiting a decision"
            value={pendingValue > 0 ? formatNaira(pendingValue) : '—'}
            note={`${counts.pending} quote${counts.pending === 1 ? '' : 's'} with customers`}
            tone="calm"
            onPress={() => router.push('/vendor/quotes')}
          />
          <Tile
            icon="cube-outline"
            label="Orders to fulfil"
            value={String(toFulfil)}
            note={toFulfil > 0 ? 'Pack and dispatch' : 'Nothing outstanding'}
            tone={toFulfil > 0 ? 'urgent' : 'calm'}
            onPress={() => router.push('/vendor/orders')}
          />
          <Tile
            icon="wallet-outline"
            label="Available to withdraw"
            value={
              payoutLoading
                ? '…'
                : summary
                ? formatNaira(summary.available_balance)
                : '—'
            }
            note={
              summary?.can_request
                ? 'Ready to withdraw'
                : summary && !summary.has_bank_account
                ? 'Add a bank account first'
                : 'Below the minimum'
            }
            tone="calm"
            onPress={() => router.push('/vendor/payouts')}
          />
        </View>
      )}

      {!loading && counts.all === 0 && unanswered === 0 && (
        <Panel title="Getting started">
          <Text style={styles.startText}>
            No requests have reached you yet. Two things bring them in: an approved, verified
            shop, and a city on your profile so buyers nearby can find you.
          </Text>
          <View style={styles.startRow}>
            <Pressable
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.startBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.startBtnText}>Check your shop details</Text>
              <Ionicons name="arrow-forward" size={15} color={colors.onNavy} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/vendor/support')}
              style={({ pressed }) => [styles.startGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.startGhostText}>Selling on LOCI</Text>
            </Pressable>
          </View>
        </Panel>
      )}

      <WorkspaceFooter />
    </ScrollView>
  );
}

function Tile({
  icon,
  label,
  value,
  note,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  note: string;
  tone: 'urgent' | 'calm';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, tone === 'urgent' && styles.tileUrgent, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${note}`}
    >
      <View style={styles.tileHead}>
        <View style={[styles.tileIcon, tone === 'urgent' && styles.tileIconUrgent]}>
          <Ionicons name={icon} size={17} color={tone === 'urgent' ? colors.onNavy : colors.navy} />
        </View>
        <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileNote} numberOfLines={1}>
        {note}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  tilesMobile: { flexDirection: 'column' },
  tile: {
    flexGrow: 1,
    flexBasis: 190,
    minWidth: 170,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 2,
    ...shadow.card,
  },
  tileUrgent: { borderColor: colors.navyLight },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconUrgent: { backgroundColor: colors.navy },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  tileLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
  tileNote: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  startText: { fontSize: font.md, color: colors.textMuted, lineHeight: 21, marginBottom: spacing.md },
  startRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    minHeight: 44,
  },
  startBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  startGhost: {
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  startGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },

  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FCEAE8',
    borderColor: '#F0C4BF',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.warning, lineHeight: 18 },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBody: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 380,
    lineHeight: 21,
  },
  gateBtn: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  pressed: { opacity: 0.85 },
});
