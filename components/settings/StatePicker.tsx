import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NIGERIAN_STATES } from '../../lib/nigerianStates';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  label: string;
  value: string;
  onChange: (state: string) => void;
  placeholder?: string;
}

/**
 * State picker.
 *
 * A modal list rather than an inline dropdown: thirty-seven options do
 * not fit in a chip row, and react-native has no cross-platform native
 * select. Search is here because most people know the first letter of
 * their state and would rather type it than scroll past Kaduna.
 *
 * Clearable, because "no state on file" is a legitimate state for a
 * profile and a picker that can only ever be set is a trap.
 */
export function StatePicker({ label, value, onChange, placeholder = 'Choose a state' }: Props) {
  const { isMobile } = useLayout();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? NIGERIAN_STATES.filter((s) => s.toLowerCase().includes(q)) : NIGERIAN_STATES),
    [q]
  );

  function choose(state: string) {
    onChange(state);
    setQuery('');
    setOpen(false);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>

      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${value}` : label}
        accessibilityHint="Opens a list of states"
      >
        <Text style={[styles.value, !value && styles.valuePlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        {value ? (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
          >
            <Ionicons name="close-circle" size={17} color={colors.textFaint} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={styles.centre} pointerEvents="box-none">
          <View style={[styles.card, isMobile && styles.cardMobile]}>
            <View style={styles.head}>
              <Text style={styles.title}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search" size={15} color={colors.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search states"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
                autoFocus={!isMobile}
                accessibilityLabel="Search states"
              />
            </View>

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {matches.length === 0 ? (
                <Text style={styles.none}>No state matches that.</Text>
              ) : (
                matches.map((state) => (
                  <Pressable
                    key={state}
                    onPress={() => choose(state)}
                    style={({ pressed }) => [
                      styles.row,
                      state === value && styles.rowOn,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: state === value }}
                    accessibilityLabel={state}
                  >
                    <Text style={[styles.rowText, state === value && styles.rowTextOn]}>
                      {state}
                    </Text>
                    {state === value && (
                      <Ionicons name="checkmark" size={17} color={colors.navy} />
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, marginBottom: 5 },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 44,
  },
  value: { flex: 1, fontSize: font.md, color: colors.text },
  valuePlaceholder: { color: colors.textFaint },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.raised,
  },
  cardMobile: { maxWidth: '100%' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 8 },
  list: { maxHeight: 320 },
  none: { fontSize: font.md, color: colors.textMuted, paddingVertical: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    minHeight: 44,
  },
  rowOn: { backgroundColor: colors.surfaceMuted },
  rowText: { fontSize: font.md, color: colors.text },
  rowTextOn: { fontWeight: '700', color: colors.navy },
  pressed: { opacity: 0.7 },
});
