import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ID_TYPES, signKycDocument, type VendorIdentity } from '../../lib/vendorKyc';
import { formatBytes, isPdf } from '../../lib/quoteFiles';
import { colors, spacing, radius, font } from '../../theme';

type Result = { ok: boolean; message?: string };

/**
 * The owner's ID as the shop submitted it, and the admin's decision.
 *
 * Verifying here is the only way a shop gets its Verified badge
 * (admin_review_identity). Approving the shop to trade is a separate
 * decision in the drawer's footer. Rejecting needs a note, because the
 * shop sees it in Settings and has to know what to fix.
 *
 * The full ID number is shown to the admin: matching it against the
 * document is the job. It is never shown to the shop again after saving.
 */
export function IdentityReview({
  identity,
  missing,
  accountName,
  onReview,
}: {
  identity: VendorIdentity | null;
  /** bookshops_vendor_identity.sql has not been run. */
  missing: boolean;
  /** The payout account holder name, for the reviewer to compare. */
  accountName: string | null;
  onReview: (verify: boolean, note: string | null) => Promise<Result>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (missing) {
    return (
      <Text style={styles.note}>
        Identity verification is stored by bookshops_vendor_identity.sql, which has not been run on this database.
      </Text>
    );
  }
  if (!identity) {
    return <Text style={styles.note}>This shop has not submitted an ID yet, so it cannot be verified.</Text>;
  }

  const typeLabel = ID_TYPES.find((t) => t.value === identity.id_type)?.label ?? identity.id_type;
  const nameMismatch =
    !!accountName && accountName.trim().toLowerCase() !== identity.legal_name.trim().toLowerCase();

  async function decide(verify: boolean) {
    setError(null);
    if (!verify && !note.trim()) {
      setError('Tell the shop what to fix — they see this note.');
      return;
    }
    setBusy(true);
    const r = await onReview(verify, verify ? null : note.trim());
    setBusy(false);
    if (!r.ok) setError(r.message ?? 'That did not work.');
    else {
      setRejecting(false);
      setNote('');
    }
  }

  const statusLook =
    identity.status === 'verified'
      ? { label: 'Verified', fg: colors.success, bg: '#E4F2E8' }
      : identity.status === 'rejected'
      ? { label: 'Rejected — waiting for the shop', fg: colors.danger, bg: '#FCEAE8' }
      : { label: 'Waiting for review', fg: colors.warning, bg: colors.warningBg };

  return (
    <View style={styles.wrap}>
      <View style={[styles.pill, { backgroundColor: statusLook.bg }]}>
        <Text style={[styles.pillText, { color: statusLook.fg }]}>{statusLook.label}</Text>
      </View>

      <Line label="ID type" value={typeLabel} />
      <Line label="ID number" value={identity.id_number} mono />
      <Line label="Name on ID" value={identity.legal_name} />
      <Line label="Submitted" value={new Date(identity.submitted_at).toLocaleString('en-NG')} />
      {nameMismatch && (
        <Text style={styles.warn}>
          Payout account name “{accountName}” does not match the name on the ID. Check before verifying.
        </Text>
      )}
      {!!identity.review_note && identity.status === 'rejected' && (
        <Text style={styles.note}>Last note to the shop: “{identity.review_note}”</Text>
      )}

      <Text style={styles.sub}>Documents</Text>
      {identity.documents.length === 0 ? (
        <Text style={styles.note}>No documents attached.</Text>
      ) : (
        identity.documents.map((d) => (
          <Pressable
            key={d.path}
            onPress={async () => {
              const url = await signKycDocument(d.path);
              if (url) Linking.openURL(url);
              else setError('Could not open that document.');
            }}
            style={({ pressed }) => [styles.doc, pressed && styles.pressed]}
            accessibilityRole="link"
            accessibilityLabel={`Open ${d.name}`}
          >
            <Ionicons name={isPdf(d.type) ? 'document-text-outline' : 'image-outline'} size={16} color={colors.navy} />
            <Text style={styles.docName} numberOfLines={1}>
              {d.name}
            </Text>
            <Text style={styles.docMeta}>{formatBytes(d.size)}</Text>
            <Ionicons name="open-outline" size={14} color={colors.textMuted} />
          </Pressable>
        ))
      )}

      {rejecting && (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What needs fixing? e.g. The NIN slip photo is blurry — please upload a clearer one."
          placeholderTextColor={colors.textFaint}
          multiline
          maxLength={500}
          style={styles.input}
          accessibilityLabel="Note to the shop"
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        {rejecting ? (
          <>
            <Pressable onPress={() => setRejecting(false)} style={styles.ghost} accessibilityRole="button">
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => decide(false)} disabled={busy} style={[styles.btn, styles.btnDanger]} accessibilityRole="button">
              {busy ? <ActivityIndicator size="small" color={colors.onNavy} /> : null}
              <Text style={styles.btnDangerText}>Send back to shop</Text>
            </Pressable>
          </>
        ) : (
          <>
            {identity.status !== 'rejected' && (
              <Pressable onPress={() => setRejecting(true)} style={styles.ghost} accessibilityRole="button">
                <Text style={styles.ghostText}>Reject…</Text>
              </Pressable>
            )}
            {identity.status !== 'verified' && (
              <Pressable onPress={() => decide(true)} disabled={busy} style={[styles.btn, styles.btnGo]} accessibilityRole="button">
                {busy ? (
                  <ActivityIndicator size="small" color={colors.onNavy} />
                ) : (
                  <Ionicons name="shield-checkmark" size={14} color={colors.onNavy} />
                )}
                <Text style={styles.btnGoText}>Verify identity</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, mono && styles.mono]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  pillText: { fontSize: font.xs, fontWeight: '800' },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  lineLabel: { fontSize: font.sm, color: colors.textMuted },
  lineValue: { fontSize: font.sm, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  mono: { letterSpacing: 1 },
  sub: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, textTransform: 'uppercase', marginTop: spacing.xs },
  note: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  warn: { fontSize: font.xs, color: colors.warning, lineHeight: 16 },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  docName: { flex: 1, fontSize: font.sm, color: colors.text, fontWeight: '600' },
  docMeta: { fontSize: font.xs, color: colors.textFaint },
  input: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: font.sm,
    color: colors.text,
    textAlignVertical: 'top',
  },
  error: { fontSize: font.sm, color: colors.danger },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
  },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnDangerText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  ghost: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' },
  ghostText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
});
