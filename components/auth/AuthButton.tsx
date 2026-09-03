import { Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, radius, font } from '../../theme';

interface AuthButtonProps {
  label: string;
  /** Replaces `label` while `loading` — say what is happening, not "Loading". */
  loadingLabel?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

/**
 * The one button on an auth screen.
 *
 * Two rules it enforces so no screen has to remember them:
 *
 *  - While `loading` it is disabled and shows a spinner. A submit button
 *    that still looks pressable during a network call is how people end
 *    up creating two accounts.
 *  - `accessibilityState` carries both disabled and busy, so assistive
 *    tech is told what the greying-out is telling everyone else.
 */
export function AuthButton({
  label,
  loadingLabel,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: AuthButtonProps) {
  const inert = disabled || loading;
  const secondary = variant === 'secondary';

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.base,
        secondary ? styles.secondary : styles.primary,
        pressed && !inert && (secondary ? styles.secondaryPressed : styles.primaryPressed),
        // Busy and disabled are NOT the same state and must not look the
        // same. Busy keeps the brand colour so the white label stays
        // readable; only a genuinely unavailable button goes grey.
        loading && !secondary && styles.primaryBusy,
        disabled && !loading && (secondary ? styles.secondaryDisabled : styles.primaryDisabled),
      ]}
      accessibilityRole="button"
      accessibilityLabel={loading ? (loadingLabel ?? label) : label}
      accessibilityState={{ disabled: inert, busy: loading }}
    >
      {loading && (
        <ActivityIndicator size="small" color={secondary ? colors.navy : colors.onNavy} />
      )}
      <Text
        style={[
          styles.label,
          secondary && styles.secondaryLabel,
          disabled && !loading && styles.disabledLabel,
        ]}
      >
        {loading ? (loadingLabel ?? label) : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.orange, borderColor: colors.orange },
  primaryPressed: { backgroundColor: colors.orangeDark, borderColor: colors.orangeDark },
  primaryBusy: { backgroundColor: colors.orangeDark, borderColor: colors.orangeDark },
  primaryDisabled: { backgroundColor: '#E3E9F2', borderColor: colors.borderStrong },

  secondary: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  secondaryPressed: { backgroundColor: colors.surfaceMuted },
  secondaryDisabled: { opacity: 0.6 },

  label: { fontSize: font.lg, fontWeight: '700', color: colors.onNavy },
  secondaryLabel: { color: colors.navy },
  disabledLabel: { color: '#6B7A94' },
});
