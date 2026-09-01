import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
  InteractionManager,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import { useProfileDetails } from '../../hooks/useProfileDetails';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

function Badge({ label, tone = 'neutral', icon }) {
  const t =
    tone === 'success'
      ? { bg: '#E4F2E8', fg: colors.success }
      : tone === 'warning'
      ? { bg: colors.warningBg, fg: colors.warning }
      : tone === 'brand'
      ? { bg: '#E4EAF5', fg: colors.navy }
      : { bg: colors.surfaceMuted, fg: colors.textMuted };

  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon && <Ionicons name={icon} size={11} color={t.fg} />}
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

function Stat({ value, label, demo }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
      {demo && <Text style={styles.statDemo}>example</Text>}
    </View>
  );
}

function Row({ icon, label, value, trailing }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={15} color={colors.textFaint} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      {trailing}
    </View>
  );
}

/**
 * Profile dropdown.
 *
 * Presented as an anchored card under the avatar on tablet and desktop,
 * and as a bottom sheet on mobile, where a small top-right popover is
 * awkward to hit. Both use a transparent Modal so the card floats above
 * the dashboard without a portal library, and both close on scrim press.
 */
export function ProfileMenu({ visible, onClose }) {
  const { isMobile } = useLayout();
  const [signingOut, setSigningOut] = useState(false);

  // Only queries while the menu is open — no cost on every dashboard load.
  const {
    loading,
    error,
    refresh,
    profile,
    vendor,
    counts,
    role,
    isVendor,
    email,
    emailVerified,
    displayName,
    addresses,
    savedShopsCount,
    vendorRating,
  } = useProfileDetails({ enabled: visible });

  /**
   * Editing lives on the Settings screen — this is a shortcut to it, not
   * a second copy of the form.
   *
   * Dismiss first, navigate after. Pushing a route while this Modal is
   * still mounted leaves it stranded above the new screen on iOS, so the
   * navigation waits for the dismissal animation to finish.
   * InteractionManager resolves on the next tick on web, so there is no
   * perceptible delay there.
   */
  /**
   * A vendor signing in lands on the buyer dashboard, which is not their
   * workspace. This is the one entry point to the vendor side, shown
   * only to vendor accounts — the role is already loaded here, so no
   * extra query is needed.
   */
  function handleVendorDashboard() {
    onClose?.();
    InteractionManager.runAfterInteractions(() => {
      router.push('/vendor');
    });
  }

  function handleEditProfile() {
    onClose?.();
    InteractionManager.runAfterInteractions(() => {
      router.push({ pathname: '/settings', params: { section: 'profile' } });
    });
  }

  async function handleSignOut() {
    setSigningOut(true);
    // app/_layout.js listens to onAuthStateChange and redirects to
    // /auth/login, so there is nothing to navigate to here.
    await supabase.auth.signOut();
    setSigningOut(false);
    onClose?.();
  }

  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close profile menu" />

        <View
          style={[styles.anchor, isMobile ? styles.anchorMobile : styles.anchorDesktop]}
          pointerEvents="box-none"
        >
          <View style={[styles.card, isMobile && styles.cardMobile]}>
            {isMobile && <View style={styles.grabber} />}

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.navy} />
              </View>
            ) : error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error.message}</Text>
                <Pressable onPress={refresh} hitSlop={6}>
                  <Text style={styles.retry}>Retry</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: isMobile ? 460 : 520 }}
                contentContainerStyle={styles.scroll}
                showsVerticalScrollIndicator={false}
              >
                {/* --- identity ------------------------------------ */}
                <View style={styles.identity}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <Text style={styles.email} numberOfLines={1}>
                      {email}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge
                        label={isVendor ? 'Vendor' : 'Buyer'}
                        tone="brand"
                        icon={isVendor ? 'storefront-outline' : 'person-outline'}
                      />
                      <Badge
                        label={emailVerified ? 'Email verified' : 'Email unverified'}
                        tone={emailVerified ? 'success' : 'warning'}
                        icon={emailVerified ? 'checkmark-circle' : 'time-outline'}
                      />
                      {isVendor && (
                        <Badge
                          label={vendor?.is_active ? 'Shop active' : vendor ? 'Shop inactive' : 'No shop yet'}
                          tone={vendor?.is_active ? 'success' : 'warning'}
                          icon="business-outline"
                        />
                      )}
                    </View>
                  </View>
                </View>

                <View style={styles.rule} />

                {/* --- role-specific ------------------------------- */}
                {isVendor ? (
                  <>
                    <Row
                      icon="storefront-outline"
                      label="Business name"
                      value={vendor?.store_name || 'Not set up yet — use Edit Profile'}
                    />
                    <Row
                      icon="location-outline"
                      label="Store address"
                      value={
                        vendor
                          ? [vendor.address, vendor.city].filter(Boolean).join(', ') || 'No address on file'
                          : '—'
                      }
                    />
                    <View style={styles.stats}>
                      {/* TODO(db): vendors has no rating column. */}
                      <Stat
                        value={`${vendorRating.rating} ★`}
                        label={`Rating · ${vendorRating.review_count} reviews`}
                        demo
                      />
                      <Stat value={counts.completedOrders} label="Completed orders" />
                    </View>
                  </>
                ) : (
                  <>
                    <Row
                      icon="call-outline"
                      label="Contact phone"
                      value={profile?.phone_number || 'Not added yet'}
                    />

                    <Text style={styles.sectionLabel}>
                      Delivery addresses
                      <Text style={styles.sectionDemo}>  · example data</Text>
                    </Text>
                    {/* TODO(db): needs an `addresses` table — see useProfileDetails.js */}
                    {addresses.map((a) => (
                      <View key={a.id} style={styles.address}>
                        <Ionicons name="location-outline" size={15} color={colors.textFaint} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.addressLabel}>
                            {a.label}
                            {a.is_default ? ' · Default' : ''}
                          </Text>
                          <Text style={styles.addressLine} numberOfLines={1}>
                            {a.line1}, {a.city}
                          </Text>
                        </View>
                      </View>
                    ))}

                    <View style={styles.stats}>
                      <Stat value={counts.activeBooklists} label="Active booklists" />
                      <Stat value={counts.pendingQuotes} label="Pending quotes" />
                      {/* TODO(db): needs a `saved_shops` table. */}
                      <Stat value={savedShopsCount} label="Saved shops" demo />
                    </View>
                  </>
                )}
              </ScrollView>
            )}

            {/* --- actions ------------------------------------- */}
            {isVendor && (
              <Pressable
                onPress={handleVendorDashboard}
                style={({ pressed }) => [styles.vendorLink, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Open the vendor dashboard"
              >
                <Ionicons name="storefront-outline" size={16} color={colors.orangeDark} />
                <Text style={styles.vendorLinkText}>Go to vendor dashboard</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.orangeDark} />
              </Pressable>
            )}

            <View style={styles.actions}>
              <Pressable
                onPress={handleEditProfile}
                disabled={loading || !profile}
                style={({ pressed }) => [
                  styles.action,
                  styles.actionPrimary,
                  (loading || !profile) && styles.actionDisabled,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Ionicons name="create-outline" size={16} color={colors.onNavy} />
                <Text style={styles.actionPrimaryText}>Edit Profile</Text>
              </Pressable>

              <Pressable
                onPress={handleSignOut}
                disabled={signingOut}
                style={({ pressed }) => [styles.action, styles.actionGhost, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {signingOut ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <>
                    <Ionicons name="log-out-outline" size={16} color={colors.danger} />
                    <Text style={styles.actionGhostText}>Sign Out</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.35)' },

  anchor: { ...StyleSheet.absoluteFill },
  // Sits just under the 62px top bar, aligned to the avatar on the right.
  anchorDesktop: { alignItems: 'flex-end', paddingTop: 62, paddingRight: spacing.lg },
  anchorMobile: { justifyContent: 'flex-end' },

  card: {
    width: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
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

  loading: { padding: spacing.xxl, alignItems: 'center' },
  scroll: { padding: spacing.lg },

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
  name: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  email: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeText: { fontSize: font.xs, fontWeight: '700' },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },

  row: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  rowLabel: { fontSize: font.xs, color: colors.textFaint, fontWeight: '600' },
  rowValue: { fontSize: font.md, color: colors.text, marginTop: 1 },

  sectionLabel: {
    fontSize: font.xs,
    color: colors.textFaint,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  sectionDemo: { color: colors.orangeDark, fontStyle: 'italic' },

  address: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addressLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  addressLine: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  stat: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  statValue: { fontSize: font.xl, fontWeight: '800', color: colors.navy },
  statLabel: { fontSize: font.xs, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  statDemo: { fontSize: 9, color: colors.orangeDark, fontStyle: 'italic', marginTop: 1 },

  vendorLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#FDE8D2',
  },
  vendorLinkText: { flex: 1, fontSize: font.sm, fontWeight: '700', color: colors.orangeDark },

  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    paddingVertical: 11,
    minHeight: 40,
  },
  actionPrimary: { backgroundColor: colors.navy },
  actionPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  actionGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#F0C4BF' },
  actionGhostText: { color: colors.danger, fontWeight: '700', fontSize: font.md },
  actionDisabled: { backgroundColor: colors.borderStrong },
  pressed: { opacity: 0.85 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
});
