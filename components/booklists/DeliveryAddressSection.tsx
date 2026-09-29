import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAddressBook, addressLine } from '../../hooks/useAddressBook';
import { EMPTY_OTHER, type DeliveryChoice, type OtherAddress } from '../../lib/requestDelivery';
import { colors, spacing, radius, font } from '../../theme';

/**
 * "Delivery Address" for a booklist being created or reviewed.
 *
 * Preselects the buyer's default saved address, lets them switch between
 * saved ones, and has a "Deliver to a different address" switch for books
 * going somewhere else — a street address, the area or city, and
 * optional notes for whoever receives them.
 *
 * Shops use this to put an accurate delivery cost in their quote, so the
 * screen says so; they see only the area until they accept the list.
 */

interface Props {
  value: DeliveryChoice;
  onChange: (next: DeliveryChoice) => void;
  disabled?: boolean;
  /** Show the "required to send" problem, e.g. after a failed submit. */
  problem?: string | null;
}

export function DeliveryAddressSection({ value, onChange, disabled, problem }: Props) {
  const book = useAddressBook();
  // Typed text survives switching back and forth between saved/different.
  const [other, setOther] = useState<OtherAddress>(
    value.mode === 'different' ? value.other : EMPTY_OTHER
  );
  const preselected = useRef(false);

  // Default address in, once, when the address book arrives — unless the
  // buyer has already chosen something.
  useEffect(() => {
    if (preselected.current || book.loading) return;
    preselected.current = true;
    if (value.mode !== 'none') return;
    const preferred = book.addresses.find((a) => a.is_default) ?? book.addresses[0];
    if (preferred) onChange({ mode: 'saved', address: preferred });
  }, [book.loading, book.addresses, value.mode, onChange]);

  const saved = book.addresses;
  const hasSaved = saved.length > 0;
  const different = value.mode === 'different' || (!hasSaved && value.mode !== 'saved');
  const selected = value.mode === 'saved' ? value.address : null;

  function setDifferent(on: boolean) {
    if (on) {
      onChange({ mode: 'different', other });
    } else {
      const preferred = saved.find((a) => a.is_default) ?? saved[0];
      onChange(preferred ? { mode: 'saved', address: preferred } : { mode: 'none' });
    }
  }

  function edit(patch: Partial<OtherAddress>) {
    const next = { ...other, ...patch };
    setOther(next);
    onChange({ mode: 'different', other: next });
  }

  return (
    <View style={styles.wrap} accessibilityLabel="Delivery address">
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <Ionicons name="location-outline" size={17} color={colors.navy} />
          <Text style={styles.title}>Delivery Address</Text>
        </View>
        {hasSaved && (
          <Pressable onPress={() => router.push('/settings')} hitSlop={6} accessibilityRole="link">
            <Text style={styles.manage}>Manage</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.help}>
        Shops use this to include an accurate delivery cost in their quote. They see only the
        area until they accept your list.
      </Text>

      {book.loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.navy} />
        </View>
      ) : (
        <>
          {hasSaved && !different && selected && (
            <>
              <View style={styles.card} accessibilityLabel={`Delivering to ${selected.label}: ${addressLine(selected)}`}>
                <View style={styles.cardHead}>
                  <Ionicons name="home-outline" size={15} color={colors.navy} />
                  <Text style={styles.cardLabel} numberOfLines={1}>
                    {selected.label}
                  </Text>
                  {selected.is_default && <Text style={styles.defaultTag}>Default</Text>}
                </View>
                <Text style={styles.cardLine} numberOfLines={1}>
                  {[selected.recipient_name, selected.phone].filter(Boolean).join(' · ')}
                </Text>
                <Text style={styles.cardLine} numberOfLines={2}>
                  {addressLine(selected)}
                  {selected.landmark ? ` (${selected.landmark})` : ''}
                </Text>
              </View>

              {saved.length > 1 && (
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {saved.map((a) => {
                    const on = a.id === selected.id;
                    return (
                      <Pressable
                        key={a.id}
                        disabled={disabled}
                        onPress={() => onChange({ mode: 'saved', address: a })}
                        style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${a.label}: ${addressLine(a)}`}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                          {a.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {hasSaved && (
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Deliver to a different address</Text>
                <Text style={styles.toggleSub}>Sending the books to someone else or another location?</Text>
              </View>
              <Switch
                value={different}
                onValueChange={setDifferent}
                disabled={disabled}
                trackColor={{ false: colors.border, true: colors.navy }}
                accessibilityLabel="Deliver to a different address"
              />
            </View>
          )}

          {!hasSaved && (
            <Text style={styles.noSaved}>
              You have no saved address yet. Enter where the books should go — you can save
              addresses for next time in Settings.
            </Text>
          )}

          {different && (
            <View style={styles.form}>
              <Text style={styles.label}>Street address</Text>
              <TextInput
                value={other.address}
                onChangeText={(t) => edit({ address: t })}
                editable={!disabled}
                placeholder="House number, street, estate"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                accessibilityLabel="Street address"
              />
              <Text style={styles.label}>Area / City</Text>
              <TextInput
                value={other.city}
                onChangeText={(t) => edit({ city: t })}
                editable={!disabled}
                placeholder="e.g. Surulere, Lagos"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                accessibilityLabel="Area or city"
              />
              <Text style={styles.label}>Recipient &amp; delivery notes (optional)</Text>
              <TextInput
                value={other.notes}
                onChangeText={(t) => edit({ notes: t })}
                editable={!disabled}
                placeholder="Who receives the books, a phone number, a landmark"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.notes]}
                multiline
                maxLength={300}
                accessibilityLabel="Recipient and delivery notes"
              />
            </View>
          )}
        </>
      )}

      {!!problem && (
        <View style={styles.problem} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.problemText}>{problem}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: font.md, fontWeight: '800', color: colors.navy },
  manage: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  help: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18 },
  loading: { paddingVertical: spacing.md, alignItems: 'flex-start' },

  card: {
    borderWidth: 2,
    borderColor: colors.navy,
    backgroundColor: '#F7F9FD',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardLabel: { fontSize: font.md, fontWeight: '700', color: colors.text, flexShrink: 1 },
  defaultTag: { fontSize: font.xs, fontWeight: '700', color: colors.success },
  cardLine: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.navy, backgroundColor: '#E8EEF8' },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  chipTextOn: { color: colors.navy, fontWeight: '800' },
  pressed: { opacity: 0.85 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  toggleTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  toggleSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  noSaved: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18, fontStyle: 'italic' },

  form: { gap: 2 },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, marginBottom: 4, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.md,
    color: colors.text,
  },
  notes: { minHeight: 64, textAlignVertical: 'top' },

  problem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  problemText: { fontSize: font.sm, color: colors.danger, flex: 1 },
});
