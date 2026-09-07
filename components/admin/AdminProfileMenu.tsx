import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import type { AdminAction } from '../../types/db';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const ACTION_LABEL: Record<string, string> = {
  set_role: 'changed a role',
  suspend_user: 'suspended a user',
  unsuspend_user: 'lifted a suspension',
  approve_vendor: 'approved a vendor',
  reject_vendor: 'rejected a vendor',
  feature_vendor: 'featured a shop',
  unfeature_vendor: 'unfeatured a shop',
  resolve_report: 'resolved a report',
};

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Action({ icon, label, onPress, tone = 'default' }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'switch' | 'danger';
}) {
  const fg =
    tone === 'danger' ? colors.danger : tone === 'switch' ? colors.orangeDark : colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        tone === 'switch' && styles.actionSwitch,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={fg} />
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

/**
 * The admin account menu.
 *
 * Exists for the same reason the vendor one does: the identity badge in
 * the admin header was a bare `router.push('/settings')`, which dropped
 * an admin into the buyer shell. A badge that looks like a menu must
 * behave like one — nothing navigates on a single tap of it.
 *
 * The recent-actions strip is the admin's own audit trail, read straight
 * from `admin_actions`. It is scoped to this admin so the menu answers
 * "what have I just done" rather than duplicating the platform-wide feed
 * already on the dashboard.
 */
export function AdminProfileMenu({ visible, onClose }: Props) {
  const { isMobile } = useLayout();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [since, setSince] = useState<string | null>(null);
  const [recent, setRecent] = useState<AdminAction[]>([]);
  const [loading, setLoading] = useState(false);

  // Only queries while open — the header should not pay for this.
  useEffect(() => {
    if (!visible) return;
    let active = true;

    (async () => {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!active || !user) return;
        setEmail(user.email ?? '');

        const [profileRes, actionsRes] = await Promise.all([
          supabase.from('profiles').select('full_name, created_at').eq('id', user.id).maybeSingle(),
          supabase
            .from('admin_actions')
            .select('*')
            .eq('actor_id', user.id)
            .order('created_at', { ascending: false })
            .limit(4),
        ]);

        if (!active) return;
        setName(profileRes.data?.full_name?.trim() || 'Administrator');
        setSince(profileRes.data?.created_at ?? null);
        // The audit table may not exist yet if the migration has not been
        // run; an empty strip is better than an error in a menu.
        setRecent((actionsRes.data ?? []) as AdminAction[]);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [visible]);

  function go(path: '/settings' | '/') {
    onClose();
    router.push(path);
  }

  async function signOut() {
    onClose();
    await supabase.auth.signOut(); // app/_layout.js routes to login
  }

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close account menu" />

      <View
        style={[styles.anchor, isMobile ? styles.anchorMobile : styles.anchorDesktop]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {isMobile && <View style={styles.grabber} />}

          <ScrollView
            style={{ maxHeight: isMobile ? 440 : 500 }}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials || 'A'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.eyebrowRow}>
                  <Ionicons name="shield-checkmark" size={11} color={colors.danger} />
                  <Text style={styles.eyebrow}>ADMINISTRATOR</Text>
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {name || '—'}
                </Text>
                <Text style={styles.email} numberOfLines={1}>
                  {email || '—'}
                </Text>
              </View>
            </View>

            {!!since && (
              <Text style={styles.since}>
                Admin account since{' '}
                {new Date(since).toLocaleDateString('en-NG', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            )}

            <View style={styles.notice}>
              <Ionicons name="lock-closed-outline" size={13} color={colors.textMuted} />
              <Text style={styles.noticeText}>
                Admin rights are granted only with the service key. Nothing in this console can
                create or remove an administrator.
              </Text>
            </View>

            <View style={styles.rule} />

            <Text style={styles.sectionLabel}>Your recent actions</Text>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={colors.navy} />
              </View>
            ) : recent.length === 0 ? (
              <Text style={styles.emptyLog}>
                Nothing logged yet. Every moderation action you take is recorded here and cannot
                be edited or deleted.
              </Text>
            ) : (
              recent.map((a) => (
                <View key={a.id} style={styles.logRow}>
                  <View style={styles.logDot} />
                  <Text style={styles.logText} numberOfLines={2}>
                    You {ACTION_LABEL[a.action] ?? a.action}
                  </Text>
                  <Text style={styles.logTime}>{timeAgo(a.created_at)}</Text>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Action
              icon="document-text-outline"
              label="System activity log"
              onPress={() => {
                // The full log lives on the dashboard's activity feed;
                // there is no dedicated /admin/logs route yet.
                onClose();
                router.push('/admin/dashboard');
              }}
            />
            <Action icon="settings-outline" label="Admin settings" onPress={() => go('/settings')} />

            <View style={styles.rule} />

            {/* Its own section, and labelled — never a side effect of
                tapping your own name. */}
            <Action
              icon="swap-horizontal-outline"
              label="Switch to buyer view"
              tone="switch"
              onPress={() => go('/')}
            />
            <Text style={styles.switchNote}>
              You keep your admin rights — this only changes which side of LOCI you're looking at.
            </Text>

            <View style={styles.rule} />

            <Action icon="log-out-outline" label="Sign out" tone="danger" onPress={signOut} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.35)' },
  anchor: { ...StyleSheet.absoluteFill },
  // Clears the 54px admin bar.
  anchorDesktop: { alignItems: 'flex-end', paddingTop: 58, paddingRight: spacing.lg },
  anchorMobile: { justifyContent: 'flex-end' },

  card: {
    width: 330,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.raised,
  },
  cardMobile: { width: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
  },

  scroll: { padding: spacing.lg, paddingBottom: spacing.md },
  identity: { flexDirection: 'row', gap: spacing.md },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.onNavy, fontWeight: '800', fontSize: font.lg },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eyebrow: { fontSize: 9, fontWeight: '800', color: colors.danger, letterSpacing: 0.6 },
  name: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  email: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  since: { fontSize: font.xs, color: colors.textFaint, marginTop: spacing.md },

  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.xs, color: colors.textMuted, lineHeight: 16 },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  sectionLabel: {
    fontSize: font.xs,
    fontWeight: '800',
    color: colors.textFaint,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  loading: { paddingVertical: spacing.md, alignItems: 'center' },
  emptyLog: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  logDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.navy },
  logText: { flex: 1, fontSize: font.sm, color: colors.text },
  logTime: { fontSize: font.xs, color: colors.textFaint },

  actions: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  actionSwitch: { backgroundColor: '#FDE8D2' },
  actionText: { flex: 1, fontSize: font.md, fontWeight: '600' },
  switchNote: {
    fontSize: font.xs,
    color: colors.textFaint,
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    lineHeight: 15,
  },
  pressed: { opacity: 0.85 },
});
