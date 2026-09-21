import { View, Text, TextInput, Pressable, Modal, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../theme';
import { useLayout } from '../hooks/useLayout';

export type BooklistSource = 'camera' | 'library' | 'manual';

interface Choice {
  source: BooklistSource;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  caption: string;
}

/**
 * All three routes are offered on every platform.
 *
 * expo-image-picker ships a web implementation of launchCameraAsync
 * (an <input type="file" capture>), so the camera row is real in the
 * browser build too — on a phone browser it opens the camera, and on a
 * desktop browser `capture` is ignored and it falls back to the file
 * chooser. That is why the caption differs there rather than the row
 * being dropped: an entry point that exists on one screen and not
 * another is the inconsistency this component exists to remove.
 */
const CHOICES: readonly Choice[] = [
  {
    source: 'camera',
    icon: 'camera-outline',
    label: 'Take a photo',
    caption: Platform.select({
      web: 'Use this device’s camera to capture the paper list',
      default: 'Snap the paper list you were given',
    }) as string,
  },
  {
    source: 'library',
    icon: 'images-outline',
    label: 'Choose from gallery',
    caption: 'Pick a photo or screenshot you already have',
  },
  {
    source: 'manual',
    icon: 'create-outline',
    label: 'Type it in',
    caption: 'No photo — enter the books yourself',
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * What the buyer is calling this list, e.g. "Chrisland JSS2 — First
   * Term". Optional on purpose — see the field itself.
   */
  title: string;
  onTitleChange: (title: string) => void;
  /**
   * Where the flow goes next. Pair this with `useCreateBooklist` so
   * every entry point picks, routes and reports errors the same way.
   */
  onPick: (source: BooklistSource) => void;
  /**
   * Fired once the sheet has actually left the screen (iOS only — RN
   * sends no onDismiss on Android or web). useCreateBooklist waits for
   * this before presenting the camera: a native picker put up while this
   * Modal is still mounted is never shown at all.
   */
  onDismissed?: () => void;
}

/**
 * The single "Create New Booklist" entry point.
 *
 * Presentational on purpose: it owns no picker, no navigation and no
 * Supabase call, so the Booklist Hub and My Booklists can mount the
 * exact same three choices and differ only in what they refresh
 * afterwards.
 *
 * A bottom sheet on mobile, where a thumb is, and a centred card on
 * wider screens, where the pointer already is. Both are one Modal —
 * only the alignment and the corner radii change.
 */
export function CreateBooklistModal({
  visible,
  onClose,
  onPick,
  onDismissed,
  title,
  onTitleChange,
}: Props) {
  const { isMobile } = useLayout();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      {/* Behind the panel, not over it, so tapping the dim area closes
          and tapping a choice still lands on the choice. */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />

      <View
        style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapCentre]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {isMobile && <View style={styles.grabber} />}

          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title}>New Booklist</Text>
              <Text style={styles.subtitle}>How would you like to start?</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {/*
            Optional, and deliberately so.
            Both destinations ask for the school themselves — the review
            screen after the photo has been read (where the parser may
            already know it), and the manual screen as its first field.
            Making this compulsory here would ask the same question
            twice, which is the redundancy the hub's old inline box was
            removed for. Typed here it just seeds the next screen; left
            blank, nothing is lost.
          */}
          <View style={styles.nameField}>
            <Text style={styles.nameLabel}>Name this list (optional)</Text>
            <TextInput
              value={title}
              onChangeText={onTitleChange}
              placeholder="e.g. Chrisland JSS2 — First Term"
              placeholderTextColor={colors.textFaint}
              style={styles.nameInput}
              accessibilityLabel="Name this booklist"
              accessibilityHint="Optional. Carried through to the next screen so you only type it once."
              returnKeyType="done"
            />
          </View>

          {CHOICES.map((choice) => (
            <Pressable
              key={choice.source}
              onPress={() => onPick(choice.source)}
              style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              accessibilityHint={choice.caption}
            >
              <View style={styles.choiceIcon}>
                <Ionicons name={choice.icon} size={20} color={colors.navy} />
              </View>
              <View style={styles.choiceText}>
                <Text style={styles.choiceLabel}>{choice.label}</Text>
                <Text style={styles.choiceCaption}>{choice.caption}</Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
            </Pressable>
          ))}

          <Text style={styles.note}>
            A photo is stored privately and only shown to you and the shops you send it to.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  wrap: { flex: 1 },
  wrapMobile: { justifyContent: 'flex-end' },
  wrapCentre: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.raised,
  },
  cardMobile: {
    maxWidth: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: spacing.xxl,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },

  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

  nameField: { gap: 5, marginBottom: spacing.xs },
  nameLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.md,
    color: colors.text,
  },

  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
  },
  choicePressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  choiceIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { flex: 1, minWidth: 0 },
  choiceLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
  choiceCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  note: { fontSize: font.xs, color: colors.textFaint, marginTop: spacing.sm, lineHeight: 16 },
  pressed: { opacity: 0.6 },
});
