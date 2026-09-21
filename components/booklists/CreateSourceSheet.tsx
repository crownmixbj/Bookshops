import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

export type BooklistSource = 'camera' | 'library' | 'manual';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (source: BooklistSource) => void;
}

interface Choice {
  source: BooklistSource;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  caption: string;
}

/**
 * Most school booklists arrive as a sheet of paper in a child's bag, so
 * the camera is listed first and typing it in is the fallback rather
 * than the default.
 */
const CHOICES: Choice[] = [
  {
    source: 'camera',
    icon: 'camera-outline',
    label: 'Take a photo',
    caption: "Snap the paper list you were given",
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

/**
 * How do you want to start a booklist?
 *
 * A sheet from the bottom on mobile, where a thumb is, and a centred
 * card on wider screens, where the pointer already is. Both are the same
 * Modal — only the alignment and the corner radii differ.
 */
export function CreateSourceSheet({ visible, onClose, onPick }: Props) {
  const { isMobile } = useLayout();

  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapCentre]} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {isMobile && <View style={styles.grabber} />}

          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>New Booklist</Text>
              <Text style={styles.subtitle}>How would you like to start?</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {CHOICES.map((choice) => (
            <Pressable
              key={choice.source}
              onPress={() => onPick(choice.source)}
              style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              accessibilityHint={choice.caption}
            >
              <View style={styles.choiceIcon}>
                <Ionicons name={choice.icon} size={20} color={colors.navy} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceLabel}>{choice.label}</Text>
                <Text style={styles.choiceCaption}>{choice.caption}</Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
            </Pressable>
          ))}
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

  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

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
  choiceIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
  choiceCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  pressed: { opacity: 0.85 },
});
