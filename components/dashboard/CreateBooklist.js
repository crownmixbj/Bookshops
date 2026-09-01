import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * The primary call to action: photograph a school booklist, name it, and
 * send it out for quotes. The navy tile is the camera/upload action; the
 * field below it names the request.
 */
export function CreateBooklist({ title, onTitleChange, onCapture, onSubmit, submitting, disabled }) {
  const canSubmit = !submitting && !disabled && title.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onCapture}
        disabled={submitting}
        style={({ pressed }) => [styles.capture, pressed && styles.capturePressed]}
        accessibilityRole="button"
        accessibilityLabel="Photograph or upload a booklist"
      >
        <View style={styles.captureIcon}>
          <Ionicons name="camera" size={22} color={colors.navy} />
        </View>
        <Text style={styles.captureText}>Create New Booklist</Text>
        <Text style={styles.captureHint}>Snap or upload the school list</Text>
      </Pressable>

      <View style={styles.field}>
        <TextInput
          value={title}
          onChangeText={onTitleChange}
          placeholder="e.g. Chrisland JSS2 — First Term"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          multiline
          accessibilityLabel="Booklist title"
        />
        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submit,
            !canSubmit && styles.submitDisabled,
            pressed && canSubmit && styles.submitPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Request quotes for this booklist"
        >
          {submitting ? (
            <ActivityIndicator color={colors.onNavy} size="small" />
          ) : (
            <Text style={styles.submitText}>Request Quotes</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  capture: {
    backgroundColor: colors.navy,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadow.card,
  },
  capturePressed: { backgroundColor: colors.navyDark },
  captureIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureText: { color: colors.onNavy, fontSize: font.lg, fontWeight: '700' },
  captureHint: { color: 'rgba(255,255,255,0.75)', fontSize: font.sm },

  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadow.card,
  },
  input: {
    minHeight: 66,
    fontSize: font.md,
    color: colors.text,
    textAlignVertical: 'top',
    outlineStyle: 'none',
  },
  submit: {
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  submitPressed: { backgroundColor: colors.orangeDark },
  submitDisabled: { backgroundColor: colors.borderStrong },
  submitText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
});
