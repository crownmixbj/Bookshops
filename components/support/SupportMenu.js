import { View, Text, Pressable, Modal, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SUPPORT, SUPPORT_TEL, supportMailto } from '../../lib/support';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

function Option({ icon, title, detail, onPress, accent }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
    >
      <View style={[styles.optionIcon, accent && styles.optionIconAccent]}>
        <Ionicons name={icon} size={17} color={accent ? colors.onNavy : colors.navy} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </Pressable>
  );
}

/**
 * Support menu: call, email, or open the live-chat drawer.
 *
 * Anchored under the headset button on tablet and desktop; a bottom
 * sheet on mobile, matching how ProfileMenu behaves so the header's two
 * popovers feel like one system.
 *
 * `Linking.openURL` handles tel: and mailto: on native and on web (where
 * RN-Web assigns window.location). We do not gate on canOpenURL — it
 * reports false for tel: in several desktop browsers even though the
 * navigation works, so a failed open is caught instead.
 */
export function SupportMenu({ visible, onClose, onOpenChat }) {
  const { isMobile } = useLayout();

  async function open(url) {
    try {
      await Linking.openURL(url);
    } catch (e) {
      // A desktop browser with no mail or phone handler registered.
      console.warn('[support] could not open', url, e?.message);
    }
    onClose?.();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close support menu" />

      <View
        style={[styles.anchor, isMobile ? styles.anchorMobile : styles.anchorDesktop]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {isMobile && <View style={styles.grabber} />}

          <View style={styles.head}>
            <Text style={styles.title}>Need a hand?</Text>
            <Text style={styles.subtitle}>{SUPPORT.hours}</Text>
          </View>

          <Option
            icon="call-outline"
            title="Call support"
            detail={SUPPORT.phoneDisplay}
            onPress={() => open(SUPPORT_TEL)}
          />
          <Option
            icon="mail-outline"
            title="Email us"
            detail={SUPPORT.email}
            onPress={() =>
              open(supportMailto({ subject: 'LOCI support request' }))
            }
          />
          <Option
            icon="chatbubble-ellipses-outline"
            title="Live chat"
            detail="Chat with the team in the app"
            accent
            onPress={() => {
              onClose?.();
              onOpenChat?.();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.35)' },

  anchor: { ...StyleSheet.absoluteFill },
  // Clears the 62px bar; nudged left so it sits under the headset icon
  // rather than the avatar.
  anchorDesktop: { alignItems: 'flex-end', paddingTop: 62, paddingRight: 56 },
  anchorMobile: { justifyContent: 'flex-end' },

  card: {
    width: 296,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.sm,
    overflow: 'hidden',
    ...shadow.raised,
  },
  cardMobile: {
    width: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
  },

  head: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionPressed: { backgroundColor: colors.surfaceMuted },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconAccent: { backgroundColor: colors.orange },
  optionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  optionDetail: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
});
