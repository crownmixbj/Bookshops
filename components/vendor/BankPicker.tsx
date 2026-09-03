import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, FlatList, Platform, StyleSheet, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import { BANKS, searchBanks, type NigerianBank } from '../../lib/nigerianBanks';

/** react-native-web renders TextInput as an <input>; the browser's own
 *  focus ring would sit on top of the sheet's border. */
const outlineReset =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

interface Props {
  label: string;
  value: string;
  onChange: (name: string, code: string | null) => void;
  hint?: string;
  disabled?: boolean;
}

/**
 * Bank chooser for the payout form.
 *
 * A searchable modal rather than a native <select>: react-native has no
 * cross-platform picker, and a list this long needs filtering anyway —
 * nobody scrolls forty banks to find theirs.
 *
 * It stays open to free text. The bundled list will fall behind reality
 * (banks merge, fintechs launch), and a shop whose bank is missing must
 * still be able to get paid. Typing a name that is not on the list saves
 * the name with a null code, which is exactly what the column allows.
 */
export function BankPicker({ label, value, onChange, hint, disabled }: Props) {
  const { isMobile } = useLayout();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchBanks(query), [query]);
  const typed = query.trim();
  // Offer "use what I typed" only once it is clear no listed bank is
  // meant. Two letters is a prefix, not a bank name — showing "Use “un”"
  // above Union Bank invites a typo into the money form.
  const showFreeText =
    typed.length >= 3 && !BANKS.some((b) => b.name.toLowerCase().startsWith(typed.toLowerCase()));

  function choose(bank: NigerianBank) {
    onChange(bank.name, bank.code);
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={({ pressed }) => [styles.control, pressed && !disabled && styles.controlPressed, disabled && styles.controlDisabled]}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${value}. Change` : `Choose your ${label.toLowerCase()}`}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
      >
        <Text style={[styles.controlText, !value && styles.placeholder]} numberOfLines={1}>
          {value || 'Choose your bank'}
        </Text>
        <Ionicons name="chevron-down" size={17} color={colors.textMuted} />
      </Pressable>

      {!!hint && <Text style={styles.hint}>{hint}</Text>}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close bank list" />

        <View style={[styles.anchor, isMobile ? styles.anchorMobile : styles.anchorDesktop]} pointerEvents="box-none">
          <View style={[styles.sheet, isMobile && styles.sheetMobile]}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search banks"
                placeholderTextColor={colors.textFaint}
                style={[styles.searchInput, outlineReset]}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search banks"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={16} color={colors.textFaint} />
                </Pressable>
              )}
            </View>

            <FlatList
              data={results}
              keyExtractor={(b) => b.name}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: isMobile ? 380 : 340 }}
              ListEmptyComponent={
                !showFreeText ? (
                  <Text style={styles.empty}>No bank matches “{typed}”.</Text>
                ) : null
              }
              renderItem={({ item }) => {
                const selected = item.name === value;
                return (
                  <Pressable
                    onPress={() => choose(item)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={item.name}
                  >
                    <Text style={[styles.rowText, selected && styles.rowTextSelected]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {selected && <Ionicons name="checkmark" size={16} color={colors.orange} />}
                  </Pressable>
                );
              }}
              ListFooterComponent={
                showFreeText ? (
                  <Pressable
                    onPress={() => choose({ name: typed, code: null })}
                    style={({ pressed }) => [styles.row, styles.freeRow, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${typed}`}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.navy} />
                    <Text style={styles.freeText} numberOfLines={1}>
                      Use “{typed}”
                    </Text>
                  </Pressable>
                ) : null
              }
            />

            <Text style={styles.footnote}>
              Can&apos;t see your bank? Type its name and choose “Use …”.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 5 },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
  },
  controlPressed: { backgroundColor: colors.border },
  controlDisabled: { opacity: 0.6 },
  controlText: { flex: 1, fontSize: font.md, color: colors.text },
  placeholder: { color: colors.textFaint },
  hint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 15 },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.35)' },
  anchor: { ...StyleSheet.absoluteFill },
  anchorDesktop: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  anchorMobile: { justifyContent: 'flex-end' },

  sheet: {
    width: 420,
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.raised,
  },
  sheetMobile: { width: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: font.lg, color: colors.text },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  rowText: { flex: 1, fontSize: font.md, color: colors.text },
  rowTextSelected: { fontWeight: '700', color: colors.navy },
  freeRow: { backgroundColor: colors.surfaceMuted },
  freeText: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.navy },
  empty: { padding: spacing.lg, fontSize: font.sm, color: colors.textFaint },

  footnote: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.xs,
    color: colors.textFaint,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
