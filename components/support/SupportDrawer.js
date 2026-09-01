import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  Animated,
  Linking,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SUPPORT, SUPPORT_TEL, supportMailto } from '../../lib/support';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * In-app support drawer.
 *
 * HONEST STATE OF THIS COMPONENT: there is no chat backend. The schema
 * has no messages table and no chat provider is wired up, so nothing
 * here can deliver a message to a human on its own.
 *
 * Rather than fake a chat that silently drops what people type, the
 * composer hands the message to the user's mail client, pre-filled and
 * addressed to support. That genuinely reaches the team today.
 *
 * TODO(backend): to make this a real chat, either
 *   a) add `support_threads` / `support_messages` tables with RLS
 *      scoping rows to their owner, and swap handleSend for an insert
 *      plus a realtime subscription on the thread; or
 *   b) drop in a provider widget (Crisp, Intercom, Tawk) and have this
 *      drawer mount it.
 * The drawer's layout and open/close behaviour stay the same either way.
 */
export function SupportDrawer({ visible, onClose, initialMessage = '' }) {
  const { isMobile, width } = useLayout();
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const drawerWidth = isMobile ? width : 380;
  const slide = useRef(new Animated.Value(drawerWidth)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : drawerWidth,
      duration: 220,
      // Layout-driven translate; the native driver cannot animate it on
      // web without a transform-only style, which this is — but RN-Web
      // ignores useNativeDriver anyway, so keep it explicit and false.
      useNativeDriver: false,
    }).start();
    if (visible) {
      setSent(false);
      // A dispute opens this drawer with the order already described, so
      // the person only has to type what went wrong.
      if (initialMessage) setMessage(initialMessage);
    }
  }, [visible, drawerWidth, slide, initialMessage]);

  async function handleSend() {
    const body = message.trim();
    if (!body) return;
    try {
      await Linking.openURL(
        supportMailto({ subject: 'LOCI in-app support request', body })
      );
      setSent(true);
      setMessage('');
    } catch (e) {
      console.warn('[support] could not open mail client:', e?.message);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close support" />

      <Animated.View
        style={[
          styles.drawer,
          { width: drawerWidth, transform: [{ translateX: slide }] },
        ]}
      >
        <View style={styles.head}>
          <View style={styles.headIcon}>
            <Ionicons name="headset-outline" size={18} color={colors.onNavy} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>LOCI Support</Text>
            <Text style={styles.subtitle}>{SUPPORT.hours}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close support">
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>
              Hi there. Tell us what you need help with — a booklist that hasn't
              been quoted, an order, or a payment — and we'll get back to you.
            </Text>
          </View>

          {sent && (
            <View style={styles.sent}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.sentText}>
                Your mail app should have opened with the message ready to send.
              </Text>
            </View>
          )}

          <Text style={styles.label}>Your message</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Describe the issue…"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            multiline
            accessibilityLabel="Your message to support"
          />

          <Pressable
            onPress={handleSend}
            disabled={!message.trim()}
            style={({ pressed }) => [
              styles.send,
              !message.trim() && styles.sendDisabled,
              pressed && message.trim() && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Ionicons name="paper-plane-outline" size={15} color={colors.onNavy} />
            <Text style={styles.sendText}>Send message</Text>
          </Pressable>

          <Text style={styles.note}>
            Live chat isn't connected yet, so this opens your email app with the
            message ready to send.
          </Text>

          <View style={styles.rule} />

          <Text style={styles.label}>Or reach us directly</Text>
          <Pressable
            style={({ pressed }) => [styles.direct, pressed && styles.pressed]}
            onPress={() => Linking.openURL(SUPPORT_TEL).catch(() => {})}
            accessibilityRole="button"
          >
            <Ionicons name="call-outline" size={16} color={colors.navy} />
            <Text style={styles.directText}>{SUPPORT.phoneDisplay}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.direct, pressed && styles.pressed]}
            onPress={() => Linking.openURL(supportMailto()).catch(() => {})}
            accessibilityRole="button"
          >
            <Ionicons name="mail-outline" size={16} color={colors.navy} />
            <Text style={styles.directText}>{SUPPORT.email}</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    ...shadow.raised,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  bubble: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderTopLeftRadius: 2,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bubbleText: { fontSize: font.md, color: colors.text, lineHeight: 20 },

  sent: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#E4F2E8',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sentText: { flex: 1, fontSize: font.sm, color: colors.success, lineHeight: 18 },

  label: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
  input: {
    minHeight: 104,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    fontSize: font.md,
    color: colors.text,
    textAlignVertical: 'top',
    outlineStyle: 'none',
  },

  send: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginTop: spacing.md,
  },
  sendDisabled: { backgroundColor: colors.borderStrong },
  sendText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  note: { fontSize: font.xs, color: colors.textFaint, marginTop: spacing.sm, lineHeight: 16 },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  direct: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  directText: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  pressed: { opacity: 0.85 },
});
