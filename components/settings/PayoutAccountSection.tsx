import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Section, Field, SaveButton, Note } from './SettingsControls';
import { BankPicker } from '../vendor/BankPicker';
import {
  loadBankAccount,
  saveVendorBankAccount,
  type VendorBankAccount,
} from '../../lib/vendorKyc';
import { maskAccountNumber } from '../../hooks/useVendorPayouts';
import type { SaveState } from '../../hooks/useSettings';
import { colors, spacing, radius, font } from '../../theme';

/**
 * Where LOCI sends the shop's money.
 *
 * The same record the Payouts page edits (vendor_bank_accounts), through
 * the same save function — this is a second door to one room, not a
 * second room. Saved details are shown masked and never prefilled back
 * into the form: changing them means typing the whole number again,
 * which is also a second look at every digit.
 */
export function PayoutAccountSection({ vendorId }: { vendorId: string | null }) {
  if (!vendorId) {
    return (
      <Section title="Payout Account" caption="The bank account LOCI pays your earnings into" icon="card-outline">
        <Note>
          Save your Shop Details above first. Payouts go to your shop, so bank details can be added as soon as
          the shop is saved.
        </Note>
      </Section>
    );
  }
  return <PayoutAccountForm vendorId={vendorId} />;
}

function PayoutAccountForm({ vendorId }: { vendorId: string }) {
  const [bank, setBank] = useState<VendorBankAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);

  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await loadBankAccount(vendorId);
      setBank(b);
      setEditing(!b);
      setMissing(false);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (['42P01', 'PGRST205'].includes(code)) setMissing(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit() {
    setAccountName(bank?.account_name ?? '');
    setBankName(bank?.bank_name ?? '');
    setBankCode(bank?.bank_code ?? null);
    setAccountNumber('');
    setPassword('');
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    setState('saving');
    const result = await saveVendorBankAccount(
      vendorId,
      { account_name: accountName, bank_name: bankName, bank_code: bankCode, account_number: accountNumber },
      password
    );
    if (!result.ok) {
      setState('error');
      setError(result.message);
      return;
    }
    setPassword('');
    setAccountNumber('');
    setState('saved');
    setTimeout(() => setState('idle'), 2200);
    await load();
  }

  const numberError =
    accountNumber.length > 0 && !/^[0-9]{10}$/.test(accountNumber) ? 'Exactly 10 digits.' : undefined;
  const canSave =
    accountName.trim().length >= 2 && bankName.trim().length >= 2 && /^[0-9]{10}$/.test(accountNumber) && !!password;

  return (
    <Section
      title="Payout Account"
      caption="The bank account LOCI pays your earnings into"
      icon="card-outline"
      footer={
        editing && !missing ? (
          <View style={styles.footer}>
            {!!bank && (
              <Pressable
                onPress={() => {
                  setEditing(false);
                  setError(null);
                }}
                style={styles.cancel}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            )}
            <SaveButton onPress={save} state={state} disabled={!canSave} />
          </View>
        ) : undefined
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.navy} />
      ) : missing ? (
        <Note tone="warning">Bank details are stored by bookshops_payouts.sql, which has not been run on this database yet.</Note>
      ) : !editing && bank ? (
        <>
          <View style={styles.saved}>
            <View style={styles.savedIcon}>
              <Ionicons name="business-outline" size={18} color={colors.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.savedBank}>{bank.bank_name}</Text>
              <Text style={styles.savedNumber}>{maskAccountNumber(bank.account_number)}</Text>
              <Text style={styles.savedName}>{bank.account_name}</Text>
            </View>
            <View style={[styles.badge, bank.verified_at ? styles.badgeOk : styles.badgeWait]}>
              <Ionicons
                name={bank.verified_at ? 'checkmark-circle' : 'time-outline'}
                size={12}
                color={bank.verified_at ? colors.success : colors.warning}
              />
              <Text style={[styles.badgeText, { color: bank.verified_at ? colors.success : colors.warning }]}>
                {bank.verified_at ? 'Confirmed' : 'Awaiting check'}
              </Text>
            </View>
          </View>
          <Text style={styles.hint}>
            {bank.verified_at
              ? 'LOCI has confirmed this account. Changing it sends it back for checking before your next payout.'
              : 'LOCI checks the account holder name against your ID before the first payout.'}
          </Text>
          <Pressable onPress={startEdit} style={styles.change} accessibilityRole="button">
            <Ionicons name="create-outline" size={15} color={colors.navy} />
            <Text style={styles.changeText}>Change bank details</Text>
          </Pressable>
        </>
      ) : (
        <>
          {!bank && (
            <Note>Add the account you want your earnings paid into. You cannot request a payout without one.</Note>
          )}
          <BankPicker
            label="Bank"
            value={bankName}
            onChange={(name, code) => {
              setBankName(name);
              setBankCode(code);
            }}
            disabled={state === 'saving'}
            hint={bankName && !bankCode ? 'We will add this bank’s transfer code when your account is checked.' : undefined}
          />
          <Field
            label="Account number (NUBAN)"
            value={accountNumber}
            onChangeText={(t) => setAccountNumber(t.replace(/[^0-9]/g, '').slice(0, 10))}
            placeholder="10 digits"
            keyboardType="number-pad"
            maxLength={10}
            error={numberError}
            hint={bank ? 'Type the full number again — the saved one is not shown.' : undefined}
          />
          <Field
            label="Account name"
            value={accountName}
            onChangeText={setAccountName}
            placeholder="As it appears at your bank"
            hint="Should match the name on your ID or your registered business."
          />
          <Field
            label="Your password"
            value={password}
            onChangeText={setPassword}
            placeholder="Confirm it’s you"
            secureTextEntry
            autoCapitalize="none"
            hint="Needed to change where your money goes."
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  cancel: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  cancelText: { fontSize: font.md, fontWeight: '600', color: colors.textMuted },

  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  savedIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedBank: { fontSize: font.md, fontWeight: '700', color: colors.text },
  savedNumber: { fontSize: font.md, color: colors.text, letterSpacing: 1, marginTop: 1 },
  savedName: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeOk: { backgroundColor: '#E4F2E8' },
  badgeWait: { backgroundColor: colors.warningBg },
  badgeText: { fontSize: font.xs, fontWeight: '800' },

  hint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },
  change: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  changeText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  error: { fontSize: font.sm, color: colors.danger },
});
