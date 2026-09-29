import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Section, Field, SaveButton, Note } from './SettingsControls';
import {
  ID_TYPES,
  MAX_KYC_DOCS,
  confirmPassword,
  idNumberError,
  loadIdentity,
  maskIdNumber,
  normaliseIdNumber,
  removeKycDocuments,
  signKycDocument,
  uploadKycDocument,
  type IdType,
  type VendorIdentity,
} from '../../lib/vendorKyc';
import {
  chooseResponseFiles,
  prepareResponseFile,
  releasePickedFile,
  isPdf,
  formatBytes,
  type PickedFile,
  type StoredFile,
} from '../../lib/quoteFiles';
import { supabase } from '../../utils/supabase';
import type { SaveState } from '../../hooks/useSettings';
import { colors, spacing, radius, font } from '../../theme';

/**
 * The owner's ID, for LOCI to verify the shop.
 *
 * Saving always sends it for review: the database resets the status on
 * any change (bookshops_vendor_identity.sql), and changing the ID behind
 * an already-verified shop takes the "Verified" badge off until an admin
 * has looked again. Only an administrator can mark it verified.
 *
 * The saved number is shown masked and never prefilled. Leaving the
 * number blank on a later save keeps the one on file.
 */

type Doc = { key: string; kind: 'stored'; file: StoredFile } | { key: string; kind: 'pending'; file: PickedFile };

const STATUS: Record<
  'none' | VendorIdentity['status'],
  { label: string; fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap; body: string }
> = {
  none: {
    label: 'Not submitted',
    fg: colors.textMuted,
    bg: colors.surfaceMuted,
    icon: 'shield-outline',
    body: 'Verified shops get a badge on their shop card and in search. Submit your ID to start.',
  },
  submitted: {
    label: 'Under review',
    fg: colors.warning,
    bg: colors.warningBg,
    icon: 'time-outline',
    body: 'LOCI is checking your details. This usually takes one working day.',
  },
  verified: {
    label: 'Verified',
    fg: colors.success,
    bg: '#E4F2E8',
    icon: 'shield-checkmark',
    body: 'Your identity has been confirmed. Buyers see a Verified badge on your shop.',
  },
  rejected: {
    label: 'Needs attention',
    fg: colors.danger,
    bg: '#FCEAE8',
    icon: 'alert-circle',
    body: 'LOCI could not verify these details. See the note below, correct them and save again.',
  },
};

let docSeq = 0;
const nextKey = () => `doc-${Date.now()}-${docSeq++}`;

export function IdentitySection({ vendorId, highlight }: { vendorId: string | null; highlight?: boolean }) {
  if (!vendorId) {
    return (
      <Section
        title="Identity Verification"
        caption="Confirm who owns this shop"
        icon="shield-checkmark-outline"
        highlight={highlight}
      >
        <Note>
          Save your Shop Details above first. Your ID is attached to your shop, so this form opens as soon as
          the shop is saved.
        </Note>
      </Section>
    );
  }
  return <IdentityForm vendorId={vendorId} highlight={highlight} />;
}

function IdentityForm({ vendorId, highlight }: { vendorId: string; highlight?: boolean }) {
  const [identity, setIdentity] = useState<VendorIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const [idType, setIdType] = useState<IdType>('nin');
  const [idNumber, setIdNumber] = useState('');
  const [legalName, setLegalName] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [picking, setPicking] = useState(false);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await loadIdentity(vendorId);
      setIdentity(row);
      setMissing(false);
      if (row) {
        setIdType(row.id_type);
        setLegalName(row.legal_name);
        setDocs(row.documents.map((file) => ({ key: nextKey(), kind: 'stored' as const, file })));
      }
      setIdNumber('');
      setRemoved([]);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (['42P01', 'PGRST205', 'PGRST202'].includes(code)) setMissing(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  const type = ID_TYPES.find((t) => t.value === idType) ?? ID_TYPES[0];
  // Blank keeps the number on file — but only for the same kind of ID.
  const keepingNumber = !!identity && idNumber === '' && identity.id_type === idType;
  const numberError = keepingNumber ? null : idNumberError(idType, idNumber);
  const status = STATUS[identity?.status ?? 'none'];
  const canSave =
    !numberError && legalName.trim().length >= 2 && docs.length > 0 && !!password && !picking && state !== 'saving';

  async function addDocuments() {
    setError(null);
    setPicking(true);
    try {
      const { files, rejected } = await chooseResponseFiles();
      const room = MAX_KYC_DOCS - docs.length;
      const ready: Doc[] = [];
      const problems = [...rejected];
      for (const f of files.slice(0, room)) {
        try {
          ready.push({ key: nextKey(), kind: 'pending', file: await prepareResponseFile(f) });
        } catch (e) {
          problems.push(`${f.fileName} ${(e as Error).message}`);
        }
      }
      if (files.length > room) problems.push(`Only ${MAX_KYC_DOCS} documents can be attached.`);
      setDocs((prev) => [...prev, ...ready]);
      if (problems.length) setError(problems.join(' '));
    } finally {
      setPicking(false);
    }
  }

  function removeDoc(doc: Doc) {
    setDocs((prev) => prev.filter((d) => d.key !== doc.key));
    if (doc.kind === 'stored') setRemoved((prev) => [...prev, doc.file.path]);
    else releasePickedFile(doc.file);
  }

  async function view(doc: Doc) {
    if (doc.kind === 'pending') return;
    const url = await signKycDocument(doc.file.path);
    if (url) Linking.openURL(url);
    else setError('Could not open that document. Try again in a moment.');
  }

  async function save() {
    setTouched(true);
    setError(null);
    if (!canSave) {
      setError(
        docs.length === 0
          ? 'Attach a photo or scan of your ID.'
          : !password
          ? 'Enter your password to confirm.'
          : numberError ?? 'Enter the name exactly as it appears on your ID.'
      );
      return;
    }

    setState('saving');
    const auth = await confirmPassword(password);
    if (!auth.ok) {
      setState('error');
      setError(auth.message);
      return;
    }

    const uploaded: StoredFile[] = [];
    try {
      const finalDocs: StoredFile[] = [];
      for (const d of docs) {
        if (d.kind === 'stored') finalDocs.push(d.file);
        else {
          const stored = await uploadKycDocument(vendorId, d.file);
          uploaded.push(stored);
          finalDocs.push(stored);
        }
      }

      const { error: e } = await supabase.from('vendor_identity').upsert(
        {
          vendor_id: vendorId,
          id_type: idType,
          id_number: keepingNumber ? identity!.id_number : normaliseIdNumber(idType, idNumber),
          legal_name: legalName.trim(),
          documents: finalDocs,
        },
        { onConflict: 'vendor_id' }
      );
      if (e) throw e;

      await removeKycDocuments(removed);
      for (const d of docs) if (d.kind === 'pending') releasePickedFile(d.file);
      setPassword('');
      setTouched(false);
      setState('saved');
      setTimeout(() => setState('idle'), 2200);
      await load();
    } catch (e) {
      // The row never pointed at these uploads; do not leave them behind.
      await removeKycDocuments(uploaded.map((f) => f.path));
      setState('error');
      setError((e as Error).message);
    }
  }

  return (
    <Section
      title="Identity Verification"
      caption="Confirm who owns this shop"
      icon="shield-checkmark-outline"
      highlight={highlight}
      footer={missing || loading ? undefined : <SaveButton onPress={save} state={state} disabled={picking} />}
    >
      {loading ? (
        <ActivityIndicator color={colors.navy} />
      ) : missing ? (
        <Note tone="warning">
          Identity verification is not switched on yet. Run bookshops_vendor_identity.sql on this project.
        </Note>
      ) : (
        <>
          <View style={[styles.status, { backgroundColor: status.bg }]}>
            <Ionicons name={status.icon} size={18} color={status.fg} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusLabel, { color: status.fg }]}>{status.label}</Text>
              <Text style={styles.statusBody}>{status.body}</Text>
              {identity?.status === 'rejected' && !!identity.review_note && (
                <Text style={styles.reviewNote}>“{identity.review_note}”</Text>
              )}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>ID type</Text>
            <View style={styles.chips}>
              {ID_TYPES.map((t) => {
                const on = t.value === idType;
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => {
                      setIdType(t.value);
                      setIdNumber('');
                    }}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Field
            label={idType === 'nin' ? 'NIN (National Identification Number)' : `${type.label} number`}
            value={idNumber}
            onChangeText={(t) => setIdNumber(normaliseIdNumber(idType, t).slice(0, idType === 'nin' ? 11 : 20))}
            placeholder={
              identity && identity.id_type === idType
                ? `On file: ${maskIdNumber(identity.id_number)} — leave blank to keep`
                : type.placeholder
            }
            keyboardType={idType === 'nin' ? 'number-pad' : 'default'}
            autoCapitalize="characters"
            autoCorrect={false}
            error={touched && numberError ? numberError : undefined}
            hint={type.hint}
          />

          <Field
            label="Full name on the ID"
            value={legalName}
            onChangeText={setLegalName}
            placeholder="Exactly as printed"
            hint="LOCI matches this against your document and your payout account name."
          />

          <View style={styles.field}>
            <Text style={styles.label}>
              ID document ({docs.length}/{MAX_KYC_DOCS})
            </Text>
            {docs.map((d) => (
              <View key={d.key} style={styles.doc}>
                <Ionicons
                  name={isPdf(d.kind === 'stored' ? d.file.type : d.file.mimeType) ? 'document-text-outline' : 'image-outline'}
                  size={18}
                  color={colors.navy}
                />
                <Pressable onPress={() => view(d)} style={{ flex: 1 }} disabled={d.kind === 'pending'}>
                  <Text style={styles.docName} numberOfLines={1}>
                    {d.kind === 'stored' ? d.file.name : d.file.fileName}
                  </Text>
                  <Text style={styles.docMeta}>
                    {d.kind === 'pending'
                      ? `${formatBytes(d.file.size)} · not saved yet`
                      : `${formatBytes(d.file.size)} · tap to view`}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => removeDoc(d)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${d.kind === 'stored' ? d.file.name : d.file.fileName}`}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
            {docs.length < MAX_KYC_DOCS && (
              <Pressable onPress={addDocuments} disabled={picking} style={styles.add} accessibilityRole="button">
                {picking ? (
                  <ActivityIndicator size="small" color={colors.navy} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={17} color={colors.navy} />
                )}
                <Text style={styles.addText}>{docs.length ? 'Add another page' : 'Upload a photo or scan of your ID'}</Text>
              </Pressable>
            )}
            <Text style={styles.hint}>
              JPG, PNG or PDF, up to 5 MB each. Front and back if your ID has two sides. Only you and LOCI administrators can see these.
            </Text>
          </View>

          <Field
            label="Your password"
            value={password}
            onChangeText={setPassword}
            placeholder="Confirm it’s you"
            secureTextEntry
            autoCapitalize="none"
          />

          {identity?.status === 'verified' && (
            <Note>Changing these details removes your Verified badge until LOCI has checked them again.</Note>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', gap: spacing.sm, borderRadius: radius.md, padding: spacing.md, alignItems: 'flex-start' },
  statusLabel: { fontSize: font.md, fontWeight: '800' },
  statusBody: { fontSize: font.sm, color: colors.text, lineHeight: 18, marginTop: 1 },
  reviewNote: { fontSize: font.sm, color: colors.text, fontStyle: 'italic', marginTop: spacing.xs },

  // A little air above each custom block: the section body's own spacing
  // is tuned for plain Fields, and these otherwise sit tight against the
  // status box and the hint text above them.
  field: { gap: 6, marginTop: spacing.sm },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.onNavy },

  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  docName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  docMeta: { fontSize: font.xs, color: colors.textFaint },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  addText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  hint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16, marginBottom: spacing.sm },
  error: { fontSize: font.sm, color: colors.danger },
});
