import { View, Text, Pressable, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button for anything that destroys data. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A yes/no dialog.
 *
 * Deliberately not React Native's Alert.alert: react-native-web does not
 * implement it, so on the web build — which is how this app is deployed —
 * the callback never fires and the destructive action silently does
 * nothing. A component renders the same everywhere.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const { isMobile } = useLayout();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <Pressable style={styles.scrim} onPress={busy ? undefined : onCancel} accessibilityLabel="Cancel" />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={[styles.icon, destructive && styles.iconDanger]}>
            <Ionicons
              name={destructive ? 'trash-outline' : 'help-circle-outline'}
              size={20}
              color={destructive ? colors.danger : colors.navy}
            />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.btnDanger : styles.btnPrimary,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.onNavy} />
              ) : (
                <Text style={styles.btnConfirmText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadow.raised,
  },
  cardMobile: { maxWidth: '100%' },

  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconDanger: { backgroundColor: '#FCEAE8' },

  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  message: { fontSize: font.md, color: colors.textMuted, lineHeight: 20, marginTop: spacing.sm },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },
  btnPrimary: { backgroundColor: colors.orange },
  btnDanger: { backgroundColor: colors.danger },
  btnConfirmText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  pressed: { opacity: 0.85 },
});
