import { View, Text, Pressable, Modal, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadow, typography } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

export type CreateSource = 'camera' | 'library' | 'manual';

interface Option {
  key: CreateSource;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
}

/**
 * "Take Photo" is dropped on web.
 *
 * expo-image-picker's launchCameraAsync has no web implementation — it
 * throws rather than opening anything — and this app's main surface is
 * the browser build on Cloudflare Pages. A button that always throws is
 * worse than one that is not there, and "Upload Image" already covers
 * the desktop case, where the photo is a file on disk anyway.
 */
const OPTIONS: Option[] = [
  ...(Platform.OS === 'web'
    ? []
    : ([
        {
          key: 'camera',
          icon: 'camera-outline',
          label: 'Take Photo',
          hint: 'Point the camera at the printed list',
        },
      ] as Option[])),
  {
    key: 'library',
    icon: 'image-outline',
    label: 'Upload Image',
    hint: Platform.OS === 'web' ? 'Choose a photo or scan from this device' : 'Choose from your photos',
  },
  {
    key: 'manual',
    icon: 'create-outline',
    label: 'Type List Manually',
    hint: 'No photo — enter the school and items yourself',
  },
];

/**
 * How a booklist gets started.
 *
 * A sheet rather than three buttons on the card: the card has to stay
 * readable at 320px, and the choice is only made once per booklist.
 */
export function CreateBooklistSheet({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (source: CreateSource) => void;
  onClose: () => void;
}) {
  const { isMobile } = useLayout();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area closes, which is what a sheet is
            expected to do. It sits behind the panel, not over it. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, isMobile ? styles.sheetMobile : styles.sheetDesktop]}>
          <View style={styles.head}>
            <Text style={styles.title}>Create a New Booklist</Text>
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

          <View style={styles.list}>
            {OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => onSelect(o.key)}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityHint={o.hint}
              >
                <View style={styles.optionIcon}>
                  <Ionicons name={o.icon} size={19} color={colors.navy} />
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{o.label}</Text>
                  <Text style={styles.optionHint}>{o.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.note}>
            A photo is stored privately and only shown to you and the shops you send it to.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,30,61,0.45)', justifyContent: 'center', alignItems: 'center' },
  sheet: { backgroundColor: colors.surface, ...shadow.raised },
  sheetDesktop: { width: '100%', maxWidth: 420, borderRadius: radius.lg, padding: spacing.lg },
  // On a phone it behaves as a bottom sheet: full width, thumb-reachable.
  sheetMobile: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, paddingBottom: spacing.xxl,
  },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...typography.cardTitle },
  pressed: { opacity: 0.6 },

  list: { gap: spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  optionPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  optionIcon: {
    width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  optionText: { flex: 1, minWidth: 0 },
  optionLabel: { ...typography.bodyStrong },
  optionHint: { ...typography.caption, marginTop: 1 },

  note: { ...typography.caption, marginTop: spacing.md },
});
