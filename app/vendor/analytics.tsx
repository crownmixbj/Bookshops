import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/vendor/VendorShell';
import {
  VendorGate,
  PageHeading,
  FilterPills,
  MigrationNeeded,
  InlineMessage,
  pageStyles,
} from '../../components/vendor/VendorPageParts';
import { BarChart, DualLineChart, OutcomeBar, compactNaira } from '../../components/vendor/AnalyticsCharts';
import { WorkspaceFooter } from '../../components/layout/WorkspaceFooter';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import {
  useVendorAnalytics,
  bucketSeries,
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type AnalyticsBucket,
} from '../../hooks/useVendorAnalytics';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';

/**
 * Analytics — how the shop is doing over a chosen period.
 *
 * Four headline figures with the change against the period before, then
 * revenue over time, quotes against orders, what became of this period's
 * quotes, and which schools the money came from. Definitions live with
 * the SQL (bookshops_vendor_analytics.sql) and are repeated in the hints
 * under each figure, so a shop owner never has to guess what a number
 * counts.
 */
export default function VendorAnalyticsScreen() {
  const { contentPadding, isDesktop } = useLayout();
  const { role } = useShell();
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [asTable, setAsTable] = useState(false);
  const { data, loading, error, migration, refresh } = useVendorAnalytics(range);

  const buckets = useMemo(() => (data ? bucketSeries(data.series, range) : []), [data, range]);

  if (role !== 'vendor') return <VendorGate area="Analytics" />;

  if (migration === 'missing') {
    return (
      <ScrollView contentContainerStyle={[pageStyles.scrollContent, { padding: contentPadding }]}>
        <MigrationNeeded feature="Analytics" file="bookshops_vendor_analytics.sql" onRetry={refresh} />
        <WorkspaceFooter />
      </ScrollView>
    );
  }

  const t = data?.totals;
  const p = data?.previous;
  const rangeLabel = ANALYTICS_RANGES.find((r) => r.key === range)?.label ?? '';
  const nothingYet = !loading && !!data && data.totals.quotes_sent === 0 && data.totals.orders_won === 0;
  const unit = range <= 30 ? 'Day' : range === 90 ? 'Week' : 'Month';

  return (
    <ScrollView
      style={pageStyles.scroll}
      contentContainerStyle={[pageStyles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
    >
      <PageHeading
        title="Analytics"
        subtitle={
          data
            ? `${formatRange(data.from, data.to)} · compared with the ${rangeLabel} before`
            : 'Quotes sent, orders won and revenue over time'
        }
      />

      <FilterPills
        options={ANALYTICS_RANGES.map((r) => ({ key: String(r.key), label: r.label }))}
        value={String(range)}
        onChange={(k) => setRange(Number(k) as AnalyticsRange)}
      />

      {!!error && <InlineMessage tone="error">{error}</InlineMessage>}

      {/* ---- headline figures --------------------------------------- */}
      <View style={styles.kpis}>
        <Kpi
          icon="paper-plane-outline"
          label="Quotes sent"
          value={t ? String(t.quotes_sent) : null}
          delta={t && p ? change(t.quotes_sent, p.quotes_sent) : null}
          hint="Booklists you priced and sent"
        />
        <Kpi
          icon="bag-check-outline"
          label="Orders won"
          value={t ? String(t.orders_won) : null}
          delta={t && p ? change(t.orders_won, p.orders_won) : null}
          hint="Quotes the buyer accepted and paid for"
        />
        <Kpi
          icon="git-compare-outline"
          label="Conversion rate"
          value={t ? (t.conversion_rate == null ? '—' : `${Math.round(t.conversion_rate * 100)}%`) : null}
          delta={
            t && p && t.conversion_rate != null && p.conversion_rate != null
              ? { text: `${pts(t.conversion_rate - p.conversion_rate)} pts`, dir: Math.sign(t.conversion_rate - p.conversion_rate) }
              : null
          }
          hint="Of this period’s quotes, the share that became paid orders"
        />
        <Kpi
          icon="cash-outline"
          label="Revenue"
          value={t ? formatNaira(t.revenue) : null}
          delta={t && p ? change(t.revenue, p.revenue) : null}
          hint={
            t && t.orders_won > 0
              ? `Books only, excl. delivery · avg ${formatNaira(t.avg_order_value ?? 0)} per order`
              : 'Books only, excluding delivery fees'
          }
          emphasis
        />
      </View>

      {nothingYet && (
        <InlineMessage tone="info">
          No activity in the last {rangeLabel}. Figures fill in as you send quotes and buyers pay for them.
        </InlineMessage>
      )}

      {/* ---- charts ------------------------------------------------- */}
      <View style={[styles.grid, isDesktop && styles.gridWide]}>
        <View style={styles.gridMain}>
          <Panel
            title="Revenue over time"
            right={
              <Pressable onPress={() => setAsTable((v) => !v)} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>{asTable ? 'View as chart' : 'View as table'}</Text>
              </Pressable>
            }
          >
            <View style={styles.panelBody}>
              {loading && !data ? (
                <Loading />
              ) : asTable ? (
                <TrendTable buckets={buckets} unit={unit} />
              ) : (
                <BarChart
                  buckets={buckets}
                  value={(b) => b.revenue}
                  format={formatNaira}
                  tickFormat={compactNaira}
                  describe={(b) => `${b.orders} order${b.orders === 1 ? '' : 's'}`}
                />
              )}
            </View>
          </Panel>

          {!asTable && (
            <Panel title="Quotes sent vs orders won">
              <View style={styles.panelBody}>
                {loading && !data ? (
                  <Loading />
                ) : (
                  <DualLineChart
                    buckets={buckets}
                    a={{ label: 'Quotes sent', value: (b) => b.quotes }}
                    b={{ label: 'Orders won', value: (b) => b.orders }}
                  />
                )}
              </View>
            </Panel>
          )}
        </View>

        <View style={styles.gridSide}>
          <Panel title="How this period’s quotes turned out">
            <View style={styles.panelBody}>
              {loading && !data ? <Loading /> : data && <OutcomeBar {...data.outcomes} />}
            </View>
          </Panel>

          <Panel title="Top schools">
            <View style={styles.panelBody}>
              {loading && !data ? (
                <Loading />
              ) : !data || data.top_schools.length === 0 ? (
                <Text style={styles.muted}>No paid orders in this period yet.</Text>
              ) : (
                data.top_schools.map((s, i) => (
                  <View key={s.school_name} style={[styles.school, i > 0 && styles.schoolBorder]}>
                    <Text style={styles.rank}>{i + 1}</Text>
                    <View style={styles.schoolMain}>
                      <Text style={styles.schoolName} numberOfLines={1}>
                        {s.school_name}
                      </Text>
                      <Text style={styles.muted}>
                        {s.orders} order{s.orders === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Text style={styles.schoolValue}>{formatNaira(s.revenue)}</Text>
                  </View>
                ))
              )}
            </View>
          </Panel>

          <Panel title="Fulfilment right now">
            <View style={styles.panelBody}>
              {data ? (
                <Pressable onPress={() => router.push('/vendor/orders')} accessibilityRole="link" style={styles.fulfil}>
                  <FulfilStat label="To pack" value={data.fulfillment.to_pack} warn={data.fulfillment.to_pack > 0} />
                  <FulfilStat label="In transit" value={data.fulfillment.in_transit} />
                  <FulfilStat label="Delivered" value={data.fulfillment.delivered} />
                </Pressable>
              ) : (
                <Loading />
              )}
              <Text style={styles.muted}>All time, not just this period. Tap to open Orders.</Text>
            </View>
          </Panel>
        </View>
      </View>

      <WorkspaceFooter />
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */

type Delta = { text: string; dir: number } | null;

/** "+12%" against the previous period; "New" when there was nothing to compare with. */
function change(now: number, before: number): Delta {
  if (before === 0) return now === 0 ? { text: 'No change', dir: 0 } : { text: 'New this period', dir: 1 };
  const pct = ((now - before) / before) * 100;
  const rounded = Math.round(pct);
  return { text: `${rounded > 0 ? '+' : ''}${rounded}%`, dir: Math.sign(rounded) };
}

function pts(diff: number): string {
  const v = Math.round(diff * 100);
  return `${v > 0 ? '+' : ''}${v}`;
}

function formatRange(from: string, to: string): string {
  const f = new Date(`${from}T12:00:00`);
  const t = new Date(`${to}T12:00:00`);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${f.toLocaleDateString('en-GB', opts)} – ${t.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`;
}

function Kpi({
  icon,
  label,
  value,
  delta,
  hint,
  emphasis,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | null;
  delta: Delta;
  hint: string;
  emphasis?: boolean;
}) {
  const up = delta && delta.dir > 0;
  const down = delta && delta.dir < 0;
  return (
    <View style={[styles.kpi, emphasis && styles.kpiEmphasis]}>
      <View style={styles.kpiHead}>
        <Ionicons name={icon} size={16} color={emphasis ? colors.orangeDark : colors.textMuted} />
        <Text style={styles.kpiLabel}>{label}</Text>
      </View>
      {value == null ? <View style={styles.kpiSkeleton} /> : <Text style={styles.kpiValue}>{value}</Text>}
      {delta && (
        <View style={styles.delta}>
          <Ionicons
            name={up ? 'arrow-up' : down ? 'arrow-down' : 'remove'}
            size={12}
            color={up ? colors.success : down ? colors.danger : colors.textFaint}
          />
          <Text style={[styles.deltaText, up && { color: colors.success }, down && { color: colors.danger }]}>
            {delta.text}
          </Text>
          <Text style={styles.deltaVs}>vs previous</Text>
        </View>
      )}
      <Text style={styles.kpiHint}>{hint}</Text>
    </View>
  );
}

function FulfilStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <View style={styles.fulfilStat}>
      <Text style={[styles.fulfilValue, warn && { color: colors.orangeDark }]}>{value}</Text>
      <Text style={styles.fulfilLabel}>{label}</Text>
    </View>
  );
}

/** The same numbers as the charts, for anyone who would rather read than look. */
function TrendTable({ buckets, unit }: { buckets: AnalyticsBucket[]; unit: string }) {
  const rows = [...buckets].reverse();
  return (
    <View>
      <View style={[styles.tr, styles.th]}>
        <Text style={[styles.td, styles.thText, styles.tdWide]}>{unit}</Text>
        <Text style={[styles.td, styles.thText]}>Quotes</Text>
        <Text style={[styles.td, styles.thText]}>Orders</Text>
        <Text style={[styles.td, styles.thText, styles.tdMoney]}>Revenue</Text>
      </View>
      {rows.map((b) => (
        <View key={b.key} style={styles.tr}>
          <Text style={[styles.td, styles.tdWide]}>{b.title}</Text>
          <Text style={styles.td}>{b.quotes}</Text>
          <Text style={styles.td}>{b.orders}</Text>
          <Text style={[styles.td, styles.tdMoney]}>{formatNaira(b.revenue)}</Text>
        </View>
      ))}
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.navy} />
    </View>
  );
}

const styles = StyleSheet.create({
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  kpi: {
    flexGrow: 1,
    flexBasis: 200,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 6,
    ...shadow.card,
  },
  kpiEmphasis: { borderColor: colors.orange },
  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kpiLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  kpiValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  kpiSkeleton: { height: 30, width: 90, borderRadius: radius.sm, backgroundColor: colors.border },
  kpiHint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 15 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deltaText: { fontSize: font.sm, fontWeight: '800', color: colors.textFaint },
  deltaVs: { fontSize: font.xs, color: colors.textFaint },

  grid: { gap: 0 },
  gridWide: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  gridMain: { flex: 3, minWidth: 0 },
  gridSide: { flex: 2, minWidth: 0 },

  panelBody: { padding: spacing.lg, gap: spacing.sm },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  muted: { fontSize: font.sm, color: colors.textFaint },
  loading: { paddingVertical: spacing.xl, alignItems: 'center' },

  school: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  schoolBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rank: { width: 20, fontSize: font.md, fontWeight: '800', color: colors.textFaint, textAlign: 'center' },
  schoolMain: { flex: 1, minWidth: 0 },
  schoolName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  schoolValue: { fontSize: font.md, fontWeight: '800', color: colors.text },

  fulfil: { flexDirection: 'row', gap: spacing.sm },
  fulfilStat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  fulfilValue: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  fulfilLabel: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600' },

  tr: { flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.xs },
  thText: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, textTransform: 'uppercase' },
  td: { flex: 1, fontSize: font.sm, color: colors.text, paddingHorizontal: spacing.xs },
  tdWide: { flex: 2 },
  tdMoney: { flex: 1.4, textAlign: 'right' },
});
