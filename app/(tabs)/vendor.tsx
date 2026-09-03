import { useMemo, useState } from 'react';
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
import { router } from 'expo-router';

import { Panel } from '../../components/vendor/VendorShell';
import { RequestQueue } from '../../components/vendor/RequestQueue';
import { QuoteEditor } from '../../components/vendor/QuoteEditor';

import { useLayout } from '../../hooks/useLayout';
import { useVendorDashboard } from '../../hooks/useVendorDashboard';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font } from '../../theme';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';

/**
 * Vendor dashboard — the bookshop's side of the marketplace.
 *
 * Only the dashboard is built; the rest of the vendor sidebar has no
 * screens yet and its links are inert rather than routing to expo-router's
 * "Unmatched Route".
 */
export default function VendorDashboardScreen() {
  const { isMobile, contentPadding } = useLayout();
  // The search box lives in the shell's top bar so its text survives
  // navigation; this screen just reads what was typed.
  const { search } = useShell();

  const {
    vendor,
    isVendor,
    queue,
    selected,
    lines,
    totals,
    loading,
    loadingDetail,
    busySaving,
    error,
    notice,
    openRequest,
    closeRequest,
    setLinePrice,
    setLineAvailable,
    saveQuote,
    declineRequest,
    setBusyMode,
    refresh,
  } = useVendorDashboard();


  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? queue.filter(
            (r) =>
              (r.customer_name ?? '').toLowerCase().includes(q) ||
              r.reference.toLowerCase().includes(q) ||
              r.school_name.toLowerCase().includes(q) ||
              r.class_level.toLowerCase().includes(q)
          )
        : queue,
    [queue, q]
  );

  const newCount = queue.filter((r) => !r.my_quote_id).length;

  // ---- gates --------------------------------------------------
  if (isVendor === false) {
    return (
      // The shell already provides the safe area; a second SafeAreaView
      // here would pad the notch twice.
      <View style={styles.safe}>
        <View style={styles.gate}>
          <Ionicons name="storefront-outline" size={34} color={colors.textFaint} />
          <Text style={styles.gateTitle}>This area is for vendors</Text>
          <Text style={styles.gateBody}>
            Your account isn't registered as a bookshop. If you sell school books, sign up
            with a vendor account and register your shop in Settings.
          </Text>
          <Pressable
            onPress={() => router.push('/')}
            style={({ pressed }) => [styles.gateBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.gateBtnText}>Back to my dashboard</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : (
            <>
              {error && !selected && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.errorText}>{error.message}</Text>
                  <Pressable onPress={refresh} hitSlop={6}>
                    <Text style={styles.retry}>Retry</Text>
                  </Pressable>
                </View>
              )}

              {!vendor && (
                <View style={styles.errorBox}>
                  <Ionicons name="information-circle" size={16} color={colors.warning} />
                  <Text style={[styles.errorText, { color: colors.warning }]}>
                    Your shop isn't set up yet. Add your business details in Settings and
                    requests will start appearing here.
                  </Text>
                </View>
              )}

              <Panel
                title="New Booklist Requests Queue"
                right={
                  <Text style={styles.count}>
                    {visible.length} open{q ? ` of ${queue.length}` : ''}
                  </Text>
                }
              >
                <RequestQueue
                  rows={visible}
                  selectedId={selected?.request_id ?? null}
                  onView={openRequest}
                  onDecline={(row) => declineRequest(row)}
                />
              </Panel>

              {selected && (
                <QuoteEditor
                  request={selected}
                  lines={lines}
                  totals={totals}
                  loading={loadingDetail}
                  saving={busySaving}
                  notice={notice}
                  error={error}
                  onPriceChange={setLinePrice}
                  onAvailabilityChange={setLineAvailable}
                  onSaveDraft={() => saveQuote('draft')}
                  onSubmit={() => saveQuote('sent')}
                  onClose={closeRequest}
                />
              )}

              <View style={{ height: isMobile ? spacing.xxl : spacing.lg }} />
            </>
          )}
          <Footer audience="vendor" />
        </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  count: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
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
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },

  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xxl,
  },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBody: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 380,
    lineHeight: 21,
  },
  gateBtn: {
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  pressed: { opacity: 0.85 },
});
