import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';

export type NoticeTone = 'error' | 'success' | 'info';

interface NoticeProps {
  tone: NoticeTone;
  message: string;
  /** Optional second line — a next step, not a restatement. */
  detail?: string;
  /**
   * Renders a close button. Only for notices about something that
   * already happened, like "email confirmed" — a validation error must
   * not be dismissable, because the problem is still there.
   */
  onDismiss?: () => void;
}

const TONE = {
  error: { icon: 'alert-circle' as const, fg: colors.danger, bg: '#FDF2F1', border: '#F3C9C4' },
  success: { icon: 'checkmark-circle' as const, fg: colors.success, bg: '#EDF7F1', border: '#BFE3CD' },
  info: { icon: 'information-circle' as const, fg: colors.navy, bg: colors.surfaceMuted, border: colors.border },
};

/**
 * Form-level feedback: the thing that went wrong, or the thing that
 * worked.
 *
 * It replaces `Alert.alert`, which the sign-up screen used to call.
 * Alert is a no-op in react-native-web, so on the deployed site every
 * sign-up error was swallowed silently and the form just sat there —
 * the worst possible failure, because it looks like nothing happened.
 *
 * `accessibilityRole="alert"` makes a screen reader announce this when
 * it appears rather than waiting to be walked to.
 */
export function Notice({ tone, message, detail, onDismiss }: NoticeProps) {
  const t = TONE[tone];

  return (
    <View
      style={[styles.shell, { backgroundColor: t.bg, borderColor: t.border }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={t.icon} size={18} color={t.fg} style={styles.icon} />
      <View style={styles.body}>
        <Text style={[styles.message, { color: t.fg }]}>{message}</Text>
        {!!detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      {!!onDismiss && (
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  icon: { marginTop: 1 },
  body: { flex: 1 },
  message: { fontSize: font.md, fontWeight: '600', lineHeight: 19 },
  detail: { fontSize: font.sm, color: colors.textMuted, lineHeight: 17, marginTop: 3 },
});
