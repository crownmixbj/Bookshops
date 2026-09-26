import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, typography, shadow, formatNaira } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/** Matches the CHECK on quotes.decline_reason. */
export const MAX_REASON = 500;

interface Props {
  visible: boolean;
  shopName: string;
  total: number | string | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Reason is trimmed, or null when the buyer left it blank. */
  onConfirm: (reason: string | null) => void;
}

/**
 * Confirm declining one shop's quote.
 *
 * A confirmation rather than a straight button, because declining is not
 * reversible from the buyer's side: buyer_decline_quote only accepts a
 * quote still at 'sent', so a mis-tap cannot be undone by tapping again.
 * The shop has to re-send.
 *
 * The reason is optional and says so. A required box would be answered
 * with "no" and a full stop by everyone in a hurry, which is worse than
 * nothing for the shop reading it — and it would turn a one-tap decline
 * into a form.
 */
export function DeclineQuoteSheet({
  visible,
  shopName,
  total,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: Props) {
  const { isMobile } = useLayout();
  const [reason, setReason] = useState('');

  // Cleared on close, not on open: a sheet on its way out should not
  // visibly reset its field, and a reason typed for one quote must never
  // appear pre-filled on the next.
  useEffect(() => {
    if (!visible) setReason('');
  }, [visible]);

  const trimmed = reason.trim();
  const remaining = MAX_REASON - reason.length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={busy ? undefined : onCancel}
    >
      <Pressable
        style={styles.scrim}
        onPress={busy ? undefined : onCancel}
        accessibilityLabel="Close"
      />
      <View
        style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapCentre]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {isMobile && <View style={styles.grabber} />}

          <View style={styles.head}>
            <View style={styles.icon}>
              <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>Decline this quote?</Text>
              <Text style={styles.body}>
                {shopName} will be told you are not taking their offer
                {total != null ? ` of ${formatNaira(total)}` : ''}. Your booklist stays open, so
                other shops can still quote it.
              </Text>
            </View>
          </View>

          <Text style={styles.label}>
            Tell them why <Text style={styles.optional}>— optional</Text>
          </Text>
          <TextInput
            value={reason}
            onChangeText={(t) => setReason(t.slice(0, MAX_REASON))}
            placeholder="Too expensive, missing two books, found them elsewhere…"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            multiline
            numberOfLines={3}
            editable={!busy}
            maxLength={MAX_REASON}
            accessibilityLabel="Reason for declining, optional"
          />
          {remaining <= 80 && (
            <Text style={styles.counter}>{remaining} characters left</Text>
          )}

          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={[styles.actions, isMobile && styles.actionsMobile]}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [styles.btn, styles.keep, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              {/* Named for what it does. "Cancel" next to "Decline" is two
                  words for stopping and one of them is wrong. */}
              <Text style={styles.keepText}>Keep it</Text>
            </Pressable>

            <Pressable
              onPress={() => onConfirm(trimmed.length ? trimmed : null)}
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                styles.confirm,
                busy && styles.confirmBusy,
                pressed && !busy && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Decline this quote"
            >
              {busy ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator size="small" color={colors.onNavy} />
                  <Text style={styles.confirmText}>Declining…</Text>
                </View>
              ) : (
                <Text style={styles.confirmText}>Decline quote</Text>
              )}
            </Pressable>
          </View>
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

  head: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, minWidth: 0 },
  title: { ...typography.cardTitle },
  body: { ...typography.body, marginTop: 3 },

  label: { ...typography.caption, color: colors.textMuted },
  optional: { fontWeight: '400', color: colors.textFaint },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.md,
    color: colors.text,
    minHeight: 76,
    textAlignVertical: 'top',
  },
  counter: { ...typography.caption, textAlign: 'right' },

  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FCEAE8',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionsMobile: { flexDirection: 'column-reverse' },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  keep: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  keepText: { ...typography.bodyStrong, color: colors.textMuted },
  confirm: { backgroundColor: colors.danger },
  confirmBusy: { opacity: 0.8 },
  confirmText: { ...typography.bodyStrong, color: colors.onNavy },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
