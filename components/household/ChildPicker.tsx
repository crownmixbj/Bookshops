import { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChildren } from '../../hooks/useChildren';
import { colors, spacing, radius, font } from '../../theme';
import type { Child } from '../../types/db';

/**
 * "Who is this list for?" — chips for each child, plus "Not for a
 * specific child", plus a quick add that never leaves the form.
 *
 * Choosing a child hands its school and class to the caller, which
 * fills the school/class fields with them. The caller decides whether
 * to overwrite what the buyer already typed; see onChange.
 *
 * Renders nothing for a guest or before bookshops_buyer_portal.sql has
 * run — the booklist forms work exactly as before in both cases.
 */

interface Props {
  value: string | null;
  onChange: (child: Child | null) => void;
  disabled?: boolean;
}

export function ChildPicker({ value, onChange, disabled }: Props) {
  const { children, loading, migration, add } = useChildren();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (migration === 'missing' || (migration === 'unknown' && !loading)) return null;

  async function quickAdd() {
    setSaving(true);
    setProblem(null);
    const result = await add({ full_name: name, school_name: null, class_level: null });
    setSaving(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setName('');
    setAdding(false);
    onChange(result.child);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Who is this booklist for?</Text>
      {loading ? (
        <ActivityIndicator color={colors.navy} style={{ alignSelf: 'flex-start' }} />
      ) : (
        <View style={styles.chips}>
          {children.map((c) => {
            const on = c.id === value;
            return (
              <Pressable
                key={c.id}
                onPress={() => onChange(on ? null : c)}
                disabled={disabled}
                style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled }}
                accessibilityLabel={[c.full_name, c.class_level, c.school_name].filter(Boolean).join(', ')}
              >
                <Ionicons name={on ? 'person' : 'person-outline'} size={14} color={on ? colors.onNavy : colors.navy} />
                <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                  {c.full_name}
                  {c.class_level ? ` · ${c.class_level}` : ''}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => onChange(null)}
            disabled={disabled}
            style={({ pressed }) => [styles.chip, value == null && styles.chipNeutralOn, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: value == null, disabled }}
          >
            <Text style={[styles.chipText, value == null && styles.chipTextNeutralOn]}>Not for a specific child</Text>
          </Pressable>
          {!adding && (
            <Pressable
              onPress={() => setAdding(true)}
              disabled={disabled}
              style={({ pressed }) => [styles.chip, styles.chipAdd, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={14} color={colors.navy} />
              <Text style={styles.chipText}>Add child</Text>
            </Pressable>
          )}
        </View>
      )}

      {adding && (
        <View style={styles.addRow}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Child's first name"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoFocus
            autoCapitalize="words"
            onSubmitEditing={quickAdd}
            accessibilityLabel="Child's first name"
          />
          <Pressable
            onPress={quickAdd}
            disabled={saving || !name.trim()}
            style={({ pressed }) => [styles.addBtn, (saving || !name.trim()) && styles.addBtnOff, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator size="small" color={colors.onNavy} /> : <Text style={styles.addBtnText}>Add</Text>}
          </Pressable>
          <Pressable onPress={() => setAdding(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}
      {!!problem && <Text style={styles.problem}>{problem}</Text>}
      <Text style={styles.hint}>
        Only you see the name. Shops see the school and class, as before.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.md },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
    maxWidth: 260,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipNeutralOn: { backgroundColor: colors.surfaceMuted, borderColor: colors.navy },
  chipAdd: { borderStyle: 'dashed' },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.navy },
  chipTextOn: { color: colors.onNavy },
  chipTextNeutralOn: { color: colors.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  addBtn: {
    minHeight: 40,
    minWidth: 64,
    borderRadius: radius.md,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  addBtnOff: { opacity: 0.5 },
  addBtnText: { fontSize: font.sm, fontWeight: '700', color: colors.onNavy },
  problem: { fontSize: font.sm, color: colors.danger },
  hint: { fontSize: font.xs, color: colors.textFaint },
  pressed: { opacity: 0.8 },
});
