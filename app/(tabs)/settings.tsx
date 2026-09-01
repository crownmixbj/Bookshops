import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { TopBar } from '../../components/dashboard/TopBar';
import { Sidebar, NAV_ITEMS } from '../../components/dashboard/Sidebar';
import {
  VendorTopBar,
  VendorSidebar,
  type VendorNavItem,
} from '../../components/vendor/VendorShell';
import { VendorProfileMenu } from '../../components/vendor/VendorProfileMenu';
import { ProfileMenu } from '../../components/profile/ProfileMenu';
import { SupportMenu } from '../../components/support/SupportMenu';
import { SupportDrawer } from '../../components/support/SupportDrawer';
import {
  Section,
  Field,
  ToggleRow,
  Segmented,
  ReadOnlyRow,
  SaveButton,
  Note,
} from '../../components/settings/SettingsControls';

import { useLayout } from '../../hooks/useLayout';
import { useSettings, type SaveState } from '../../hooks/useSettings';
import { colors, spacing, radius, font } from '../../theme';
import type { ThemePreference } from '../../types/db';

const IMPLEMENTED = {
  dashboard: '/',
  booklists: '/booklists',
  orders: '/orders',
  saved: '/saved',
  settings: '/settings',
} as const;

const MIN_PASSWORD = 8;

export default function SettingsScreen() {
  const { isMobile, contentPadding } = useLayout();
  // The profile dropdown's "Edit Profile" links here with ?section=profile
  // rather than carrying its own copy of the form.
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const profileY = useRef(0);
  const [highlightProfile, setHighlightProfile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [search, setSearch] = useState('');

  const {
    profile,
    vendor,
    email,
    emailVerified,
    isVendor,
    loading,
    error,
    updateProfile,
    updateVendor,
    changePassword,
    signOut,
  } = useSettings();

  // --- personal details form -----------------------------------
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [personalState, setPersonalState] = useState<SaveState>('idle');

  // --- vendor form ---------------------------------------------
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeCity, setStoreCity] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeEmail, setStoreEmail] = useState('');
  const [vendorState, setVendorState] = useState<SaveState>('idle');

  // --- password ------------------------------------------------
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordState, setPasswordState] = useState<SaveState>('idle');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  /**
   * Arriving with ?section=profile scrolls the Profile card into view and
   * outlines it briefly, so the shortcut lands somewhere obvious rather
   * than dumping the user at the top of a long settings page.
   *
   * Waits for `loading` to clear: before that the sections are not laid
   * out, so profileY is still 0 and the scroll would do nothing.
   */
  useEffect(() => {
    if (section !== 'profile' || loading) return;
    const scrollTimer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(profileY.current - 12, 0), animated: true });
      setHighlightProfile(true);
    }, 120);
    const fadeTimer = setTimeout(() => setHighlightProfile(false), 2600);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(fadeTimer);
    };
  }, [section, loading]);

  // Seed the forms once the profile arrives.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    setPhone(profile.phone_number ?? '');
    setAddress(profile.default_delivery_address ?? '');
    setCity(profile.default_delivery_city ?? '');
    setDeliveryPhone(profile.default_delivery_phone ?? '');
  }, [profile]);

  useEffect(() => {
    if (!vendor) return;
    setStoreName(vendor.store_name ?? '');
    setStoreAddress(vendor.address ?? '');
    setStoreCity(vendor.city ?? '');
    setStorePhone(vendor.phone ?? '');
    setStoreEmail(vendor.email ?? '');
  }, [vendor]);

  async function handleNavigate(item: (typeof NAV_ITEMS)[number]) {
    if (item.key === 'logout') return signOut();
    const target = IMPLEMENTED[item.key as keyof typeof IMPLEMENTED];
    if (target && target !== '/settings') router.push(target);
  }

  /**
   * Settings is shared by both roles, but the chrome around it is not.
   * A vendor arriving here used to get the buyer sidebar, which is how
   * "open my shop settings" ended up looking like being thrown back to
   * the buyer app. Same screen, correct shell.
   */
  async function handleVendorNavigate(item: VendorNavItem) {
    if (item.key === 'logout') return signOut();
    if (item.key === 'dashboard') router.push('/vendor');
    // The other vendor destinations have no screens yet, so they stay inert.
  }

  /** Runs a save, then flashes "Saved" briefly so the write is visible. */
  async function runSave(
    setState: (s: SaveState) => void,
    action: () => Promise<boolean>
  ) {
    setState('saving');
    const ok = await action();
    setState(ok ? 'saved' : 'error');
    if (ok) setTimeout(() => setState('idle'), 2200);
  }

  const savePersonal = () =>
    runSave(setPersonalState, () =>
      updateProfile({
        full_name: fullName.trim(),
        phone_number: phone.trim() || null,
        default_delivery_address: address.trim() || null,
        default_delivery_city: city.trim() || null,
        default_delivery_phone: deliveryPhone.trim() || null,
      })
    );

  const saveVendor = () =>
    runSave(setVendorState, () =>
      updateVendor({
        store_name: storeName.trim(),
        address: storeAddress.trim(),
        city: storeCity.trim(),
        phone: storePhone.trim() || null,
        email: storeEmail.trim() || null,
      })
    );

  async function savePassword() {
    setPasswordError(null);
    if (password.length < MIN_PASSWORD) {
      setPasswordError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setPasswordError('The two passwords do not match.');
      return;
    }
    setPasswordState('saving');
    const result = await changePassword(password);
    if (result.ok) {
      setPassword('');
      setConfirm('');
      setPasswordState('saved');
      setTimeout(() => setPasswordState('idle'), 2200);
    } else {
      setPasswordState('error');
      setPasswordError(result.message ?? 'Could not change the password.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {isVendor ? (
        <VendorTopBar
          storeName={vendor?.store_name ?? 'Your shop'}
          query={search}
          onQueryChange={setSearch}
          busyMode={vendor?.busy_mode ?? false}
          onBusyModeChange={(v) => updateVendor({ busy_mode: v })}
          onMenuPress={() => setDrawerOpen(true)}
          onProfilePress={() => setAccountOpen(true)}
        />
      ) : (
        <TopBar
          query={search}
          onQueryChange={setSearch}
          onMenuPress={() => setDrawerOpen(true)}
          onProfilePress={() => setProfileOpen(true)}
          onSupportPress={() => setSupportOpen(true)}
        />
      )}

      {isVendor ? (
        <VendorProfileMenu
          visible={accountOpen}
          vendor={vendor}
          onClose={() => setAccountOpen(false)}
        />
      ) : (
        <ProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} />
      )}
      <SupportMenu
        visible={supportOpen}
        onClose={() => setSupportOpen(false)}
        onOpenChat={() => setChatOpen(true)}
      />
      <SupportDrawer visible={chatOpen} onClose={() => setChatOpen(false)} />

      <View style={styles.body}>
        {isVendor ? (
          <VendorSidebar
            activeKey="settings"
            onNavigate={handleVendorNavigate}
            drawerOpen={drawerOpen}
            onCloseDrawer={() => setDrawerOpen(false)}
          />
        ) : (
          <Sidebar
            activeKey="settings"
            onNavigate={handleNavigate}
            drawerOpen={drawerOpen}
            onCloseDrawer={() => setDrawerOpen(false)}
          />
        )}

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heading}>
            <Text style={styles.h1}>Settings</Text>
            <Text style={styles.h2}>Your account, notifications and preferences</Text>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error.message}</Text>
            </View>
          )}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : !profile ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>
                No profile found for this account. Sign out and back in, or check that the
                signup trigger is in place.
              </Text>
            </View>
          ) : (
            <View style={isMobile ? undefined : styles.columns}>
              <View
                style={styles.col}
                onLayout={(e) => {
                  profileY.current = e.nativeEvent.layout.y;
                }}
              >
                {/* ---- profile ---------------------------------- */}
                <Section
                  title="Profile"
                  caption="Your name and how vendors reach you"
                  icon="person-outline"
                  highlight={highlightProfile}
                  footer={<SaveButton onPress={savePersonal} state={personalState} />}
                >
                  <Field
                    label="Full name"
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Bolaji Adedapo"
                    autoCapitalize="words"
                  />
                  <Field
                    label="Phone number"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="0803 000 0000"
                    keyboardType="phone-pad"
                  />
                  <ReadOnlyRow
                    label="Email address"
                    value={email}
                    badge={{
                      label: emailVerified ? 'Verified' : 'Unverified',
                      tone: emailVerified ? 'success' : 'warning',
                    }}
                    note="Changing your email needs a confirmation link, so it isn't editable here."
                  />
                  <ReadOnlyRow
                    label="Account type"
                    value={isVendor ? 'Vendor' : 'Buyer'}
                    note="Only an administrator can change your account type."
                  />
                </Section>

                {/* ---- delivery -------------------------------- */}
                {!isVendor && (
                  <Section
                    title="Default delivery address"
                    caption="Used to prefill checkout"
                    icon="location-outline"
                    footer={<SaveButton onPress={savePersonal} state={personalState} />}
                  >
                    <Field
                      label="Street address"
                      value={address}
                      onChangeText={setAddress}
                      placeholder="14 Adeniyi Jones Avenue"
                    />
                    <Field
                      label="City"
                      value={city}
                      onChangeText={setCity}
                      placeholder="Ikeja, Lagos"
                    />
                    <Field
                      label="Delivery phone"
                      value={deliveryPhone}
                      onChangeText={setDeliveryPhone}
                      placeholder="Someone who can receive the parcel"
                      keyboardType="phone-pad"
                    />
                    <Note>
                      Each order keeps its own copy of the address it was sent to, so
                      changing this never rewrites where past orders went.
                    </Note>
                  </Section>
                )}

                {/* ---- vendor ---------------------------------- */}
                {isVendor && (
                  <Section
                    title="Shop details"
                    caption="What buyers see on your shop card"
                    icon="storefront-outline"
                    footer={<SaveButton onPress={saveVendor} state={vendorState} />}
                  >
                    <Field
                      label="Business name"
                      value={storeName}
                      onChangeText={setStoreName}
                      placeholder="Laterna Books (Ikeja)"
                    />
                    <Field
                      label="Store address"
                      value={storeAddress}
                      onChangeText={setStoreAddress}
                      placeholder="13 Oba Akran Avenue"
                    />
                    <Field label="City" value={storeCity} onChangeText={setStoreCity} placeholder="Ikeja" />
                    <Field
                      label="Business phone"
                      value={storePhone}
                      onChangeText={setStorePhone}
                      placeholder="0803 000 1122"
                      keyboardType="phone-pad"
                      hint="Shown to buyers on your shop card and their orders."
                    />
                    <Field
                      label="Business email"
                      value={storeEmail}
                      onChangeText={setStoreEmail}
                      placeholder="orders@yourshop.ng"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <ReadOnlyRow
                      label="Verification"
                      value={vendor?.verified_at ? 'Verified shop' : 'Not yet verified'}
                      badge={
                        vendor?.verified_at
                          ? { label: 'Verified', tone: 'success' }
                          : { label: 'Pending', tone: 'warning' }
                      }
                      note="An administrator verifies your identity and address."
                    />
                  </Section>
                )}
              </View>

              <View style={styles.col}>
                {/* ---- security -------------------------------- */}
                <Section
                  title="Password"
                  caption="Change the password you sign in with"
                  icon="lock-closed-outline"
                  footer={
                    <SaveButton
                      onPress={savePassword}
                      state={passwordState}
                      label="Update password"
                      disabled={!password && !confirm}
                    />
                  }
                >
                  <Field
                    label="New password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <Field
                    label="Confirm new password"
                    value={confirm}
                    onChangeText={setConfirm}
                    placeholder="Type it again"
                    secureTextEntry
                    autoCapitalize="none"
                    error={passwordError ?? undefined}
                  />
                  <Note tone="warning">
                    Changing your password here doesn't ask for the current one — your
                    signed-in session is the proof of identity. Sign out on shared devices.
                  </Note>
                </Section>

                {/* ---- notifications --------------------------- */}
                <Section
                  title="Notifications"
                  caption="Choose what reaches you, and how"
                  icon="notifications-outline"
                >
                  <Text style={styles.groupLabel}>Email</Text>
                  <ToggleRow
                    label="Order updates"
                    description="Dispatched, delivered, payment problems"
                    value={profile.notify_email_orders}
                    onValueChange={(v) => updateProfile({ notify_email_orders: v })}
                  />
                  <ToggleRow
                    label="New quotes"
                    description="When a vendor prices one of your booklists"
                    value={profile.notify_email_quotes}
                    onValueChange={(v) => updateProfile({ notify_email_quotes: v })}
                    last
                  />

                  <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>Push</Text>
                  <ToggleRow
                    label="Order updates"
                    value={profile.notify_push_orders}
                    onValueChange={(v) => updateProfile({ notify_push_orders: v })}
                  />
                  <ToggleRow
                    label="New quotes"
                    value={profile.notify_push_quotes}
                    onValueChange={(v) => updateProfile({ notify_push_quotes: v })}
                    last
                  />

                  <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>SMS</Text>
                  <ToggleRow
                    label="Order updates"
                    description="Charged per message, so off by default"
                    value={profile.notify_sms_orders}
                    onValueChange={(v) => updateProfile({ notify_sms_orders: v })}
                  />
                  <ToggleRow
                    label="New quotes"
                    value={profile.notify_sms_quotes}
                    onValueChange={(v) => updateProfile({ notify_sms_quotes: v })}
                    last
                  />

                  <Note tone="warning">
                    These preferences save immediately, but nothing sends notifications
                    yet — no email, push or SMS service is connected. Your choices are
                    stored so they apply the moment one is.
                  </Note>
                </Section>

                {/* ---- app preferences ------------------------- */}
                <Section
                  title="App preferences"
                  caption="Currency and appearance"
                  icon="options-outline"
                >
                  <ReadOnlyRow
                    label="Currency"
                    value="Nigerian Naira (₦)"
                    note="LOCI prices and settles in Naira only. Orders carry the same restriction in the database."
                  />

                  <Text style={styles.label}>Theme</Text>
                  <Segmented<ThemePreference>
                    value={profile.theme_preference}
                    onChange={(v) => updateProfile({ theme_preference: v })}
                    options={[
                      { value: 'light', label: 'Light', icon: 'sunny-outline' },
                      { value: 'dark', label: 'Dark', icon: 'moon-outline' },
                      { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
                    ]}
                  />
                  <Note tone="warning">
                    Your choice is saved, but the app renders in light mode for now —
                    theming isn't wired up yet. It will apply once it is.
                  </Note>
                </Section>

                {/* ---- account -------------------------------- */}
                <Section title="Account" caption="Sign out of this device" icon="log-out-outline">
                  <Pressable
                    onPress={signOut}
                    style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <Ionicons name="log-out-outline" size={16} color={colors.danger} />
                    <Text style={styles.signOutText}>Sign out</Text>
                  </Pressable>
                </Section>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.xl },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  columns: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 280 },

  groupLabel: {
    fontSize: font.xs,
    fontWeight: '800',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  groupLabelSpaced: { marginTop: spacing.lg },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, marginBottom: 5 },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: '#F0C4BF',
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  signOutText: { color: colors.danger, fontWeight: '700', fontSize: font.md },

  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FCEAE8',
    borderColor: '#F0C4BF',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },
  pressed: { opacity: 0.85 },
});
