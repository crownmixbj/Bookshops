import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import type { Vendor } from '../../types/db';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  visible: boolean;
  vendor: Vendor | null;
  onClose: () => void;
}

function Badge({ label, tone, icon }: {
  label: string;
  tone: 'success' | 'warning' | 'neutral';
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const t =
    tone === 'success'
      ? { bg: '#E4F2E8', fg: colors.success }
      : tone === 'warning'
      ? { bg: colors.warningBg, fg: colors.warning }
      : { bg: colors.surfaceMuted, fg: colors.textMuted };
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Ionicons name={icon} size={11} color={t.fg} />
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

function Row({ icon, label, value }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={15} color={colors.textFaint} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
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
 * The vendor account dropdown.
 *
 * This exists because the vendor identity badge used to be a bare
 * `router.push('/settings')`, which threw a vendor straight into the
 * buyer shell — the badge looked like a menu and behaved like a
 * navigation. It now opens this, and nothing navigates on a single tap
 * of the badge.
 *
 * Switching to the buyer side is a labelled item in its own section, not
 * a side effect of clicking your own shop name. A vendor is also a buyer
 * — they can order books for their own family — so the route exists, but
 * it should be chosen, not stumbled into.
 */
export function VendorProfileMenu({ visible, vendor, onClose }: Props) {
  const { isMobile } = useLayout();
  const [email, setEmail] = useState('');

  // Only when opened: the header does not need this on every render.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? '');
    });
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
    // app/_layout.js sees the auth change and routes to login.
    await supabase.auth.signOut();
  }

  const initials = (vendor?.store_name ?? 'S')
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
            style={{ maxHeight: isMobile ? 460 : 520 }}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.identity}>
              <View style={styles.logo}>
                <Text style={styles.logoText}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>VENDOR ACCOUNT</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {vendor?.store_name ?? 'Shop not set up'}
                </Text>
                <Text style={styles.email} numberOfLines={1}>
                  {email || '—'}
                </Text>
              </View>
            </View>

            <View style={styles.badges}>
              <Badge
                label={vendor?.verified_at ? 'Verified' : 'Unverified'}
                tone={vendor?.verified_at ? 'success' : 'warning'}
                icon={vendor?.verified_at ? 'checkmark-circle' : 'time-outline'}
              />
              <Badge
                label={vendor?.is_active ? 'Open for quotes' : 'Not trading'}
                tone={vendor?.is_active ? 'success' : 'neutral'}
                icon="storefront-outline"
              />
              {vendor?.busy_mode && (
                <Badge label="Busy mode on" tone="warning" icon="flash-outline" />
              )}
            </View>

            <View style={styles.rule} />

            {vendor ? (
              <>
                <Row
                  icon="location-outline"
                  label="Shop address"
                  value={
                    [vendor.address, vendor.city].filter(Boolean).join(', ') ||
                    'No address on file'
                  }
                />
                <Row
                  icon="call-outline"
                  label="Business phone"
                  value={vendor.phone || 'Not added yet'}
                />
                <Row
                  icon="mail-outline"
                  label="Business email"
                  value={vendor.email || 'Not added yet'}
                />

                <View style={styles.stats}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {vendor.rating != null ? `${vendor.rating.toFixed(1)} ★` : '—'}
                    </Text>
                    <Text style={styles.statLabel}>
                      {vendor.review_count} review{vendor.review_count === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{vendor.completed_orders}</Text>
                    <Text style={styles.statLabel}>Completed orders</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.setup}>
                Your shop isn't set up yet. Add your business details and buyers will start
                seeing you in the marketplace.
              </Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Action
              icon="storefront-outline"
              label={vendor ? 'Shop & account settings' : 'Set up my shop'}
              onPress={() => go('/settings')}
            />

            <View style={styles.rule} />

            {/* Deliberately its own section, deliberately labelled. */}
            <Action
              icon="swap-horizontal-outline"
              label="Switch to buyer view"
              tone="switch"
              onPress={() => go('/')}
            />
            <Text style={styles.switchNote}>
              Your shop stays open — this only changes which side of LOCI you're looking at.
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
  // Clears the 56px vendor bar plus the busy strip beneath it.
  anchorDesktop: { alignItems: 'flex-end', paddingTop: 92, paddingRight: spacing.lg },
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
  logo: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: colors.onNavy, fontWeight: '800', fontSize: font.lg },
  eyebrow: { fontSize: 9, fontWeight: '800', color: colors.textFaint, letterSpacing: 0.6 },
  name: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  email: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeText: { fontSize: font.xs, fontWeight: '700' },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  row: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  rowLabel: { fontSize: font.xs, color: colors.textFaint, fontWeight: '600' },
  rowValue: { fontSize: font.md, color: colors.text, marginTop: 1 },

  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  statValue: { fontSize: font.lg, fontWeight: '800', color: colors.navy },
  statLabel: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },

  setup: { fontSize: font.md, color: colors.textMuted, lineHeight: 20 },

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
