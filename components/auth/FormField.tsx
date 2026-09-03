import { forwardRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  StyleSheet,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';

export interface FormFieldProps extends Omit<TextInputProps, 'style' | 'secureTextEntry'> {
  label: string;
  /** Shown under the field, in red, and turns the border red. */
  error?: string;
  /** Shown under the field in grey when there is no error. */
  hint?: string;
  /** Renders a show/hide control and owns `secureTextEntry` itself. */
  isPassword?: boolean;
}

/**
 * react-native-web renders TextInput as a real <input>, and the browser
 * draws its own focus ring on top of ours. We draw a better one (a navy
 * border), so the default has to go.
 */
const outlineReset =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

/**
 * A labelled text input with visible focus, an error state, and a
 * password reveal.
 *
 * The label is a real label rather than a placeholder. Placeholder-only
 * fields look tidy until someone starts typing and can no longer see
 * what the box was for — which is precisely when they need it.
 *
 * `forwardRef` is what lets a screen move focus from one field to the
 * next when the user presses Next / Tab.
 */
export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, error, hint, isPassword, ...inputProps },
  ref
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const invalid = !!error;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>

      <View
        style={[
          styles.shell,
          focused && styles.shellFocused,
          invalid && styles.shellInvalid,
          inputProps.editable === false && styles.shellDisabled,
        ]}
      >
        <TextInput
          ref={ref}
          {...inputProps}
          secureTextEntry={isPassword && !revealed}
          placeholderTextColor={colors.textFaint}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          style={[styles.input, outlineReset]}
          // Screen readers get the label and, when something is wrong,
          // the reason — otherwise the red border means nothing to them.
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
        />

        {isPassword && (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            style={styles.reveal}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={colors.textMuted}
            />
          </Pressable>
        )}
      </View>

      {invalid ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: {
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    // 48 is the smallest comfortable touch target, and it stops the
    // field looking cramped on a desktop too.
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
  },
  shellFocused: { borderColor: colors.navy, backgroundColor: colors.surface },
  shellInvalid: { borderColor: colors.danger, backgroundColor: '#FDF2F1' },
  // Enough to read as locked while a request is in flight, not so much
  // that what the user typed starts to look like placeholder text.
  shellDisabled: { opacity: 0.75 },

  input: {
    flex: 1,
    fontSize: font.lg,
    color: colors.text,
    paddingVertical: spacing.md,
  },
  reveal: { paddingLeft: spacing.sm, paddingVertical: spacing.sm },

  error: { fontSize: font.sm, color: colors.danger, marginTop: spacing.xs, lineHeight: 17 },
  hint: { fontSize: font.sm, color: colors.textFaint, marginTop: spacing.xs, lineHeight: 17 },
});
