import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * The one way to start a booklist from the hub.
 *
 * This card used to carry a second path as well: a title box and a
 * "Request Quotes" button that inserted a book_requests row on the spot.
 * It was removed because of what it produced — a booklist with a name
 * and no books. A parent typed "Chrisland JSS2 — First Term", pressed
 * the orange button, and got a draft with nothing in it and no obvious
 * next step; publishing one reaches every vendor as a row they can only
 * decline. The chooser this tile opens asks how the list should be
 * started before creating anything, so a request only exists once there
 * is something in it.
 */
export function CreateBooklist({ onCapture, disabled = false }) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onCapture}
        disabled={disabled}
        style={({ pressed }) => [styles.capture, pressed && styles.capturePressed]}
        accessibilityRole="button"
        accessibilityLabel="Create a new booklist"
        accessibilityHint="Photograph a printed list, pick one from your photos, or type it in"
      >
        <View style={styles.captureIcon}>
          <Ionicons name="camera" size={22} color={colors.navy} />
        </View>
        <Text style={styles.captureText}>Create New Booklist</Text>
        <Text style={styles.captureHint}>Snap it, upload it, or type it in</Text>
      </Pressable>
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
});
