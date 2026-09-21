import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SendableBooklist } from '../../hooks/useShopQuotes';
import { useLayout } from '../../hooks/useLayout';
import { colors, spacing, radius, font, shadow } from '../../theme';

interface Props {
  visible: boolean;
  shopName: string;
  booklists: SendableBooklist[];
  /** Id of the booklist currently being sent, if any. */
  sendingId: string | null;
  error: string | null;
  onSend: (booklist: SendableBooklist) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

/**
 * Pick a booklist to send to one shop.
 *
 * The two kinds of list here behave differently once sent, and the sheet
 * says which is which rather than hiding it: a draft is published and
 * addressed to this shop, while a list already out on the open market is
 * re-pointed at them — which withdraws it from every other shop's queue,
 * possibly mid-quote. That is a consequence worth reading before tapping.
 */
export function SendBooklistSheet({
  visible,
  shopName,
  booklists,
  sendingId,
  error,
  onSend,
  onCreateNew,
  onClose,
}: Props) {
  const { isMobile } = useLayout();
  const busy = sendingId !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.scrim}
        onPress={busy ? undefined : onClose}
        accessibilityLabel="Close"
      />
      <View
        style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapCentre]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {isMobile && <View style={styles.grabber} />}

          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title}>Send a Booklist</Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                Pick one to send to {shopName}. Only they will see it.
              </Text>
            </View>
            <Pressable onPress={onClose} disabled={busy} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {!!error && (
            <View style={styles.error}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {booklists.map((b) => {
              const thisOne = sendingId === b.id;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => onSend(b)}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && !busy && styles.rowPressed,
                    busy && !thisOne && styles.rowDim,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${b.title} to ${shopName}`}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons
                      name={b.isDraft ? 'create-outline' : 'paper-plane-outline'}
                      size={18}
                      color={colors.navy}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {b.title}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {[
                        b.classLevel,
                        `${b.itemCount} item${b.itemCount === 1 ? '' : 's'}`,
                        b.isDraft ? 'Draft' : 'Currently with other shops',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {/* Said on the row that causes it, not in a footnote. */}
                    {b.alreadyPublished && (
                      <Text style={styles.rowWarn}>
                        Sending moves it to {shopName} only — other shops lose it.
                      </Text>
                    )}
                  </View>
                  {thisOne ? (
                    <ActivityIndicator size="small" color={colors.navy} />
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={onCreateNew}
            disabled={busy}
            style={({ pressed }) => [styles.new, pressed && !busy && styles.newPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Create a new booklist for ${shopName}`}
          >
            <Ionicons name="add" size={16} color={colors.navy} />
            <Text style={styles.newText}>Create a new booklist instead</Text>
          </Pressable>
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
    maxWidth: 460,
    maxHeight: '85%',
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

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, lineHeight: 18 },

  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#FDECEA',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },

  list: { marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 62,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  rowDim: { opacity: 0.45 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  rowMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  rowWarn: { fontSize: font.xs, color: colors.warning, marginTop: 2, lineHeight: 15 },

  new: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 12,
    minHeight: 44,
  },
  newPressed: { backgroundColor: colors.surfaceMuted },
  newText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
});
