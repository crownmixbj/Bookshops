import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/admin/AdminShell';
import { MetricCard } from '../../components/admin/Sparkline';
import {
  useAdminDashboard,
  useAdminMetrics,
  trendFor,
  type AdminUserRow,
} from '../../hooks/useAdminDashboard';
import { useLayout } from '../../hooks/useLayout';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font, formatNaira } from '../../theme';
import type { ContentReport, Vendor } from '../../types/db';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Chip({ label, tone }: { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' }) {
  const t =
    tone === 'good'
      ? { bg: '#E4F2E8', fg: colors.success }
      : tone === 'warn'
      ? { bg: colors.warningBg, fg: colors.warning }
      : tone === 'bad'
      ? { bg: '#FCEAE8', fg: colors.danger }
      : { bg: colors.surfaceMuted, fg: colors.textMuted };
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

function IconBtn({
  icon,
  label,
  tone = 'default',
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: 'default' | 'good' | 'bad';
  busy?: boolean;
  onPress: () => void;
}) {
  const fg = tone === 'good' ? colors.success : tone === 'bad' ? colors.danger : colors.navy;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Ionicons name={icon} size={15} color={fg} />}
    </Pressable>
  );
}

export default function AdminDashboardScreen() {
  const { isMobile, isDesktop, contentPadding, width } = useLayout();
  // The search box lives in the shell's top bar so its text survives
  // navigation; this screen just reads what was typed.
  const { search } = useShell();

  const {
    isAdmin,
    stats,
    users,
    pendingVendors,
    reports,
    featured,
    activity,
    loading,
    working,
    error,
    refresh,
    setRole,
    setSuspended,
    reviewVendor,
    setFeatured,
    resolveReport,
  } = useAdminDashboard();

  const metrics = useAdminMetrics(stats);


  const q = search.trim().toLowerCase();
  const visibleUsers = useMemo(
    () =>
      q
        ? users.filter(
            (u) =>
              (u.full_name ?? '').toLowerCase().includes(q) ||
              (u.vendor?.store_name ?? '').toLowerCase().includes(q) ||
              u.role.includes(q)
          )
        : users,
    [users, q]
  );

  // ---- gate ---------------------------------------------------
  if (isAdmin === false) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.gate}>
          <Ionicons name="lock-closed-outline" size={34} color={colors.textFaint} />
          <Text style={styles.gateTitle}>Administrators only</Text>
          <Text style={styles.gateBody}>
            This console is limited to admin accounts. Even reaching this screen shows you
            nothing — the database refuses the queries behind it.
          </Text>
          <Pressable
            onPress={() => router.push('/')}
            style={({ pressed }) => [styles.gateBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.gateBtnText}>Back to my dashboard</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Three columns on desktop, one below that. The metric row wraps.
  const contentWidth = width - (isMobile ? 0 : 200) - contentPadding * 2;
  const metricWidth = isDesktop
    ? Math.max((contentWidth - spacing.md * 4) / 5, 180)
    : isMobile
    ? contentWidth
    : (contentWidth - spacing.md) / 2;

  return (
    <>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.h1}>Admin Summary</Text>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error.message}</Text>
              <Pressable onPress={refresh} hitSlop={6}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            </View>
          )}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : (
            <>
              {/* ---- metric row -------------------------------- */}
              <View style={styles.metrics}>
                {metrics.map((m) => (
                  <MetricCard
                    key={m.key}
                    label={m.label}
                    value={m.isMoney ? formatNaira(m.value) : String(m.value)}
                    series={m.series}
                    trend={trendFor(m.series)}
                    accent={m.key === 'revenue'}
                    width={metricWidth}
                  />
                ))}
              </View>

              {/* ---- three columns ----------------------------- */}
              <View style={[styles.columns, !isDesktop && styles.columnsStacked]}>
                {/* Left: activity feed */}
                <View style={styles.colLeft}>
                  <Panel title="Recent Platform Activity">
                    {activity.length === 0 ? (
                      <Text style={styles.empty}>Nothing has happened on the platform yet.</Text>
                    ) : (
                      <ScrollView style={styles.feed} nestedScrollEnabled>
                        {activity.map((a) => (
                          <View key={a.id} style={styles.feedRow}>
                            <View style={styles.feedIcon}>
                              <Ionicons
                                name={a.icon as keyof typeof Ionicons.glyphMap}
                                size={14}
                                color={colors.navy}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.feedText}>{a.text}</Text>
                              <Text style={styles.feedTime}>{timeAgo(a.at)}</Text>
                            </View>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </Panel>
                </View>

                {/* Middle: approvals + users */}
                <View style={styles.colMid}>
                  <Panel
                    title="Vendor Approval Queue"
                    right={<Chip label={`${pendingVendors.length} pending`} tone={pendingVendors.length ? 'warn' : 'muted'} />}
                  >
                    {pendingVendors.length === 0 ? (
                      <Text style={styles.empty}>No shops are waiting for review.</Text>
                    ) : (
                      pendingVendors.map((v: Vendor) => (
                        <View key={v.id} style={styles.tableRow}>
                          <View style={{ flex: 2 }}>
                            <Text style={styles.rowStrong} numberOfLines={1}>
                              {v.store_name}
                            </Text>
                            <Text style={styles.rowMuted} numberOfLines={1}>
                              {[v.city, v.phone].filter(Boolean).join(' · ') || 'No contact details'}
                            </Text>
                          </View>
                          <Text style={[styles.rowMuted, { flex: 1 }]}>
                            {new Date(v.created_at).toLocaleDateString('en-NG', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </Text>
                          <View style={styles.rowActions}>
                            <IconBtn
                              icon="checkmark"
                              label={`Approve ${v.store_name}`}
                              tone="good"
                              busy={working[`review:${v.id}`]}
                              onPress={() => reviewVendor(v.id, true)}
                            />
                            <IconBtn
                              icon="close"
                              label={`Reject ${v.store_name}`}
                              tone="bad"
                              busy={working[`review:${v.id}`]}
                              onPress={() => reviewVendor(v.id, false)}
                            />
                          </View>
                        </View>
                      ))
                    )}
                  </Panel>

                  <View style={{ height: spacing.lg }} />

                  <Panel
                    title="User Management"
                    right={<Text style={styles.count}>{visibleUsers.length} shown</Text>}
                  >
                    <ScrollView style={styles.userTable} nestedScrollEnabled>
                      {visibleUsers.map((u: AdminUserRow) => {
                        const suspended = Boolean(u.suspended_at);
                        const isAdminRow = u.role === 'admin';
                        return (
                          <View key={u.id} style={styles.tableRow}>
                            <View style={{ flex: 2 }}>
                              <Text style={styles.rowStrong} numberOfLines={1}>
                                {u.full_name?.trim() || 'Unnamed user'}
                              </Text>
                              <Text style={styles.rowMuted} numberOfLines={1}>
                                {u.vendor?.store_name ?? u.phone_number ?? '—'}
                              </Text>
                            </View>
                            <View style={styles.rowChips}>
                              <Chip
                                label={u.role}
                                tone={isAdminRow ? 'bad' : u.role === 'vendor' ? 'good' : 'muted'}
                              />
                              {suspended && <Chip label="Suspended" tone="bad" />}
                            </View>
                            <View style={styles.rowActions}>
                              {/* Admin rows carry no controls: the database
                                  refuses these actions on an admin, so
                                  offering them would only produce errors. */}
                              {isAdminRow ? (
                                <Text style={styles.protected}>protected</Text>
                              ) : (
                                <>
                                  <IconBtn
                                    icon={u.role === 'vendor' ? 'person-outline' : 'storefront-outline'}
                                    label={`Make ${u.full_name} a ${u.role === 'vendor' ? 'buyer' : 'vendor'}`}
                                    busy={working[`role:${u.id}`]}
                                    onPress={() => setRole(u.id, u.role === 'vendor' ? 'buyer' : 'vendor')}
                                  />
                                  <IconBtn
                                    icon={suspended ? 'lock-open-outline' : 'ban-outline'}
                                    label={suspended ? `Unsuspend ${u.full_name}` : `Suspend ${u.full_name}`}
                                    tone={suspended ? 'good' : 'bad'}
                                    busy={working[`susp:${u.id}`]}
                                    onPress={() =>
                                      setSuspended(u.id, !suspended, suspended ? undefined : 'Suspended from the admin console')
                                    }
                                  />
                                </>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </ScrollView>
                  </Panel>

                  <View style={{ height: spacing.lg }} />

                  <Panel title="Platform Health Monitor">
                    {/* Deliberately not a chart. Uptime and error rate are
                        infrastructure telemetry — nothing in this database
                        records them, and drawing a reassuring green line
                        from invented numbers would be worse than an empty
                        panel that says what it needs. */}
                    <View style={styles.health}>
                      <Ionicons name="pulse-outline" size={22} color={colors.textFaint} />
                      <Text style={styles.healthTitle}>Not connected</Text>
                      <Text style={styles.healthBody}>
                        Uptime and error rate come from infrastructure monitoring, not from
                        application tables — there is no source for them yet. Point a Supabase
                        log drain or an uptime probe at a `system_metrics` table and this panel
                        can plot it.
                      </Text>
                    </View>
                  </Panel>
                </View>

                {/* Right: moderation */}
                <View style={styles.colRight}>
                  <Panel
                    title="Flagged Content"
                    right={<Chip label={`${reports.length} open`} tone={reports.length ? 'warn' : 'muted'} />}
                  >
                    {reports.length === 0 ? (
                      <Text style={styles.empty}>Nothing has been reported.</Text>
                    ) : (
                      reports.map((r: ContentReport) => (
                        <View key={r.id} style={styles.reportRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowStrong}>{r.subject_type}</Text>
                            <Text style={styles.rowMuted} numberOfLines={2}>
                              {r.reason}
                            </Text>
                            <Text style={styles.feedTime}>{timeAgo(r.created_at)}</Text>
                          </View>
                          <View style={{ gap: 6 }}>
                            <Pressable
                              onPress={() => resolveReport(r.id, 'actioned')}
                              disabled={working[`rep:${r.id}`]}
                              style={({ pressed }) => [styles.reviewBtn, pressed && styles.pressed]}
                              accessibilityRole="button"
                            >
                              <Text style={styles.reviewBtnText}>Action</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => resolveReport(r.id, 'dismissed')}
                              disabled={working[`rep:${r.id}`]}
                              style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}
                              accessibilityRole="button"
                            >
                              <Text style={styles.dismissBtnText}>Dismiss</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))
                    )}
                  </Panel>

                  <View style={{ height: spacing.lg }} />

                  <Panel
                    title="Featured Promotions"
                    right={<Text style={styles.count}>{featured.length} featured</Text>}
                  >
                    <Text style={styles.panelIntro}>
                      Featured shops appear ahead of others in the marketplace.
                    </Text>
                    {users
                      .filter((u) => u.vendor && u.vendor.approval_status === 'approved')
                      .slice(0, 8)
                      .map((u) => {
                        const v = u.vendor!;
                        return (
                          <View key={v.id} style={styles.tableRow}>
                            <Text style={[styles.rowStrong, { flex: 1 }]} numberOfLines={1}>
                              {v.store_name}
                            </Text>
                            <IconBtn
                              icon={v.featured ? 'star' : 'star-outline'}
                              label={v.featured ? `Unfeature ${v.store_name}` : `Feature ${v.store_name}`}
                              tone={v.featured ? 'good' : 'default'}
                              busy={working[`feat:${v.id}`]}
                              onPress={() => setFeatured(v.id, !v.featured)}
                            />
                          </View>
                        );
                      })}
                    {users.filter((u) => u.vendor?.approval_status === 'approved').length === 0 && (
                      <Text style={styles.empty}>No approved shops to feature yet.</Text>
                    )}
                  </Panel>
                </View>
              </View>
            </>
          )}
          <Footer audience="admin" />
        </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  h1: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: spacing.lg },

  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },

  columns: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  columnsStacked: { flexDirection: 'column' },
  colLeft: { flex: 1.1, minWidth: 260 },
  colMid: { flex: 1.7, minWidth: 300 },
  colRight: { flex: 1.1, minWidth: 260 },

  feed: { maxHeight: 460 },
  feedRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  feedIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedText: { fontSize: font.sm, color: colors.text, lineHeight: 18 },
  feedTime: { fontSize: font.xs, color: colors.textFaint, marginTop: 2 },

  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userTable: { maxHeight: 420 },
  rowStrong: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  rowMuted: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  rowChips: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', flex: 1 },
  rowActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  protected: { fontSize: font.xs, color: colors.textFaint, fontStyle: 'italic' },

  chip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  chipText: { fontSize: font.xs, fontWeight: '700', textTransform: 'capitalize' },
  count: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600' },
  panelIntro: {
    fontSize: font.xs,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reportRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewBtn: {
    backgroundColor: colors.orange,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  reviewBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.xs },
  dismissBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  dismissBtnText: { color: colors.textMuted, fontWeight: '700', fontSize: font.xs },

  health: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  healthTitle: { fontSize: font.md, fontWeight: '700', color: colors.textMuted },
  healthBody: {
    fontSize: font.xs,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 360,
  },

  empty: { fontSize: font.sm, color: colors.textMuted, padding: spacing.lg },
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

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBody: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 400,
    lineHeight: 21,
  },
  gateBtn: {
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  pressed: { opacity: 0.85 },
});
