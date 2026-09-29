import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AppNotification, NotificationKind } from '../../types/db';
import { relativeStamp } from '../vendor/VendorPageParts';
import { useLayout } from '../../hooks/useLayout';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * The bell's dropdown: quote updates, messages and order progress.
 *
 * A Modal rather than an absolutely-positioned View so it sits above
 * the sidebar and page on every platform without z-index negotiations;
 * the card itself is pinned under the bell on wide screens and becomes
 * a top sheet on a phone.
 */

const KIND_ICON: Record<NotificationKind, { icon: keyof typeof Ionicons.glyphMap; fg: string; bg: string }> = {
  quote_received: { icon: 'pricetag-outline', fg: colors.navy, bg: '#E8EEF8' },
  quote_updated: { icon: 'create-outline', fg: colors.navy, bg: '#E8EEF8' },
  quote_withdrawn: { icon: 'arrow-undo-outline', fg: colors.warning, bg: colors.warningBg },
  message: { icon: 'chatbubble-ellipses-outline', fg: colors.orangeDark, bg: '#FDF1E6' },
  payment_held: { icon: 'shield-checkmark-outline', fg: colors.success, bg: '#E4F2E8' },
  order_dispatched: { icon: 'car-outline', fg: colors.navyLight, bg: '#E8EEF8' },
  order_delivered: { icon: 'checkmark-done-outline', fg: colors.success, bg: '#E4F2E8' },
  order_cancelled: { icon: 'close-circle-outline', fg: colors.danger, bg: '#FCEAE8' },
  escrow_released: { icon: 'cash-outline', fg: colors.success, bg: '#E4F2E8' },
  // Vendor alerts
  request_received: { icon: 'document-text-outline', fg: colors.navy, bg: '#E8EEF8' },
  order_placed: { icon: 'cube-outline', fg: colors.orangeDark, bg: '#FDF1E6' },
  quote_declined: { icon: 'close-circle-outline', fg: colors.textMuted, bg: colors.surfaceMuted },
  buyer_message: { icon: 'chatbubble-ellipses-outline', fg: colors.orangeDark, bg: '#FDF1E6' },
  payment_released: { icon: 'cash-outline', fg: colors.success, bg: '#E4F2E8' },
};

/** The panel is shared; only its empty-state words differ by role. */
const COPY = {
  buyer: {
    caption: 'Quote updates, messages and deliveries',
    empty: 'New quotes, messages from shops and delivery updates will appear here.',
    file: 'bookshops_buyer_portal.sql',
  },
  vendor: {
    caption: 'New booklists, orders, messages and payments',
    empty: 'Booklists sent to your shop, new orders, buyer messages and released payments will appear here.',
    file: 'bookshops_vendor_alerts.sql',
  },
};

interface Props {
  visible: boolean;
  items: AppNotification[];
  unread: number;
  loading: boolean;
  migrationMissing: boolean;
  onClose: () => void;
  onOpen: (n: AppNotification) => void;
  onMarkAllRead: () => void;
  /** Whose bell this is. Defaults to the buyer's. */
  audience?: 'buyer' | 'vendor';
}

export function NotificationsPanel({
  visible,
  items,
  unread,
  loading,
  migrationMissing,
  onClose,
  onOpen,
  onMarkAllRead,
  audience = 'buyer',
}: Props) {
  const { isMobile } = useLayout();
  const copy = COPY[audience];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close notifications" />
      <View style={[styles.card, isMobile ? styles.cardMobile : styles.cardDesktop]}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Notifications</Text>
            <Text style={styles.caption}>
              {unread > 0 ? `${unread} unread` : copy.caption}
            </Text>
          </View>
          {unread > 0 && (
            <Pressable onPress={onMarkAllRead} hitSlop={6} accessibilityRole="button">
              <Text style={styles.link}>Mark all read</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView style={styles.list}>
          {migrationMissing ? (
            <View style={styles.state}>
              <Ionicons name="construct-outline" size={24} color={colors.textFaint} />
              <Text style={styles.stateTitle}>Notifications are not switched on yet</Text>
              <Text style={styles.stateBody}>Run {copy.file} on this project to turn them on.</Text>
            </View>
          ) : loading && items.length === 0 ? (
            <View style={styles.state}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : items.length === 0 ? (
            <View style={styles.state}>
              <Ionicons name="notifications-off-outline" size={24} color={colors.textFaint} />
              <Text style={styles.stateTitle}>You are all caught up</Text>
              <Text style={styles.stateBody}>
                {copy.empty}
              </Text>
            </View>
          ) : (
            items.map((n) => {
              const look = KIND_ICON[n.kind] ?? KIND_ICON.quote_received;
              const isUnread = !n.read_at;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => onOpen(n)}
                  style={({ pressed }) => [styles.row, isUnread && styles.rowUnread, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${n.title}. ${n.body ?? ''}`}
                >
                  <View style={[styles.icon, { backgroundColor: look.bg }]}>
                    <Ionicons name={look.icon} size={16} color={look.fg} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.rowTitle, isUnread && styles.rowTitleUnread]} numberOfLines={1}>
                      {n.title}
                    </Text>
                    {!!n.body && (
                      <Text style={styles.rowBody} numberOfLines={2}>
                        {n.body}
                      </Text>
                    )}
                    <Text style={styles.rowTime}>{relativeStamp(n.created_at)}</Text>
                  </View>
                  {isUnread && <View style={styles.dot} />}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.25)' },
  card: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    maxHeight: '80%',
    ...shadow.raised,
  },
  cardDesktop: { top: 64, right: spacing.lg, width: 380 },
  cardMobile: { top: 56, left: spacing.md, right: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  caption: { fontSize: font.xs, color: colors.textFaint, marginTop: 1 },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  list: { flexGrow: 0 },
  state: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  stateTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, textAlign: 'center' },
  stateBody: { fontSize: font.sm, color: colors.textFaint, textAlign: 'center', lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowUnread: { backgroundColor: '#F7F9FD' },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rowTitleUnread: { fontWeight: '800' },
  rowBody: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  rowTime: { fontSize: font.xs, color: colors.textFaint, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.orange, marginTop: 6 },
});
