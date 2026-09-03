import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/vendor/VendorShell';
import { Skeleton, StatCard, StatusBadge, ThresholdBar } from '../../components/vendor/PayoutParts';
import { BankPicker } from '../../components/vendor/BankPicker';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import { useVendorPayouts, maskAccountNumber } from '../../hooks/useVendorPayouts';
import { exportPayoutStatement } from '../../lib/statement';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * Vendor payouts.
 *
 * Nothing on this page moves money. It shows what the marketplace owes,
 * records where the shop wants it sent, and files a withdrawal request
 * for a human to process. When Paystack transaction splits are wired up,
 * settlement rows land in payout_requests the same way and this screen
 * does not change — which is the point of keeping the bank form and the
 * balance maths on opposite sides of the RPC boundary.
 */
export default function VendorPayoutsScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role } = useShell();
  const { summary, history, bank, loading, migration, error, refresh, saveBankAccount, requestPayout } =
    useVendorPayouts();

  const [editingBank, setEditingBank] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  if (role !== 'vendor') {
    return (
      <View style={styles.gate}>
        <Ionicons name="lock-closed-outline" size={30} color={colors.textFaint} />
        <Text style={styles.gateTitle}>This area is for bookshops</Text>
        <Text style={styles.gateBody}>Payouts are part of the vendor console.</Text>
        <Pressable onPress={() => router.replace('/')} style={styles.gateBtn} accessibilityRole="button">
          <Text style={styles.gateBtnText}>Back to my dashboard</Text>
        </Pressable>
      </View>
    );
  }

  function openBankForm() {
    setAccountName(bank?.account_name ?? '');
    setBankName(bank?.bank_name ?? '');
    setBankCode(bank?.bank_code ?? null);
    // Never prefilled. The saved number is not redisplayed, so changing
    // it means typing it again in full — which is also a second chance
    // to notice a wrong digit.
    setAccountNumber('');
    setPassword('');
    setFormError(null);
    setEditingBank(true);
  }

  async function handleSaveBank() {
    if (!accountName.trim() || !bankName.trim()) return setFormError('Fill in the name and the bank.');
    if (!/^[0-9]{10}$/.test(accountNumber.trim()))
      return setFormError('A Nigerian account number is exactly 10 digits.');
    if (!password) return setFormError('Enter your password to confirm this change.');

    setSaving(true);
    setFormError(null);
    const result = await saveBankAccount(
      { account_name: accountName, bank_name: bankName, account_number: accountNumber, bank_code: bankCode ?? undefined },
      password
    );
    setSaving(false);
    if (!result.ok) return setFormError(result.message ?? 'Could not save your bank details.');
    setEditingBank(false);
    setPassword('');
    setNotice('Bank details saved.');
  }

  async function handleRequestPayout() {
    setRequesting(true);
    setNotice(null);
    const result = await requestPayout();
    setRequesting(false);
    setNotice(result.ok ? 'Payout requested. You will be paid within 3 working days.' : (result.message ?? 'Could not request a payout.'));
  }

  // ---- the migration has not been run -------------------------------
  if (migration === 'missing') {
    return (
      <ScrollView contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}>
        <View style={styles.setup}>
          <Ionicons name="server-outline" size={26} color={colors.warning} />
          <Text style={styles.setupTitle}>Payouts are not set up yet</Text>
          <Text style={styles.setupBody}>
            This page reads from three tables that do not exist in your database yet. Run{' '}
            <Text style={styles.code}>bookshops_payouts.sql</Text> in the Supabase SQL editor, then
            reload. Nothing here shows a number until it can read a real one.
          </Text>
          <Pressable onPress={refresh} style={styles.setupBtn} accessibilityRole="button">
            <Text style={styles.setupBtnText}>Check again</Text>
          </Pressable>
        </View>
        <Footer audience="vendor" />
      </ScrollView>
    );
  }

  const balance = summary?.available_balance ?? 0;
  const minimum = summary?.minimum_amount ?? 0;
  const belowThreshold = !loading && !!summary && balance < minimum;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>Payments & Payouts</Text>
        <Text style={styles.h2}>What you have earned, and where it goes</Text>
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

      {/* ---- summary ------------------------------------------------ */}
      <View style={styles.cards}>
        <StatCard
          label="Total Revenue"
          value={summary?.total_revenue ?? 0}
          hint="Delivered and paid orders"
          icon="trending-up-outline"
          loading={loading}
        />
        <StatCard
          label="Available Balance"
          value={balance}
          hint="Ready to withdraw"
          icon="wallet-outline"
          loading={loading}
          emphasis
        />
        <StatCard
          label="Pending Payouts"
          value={summary?.pending_payouts ?? 0}
          hint="Requested, not yet paid"
          icon="hourglass-outline"
          loading={loading}
        />
      </View>

      {/* ---- withdraw ------------------------------------------------ */}
      <Panel title="Withdraw">
        <View style={styles.panelBody}>
          {loading ? (
            <Skeleton width="100%" height={44} />
          ) : (
            <>
              {belowThreshold && <ThresholdBar balance={balance} minimum={minimum} />}

              {!summary?.has_bank_account && (
                <Text style={styles.blocked}>
                  Add your bank details below before you can request a payout.
                </Text>
              )}

              <Pressable
                onPress={handleRequestPayout}
                disabled={!summary?.can_request || requesting}
                style={({ pressed }) => [
                  styles.cta,
                  (!summary?.can_request || requesting) && styles.ctaDisabled,
                  pressed && summary?.can_request && styles.ctaPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !summary?.can_request, busy: requesting }}
                accessibilityLabel="Request payout"
              >
                <Ionicons
                  name="cash-outline"
                  size={17}
                  color={summary?.can_request ? colors.onNavy : '#6B7A94'}
                />
                <Text style={[styles.ctaText, !summary?.can_request && styles.ctaTextDisabled]}>
                  {requesting
                    ? 'Requesting…'
                    : summary?.can_request
                      ? `Request payout of ${formatNaira(balance)}`
                      : 'Request Payout'}
                </Text>
              </Pressable>

              <Text style={styles.ctaNote}>
                Payouts are processed by hand today, within 3 working days. The minimum exists
                because a bank transfer fee would eat a small balance.
              </Text>
            </>
          )}
        </View>
      </Panel>

      {/* ---- bank details ------------------------------------------- */}
      <Panel
        title="Bank Account"
        right={
          !editingBank && !loading ? (
            <Pressable onPress={openBankForm} hitSlop={6} accessibilityRole="button">
              <Text style={styles.link}>{bank ? 'Update' : 'Add details'}</Text>
            </Pressable>
          ) : undefined
        }
      >
        <View style={styles.panelBody}>
          {loading ? (
            <Skeleton width="70%" height={40} />
          ) : editingBank ? (
            <>
              <Field label="Account holder name" value={accountName} onChangeText={setAccountName} placeholder="As it appears at your bank" />
              <BankPicker
                label="Bank"
                value={bankName}
                onChange={(name, code) => {
                  setBankName(name);
                  setBankCode(code);
                }}
                disabled={saving}
                hint={
                  bankName && !bankCode
                    ? "We don't have this bank's transfer code on file — it will be filled in when your account is checked."
                    : undefined
                }
              />
              <Field
                label="Account number"
                value={accountNumber}
                onChangeText={(v) => setAccountNumber(v.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="10 digits"
                keyboardType="number-pad"
                hint="Nigerian NUBAN. We never show this in full once saved."
              />
              <Field
                label="Your password"
                value={password}
                onChangeText={setPassword}
                placeholder="Confirm it's you"
                secureTextEntry
                hint="Changing where money is sent needs your password."
              />

              {!!formError && <Text style={styles.formError}>{formError}</Text>}

              <View style={[styles.row, isMobile && styles.rowStacked]}>
                <Pressable
                  onPress={handleSaveBank}
                  disabled={saving}
                  style={({ pressed }) => [styles.saveBtn, saving && styles.ctaDisabled, pressed && styles.ctaPressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save bank details'}</Text>
                </Pressable>
                <Pressable onPress={() => setEditingBank(false)} style={styles.cancelBtn} accessibilityRole="button">
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          ) : bank ? (
            <>
              <Text style={styles.bankName}>{bank.account_name}</Text>
              <Text style={styles.bankLine}>{bank.bank_name}</Text>
              <Text style={styles.bankNumber}>{maskAccountNumber(bank.account_number)}</Text>
              <View style={styles.verifyRow}>
                <Ionicons
                  name={bank.verified_at ? 'checkmark-circle' : 'alert-circle-outline'}
                  size={14}
                  color={bank.verified_at ? colors.success : colors.warning}
                />
                <Text style={styles.verifyText}>
                  {bank.verified_at
                    ? 'Name confirmed with the bank'
                    : 'Not yet confirmed with the bank — check the digits carefully'}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.empty}>No bank account saved. Add one to get paid.</Text>
          )}
        </View>
      </Panel>

      {/* ---- history -------------------------------------------------- */}
      <Panel
        title="Payout History"
        right={
          history.length > 0 ? (
            <Pressable
              onPress={() => exportPayoutStatement(history)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Download CSV statement"
            >
              <Text style={styles.link}>Download CSV</Text>
            </Pressable>
          ) : undefined
        }
      >
        {loading ? (
          <View style={styles.panelBody}>
            <Skeleton width="100%" height={18} />
            <Skeleton width="90%" height={18} />
          </View>
        ) : history.length === 0 ? (
          <View style={styles.panelBody}>
            <Text style={styles.empty}>No payouts yet. Your first one will be listed here.</Text>
          </View>
        ) : (
          <View>
            {!isMobile && (
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.cell, styles.cDate, styles.thText]}>Date</Text>
                <Text style={[styles.cell, styles.cAmount, styles.thText]}>Amount</Text>
                <Text style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
                <Text style={[styles.cell, styles.cRef, styles.thText]}>Reference</Text>
              </View>
            )}
            {history.map((p) =>
              isMobile ? (
                <View key={p.id} style={styles.mobileRow}>
                  <View style={styles.mobileTop}>
                    <Text style={styles.mobileAmount}>{formatNaira(p.amount)}</Text>
                    <StatusBadge status={p.status} />
                  </View>
                  <Text style={styles.mobileMeta}>
                    {new Date(p.requested_at).toLocaleDateString('en-NG')} · {p.reference}
                  </Text>
                  {!!p.failure_reason && <Text style={styles.failure}>{p.failure_reason}</Text>}
                </View>
              ) : (
                <View key={p.id} style={styles.tr}>
                  <Text style={[styles.cell, styles.cDate]}>
                    {new Date(p.requested_at).toLocaleDateString('en-NG')}
                  </Text>
                  <Text style={[styles.cell, styles.cAmount, styles.amountText]}>
                    {formatNaira(p.amount)}
                  </Text>
                  <View style={styles.cStatus}>
                    <StatusBadge status={p.status} />
                  </View>
                  <Text style={[styles.cell, styles.cRef]} numberOfLines={1}>
                    {p.reference}
                  </Text>
                </View>
              )
            )}
          </View>
        )}
      </Panel>

      <Footer audience="vendor" />
    </ScrollView>
  );
}

function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'number-pad';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        style={styles.input}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        accessibilityLabel={label}
      />
      {!!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginBottom: spacing.lg },
  panelBody: { padding: spacing.lg, gap: spacing.md },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.lg,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaDisabled: { backgroundColor: '#E3E9F2' },
  ctaText: { fontSize: font.lg, fontWeight: '700', color: colors.onNavy },
  ctaTextDisabled: { color: '#6B7A94' },
  ctaNote: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },
  blocked: { fontSize: font.sm, color: colors.warning, fontWeight: '600' },

  link: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  field: { gap: 5 },
  fieldLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    fontSize: font.md,
    color: colors.text,
  },
  fieldHint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 15 },
  formError: { fontSize: font.sm, color: colors.danger },

  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  saveBtn: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  cancelBtn: { paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center' },
  cancelBtnText: { color: colors.textMuted, fontWeight: '600', fontSize: font.md },

  bankName: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  bankLine: { fontSize: font.md, color: colors.textMuted },
  bankNumber: { fontSize: font.lg, color: colors.text, letterSpacing: 1.5, marginTop: 2 },
  verifyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  verifyText: { flex: 1, fontSize: font.xs, color: colors.textMuted },

  empty: { fontSize: font.sm, color: colors.textFaint },

  th: { backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.border },
  thText: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, textTransform: 'uppercase' },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cell: { fontSize: font.md, color: colors.text },
  cDate: { flex: 1.1 },
  cAmount: { flex: 1 },
  cStatus: { flex: 1, alignItems: 'flex-start' },
  cRef: { flex: 1.4, color: colors.textMuted, fontSize: font.sm },
  amountText: { fontWeight: '700' },

  mobileRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  mobileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mobileAmount: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  mobileMeta: { fontSize: font.sm, color: colors.textMuted },
  failure: { fontSize: font.xs, color: colors.danger },

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
