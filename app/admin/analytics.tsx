import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/admin/AdminShell';
import {
  StatRow, StatTile, ShareBar, ErrorBanner, InfoBanner, TableSkeleton, EmptyRow,
  pageStyles as page,
} from '../../components/admin/AdminTable';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import { useAdminAnalytics } from '../../hooks/useAdminOps';
import { colors, spacing, font, formatNaira } from '../../theme';

/**
 * Platform Analytics.
 *
 * Every figure is computed from rows the admin policies already expose —
 * there is no analytics pipeline and no event stream, so what you see is
 * the current state of orders, quotes and booklists, not a time series.
 * A "growth" chart would need snapshots nobody is taking.
 */
export default function AdminAnalyticsScreen() {
  const { contentPadding } = useLayout();
  const { role } = useShell();
  const { data, loading, error, refresh } = useAdminAnalytics();

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

  const conv = data?.conversionRate;

  return (
    <ScrollView
      style={page.scroll}
      contentContainerStyle={[page.content, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={page.heading}>
        <Text style={page.h1}>Platform Analytics</Text>
        <Text style={page.h2}>Where the marketplace stands right now</Text>
      </View>

      {!!error && <ErrorBanner message={error.message} onRetry={refresh} />}

      <StatRow>
        <StatTile label="Total Gross Volume" value={formatNaira(data?.grossVolume ?? 0)} loading={loading} hint="Paid orders" />
        <StatTile
          label="Platform Net Revenue"
          value={formatNaira(data?.netRevenue ?? 0)}
          tone="info"
          loading={loading}
          hint={
            data && data.commissionRate === 0
              ? 'Commission is 0% — set a rate in payout_settings'
              : `${((data?.commissionRate ?? 0) * 100).toFixed(1)}% of gross`
          }
        />
        <StatTile label="Total Orders Placed" value={data?.totalOrders ?? 0} loading={loading} hint="All statuses" />
        <StatTile label="Active Vendors" value={data?.activeVendors ?? 0} tone="good" loading={loading} hint="Approved shops" />
      </StatRow>

      <Panel title="Booklist Quote Conversion">
        <View style={page.panelBody}>
          {loading ? (
            <TableSkeleton />
          ) : conv == null ? (
            <Text style={{ fontSize: font.sm, color: colors.textFaint }}>
              No booklists have been submitted yet, so there is no conversion rate to report.
            </Text>
          ) : (
            <>
              <Text style={{ fontSize: 30, fontWeight: '800', color: colors.navy }}>
                {conv.toFixed(1)}%
              </Text>
              <Text style={{ fontSize: font.sm, color: colors.textMuted, lineHeight: 19 }}>
                {data?.quotedRequests} of {data?.totalRequests} booklists have at least one real
                quote. Drafts a vendor has started but not sent are excluded — they are not offers.
              </Text>
              <ShareBar label="Quoted" value={data?.quotedRequests ?? 0} total={data?.totalRequests ?? 0} />
            </>
          )}
        </View>
      </Panel>

      <Panel title="Top Performing Regions">
        <View style={page.panelBody}>
          {loading ? (
            <TableSkeleton />
          ) : (data?.regions.length ?? 0) === 0 ? (
            <Text style={{ fontSize: font.sm, color: colors.textFaint }}>
              No paid orders yet, so there is nothing to rank by region.
            </Text>
          ) : (
            <>
              {data!.regions.map((r) => (
                <View key={r.name} style={{ gap: 3 }}>
                  <ShareBar
                    label={r.name}
                    value={r.value}
                    total={data!.regions[0].value}
                    display={formatNaira(r.value)}
                  />
                  <Text style={{ fontSize: font.xs, color: colors.textFaint }}>
                    {formatNaira(r.value)} across {r.orders} order{r.orders === 1 ? '' : 's'}
                  </Text>
                </View>
              ))}
              <Text style={{ fontSize: font.xs, color: colors.textFaint, marginTop: spacing.sm, lineHeight: 16 }}>
                Grouped by the city on each delivery address. Orders have no state field, so these
                are cities rather than states.
              </Text>
            </>
          )}
        </View>
      </Panel>

      <Panel title="Most Requested Schools">
        <View style={page.panelBody}>
          {loading ? <TableSkeleton /> : (data?.schools.length ?? 0) === 0 ? (
            <Text style={{ fontSize: font.sm, color: colors.textFaint }}>No booklists yet.</Text>
          ) : (
            data!.schools.map((s) => (
              <ShareBar key={s.name} label={s.name} value={s.requests} total={data!.schools[0].requests} />
            ))
          )}
        </View>
      </Panel>

      <Panel title="Most Requested Class Levels">
        <View style={page.panelBody}>
          {loading ? <TableSkeleton /> : (data?.classLevels.length ?? 0) === 0 ? (
            <EmptyRow>No booklists yet.</EmptyRow>
          ) : (
            data!.classLevels.map((s) => (
              <ShareBar key={s.name} label={s.name} value={s.requests} total={data!.classLevels[0].requests} />
            ))
          )}
        </View>
      </Panel>

      <InfoBanner tone="info">
        These are live counts, not a time series. Nothing snapshots these figures daily, so
        month-on-month growth cannot be shown without a metrics table that records them.
      </InfoBanner>

      <Footer audience="admin" />
    </ScrollView>
  );
}
