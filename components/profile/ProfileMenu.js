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

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
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
    signedOut,
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

  /**
   * Dismiss, then go. Same sequencing as the other two: pushing a route
   * from under a live Modal strands it above the new screen on iOS.
   */
  function handleSignIn() {
    onClose?.();
    InteractionManager.runAfterInteractions(() => {
      router.push('/auth/login');
    });
  }

  function handleEditProfile() {
    onClose?.();
    InteractionManager.runAfterInteractions(() => {
      router.push({ pathname: '/settings', params: { section: 'profile' } });
    });
  }

  /**
   * Sign out, and mean it.
   *
   * Three things, in this order, because the failure mode of getting it
   * wrong is a menu that says "signed out" while the tokens are still on
   * the device:
   *
   *   1. supabase.auth.signOut() clears the stored session and fires
   *      SIGNED_OUT, which useProfileDetails listens for and wipes on.
   *   2. The card is closed regardless of the result. A network error
   *      here means the server could not be told, but supabase-js has
   *      already dropped the local session either way — so the person IS
   *      signed out on this device, and holding the menu open over an
   *      error would say otherwise.
   *   3. Where they land is not decided here. app/_layout.js watches the
   *      session: a protected route bounces to /auth/login, and a public
   *      one — the dashboard, a shop page — simply stays open as a
   *      guest. That is the point of guest browsing, and navigating
   *      to the login form from here would undo it.
   */
  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      // Logged rather than shown. The local session is gone whatever the
      // server said, so this is a developer's problem, not the person's.
      if (signOutError) console.warn('[auth] sign-out reported:', signOutError.message);
    } catch (e) {
      console.warn('[auth] sign-out threw:', e);
    } finally {
      setSigningOut(false);
      onClose?.();
    }
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
            ) : signedOut ? (
              /* Reachable only if the session drops while the menu is
                 open — AppShell will not mount it without one. There is
                 nothing to show and nothing to retry, so it says so and
                 offers the way back in, rather than rendering an empty
                 identity card or a red error. */
              <View style={styles.guest}>
                <Ionicons name="person-circle-outline" size={30} color={colors.textFaint} />
                <Text style={styles.guestTitle}>You're signed out</Text>
                <Text style={styles.guestBody}>
                  Log in to see your profile, booklists and orders.
                </Text>
                <Pressable
                  onPress={handleSignIn}
                  style={({ pressed }) => [styles.guestAction, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Log in"
                >
                  <Text style={styles.guestActionText}>Log in</Text>
                </Pressable>
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
                      {/* vendorRating is null until at least one review
                          exists. "0 ★" would read as a bad shop rather
                          than a new one, which is the opposite of true
                          and unfair to a business that has done nothing
                          wrong. */}
                      {vendorRating ? (
                        <Stat
                          value={`${vendorRating.rating.toFixed(1)} ★`}
                          label={`Rating · ${vendorRating.review_count} review${
                            vendorRating.review_count === 1 ? '' : 's'
                          }`}
                        />
                      ) : (
                        <Stat value="—" label="No rating yet" />
                      )}
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

                    {/* Singular: profiles holds one default delivery
                        address, so the old plural promised a list the
                        buyer could not have. */}
                    <Text style={styles.sectionLabel}>Delivery address</Text>
                    {addresses.length === 0 ? (
                      <Text style={styles.addressEmpty}>
                        No delivery address saved yet. Add one in Settings so shops know where to
                        send your books.
                      </Text>
                    ) : (
                      addresses.map((a) => (
                        <View key={a.id} style={styles.address}>
                          <Ionicons name="location-outline" size={15} color={colors.textFaint} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.addressLabel}>{a.label}</Text>
                            <Text style={styles.addressLine} numberOfLines={1}>
                              {[a.line1, a.city].filter(Boolean).join(', ')}
                            </Text>
                            {!!a.phone && (
                              <Text style={styles.addressLine} numberOfLines={1}>
                                {a.phone}
                              </Text>
                            )}
                          </View>
                        </View>
                      ))
                    )}

                    <View style={styles.stats}>
                      <Stat value={counts.activeBooklists} label="Active booklists" />
                      <Stat value={counts.pendingQuotes} label="Pending quotes" />
                      <Stat value={savedShopsCount} label="Saved shops" />
                    </View>
                  </>
                )}
              </ScrollView>
            )}

            {/* --- actions ------------------------------------- */}
            {/* Edit Profile edits a profile that is not there, and Sign
                Out signs out a session that is already gone. Neither
                belongs on a signed-out card. */}
            {!signedOut && isVendor && (
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

            {!signedOut && (
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
            )}
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

  address: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addressEmpty: {
    fontSize: font.sm,
    color: colors.textFaint,
    lineHeight: 18,
    paddingVertical: spacing.sm,
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

  guest: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  guestTitle: { fontSize: font.md, fontWeight: '800', color: colors.text },
  guestBody: {
    fontSize: font.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 240,
  },
  guestAction: {
    marginTop: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.xl,
    minHeight: 42,
    justifyContent: 'center',
  },
  guestActionText: { color: colors.onNavy, fontWeight: '800', fontSize: font.md },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
});
