import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import { routeBookRequest, directTo, describeBooklistError } from '../../lib/booklistUpload';
import type { BookRequest, ShopView } from '../../types/db';
import { colors, spacing, radius, font, shadow } from '../../theme';

interface Props {
  visible: boolean;
  shop: ShopView | null;
  userId: string | null;
  onClose: () => void;
  onSent: () => void;
  onCreateNew: () => void;
}

/**
 * "Request Quote" from a saved shop: pick one of the buyer's existing
 * booklists and address it to this vendor.
 *
 * Routes the list to this shop alone: dispatch_type becomes 'direct'
 * and target_vendor_id names the shop. After
 * bookshops_dispatch_routing.sql that is enforced rather than advisory —
 * vendor_request_queue() and requests_select_visible both drop a direct
 * request from every other shop's view — so this button now genuinely
 * takes the list off the open market.
 */
export function SendBooklistModal({ visible, shop, userId, onClose, onSent, onCreateNew }: Props) {
  const [lists, setLists] = useState<BookRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setSentTo(null);
      try {
        // Only lists still open for quoting are worth sending.
        const { data, error: e } = await supabase
          .from('book_requests')
          .select('id, buyer_id, school_name, class_level, image_url, image_path, target_vendor_id, status, created_at, updated_at')
          .eq('buyer_id', userId)
          .in('status', ['pending_quote', 'quoted'])
          .order('created_at', { ascending: false });
        if (e) throw e;
        if (!cancelled) setLists((data ?? []) as BookRequest[]);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, userId]);

  async function send(list: BookRequest) {
    if (!shop) return;
    setSendingId(list.id);
    setError(null);
    try {
      // Via routeBookRequest, not a bare update: dispatch_type and
      // target_vendor_id have to move together or
      // book_requests_dispatch_target_agree rejects the write. RLS
      // (requests_update_own) is what scopes it to this buyer.
      await routeBookRequest(list.id, directTo(shop.id));
      setSentTo(list.id);
      onSent();
    } catch (e) {
      setError(new Error(describeBooklistError(e)));
    } finally {
      setSendingId(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Request a quote</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                from {shop?.store_name ?? 'this shop'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: spacing.md }}>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.navy} />
              </View>
            ) : lists.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="documents-outline" size={26} color={colors.textFaint} />
                <Text style={styles.emptyText}>
                  You have no open booklists to send. Create one and this shop can quote it.
                </Text>
                <Pressable
                  onPress={() => {
                    onClose();
                    onCreateNew();
                  }}
                  style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaText}>Create a booklist</Text>
                </Pressable>
              </View>
            ) : (
              lists.map((list) => {
                const alreadySent = list.target_vendor_id === shop?.id || sentTo === list.id;
                return (
                  <Pressable
                    key={list.id}
                    onPress={() => !alreadySent && send(list)}
                    disabled={alreadySent || sendingId === list.id}
                    style={({ pressed }) => [styles.row, pressed && !alreadySent && styles.rowPressed]}
                    accessibilityRole="button"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {list.school_name || 'Untitled booklist'}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {[list.class_level, list.status.replace('_', ' ')].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {sendingId === list.id ? (
                      <ActivityIndicator size="small" color={colors.navy} />
                    ) : alreadySent ? (
                      <View style={styles.sentPill}>
                        <Ionicons name="checkmark" size={12} color={colors.success} />
                        <Text style={styles.sentText}>Sent</Text>
                      </View>
                    ) : (
                      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                    )}
                  </Pressable>
                );
              })
            )}

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
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
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  rowTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  rowMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1, textTransform: 'capitalize' },
  sentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E4F2E8',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  sentText: { fontSize: font.xs, fontWeight: '700', color: colors.success },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  emptyText: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  cta: {
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
  },
  ctaText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FCEAE8',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },
  pressed: { opacity: 0.85 },
});
