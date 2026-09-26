import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Section, Field, Note } from '../settings/SettingsControls';
import { StatePicker } from '../settings/StatePicker';
import { ConfirmDialog } from '../booklists/ConfirmDialog';
import { useAddressBook, addressLine } from '../../hooks/useAddressBook';
import { colors, spacing, radius, font } from '../../theme';
import type { DeliveryAddress, EditableAddress } from '../../types/db';

/**
 * Settings → Delivery Addresses.
 *
 * Replaces the single "Default Delivery Address" form. The default here
 * is mirrored onto the profile by the database, so anything that still
 * prefills from profiles.default_delivery_* keeps working. Each order
 * keeps its own copy of where it went, so editing or deleting an
 * address never rewrites a past delivery.
 */

const BLANK: EditableAddress = {
  label: 'Home',
  recipient_name: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  lga: '',
  landmark: '',
  is_default: false,
};

export function AddressBookSection({ defaultName }: { defaultName?: string }) {
  const { addresses, loading, error, migration, save, makeDefault, remove } = useAddressBook();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<EditableAddress>(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeliveryAddress | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const set = <K extends keyof EditableAddress>(key: K, value: EditableAddress[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function startNew() {
    setForm({
      ...BLANK,
      label: addresses.length === 0 ? 'Home' : '',
      recipient_name: defaultName ?? '',
      is_default: addresses.length === 0,
    });
    setFormError(null);
    setEditing('new');
  }
  function startEdit(a: DeliveryAddress) {
    setForm({
      label: a.label,
      recipient_name: a.recipient_name,
      phone: a.phone,
      address: a.address,
      city: a.city,
      state: a.state ?? '',
      lga: a.lga ?? '',
      landmark: a.landmark ?? '',
      is_default: a.is_default,
    });
    setFormError(null);
    setEditing(a.id);
  }

  async function submit() {
    setSaving(true);
    setFormError(null);
    const result = await save(form, editing === 'new' ? undefined : (editing as string));
    setSaving(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setEditing(null);
  }

  async function setDefault(id: string) {
    setBusyId(id);
    const result = await makeDefault(id);
    setBusyId(null);
    if (!result.ok) setFormError(result.message);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusyId(deleting.id);
    const result = await remove(deleting.id);
    setBusyId(null);
    if (!result.ok) setFormError(result.message);
    setDeleting(null);
  }

  const formView = (
    <View style={styles.form}>
      <Field label="Label" value={form.label} onChangeText={(v) => set('label', v)} placeholder="Home, Office, Grandma's" />
      <Field
        label="Recipient"
        value={form.recipient_name}
        onChangeText={(v) => set('recipient_name', v)}
        placeholder="Who receives the parcel"
        autoCapitalize="words"
      />
      <Field
        label="Phone"
        value={form.phone}
        onChangeText={(v) => set('phone', v)}
        placeholder="0803 123 4567"
        keyboardType="phone-pad"
        hint="The shop calls this number before delivering."
      />
      <Field
        label="Street address"
        value={form.address}
        onChangeText={(v) => set('address', v)}
        placeholder="14 Adeniyi Jones Avenue"
      />
      <Field label="City or town" value={form.city} onChangeText={(v) => set('city', v)} placeholder="Ikeja" />
      <StatePicker label="State" value={form.state ?? ''} onChange={(v) => set('state', v)} />
      <Field label="Local Government Area" value={form.lga ?? ''} onChangeText={(v) => set('lga', v)} placeholder="Ikeja LGA" />
      <Field
        label="Nearest landmark"
        value={form.landmark ?? ''}
        onChangeText={(v) => set('landmark', v)}
        placeholder="Opposite Ikeja City Mall"
        error={formError ?? undefined}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Use as my default address</Text>
        <Switch
          value={form.is_default}
          onValueChange={(v) => set('is_default', v)}
          trackColor={{ false: colors.borderStrong, true: colors.navy }}
          thumbColor={colors.surface}
          accessibilityLabel="Use as my default address"
        />
      </View>
      <View style={styles.formActions}>
        <Pressable
          onPress={() => setEditing(null)}
          disabled={saving}
          style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={saving}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.onNavy} />
          ) : (
            <Text style={styles.btnPrimaryText}>{editing === 'new' ? 'Save address' : 'Save'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <Section title="Delivery Addresses" caption="Saved addresses to choose from at checkout" icon="location-outline">
      {migration === 'missing' ? (
        <Note tone="warning">The address book needs bookshops_buyer_portal.sql to be run on this project.</Note>
      ) : loading ? (
        <ActivityIndicator color={colors.navy} />
      ) : (
        <>
          {!!error && <Note tone="warning">{error}</Note>}
          {!!formError && editing === null && <Note tone="warning">{formError}</Note>}
          {addresses.length === 0 && editing !== 'new' && (
            <Text style={styles.empty}>
              No saved addresses yet. Save home, office, or a relative's house once and pick it at checkout.
            </Text>
          )}

          {addresses.map((a) =>
            editing === a.id ? (
              <View key={a.id}>{formView}</View>
            ) : (
              <View key={a.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.label}>{a.label}</Text>
                  {a.is_default && (
                    <View style={styles.defaultPill}>
                      <Text style={styles.defaultText}>Default</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => startEdit(a)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${a.label}`}>
                    <Ionicons name="create-outline" size={18} color={colors.navy} />
                  </Pressable>
                  <Pressable onPress={() => setDeleting(a)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${a.label}`}>
                    <Ionicons name="trash-outline" size={18} color={colors.textFaint} />
                  </Pressable>
                </View>
                <Text style={styles.line}>
                  {a.recipient_name} · {a.phone}
                </Text>
                <Text style={styles.line}>{addressLine(a)}</Text>
                {!!a.landmark && <Text style={styles.landmark}>{a.landmark}</Text>}
                {!a.is_default && (
                  <Pressable
                    onPress={() => setDefault(a.id)}
                    disabled={busyId === a.id}
                    style={styles.makeDefault}
                    accessibilityRole="button"
                  >
                    <Text style={styles.makeDefaultText}>{busyId === a.id ? 'Saving…' : 'Make default'}</Text>
                  </Pressable>
                )}
              </View>
            )
          )}

          {editing === 'new'
            ? formView
            : editing === null && (
                <Pressable onPress={startNew} style={({ pressed }) => [styles.add, pressed && styles.pressed]} accessibilityRole="button">
                  <Ionicons name="add-circle-outline" size={18} color={colors.navy} />
                  <Text style={styles.addText}>Add an address</Text>
                </Pressable>
              )}

          <Note>Each order keeps its own copy of the address it was sent to, so changes here never rewrite past deliveries.</Note>
        </>
      )}

      <ConfirmDialog
        visible={!!deleting}
        title={`Delete "${deleting?.label ?? 'this address'}"?`}
        message={
          deleting?.is_default
            ? 'This is your default. Your most recently used remaining address becomes the default instead.'
            : 'Past orders sent here are not affected.'
        }
        confirmLabel="Delete"
        destructive
        busy={!!deleting && busyId === deleting.id}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  label: { fontSize: font.md, fontWeight: '800', color: colors.text },
  defaultPill: { backgroundColor: '#E4F2E8', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  defaultText: { fontSize: font.xs, fontWeight: '700', color: colors.success },
  line: { fontSize: font.sm, color: colors.textMuted },
  landmark: { fontSize: font.sm, color: colors.textFaint, fontStyle: 'italic' },
  makeDefault: { alignSelf: 'flex-start', marginTop: spacing.xs },
  makeDefaultText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  form: {
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: {
    minHeight: 40,
    minWidth: 96,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  btnGhostText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  btnPrimary: { backgroundColor: colors.navy },
  btnPrimaryText: { fontSize: font.sm, fontWeight: '700', color: colors.onNavy },
  add: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', paddingVertical: spacing.sm },
  addText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
  pressed: { opacity: 0.8 },
});
