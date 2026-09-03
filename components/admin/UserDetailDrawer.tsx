import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import { Skeleton } from '../vendor/PayoutParts';
import { actionability, type AdminUserRow } from '../../hooks/useAdminUsers';

interface SuspensionEvent {
  id: string;
  action: string;
  created_at: string;
  detail: { reason?: string | null } | null;
}

interface Props {
  user: AdminUserRow | null;
  currentUserId: string | null;
  onClose: () => void;
  onSuspend: (row: AdminUserRow) => void;
  onUnsuspend: (row: AdminUserRow) => void;
  busy: boolean;
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono, !value && styles.missing]}>
        {value || 'Not on file'}
      </Text>
    </View>
  );
}

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

/**
 * One account, in full.
 *
 * The activity counts and the suspension history are fetched on open
 * rather than with the list: three extra round trips per row would make
 * a directory of any size unusable.
 *
 * Suspension history comes from admin_actions, which has no INSERT,
 * UPDATE or DELETE policy at all — so this is a record the admins it
 * describes cannot edit.
 */
export function UserDetailDrawer({ user, currentUserId, onClose, onSuspend, onUnsuspend, busy }: Props) {
  const { isMobile, width } = useLayout();
  const [orders, setOrders] = useState<number | null>(null);
  const [booklists, setBooklists] = useState<number | null>(null);
  const [history, setHistory] = useState<SuspensionEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);

    (async () => {
      const [orderRes, listRes, logRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('buyer_id', user.id),
        supabase.from('book_requests').select('id', { count: 'exact', head: true }).eq('buyer_id', user.id),
        supabase
          .from('admin_actions')
          .select('id, action, created_at, detail')
          .eq('subject_id', user.id)
          .in('action', ['suspend_user', 'unsuspend_user'])
          .order('created_at', { ascending: false })
          .limit(10),
      ]);
      if (!active) return;
      setOrders(orderRes.error ? null : (orderRes.count ?? 0));
      setBooklists(listRes.error ? null : (listRes.count ?? 0));
      setHistory(logRes.error ? [] : ((logRes.data ?? []) as SuspensionEvent[]));
      setLoading(false);
    })().catch(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  if (!user) return null;

  const { allowed, reason: blockedReason } = actionability(user, currentUserId);
  const initials = (user.full_name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close user details" />

      <View style={[styles.anchor, isMobile ? styles.anchorMobile : styles.anchorDesktop]} pointerEvents="box-none">
        <View style={[styles.panel, { width: isMobile ? width : 440 }, isMobile && styles.panelMobile]}>
          <View style={styles.head}>
            <View style={[styles.avatar, user.suspended_at && styles.avatarSuspended]}>
              <Text style={styles.avatarText}>{initials || '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>{user.full_name ?? 'Unnamed account'}</Text>
              <Text style={styles.roleLine}>
                {user.role === 'admin' ? 'Administrator' : user.role === 'vendor' ? 'Vendor' : 'Buyer'}
                {user.suspended_at ? ' · Suspended' : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Account</Text>
              <Row label="Email" value={user.email} />
              <Row label="Phone" value={user.phone_number} />
              <Row label="Joined" value={dt(user.created_at)} />
              <Row label="Last signed in" value={dt(user.last_sign_in_at)} />
              <Row
                label="Email confirmed"
                value={user.email_confirmed_at ? dt(user.email_confirmed_at) : null}
              />
              {/* The id is what you paste into a SQL query or a support
                  ticket, so it is shown in full rather than truncated. */}
              <Row label="User ID" value={user.id} mono />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Activity</Text>
              {loading ? (
                <Skeleton width="90%" height={40} />
              ) : (
                <View style={styles.stats}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{orders ?? '—'}</Text>
                    <Text style={styles.statLabel}>Orders placed</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{booklists ?? '—'}</Text>
                    <Text style={styles.statLabel}>Booklists sent</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{user.store_name ? 'Yes' : 'No'}</Text>
                    <Text style={styles.statLabel}>Owns a shop</Text>
                  </View>
                </View>
              )}
              {!!user.store_name && (
                <Text style={styles.shopNote}>Shop: {user.store_name}</Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Suspension history</Text>
              {loading ? (
                <Skeleton width="80%" height={16} />
              ) : history.length === 0 ? (
                <Text style={styles.note}>
                  {user.suspended_at
                    ? 'Currently suspended, but no logged action — it was set directly in the database rather than through the console.'
                    : 'Never suspended.'}
                </Text>
              ) : (
                history.map((h) => (
                  <View key={h.id} style={styles.event}>
                    <View
                      style={[
                        styles.eventDot,
                        { backgroundColor: h.action === 'suspend_user' ? colors.danger : colors.success },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventText}>
                        {h.action === 'suspend_user' ? 'Suspended' : 'Reinstated'} on {dt(h.created_at)}
                      </Text>
                      {!!h.detail?.reason && <Text style={styles.eventReason}>{h.detail.reason}</Text>}
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            {!allowed ? (
              <View style={styles.blocked}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
                <Text style={styles.blockedText}>{blockedReason}</Text>
              </View>
            ) : user.suspended_at ? (
              <Pressable
                onPress={() => onUnsuspend(user)}
                disabled={busy}
                style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Reinstate ${user.full_name ?? 'this account'}`}
              >
                <Ionicons name="refresh" size={15} color={colors.onNavy} />
                <Text style={styles.btnGoText}>Reinstate account</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => onSuspend(user)}
                disabled={busy}
                style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Suspend ${user.full_name ?? 'this account'}`}
              >
                <Ionicons name="ban-outline" size={15} color={colors.danger} />
                <Text style={styles.btnDangerText}>Suspend account</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.4)' },
  anchor: { ...StyleSheet.absoluteFill },
  anchorDesktop: { alignItems: 'flex-end' },
  anchorMobile: { justifyContent: 'flex-end' },

  panel: { flex: 1, backgroundColor: colors.surface, ...shadow.raised },
  panelMobile: { flex: 0, maxHeight: '92%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },

  head: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSuspended: { backgroundColor: colors.danger },
  avatarText: { color: colors.onNavy, fontWeight: '800', fontSize: font.lg },
  name: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  roleLine: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: {
    fontSize: font.xs, fontWeight: '800', color: colors.textFaint,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  rowLabel: { width: 120, fontSize: font.sm, color: colors.textMuted },
  rowValue: { flex: 1, fontSize: font.md, color: colors.text },
  missing: { color: colors.textFaint, fontStyle: 'italic' },
  mono: { fontSize: font.sm, letterSpacing: 0.3 },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: {
    flexGrow: 1, flexBasis: 110, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, padding: spacing.md, gap: 2,
  },
  statValue: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textMuted },
  shopNote: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

  note: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  event: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingVertical: 4 },
  eventDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  eventText: { fontSize: font.sm, color: colors.text },
  eventReason: { fontSize: font.xs, color: colors.textMuted, lineHeight: 16 },

  actions: {
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 11,
  },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.md, fontWeight: '700' },
  btnDanger: { backgroundColor: colors.surface, borderColor: '#F0C4BF' },
  btnDangerText: { color: colors.danger, fontSize: font.md, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  blocked: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  blockedText: { flex: 1, fontSize: font.sm, color: colors.textMuted },
});
