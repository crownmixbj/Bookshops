import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/admin/AdminShell';
import { Skeleton, StatCard, StatusBadge } from '../../components/vendor/PayoutParts';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import { useAdminFinance, formatNuban, type PayoutQueueRow } from '../../hooks/useAdminFinance';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * Financials & Payments — the platform side of the money.
 *
 * Nothing here moves funds. Approving a payout marks it `processing`,
 * which is a signal to whoever runs the bank transfer; marking it paid
 * records that the transfer happened. Every one of those writes goes
 * through admin_set_payout_status(), which logs to admin_actions in the
 * same transaction — an admin cannot settle a payout without a trace.
 */
export default function AdminPaymentsScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role } = useShell();
  const { summary, queue, loading, migration, error, refresh, setStatus } = useAdminFinance();

  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? queue.filter(
            (r) =>
              r.store_name.toLowerCase().includes(q) ||
              r.reference.toLowerCase().includes(q) ||
              (r.bank_name ?? '').toLowerCase().includes(q) ||
              (r.account_number ?? '').includes(q)
          )
        : queue,
    [queue, q]
  );

  if (role !== 'admin') {
    return (
      <View style={styles.gate}>
        <Ionicons name="lock-closed-outline" size={30} color={colors.textFaint} />
        <Text style={styles.gateTitle}>This area is for administrators</Text>
        <Text style={styles.gateBody}>Platform financials are part of the admin console.</Text>
        <Pressable onPress={() => router.replace('/')} style={styles.gateBtn} accessibilityRole="button">
          <Text style={styles.gateBtnText}>Back to my dashboard</Text>
        </Pressable>
      </View>
    );
  }

  async function act(row: PayoutQueueRow, next: 'processing' | 'pending' | 'completed') {
    setBusyId(row.id);
    setNotice(null);
    const result = await setStatus(row.id, next);
    setBusyId(null);
    setNotice(
      result.ok
        ? next === 'processing'
          ? `${row.reference} approved — transfer ${formatNaira(row.amount)} to ${row.store_name}.`
          : next === 'completed'
            ? `${row.reference} marked paid.`
            : `${row.reference} put back on hold.`
        : (result.message ?? 'Could not update that payout.')
    );
  }

  if (migration === 'missing') {
    return (
      <ScrollView contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}>
        <View style={styles.setup}>
          <Ionicons name="server-outline" size={26} color={colors.warning} />
          <Text style={styles.setupTitle}>Financials are not set up yet</Text>
          <Text style={styles.setupBody}>
            This page reads two functions that do not exist in your database yet. Run{' '}
            <Text style={styles.code}>bookshops_payouts.sql</Text> and then{' '}
            <Text style={styles.code}>bookshops_admin_finance.sql</Text> in the Supabase SQL
            editor, in that order. Until then there is no balance to show, so this page shows
            none rather than four zeroes.
          </Text>
          <Pressable onPress={refresh} style={styles.setupBtn} accessibilityRole="button">
            <Text style={styles.setupBtnText}>Check again</Text>
          </Pressable>
        </View>
        <Footer audience="admin" />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>Financials & Payments</Text>
        <Text style={styles.h2}>Marketplace money, and what is waiting to be paid out</Text>
      </View>

      {!!error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      )}
      {!!notice && (
        <View style={styles.notice}>
          <Ionicons name="information-circle" size={16} color={colors.navy} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <View style={styles.cards}>
        <StatCard label="Gross Merchandise Value" value={summary?.gmv ?? 0}
          hint="All paid orders" icon="trending-up-outline" loading={loading} />
        <StatCard label="Platform Revenue" value={summary?.platform_revenue ?? 0}
          hint={
            summary && summary.commission_rate === 0
              ? 'Commission is set to 0% — set a rate in payout_settings'
              : `${((summary?.commission_rate ?? 0) * 100).toFixed(1)}% of GMV`
          }
          icon="cash-outline" loading={loading} emphasis />
        <StatCard label="Escrow Funds" value={summary?.escrow ?? 0}
          hint="Paid, not yet delivered" icon="lock-closed-outline" loading={loading} />
        <StatCard label="Pending Payouts" value={summary?.pending_payouts ?? 0}
          hint="Requested by vendors" icon="hourglass-outline" loading={loading} />
      </View>

      <Panel
        title="Vendor Payout Queue"
        right={
          <View style={styles.searchBox}>
            <Ionicons name="search" size={14} color={colors.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Shop, reference, bank or NUBAN"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              accessibilityLabel="Filter payouts"
            />
          </View>
        }
      >
        {loading ? (
          <View style={styles.body}>
            <Skeleton width="100%" height={18} />
            <Skeleton width="85%" height={18} />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.body}>
            <Text style={styles.empty}>
              {queue.length === 0
                ? 'No payout requests yet. They appear here the moment a shop asks to withdraw.'
                : `Nothing matches “${search.trim()}”.`}
            </Text>
          </View>
        ) : (
          <View>
            {!isMobile && (
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.cell, styles.cShop, styles.thText]}>Vendor</Text>
                <Text style={[styles.cell, styles.cDate, styles.thText]}>Requested</Text>
                <Text style={[styles.cell, styles.cAmt, styles.thText]}>Amount</Text>
                <Text style={[styles.cell, styles.cBank, styles.thText]}>Bank & NUBAN</Text>
                <Text style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
                <Text style={[styles.cell, styles.cAct, styles.thText]}>Action</Text>
              </View>
            )}

            {visible.map((row) => {
              const actions = (
                <View style={styles.actions}>
                  {row.status === 'pending' && (
                    <Pressable
                      onPress={() => act(row, 'processing')}
                      disabled={busyId === row.id}
                      style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Approve payout ${row.reference}`}
                    >
                      <Text style={styles.btnGoText}>Approve</Text>
                    </Pressable>
                  )}
                  {row.status === 'processing' && (
                    <>
                      <Pressable
                        onPress={() => act(row, 'completed')}
                        disabled={busyId === row.id}
                        style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Mark ${row.reference} paid`}
                      >
                        <Text style={styles.btnGoText}>Mark paid</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => act(row, 'pending')}
                        disabled={busyId === row.id}
                        style={({ pressed }) => [styles.btn, styles.btnHold, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Hold ${row.reference}`}
                      >
                        <Text style={styles.btnHoldText}>Hold</Text>
                      </Pressable>
                    </>
                  )}
                  {(row.status === 'completed' || row.status === 'failed') && (
                    <Text style={styles.settled}>
                      {row.processed_at
                        ? new Date(row.processed_at).toLocaleDateString('en-NG')
                        : '—'}
                    </Text>
                  )}
                </View>
              );

              return isMobile ? (
                <View key={row.id} style={styles.mRow}>
                  <View style={styles.mTop}>
                    <Text style={styles.mShop} numberOfLines={1}>{row.store_name}</Text>
                    <StatusBadge status={row.status} />
                  </View>
                  <Text style={styles.mAmount}>{formatNaira(row.amount)}</Text>
                  <Text style={styles.mMeta}>
                    {row.bank_name ?? 'No bank on file'} · {formatNuban(row.account_number)}
                  </Text>
                  <Text style={styles.mMeta}>
                    {new Date(row.requested_at).toLocaleDateString('en-NG')} · {row.reference}
                  </Text>
                  {!!row.failure_reason && <Text style={styles.failure}>{row.failure_reason}</Text>}
                  {actions}
                </View>
              ) : (
                <View key={row.id} style={styles.tr}>
                  <Text style={[styles.cell, styles.cShop]} numberOfLines={1}>{row.store_name}</Text>
                  <Text style={[styles.cell, styles.cDate]}>
                    {new Date(row.requested_at).toLocaleDateString('en-NG')}
                  </Text>
                  <Text style={[styles.cell, styles.cAmt, styles.amt]}>{formatNaira(row.amount)}</Text>
                  <View style={styles.cBank}>
                    <Text style={styles.bankName} numberOfLines={1}>
                      {row.bank_name ?? 'No bank on file'}
                    </Text>
                    <Text style={styles.nuban}>{formatNuban(row.account_number)}</Text>
                  </View>
                  <View style={styles.cStatus}><StatusBadge status={row.status} /></View>
                  <View style={styles.cAct}>{actions}</View>
                </View>
              );
            })}
          </View>
        )}
      </Panel>

      <Panel title="Platform Transaction Ledger">
        <View style={styles.body}>
          <View style={styles.ledgerNote}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
            <Text style={styles.ledgerText}>
              A per-transaction ledger needs a row for each customer payment and its fee split.
              Nothing writes those yet — orders record an amount, but no payment processor is
              connected, so there are no settlement records to list. The payout queue above is
              the real money movement today. Wire up Paystack and this becomes the natural place
              for its webhook to land.
            </Text>
          </View>
        </View>
      </Panel>

      <Footer audience="admin" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },
  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginBottom: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.md },
  empty: { fontSize: font.sm, color: colors.textFaint },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, height: 32, minWidth: 200,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: font.sm, color: colors.text },

  th: { backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.border },
  thText: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, textTransform: 'uppercase' },
  tr: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cell: { fontSize: font.md, color: colors.text },
  cShop: { flex: 1.4 },
  cDate: { flex: 1 },
  cAmt: { flex: 1 },
  cBank: { flex: 1.6 },
  cStatus: { flex: 0.9, alignItems: 'flex-start' },
  cAct: { flex: 1.3, alignItems: 'flex-start' },
  amt: { fontWeight: '700' },
  bankName: { fontSize: font.sm, color: colors.text },
  nuban: { fontSize: font.sm, color: colors.textMuted, letterSpacing: 0.5 },

  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  btn: { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1 },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  btnHold: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  btnHoldText: { color: colors.textMuted, fontSize: font.sm, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  settled: { fontSize: font.sm, color: colors.textFaint },

  mRow: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 4,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  mTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  mShop: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  mAmount: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  mMeta: { fontSize: font.sm, color: colors.textMuted },
  failure: { fontSize: font.xs, color: colors.danger },

  ledgerNote: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  ledgerText: { flex: 1, fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },

  errorBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: '#FDF2F1', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  notice: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.text },

  setup: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.xl, gap: spacing.md, alignItems: 'flex-start',
  },
  setupTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  setupBody: { fontSize: font.md, color: colors.textMuted, lineHeight: 21 },
  code: { fontWeight: '700', color: colors.text },
  setupBtn: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  setupBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBody: { fontSize: font.md, color: colors.textMuted, textAlign: 'center' },
  gateBtn: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.sm },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
});
