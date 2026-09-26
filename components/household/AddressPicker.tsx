import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { addressLine } from '../../hooks/useAddressBook';
import { colors, spacing, radius, font } from '../../theme';
import type { DeliveryAddress } from '../../types/db';

/**
 * Saved addresses as cards above the checkout form. Picking one fills
 * the form; the form stays editable, because a one-off change ("leave it
 * with the gateman today") should not need a trip to Settings.
 */

interface Props {
  addresses: DeliveryAddress[];
  selectedId: string | null;
  onSelect: (address: DeliveryAddress) => void;
  onNew: () => void;
  disabled?: boolean;
}

export function AddressPicker({ addresses, selectedId, onSelect, onNew, disabled }: Props) {
  if (addresses.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>Deliver to a saved address</Text>
        <Pressable onPress={() => router.push('/settings')} hitSlop={6} accessibilityRole="link">
          <Text style={styles.manage}>Manage</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {addresses.map((a) => {
          const on = a.id === selectedId;
          return (
            <Pressable
              key={a.id}
              onPress={() => onSelect(a)}
              disabled={disabled}
              style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled }}
              accessibilityLabel={`${a.label}: ${addressLine(a)}`}
            >
              <View style={styles.cardHead}>
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={16}
                  color={on ? colors.navy : colors.textFaint}
                />
                <Text style={styles.cardLabel} numberOfLines={1}>
                  {a.label}
                </Text>
                {a.is_default && <Text style={styles.default}>Default</Text>}
              </View>
              <Text style={styles.cardLine} numberOfLines={1}>
                {a.recipient_name}
              </Text>
              <Text style={styles.cardLine} numberOfLines={2}>
                {addressLine(a)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={onNew}
          disabled={disabled}
          style={({ pressed }) => [styles.card, styles.cardNew, selectedId === null && styles.cardOn, pressed && styles.pressed]}
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedId === null }}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.navy} />
          <Text style={styles.cardLabel}>A different address</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  manage: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  row: { gap: spacing.sm, paddingBottom: 2 },
  card: {
    width: 200,
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
    backgroundColor: colors.surface,
  },
  cardOn: { borderColor: colors.navy, borderWidth: 2, backgroundColor: '#F7F9FD' },
  cardNew: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', gap: spacing.xs },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // No flex:0 here — on web it becomes flex-basis 0 and the label collapses to nothing.
  cardLabel: { fontSize: font.md, fontWeight: '700', color: colors.text, flexShrink: 1 },
  default: { fontSize: font.xs, fontWeight: '700', color: colors.success },
  cardLine: { fontSize: font.sm, color: colors.textMuted, lineHeight: 17 },
  pressed: { opacity: 0.85 },
});
