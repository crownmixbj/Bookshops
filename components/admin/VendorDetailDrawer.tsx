import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import { useVendorDetail } from '../../hooks/useVendorDetail';
import { Skeleton } from '../vendor/PayoutParts';
import { formatNuban } from '../../hooks/useAdminFinance';
import type { AdminVendorRow } from '../../hooks/useAdminVendors';
import { IdentityReview } from './IdentityReview';

interface Props {
  vendor: AdminVendorRow | null;
  onClose: () => void;
  onApprove: (row: AdminVendorRow) => void;
  onSuspend: (row: AdminVendorRow) => void;
  onRestore: (row: AdminVendorRow) => void;
  /** Verify or reject the owner's ID. */
  onReviewIdentity?: (row: AdminVendorRow, verify: boolean, note: string | null) => Promise<{ ok: boolean; message?: string }>;
  /** Mark the payout account as checked (or not). */
  onConfirmBank?: (row: AdminVendorRow, confirmed: boolean) => Promise<{ ok: boolean; message?: string }>;
  busy: boolean;
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono, !value && styles.rowMissing]}>
        {value || 'Not on file'}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {
    // No dialer or mail client on this machine; the number is on screen
    // either way.
  });
}

/**
 * Everything known about one bookshop, in a slide-over.
 *
 * Fields the schema genuinely does not have are listed under "Not
 * captured yet" rather than shown as empty rows, so an admin can tell
 * the difference between "this shop did not fill it in" and "we never
 * ask anyone for this". Guessing which is which is how a verification
 * step gets skipped.
 */
export function VendorDetailDrawer({
  vendor,
  onClose,
  onApprove,
  onSuspend,
  onRestore,
  onReviewIdentity,
  onConfirmBank,
  busy,
}: Props) {
  const { isMobile, width } = useLayout();
  const { bank, performance, identity, identityMissing, loading, error, bankTableMissing, refresh } =
    useVendorDetail(vendor?.id ?? null);
  const [bankBusy, setBankBusy] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  if (!vendor) return null;

  const initials = vendor.store_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  const panelWidth = isMobile ? width : 440;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close vendor details" />

      <View style={[styles.anchor, isMobile ? styles.anchorMobile : styles.anchorDesktop]} pointerEvents="box-none">
        <View style={[styles.panel, { width: panelWidth }, isMobile && styles.panelMobile]}>
          <View style={styles.head}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials || 'B'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.shopName} numberOfLines={2}>{vendor.store_name}</Text>
              <View style={styles.badgeRow}>
                {vendor.verified_at ? (
                  <View style={styles.verified}>
                    <Ionicons name="shield-checkmark" size={12} color={colors.success} />
                    <Text style={styles.verifiedText}>Verified</Text>
                  </View>
                ) : (
                  <View style={styles.unverified}>
                    <Ionicons name="shield-outline" size={12} color={colors.warning} />
                    <Text style={styles.unverifiedText}>Not verified</Text>
                  </View>
                )}
                {vendor.featured && (
                  <View style={styles.featured}>
                    <Ionicons name="star" size={11} color={colors.orange} />
                    <Text style={styles.featuredText}>Featured</Text>
                  </View>
                )}
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
            )}

            <Section title="Shop Profile">
              <Row label="City" value={vendor.city} />
              <Row label="Address" value={vendor.address} />
              <Row
                label="Registered"
                value={new Date(vendor.created_at).toLocaleDateString('en-NG', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              />
              {!!vendor.review_note && <Row label="Review note" value={vendor.review_note} />}
            </Section>

            <Section title="Owner">
              <Row label="Full name" value={vendor.owner_name} />
              <Row label="Phone" value={vendor.phone ?? vendor.owner_phone} />
              <Row label="Shop email" value={vendor.email} />
            </Section>

            {/* Before the bank details: whether we know who this is
                decides whether the bank account can be trusted. */}
            <Section title="Identity">
              {loading && !identity ? (
                <Skeleton width="70%" height={14} />
              ) : (
                <IdentityReview
                  identity={identity}
                  missing={identityMissing}
                  accountName={bank?.account_name ?? null}
                  onReview={async (verify, note) => {
                    if (!onReviewIdentity) return { ok: false, message: 'Not available here.' };
                    const r = await onReviewIdentity(vendor, verify, note);
                    if (r.ok) await refresh();
                    return r;
                  }}
                />
              )}
            </Section>

            <Section title="Payout Account">
              {loading ? (
                <>
                  <Skeleton width="80%" height={14} />
                  <Skeleton width="60%" height={14} />
                </>
              ) : bankTableMissing ? (
                <Text style={styles.note}>
                  Bank details are stored by bookshops_payouts.sql, which has not been run on this
                  database.
                </Text>
              ) : bank ? (
                <>
                  <Row label="Bank" value={bank.bank_name} />
                  <Row label="Account number" value={formatNuban(bank.account_number)} mono />
                  <Row label="Account holder" value={bank.account_name} />
                  <Text style={bank.verified_at ? styles.okNote : styles.warnNote}>
                    {bank.verified_at
                      ? 'Name confirmed against the bank.'
                      : 'Not confirmed against the bank — check the digits before paying out.'}
                  </Text>
                  {!!onConfirmBank && (
                    <Pressable
                      onPress={async () => {
                        setBankBusy(true);
                        setBankError(null);
                        const r = await onConfirmBank(vendor, !bank.verified_at);
                        setBankBusy(false);
                        if (r.ok) await refresh();
                        else setBankError(r.message ?? 'That did not work.');
                      }}
                      disabled={bankBusy}
                      style={({ pressed }) => [styles.bankBtn, pressed && styles.pressed]}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name={bank.verified_at ? 'close-circle-outline' : 'checkmark-circle-outline'}
                        size={15}
                        color={bank.verified_at ? colors.textMuted : colors.success}
                      />
                      <Text style={[styles.bankBtnText, !bank.verified_at && { color: colors.success }]}>
                        {bankBusy ? 'Saving…' : bank.verified_at ? 'Mark as unchecked' : 'Mark account as checked'}
                      </Text>
                    </Pressable>
                  )}
                  {!!bankError && <Text style={styles.warnNote}>{bankError}</Text>}
                </>
              ) : (
                <Text style={styles.note}>
                  This shop has not added bank details yet, so it cannot be paid out.
                </Text>
              )}
            </Section>

            <Section title="Performance">
              {loading ? (
                <Skeleton width="90%" height={40} />
              ) : (
                <View style={styles.stats}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{performance?.ordersCompleted ?? vendor.completed_orders}</Text>
                    <Text style={styles.statLabel}>Orders delivered</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{formatNaira(performance?.revenue ?? 0)}</Text>
                    <Text style={styles.statLabel}>Revenue</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{formatNaira(performance?.inFlight ?? 0)}</Text>
                    <Text style={styles.statLabel}>In fulfilment</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {vendor.rating != null ? `${Number(vendor.rating).toFixed(1)}★` : '—'}
                    </Text>
                    <Text style={styles.statLabel}>
                      {vendor.review_count ? `${vendor.review_count} review${vendor.review_count === 1 ? '' : 's'}` : 'No reviews'}
                    </Text>
                  </View>
                </View>
              )}
            </Section>

            {/* Being explicit beats an empty row: an admin must be able to
                tell "this shop did not provide it" from "we never ask". */}
            <Section title="Not captured yet">
              <Text style={styles.note}>
                The shop registration form does not collect a logo, a state (only city), a CAC
                registration number, or a book catalogue — so there is no "books listed" figure.
                The owner&apos;s sign-in email lives in auth.users, which RLS does not expose to
                the browser; the shop email above is the address they published.
              </Text>
            </Section>
          </ScrollView>

          <View style={styles.actions}>
            {vendor.status === 'pending' && (
              <Pressable
                onPress={() => onApprove(vendor)}
                disabled={busy}
                style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Approve ${vendor.store_name}`}
              >
                <Ionicons name="checkmark" size={15} color={colors.onNavy} />
                <Text style={styles.btnGoText}>Approve</Text>
              </Pressable>
            )}
            {vendor.status === 'suspended' ? (
              <Pressable
                onPress={() => onRestore(vendor)}
                disabled={busy}
                style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Re-activate ${vendor.store_name}`}
              >
                <Ionicons name="refresh" size={15} color={colors.onNavy} />
                <Text style={styles.btnGoText}>Re-activate</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => onSuspend(vendor)}
                disabled={busy}
                style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Suspend ${vendor.store_name}`}
              >
                <Ionicons name="ban-outline" size={15} color={colors.danger} />
                <Text style={styles.btnDangerText}>Suspend</Text>
              </Pressable>
            )}

            {/* Only offered when there is something to dial or write to —
                a disabled "Contact" with no number behind it is worse
                than no button. */}
            {!!(vendor.phone ?? vendor.owner_phone) && (
              <Pressable
                onPress={() => openUrl(`tel:${(vendor.phone ?? vendor.owner_phone ?? '').replace(/[^\d+]/g, '')}`)}
                style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Call this shop"
              >
                <Ionicons name="call-outline" size={15} color={colors.navy} />
                <Text style={styles.btnPlainText}>Call</Text>
              </Pressable>
            )}
            {!!vendor.email && (
              <Pressable
                onPress={() => openUrl(`mailto:${vendor.email}?subject=${encodeURIComponent('About your LOCI bookshop')}`)}
                style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Email this shop"
              >
                <Ionicons name="mail-outline" size={15} color={colors.navy} />
                <Text style={styles.btnPlainText}>Email</Text>
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
    width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onNavy, fontWeight: '800', fontSize: font.lg },
  shopName: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  badgeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 5, flexWrap: 'wrap' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EDF7F1', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  verifiedText: { fontSize: font.xs, fontWeight: '800', color: colors.success },
  unverified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.warningBg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  unverifiedText: { fontSize: font.xs, fontWeight: '800', color: colors.warning },
  featured: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FDE8D2', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  featuredText: { fontSize: font.xs, fontWeight: '800', color: colors.orangeDark },

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
  rowMissing: { color: colors.textFaint, fontStyle: 'italic' },
  mono: { letterSpacing: 1 },

  note: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  okNote: { fontSize: font.xs, color: colors.success, marginTop: 2 },
  bankBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  bankBtnText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  warnNote: { fontSize: font.xs, color: colors.warning, marginTop: 2, lineHeight: 16 },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: {
    flexGrow: 1, flexBasis: 120, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, padding: spacing.md, gap: 2,
  },
  statValue: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textMuted },

  actions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderRadius: radius.md, borderWidth: 1,
    paddingHorizontal: spacing.md, paddingVertical: 9,
  },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  btnDanger: { backgroundColor: colors.surface, borderColor: '#F0C4BF' },
  btnDangerText: { color: colors.danger, fontSize: font.sm, fontWeight: '700' },
  btnPlain: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  btnPlainText: { color: colors.navy, fontSize: font.sm, fontWeight: '700' },
  pressed: { opacity: 0.85 },

  errorBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: '#FDF2F1', borderRadius: radius.md, padding: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
});
