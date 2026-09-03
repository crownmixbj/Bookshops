import { ReactNode } from 'react';
import { View, Text, TextInput, Pressable, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';

/** A titled card. Every settings group is one of these. */
export function Section({
  title,
  caption,
  icon,
  children,
  footer,
  /** Briefly outlined when navigated to from elsewhere in the app. */
  highlight,
}: {
  title: string;
  caption?: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
  footer?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.section, highlight && styles.sectionHighlight]}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={17} color={colors.navy} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {!!caption && <Text style={styles.sectionCaption}>{caption}</Text>}
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
      {footer && <View style={styles.sectionFooter}>{footer}</View>}
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: {
  label: string;
  hint?: string;
  error?: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !!error && styles.inputError]}
        placeholderTextColor={colors.textFaint}
        // The visible <Text> above is not tied to the input, so without
        // this a screen reader reaches the field and announces nothing.
        // Spread last so a caller can still override it.
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        {...input}
      />
      {!!error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : (
        !!hint && <Text style={styles.hint}>{hint}</Text>
      )}
    </View>
  );
}

/** A labelled switch row. Used for every notification preference. */
export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
  last,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, last && styles.toggleRowLast]}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={[styles.toggleLabel, disabled && styles.disabledText]}>{label}</Text>
        {!!description && <Text style={styles.toggleDescription}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.navy }}
        thumbColor={colors.surface}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Small segmented picker — used for the theme choice. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            {option.icon && (
              <Ionicons
                name={option.icon}
                size={14}
                color={active ? colors.onNavy : colors.textMuted}
              />
            )}
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A read-only row, for values that exist but cannot be changed here. */
export function ReadOnlyRow({
  label,
  value,
  note,
  badge,
}: {
  label: string;
  value: string;
  note?: string;
  badge?: { label: string; tone: 'success' | 'warning' };
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.readOnly}>
        <Text style={styles.readOnlyValue} numberOfLines={1}>
          {value}
        </Text>
        {badge && (
          <View
            style={[
              styles.badge,
              { backgroundColor: badge.tone === 'success' ? '#E4F2E8' : colors.warningBg },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: badge.tone === 'success' ? colors.success : colors.warning },
              ]}
            >
              {badge.label}
            </Text>
          </View>
        )}
      </View>
      {!!note && <Text style={styles.hint}>{note}</Text>}
    </View>
  );
}

export function SaveButton({
  onPress,
  state,
  label = 'Save changes',
  disabled,
}: {
  onPress: () => void;
  state: 'idle' | 'saving' | 'saved' | 'error';
  label?: string;
  disabled?: boolean;
}) {
  const busy = state === 'saving';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [
        styles.save,
        (busy || disabled) && styles.saveDisabled,
        state === 'saved' && styles.saveDone,
        pressed && !busy && !disabled && styles.pressed,
      ]}
      accessibilityRole="button"
    >
      {state === 'saved' && <Ionicons name="checkmark" size={15} color={colors.onNavy} />}
      <Text style={styles.saveText}>
        {busy ? 'Saving…' : state === 'saved' ? 'Saved' : label}
      </Text>
    </Pressable>
  );
}

/** A short explanatory note — used where something is stored but inert. */
export function Note({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' }) {
  return (
    <View style={[styles.note, tone === 'warning' && styles.noteWarning]}>
      <Ionicons
        name="information-circle-outline"
        size={14}
        color={tone === 'warning' ? colors.warning : colors.textMuted}
      />
      <Text style={[styles.noteText, tone === 'warning' && { color: colors.warning }]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    ...shadow.card,
  },
  sectionHighlight: { borderColor: colors.orange, borderWidth: 2 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  sectionCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  sectionBody: { padding: spacing.lg },
  sectionFooter: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: 0,
  },

  field: { marginBottom: spacing.md },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, marginBottom: 5 },
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
  inputError: { borderColor: colors.danger },
  hint: { fontSize: font.xs, color: colors.textFaint, marginTop: 4, lineHeight: 15 },
  fieldError: { fontSize: font.xs, color: colors.danger, marginTop: 4 },

  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.page,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  readOnlyValue: { flex: 1, fontSize: font.md, color: colors.textMuted },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontSize: font.xs, fontWeight: '700' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toggleRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  toggleLabel: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  toggleDescription: { fontSize: font.sm, color: colors.textMuted, marginTop: 1, lineHeight: 17 },
  disabledText: { color: colors.textFaint },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.navy },
  segmentText: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: colors.onNavy, fontWeight: '700' },

  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    minHeight: 40,
  },
  saveDisabled: { backgroundColor: colors.borderStrong },
  saveDone: { backgroundColor: colors.success },
  saveText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  noteWarning: { backgroundColor: colors.warningBg },
  noteText: { flex: 1, fontSize: font.xs, color: colors.textMuted, lineHeight: 17 },
  pressed: { opacity: 0.85 },
});
