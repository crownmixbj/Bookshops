import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/admin/AdminShell';
import { Skeleton } from '../../components/vendor/PayoutParts';
import { VendorDetailDrawer } from '../../components/admin/VendorDetailDrawer';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import { useAdminVendors, type AdminVendorRow, type VendorStatus } from '../../hooks/useAdminVendors';
import { colors, spacing, radius, font } from '../../theme';

const TABS: { key: 'all' | VendorStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending Approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'rejected', label: 'Rejected' },
];

/**
 * Yellow / green / red as asked, plus grey for rejected — a rejected
 * shop is not the same as a suspended one and should not wear the same
 * badge.
 */
const STATUS: Record<VendorStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: 'Pending', fg: colors.warning, bg: colors.warningBg },
  approved: { label: 'Approved', fg: colors.success, bg: '#EDF7F1' },
  suspended: { label: 'Suspended', fg: colors.danger, bg: '#FDF2F1' },
  rejected: { label: 'Rejected', fg: colors.textMuted, bg: colors.surfaceMuted },
};

function StatusBadge({ status }: { status: VendorStatus }) {
  const s = STATUS[status];
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

function StatTile({
  label, value, tone, loading,
}: { label: string; value: number; tone?: 'warn' | 'good' | 'bad'; loading: boolean }) {
  const colour =
    tone === 'warn' ? colors.warning : tone === 'good' ? colors.success : tone === 'bad' ? colors.danger : colors.text;
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      {loading ? <Skeleton width={60} height={26} /> : <Text style={[styles.tileValue, { color: colour }]}>{value}</Text>}
    </View>
  );
}

/**
 * Vendor Management.
 *
 * Two different records sit behind the one status column, and the
 * buttons write to different places:
 *
 *   Approve / Reject   -> vendors.approval_status, via admin_review_vendor
 *   Suspend / Restore  -> profiles.suspended_at,   via admin_set_suspended
 *
 * Suspending is the heavier action: it stops the OWNER signing in at
 * all, not just their shop trading, which is why it asks for a reason
 * and says so on the confirmation.
 *
 * Admins hold read-only policies on both tables; every write here goes
 * through a SECURITY DEFINER RPC that logs to admin_actions in the same
 * transaction.
 */
export default function AdminVendorsScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role } = useShell();
  const { rows, stats, loading, error, schemaMissing, refresh, reviewVendor, reviewIdentity, confirmBank, setSuspended } =
    useAdminVendors();

  const [tab, setTab] = useState<'all' | VendorStatus>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminVendorRow | null>(null);
  const [detail, setDetail] = useState<AdminVendorRow | null>(null);
  const [reason, setReason] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (tab === 'all' ? true : r.status === tab))
      .filter((r) =>
        q
          ? r.store_name.toLowerCase().includes(q) ||
            (r.owner_name ?? '').toLowerCase().includes(q) ||
            (r.email ?? '').toLowerCase().includes(q)
          : true
      );
  }, [rows, tab, search]);

  if (role !== 'admin') {
    return (
      <View style={styles.gate}>
        <Ionicons name="lock-closed-outline" size={30} color={colors.textFaint} />
        <Text style={styles.gateTitle}>This area is for administrators</Text>
        <Pressable onPress={() => router.replace('/')} style={styles.gateBtn} accessibilityRole="button">
          <Text style={styles.gateBtnText}>Back to my dashboard</Text>
        </Pressable>
      </View>
    );
  }

  /** The rows array is replaced on every refresh, so the panel has to
   *  re-read its vendor by id or it keeps showing the pre-action state. */
  const openDetail = detail ? (rows.find((r) => r.id === detail.id) ?? null) : null;

  async function act(row: AdminVendorRow, what: 'approve' | 'reject' | 'restore') {
    setBusyId(row.id);
    setNotice(null);
    const result =
      what === 'restore'
        ? await setSuspended(row.profile_id, false)
        : await reviewVendor(row.id, what === 'approve');
    setBusyId(null);
    setNotice(
      result.ok
        ? what === 'approve'
          ? `${row.store_name} approved — it can now receive booklists.`
          : what === 'reject'
            ? `${row.store_name} rejected.`
            : `${row.store_name}'s owner can sign in again.`
        : (result.message ?? 'That did not work.')
    );
  }

  async function confirmSuspend() {
    if (!suspendTarget) return;
    setBusyId(suspendTarget.id);
    const result = await setSuspended(suspendTarget.profile_id, true, reason.trim() || undefined);
    setBusyId(null);
    setNotice(
      result.ok
        ? `${suspendTarget.store_name}'s owner account is suspended.`
        : (result.message ?? 'Could not suspend that account.')
    );
    setSuspendTarget(null);
    setReason('');
  }

  if (schemaMissing) {
    return (
      <ScrollView contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}>
        <View style={styles.setup}>
          <Ionicons name="server-outline" size={26} color={colors.warning} />
          <Text style={styles.setupTitle}>Vendor moderation is not set up</Text>
          <Text style={styles.setupBody}>
            The approval columns this screen reads do not exist yet. Run{' '}
            <Text style={styles.code}>bookshops_admin.sql</Text> in the Supabase SQL editor.
          </Text>
          <Pressable onPress={refresh} style={styles.setupBtn} accessibilityRole="button">
            <Text style={styles.setupBtnText}>Check again</Text>
          </Pressable>
        </View>
        <Footer audience="admin" />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>Vendor Management</Text>
        <Text style={styles.h2}>Approvals, suspensions and shop records</Text>
      </View>

      {!!error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error.message}</Text>
          <Pressable onPress={refresh} hitSlop={6} accessibilityRole="button">
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      )}
      {!!notice && (
        <View style={styles.notice}>
          <Ionicons name="information-circle" size={16} color={colors.navy} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <View style={styles.tiles}>
        <StatTile label="Total Bookshops" value={stats.total} loading={loading} />
        <StatTile label="Pending Approvals" value={stats.pending} tone="warn" loading={loading} />
        <StatTile label="Approved Shops" value={stats.approved} tone="good" loading={loading} />
        <StatTile label="Suspended" value={stats.suspended} tone="bad" loading={loading} />
      </View>

      <Panel
        title="Bookshops"
        right={
          <View style={styles.searchBox}>
            <Ionicons name="search" size={14} color={colors.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Shop, owner or email"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              accessibilityLabel="Search vendors"
            />
          </View>
        }
      >
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && !active && styles.tabPressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.label}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <View style={styles.body}>
            <Skeleton width="100%" height={18} />
            <Skeleton width="88%" height={18} />
            <Skeleton width="94%" height={18} />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.body}>
            <Text style={styles.empty}>
              {rows.length === 0
                ? 'No bookshops have registered yet. They appear here as soon as someone signs up with a vendor account and registers a shop.'
                : search.trim()
                  ? `Nothing matches “${search.trim()}”.`
                  : 'Nothing in this tab.'}
            </Text>
          </View>
        ) : (
          <View>
            {!isMobile && (
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.cell, styles.cShop, styles.thText]}>Shop</Text>
                <Text style={[styles.cell, styles.cOwner, styles.thText]}>Owner / Contact</Text>
                <Text style={[styles.cell, styles.cDate, styles.thText]}>Registered</Text>
                <Text style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
                <Text style={[styles.cell, styles.cAct, styles.thText]}>Actions</Text>
              </View>
            )}

            {visible.map((row) => {
              const busy = busyId === row.id;
              const actions = (
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => setDetail(row)}
                    style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`View details for ${row.store_name}`}
                  >
                    <Text style={styles.btnPlainText}>View</Text>
                  </Pressable>
                  {row.status === 'pending' && (
                    <>
                      <Pressable
                        onPress={() => act(row, 'approve')}
                        disabled={busy}
                        style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Approve ${row.store_name}`}
                      >
                        <Text style={styles.btnGoText}>Approve</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => act(row, 'reject')}
                        disabled={busy}
                        style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Reject ${row.store_name}`}
                      >
                        <Text style={styles.btnPlainText}>Reject</Text>
                      </Pressable>
                    </>
                  )}

                  {(row.status === 'approved' || row.status === 'rejected') && (
                    <>
                      {row.status === 'rejected' && (
                        <Pressable
                          onPress={() => act(row, 'approve')}
                          disabled={busy}
                          style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Approve ${row.store_name}`}
                        >
                          <Text style={styles.btnGoText}>Approve</Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => {
                          setReason('');
                          setSuspendTarget(row);
                        }}
                        disabled={busy}
                        style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Suspend ${row.store_name}`}
                      >
                        <Text style={styles.btnDangerText}>Suspend</Text>
                      </Pressable>
                    </>
                  )}

                  {row.status === 'suspended' && (
                    <Pressable
                      onPress={() => act(row, 'restore')}
                      disabled={busy}
                      style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Re-activate ${row.store_name}`}
                    >
                      <Text style={styles.btnGoText}>Re-activate</Text>
                    </Pressable>
                  )}
                </View>
              );

              const contact = [row.email, row.phone ?? row.owner_phone].filter(Boolean).join(' · ');

              return isMobile ? (
                <View key={row.id} style={styles.mRow}>
                  <View style={styles.mTop}>
                    <Pressable
                      onPress={() => setDetail(row)}
                      style={{ flex: 1 }}
                      accessibilityRole="button"
                      accessibilityLabel={`View details for ${row.store_name}`}
                    >
                      <Text style={[styles.mShop, styles.shopLink]} numberOfLines={1}>
                        {row.store_name}
                      </Text>
                    </Pressable>
                    <StatusBadge status={row.status} />
                  </View>
                  <Text style={styles.mMeta}>{row.owner_name ?? 'Owner unknown'}</Text>
                  {!!contact && <Text style={styles.mMeta}>{contact}</Text>}
                  <Text style={styles.mMeta}>
                    Registered {new Date(row.created_at).toLocaleDateString('en-NG')}
                  </Text>
                  {!!row.suspension_reason && row.status === 'suspended' && (
                    <Text style={styles.reason}>{row.suspension_reason}</Text>
                  )}
                  {actions}
                </View>
              ) : (
                <View key={row.id} style={styles.tr}>
                  <View style={styles.cShop}>
                    <Pressable
                      onPress={() => setDetail(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`View details for ${row.store_name}`}
                    >
                      {({ pressed }) => (
                        <Text
                          style={[styles.shopName, styles.shopLink, pressed && styles.shopLinkPressed]}
                          numberOfLines={1}
                        >
                          {row.store_name}
                        </Text>
                      )}
                    </Pressable>
                    <Text style={styles.shopMeta} numberOfLines={1}>
                      {row.city ?? '—'}
                      {row.featured ? ' · Featured' : ''}
                      {row.verified_at ? ' · Verified' : ''}
                    </Text>
                  </View>
                  <View style={styles.cOwner}>
                    <Text style={styles.ownerName} numberOfLines={1}>
                      {row.owner_name ?? 'Owner unknown'}
                    </Text>
                    <Text style={styles.shopMeta} numberOfLines={1}>{contact || '—'}</Text>
                  </View>
                  <Text style={[styles.cell, styles.cDate]}>
                    {new Date(row.created_at).toLocaleDateString('en-NG')}
                  </Text>
                  <View style={styles.cStatus}>
                    <StatusBadge status={row.status} />
                    {!!row.suspension_reason && row.status === 'suspended' && (
                      <Text style={styles.reason} numberOfLines={2}>{row.suspension_reason}</Text>
                    )}
                  </View>
                  <View style={styles.cAct}>{actions}</View>
                </View>
              );
            })}
          </View>
        )}
      </Panel>

      <Footer audience="admin" />

      <VendorDetailDrawer
        vendor={openDetail}
        onClose={() => setDetail(null)}
        busy={busyId !== null}
        onApprove={(row) => act(row, 'approve')}
        onRestore={(row) => act(row, 'restore')}
        onReviewIdentity={async (row, verify, note) => {
          const r = await reviewIdentity(row.id, verify, note);
          if (r.ok) {
            setNotice(
              verify
                ? `${row.store_name}'s identity verified — the shop now shows as Verified.`
                : `${row.store_name}'s ID sent back with your note.`
            );
          }
          return r;
        }}
        onConfirmBank={(row, confirmed) => confirmBank(row.id, confirmed)}
        onSuspend={(row) => {
          // Close the panel first: two stacked modals put two scrims on
          // screen and the confirmation ends up behind its own dimmer.
          setDetail(null);
          setReason('');
          setSuspendTarget(row);
        }}
      />

      {/* ---- suspend, with a reason ---------------------------------- */}
      <Modal
        visible={suspendTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSuspendTarget(null)}
      >
        <Pressable style={styles.scrim} onPress={() => setSuspendTarget(null)} accessibilityLabel="Cancel" />
        <View style={styles.modalWrap} pointerEvents="box-none">
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Suspend {suspendTarget?.store_name}?</Text>
            <Text style={styles.modalBody}>
              This suspends the OWNER&apos;S ACCOUNT, not just the shop —{' '}
              {suspendTarget?.owner_name ?? 'they'} will not be able to sign in or write anything
              until it is lifted. Existing orders are not cancelled.
            </Text>

            <Text style={styles.modalLabel}>Reason (optional, but the owner sees it)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Repeated failure to fulfil paid orders"
              placeholderTextColor={colors.textFaint}
              style={styles.modalInput}
              multiline
              accessibilityLabel="Suspension reason"
            />

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setSuspendTarget(null)}
                style={styles.btnPlain}
                accessibilityRole="button"
              >
                <Text style={styles.btnPlainText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmSuspend}
                disabled={busyId !== null}
                style={({ pressed }) => [styles.btn, styles.btnDangerSolid, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Confirm suspension"
              >
                <Text style={styles.btnDangerSolidText}>
                  {busyId ? 'Suspending…' : 'Suspend account'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },
  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginBottom: spacing.lg },
  tile: {
    flexGrow: 1, flexBasis: 160,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, gap: spacing.sm,
  },
  tileLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  tileValue: { fontSize: 26, fontWeight: '800' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, height: 32, minWidth: 190,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: font.sm, color: colors.text },

  tabs: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tab: {
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabPressed: { backgroundColor: colors.surfaceMuted },
  tabText: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.onNavy, fontWeight: '700' },

  body: { padding: spacing.lg, gap: spacing.md },
  empty: { fontSize: font.sm, color: colors.textFaint, lineHeight: 19 },

  th: { backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.border },
  thText: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, textTransform: 'uppercase' },
  tr: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cell: { fontSize: font.md, color: colors.text },
  cShop: { flex: 1.5 },
  cOwner: { flex: 1.6 },
  cDate: { flex: 1 },
  cStatus: { flex: 1.1, alignItems: 'flex-start', gap: 3 },
  cAct: { flex: 1.5, alignItems: 'flex-start' },
  shopName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  shopLink: { color: colors.navy, textDecorationLine: 'underline' },
  shopLinkPressed: { color: colors.orangeDark },
  shopMeta: { fontSize: font.xs, color: colors.textFaint },
  ownerName: { fontSize: font.md, color: colors.text },

  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  badgeText: { fontSize: font.xs, fontWeight: '800' },
  reason: { fontSize: font.xs, color: colors.danger, lineHeight: 15 },

  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  btn: { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1 },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  btnPlain: {
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  btnPlainText: { color: colors.textMuted, fontSize: font.sm, fontWeight: '700' },
  btnDanger: { backgroundColor: colors.surface, borderColor: '#F0C4BF' },
  btnDangerText: { color: colors.danger, fontSize: font.sm, fontWeight: '700' },
  btnDangerSolid: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnDangerSolidText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  pressed: { opacity: 0.85 },

  mRow: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 4,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  mTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  mShop: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  mMeta: { fontSize: font.sm, color: colors.textMuted },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.4)' },
  modalWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: {
    width: '100%', maxWidth: 460, backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm,
  },
  modalTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  modalBody: { fontSize: font.md, color: colors.textMuted, lineHeight: 20 },
  modalLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  modalInput: {
    minHeight: 72, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted, padding: spacing.md, fontSize: font.md,
    color: colors.text, textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.md },

  errorBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: '#FDF2F1', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
  notice: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.text },

  setup: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.xl, gap: spacing.md, alignItems: 'flex-start',
  },
  setupTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  setupBody: { fontSize: font.md, color: colors.textMuted, lineHeight: 21 },
  code: { fontWeight: '700', color: colors.text },
  setupBtn: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  setupBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBtn: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
});
