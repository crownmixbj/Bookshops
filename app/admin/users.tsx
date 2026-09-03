import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/admin/AdminShell';
import { Skeleton } from '../../components/vendor/PayoutParts';
import { UserDetailDrawer } from '../../components/admin/UserDetailDrawer';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import { useAdminUsers, actionability, type AdminUserRow, type UserRole } from '../../hooks/useAdminUsers';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font } from '../../theme';

type Filter = 'all' | UserRole | 'suspended';

const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All Users' },
  { key: 'buyer', label: 'Buyers' },
  { key: 'vendor', label: 'Vendors' },
  { key: 'admin', label: 'Admins' },
  { key: 'suspended', label: 'Suspended' },
];

const ROLE_STYLE: Record<UserRole, { label: string; fg: string; bg: string }> = {
  buyer: { label: 'Buyer', fg: colors.navy, bg: '#E7EDF7' },
  vendor: { label: 'Vendor', fg: colors.orangeDark, bg: '#FDE8D2' },
  admin: { label: 'Admin', fg: colors.danger, bg: '#FDF2F1' },
};

function RoleBadge({ role }: { role: UserRole }) {
  const s = ROLE_STYLE[role];
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

function StatusBadge({ suspended }: { suspended: boolean }) {
  return (
    <View style={[styles.badge, { backgroundColor: suspended ? '#FDF2F1' : '#EDF7F1' }]}>
      <Text style={[styles.badgeText, { color: suspended ? colors.danger : colors.success }]}>
        {suspended ? 'Suspended' : 'Active'}
      </Text>
    </View>
  );
}

function StatTile({ label, value, tone, loading }: {
  label: string; value: number; tone?: 'good' | 'warn' | 'bad'; loading: boolean;
}) {
  const colour =
    tone === 'good' ? colors.success : tone === 'warn' ? colors.orangeDark : tone === 'bad' ? colors.danger : colors.text;
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      {loading ? <Skeleton width={60} height={26} /> : <Text style={[styles.tileValue, { color: colour }]}>{value}</Text>}
    </View>
  );
}

/**
 * User Management.
 *
 * Three guardrails are enforced by admin_set_role and
 * admin_set_suspended in the database, and mirrored here so the console
 * does not offer a button that is certain to fail:
 *
 *   * an admin cannot change their own role or suspend themselves
 *   * an admin cannot touch another admin
 *   * roles can only be set to buyer or vendor — a new administrator is
 *     granted with the service key, never from this screen
 *
 * The mirroring is convenience, not security. The server refuses either
 * way; removing these checks would make the UI misleading, not unsafe.
 */
export default function AdminUsersScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role } = useShell();
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)).catch(() => setMe(null));
  }, []);

  const { rows, stats, loading, error, directoryMissing, refresh, setSuspended, setRole } = useAdminUsers(me);

  const [tab, setTab] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserRow | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminUserRow | null>(null);
  const [reason, setReason] = useState('');
  const [roleTarget, setRoleTarget] = useState<AdminUserRow | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (tab === 'all' ? true : tab === 'suspended' ? !!r.suspended_at : r.role === tab))
      .filter((r) =>
        q
          ? (r.full_name ?? '').toLowerCase().includes(q) ||
            (r.email ?? '').toLowerCase().includes(q) ||
            (r.phone_number ?? '').includes(q)
          : true
      );
  }, [rows, tab, search]);

  // The rows array is replaced on refresh, so the open panel re-reads by id.
  const openDetail = detail ? (rows.find((r) => r.id === detail.id) ?? null) : null;

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

  async function confirmSuspend() {
    if (!suspendTarget) return;
    setBusyId(suspendTarget.id);
    const result = await setSuspended(suspendTarget.id, true, reason.trim() || undefined);
    setBusyId(null);
    setNotice(result.ok
      ? `${suspendTarget.full_name ?? 'That account'} is suspended.`
      : (result.message ?? 'Could not suspend that account.'));
    setSuspendTarget(null);
    setReason('');
  }

  async function reinstate(row: AdminUserRow) {
    setBusyId(row.id);
    const result = await setSuspended(row.id, false);
    setBusyId(null);
    setNotice(result.ok
      ? `${row.full_name ?? 'That account'} can sign in again.`
      : (result.message ?? 'Could not reinstate that account.'));
  }

  async function applyRole(row: AdminUserRow, next: 'buyer' | 'vendor') {
    setRoleTarget(null);
    setBusyId(row.id);
    const result = await setRole(row.id, next);
    setBusyId(null);
    setNotice(result.ok
      ? `${row.full_name ?? 'That account'} is now a ${next}.`
      : (result.message ?? 'Could not change that role.'));
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>User Management</Text>
        <Text style={styles.h2}>Every account on the platform</Text>
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
      {directoryMissing && (
        <View style={styles.warnBox}>
          <Ionicons name="mail-outline" size={16} color={colors.warning} />
          <Text style={styles.warnText}>
            Email addresses are not available. They live in auth.users, which the browser cannot
            read — run <Text style={styles.code}>bookshops_admin_users.sql</Text> to install the
            admin-only directory function. Search still works on name and phone.
          </Text>
        </View>
      )}
      {!!notice && (
        <View style={styles.notice}>
          <Ionicons name="information-circle" size={16} color={colors.navy} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <View style={styles.tiles}>
        <StatTile label="Total Users" value={stats.total} loading={loading} />
        <StatTile label="Active Buyers" value={stats.buyers} tone="good" loading={loading} />
        <StatTile label="Registered Vendors" value={stats.vendors} tone="warn" loading={loading} />
        <StatTile label="Suspended" value={stats.suspended} tone="bad" loading={loading} />
      </View>

      <Panel
        title="Accounts"
        right={
          <View style={styles.searchBox}>
            <Ionicons name="search" size={14} color={colors.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={directoryMissing ? 'Name or phone' : 'Name, email or phone'}
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              accessibilityLabel="Search users"
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
            <Skeleton width="90%" height={18} />
            <Skeleton width="95%" height={18} />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.body}>
            <Text style={styles.empty}>
              {rows.length === 0
                ? 'No accounts yet.'
                : search.trim()
                  ? `Nothing matches “${search.trim()}”.`
                  : 'Nothing in this tab.'}
            </Text>
          </View>
        ) : (
          <View>
            {!isMobile && (
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.cell, styles.cUser, styles.thText]}>User</Text>
                <Text style={[styles.cell, styles.cContact, styles.thText]}>Contact</Text>
                <Text style={[styles.cell, styles.cRole, styles.thText]}>Role</Text>
                <Text style={[styles.cell, styles.cDate, styles.thText]}>Joined</Text>
                <Text style={[styles.cell, styles.cStatus, styles.thText]}>Status</Text>
                <Text style={[styles.cell, styles.cAct, styles.thText]}>Actions</Text>
              </View>
            )}

            {visible.map((row) => {
              const { allowed } = actionability(row, me);
              const busy = busyId === row.id;

              const actions = (
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => setDetail(row)}
                    style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`View details for ${row.full_name ?? 'this account'}`}
                  >
                    <Text style={styles.btnPlainText}>View</Text>
                  </Pressable>

                  {allowed && (
                    <>
                      <Pressable
                        onPress={() => setRoleTarget(row)}
                        disabled={busy}
                        style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Change role for ${row.full_name ?? 'this account'}`}
                      >
                        <Text style={styles.btnPlainText}>Role</Text>
                        <Ionicons name="chevron-down" size={12} color={colors.navy} />
                      </Pressable>

                      {row.suspended_at ? (
                        <Pressable
                          onPress={() => reinstate(row)}
                          disabled={busy}
                          style={({ pressed }) => [styles.btn, styles.btnGo, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Reinstate ${row.full_name ?? 'this account'}`}
                        >
                          <Text style={styles.btnGoText}>Reinstate</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => {
                            setReason('');
                            setSuspendTarget(row);
                          }}
                          disabled={busy}
                          style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Suspend ${row.full_name ?? 'this account'}`}
                        >
                          <Text style={styles.btnDangerText}>Suspend</Text>
                        </Pressable>
                      )}
                    </>
                  )}
                </View>
              );

              const contact = [row.email, row.phone_number].filter(Boolean).join('\n');

              return isMobile ? (
                <View key={row.id} style={styles.mRow}>
                  <View style={styles.mTop}>
                    <Pressable
                      onPress={() => setDetail(row)}
                      style={{ flex: 1 }}
                      accessibilityRole="button"
                      accessibilityLabel={`View details for ${row.full_name ?? 'this account'}`}
                    >
                      <Text style={[styles.mName, styles.link]} numberOfLines={1}>
                        {row.full_name ?? 'Unnamed account'}
                      </Text>
                    </Pressable>
                    <RoleBadge role={row.role} />
                  </View>
                  {!!contact && <Text style={styles.mMeta}>{contact.replace('\n', ' · ')}</Text>}
                  <View style={styles.mStatusRow}>
                    <StatusBadge suspended={!!row.suspended_at} />
                    <Text style={styles.mMeta}>
                      Joined {new Date(row.created_at).toLocaleDateString('en-NG')}
                    </Text>
                  </View>
                  {!!row.suspension_reason && <Text style={styles.reason}>{row.suspension_reason}</Text>}
                  {actions}
                </View>
              ) : (
                <View key={row.id} style={styles.tr}>
                  <View style={styles.cUser}>
                    <Pressable
                      onPress={() => setDetail(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`View details for ${row.full_name ?? 'this account'}`}
                    >
                      {({ pressed }) => (
                        <Text style={[styles.userName, styles.link, pressed && styles.linkPressed]} numberOfLines={1}>
                          {row.full_name ?? 'Unnamed account'}
                        </Text>
                      )}
                    </Pressable>
                    {!!row.store_name && (
                      <Text style={styles.subtle} numberOfLines={1}>{row.store_name}</Text>
                    )}
                  </View>
                  <View style={styles.cContact}>
                    <Text style={styles.contactLine} numberOfLines={1}>{row.email ?? '—'}</Text>
                    <Text style={styles.subtle} numberOfLines={1}>{row.phone_number ?? '—'}</Text>
                  </View>
                  <View style={styles.cRole}><RoleBadge role={row.role} /></View>
                  <Text style={[styles.cell, styles.cDate]}>
                    {new Date(row.created_at).toLocaleDateString('en-NG')}
                  </Text>
                  <View style={styles.cStatus}>
                    <StatusBadge suspended={!!row.suspended_at} />
                    {!!row.suspension_reason && (
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

      <UserDetailDrawer
        user={openDetail}
        currentUserId={me}
        onClose={() => setDetail(null)}
        busy={busyId !== null}
        onUnsuspend={(row) => {
          setDetail(null);
          reinstate(row);
        }}
        onSuspend={(row) => {
          setDetail(null);
          setReason('');
          setSuspendTarget(row);
        }}
      />

      {/* ---- suspend confirmation ------------------------------------ */}
      <Modal
        visible={suspendTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSuspendTarget(null)}
      >
        <Pressable style={styles.scrim} onPress={() => setSuspendTarget(null)} accessibilityLabel="Cancel" />
        <View style={styles.modalWrap} pointerEvents="box-none">
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              Suspend {suspendTarget?.full_name ?? 'this account'}?
            </Text>
            <Text style={styles.modalBody}>
              They will not be able to sign in or write anything until it is lifted. Orders and
              booklists already placed are left alone.
            </Text>
            <Text style={styles.modalLabel}>Reason (optional — the person sees it)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Abusive messages to a bookshop"
              placeholderTextColor={colors.textFaint}
              style={styles.modalInput}
              multiline
              accessibilityLabel="Suspension reason"
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setSuspendTarget(null)} style={styles.btnPlain} accessibilityRole="button">
                <Text style={styles.btnPlainText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmSuspend}
                disabled={busyId !== null}
                style={({ pressed }) => [styles.btn, styles.btnDangerSolid, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Confirm suspension"
              >
                <Text style={styles.btnDangerSolidText}>{busyId ? 'Suspending…' : 'Suspend'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- role picker --------------------------------------------- */}
      <Modal
        visible={roleTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleTarget(null)}
      >
        <Pressable style={styles.scrim} onPress={() => setRoleTarget(null)} accessibilityLabel="Cancel" />
        <View style={styles.modalWrap} pointerEvents="box-none">
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              Change role for {roleTarget?.full_name ?? 'this account'}
            </Text>
            <Text style={styles.modalBody}>
              Currently {roleTarget ? ROLE_STYLE[roleTarget.role].label.toLowerCase() : ''}.
              Switching to vendor lets them register a bookshop; switching to buyer does not delete
              a shop they already have, it just stops them reaching the vendor console.
            </Text>

            {(['buyer', 'vendor'] as const).map((r) => (
              <Pressable
                key={r}
                onPress={() => roleTarget && applyRole(roleTarget, r)}
                disabled={roleTarget?.role === r}
                style={({ pressed }) => [
                  styles.roleOption,
                  roleTarget?.role === r && styles.roleOptionCurrent,
                  pressed && roleTarget?.role !== r && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Set role to ${r}`}
              >
                <RoleBadge role={r} />
                <Text style={styles.roleOptionText}>
                  {r === 'buyer' ? 'Buys school books' : 'Runs a bookshop'}
                </Text>
                {roleTarget?.role === r && <Text style={styles.currentTag}>Current</Text>}
              </Pressable>
            ))}

            <View style={styles.adminNote}>
              <Ionicons name="lock-closed-outline" size={13} color={colors.textMuted} />
              <Text style={styles.adminNoteText}>
                Administrator is not on this list. Admin rights are granted only with the service
                key, so a stolen admin session cannot mint another one.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <Pressable onPress={() => setRoleTarget(null)} style={styles.btnPlain} accessibilityRole="button">
                <Text style={styles.btnPlainText}>Cancel</Text>
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
    flexGrow: 1, flexBasis: 160, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm,
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
  cUser: { flex: 1.4 },
  cContact: { flex: 1.7 },
  cRole: { flex: 0.8, alignItems: 'flex-start' },
  cDate: { flex: 0.9 },
  cStatus: { flex: 1, alignItems: 'flex-start', gap: 3 },
  cAct: { flex: 1.7, alignItems: 'flex-start' },
  userName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  contactLine: { fontSize: font.sm, color: colors.text },
  subtle: { fontSize: font.xs, color: colors.textFaint },
  link: { color: colors.navy, textDecorationLine: 'underline' },
  linkPressed: { color: colors.orangeDark },

  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  badgeText: { fontSize: font.xs, fontWeight: '800' },
  reason: { fontSize: font.xs, color: colors.danger, lineHeight: 15 },

  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1,
  },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  btnPlain: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  btnPlainText: { color: colors.navy, fontSize: font.sm, fontWeight: '700' },
  btnDanger: { backgroundColor: colors.surface, borderColor: '#F0C4BF' },
  btnDangerText: { color: colors.danger, fontSize: font.sm, fontWeight: '700' },
  btnDangerSolid: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnDangerSolidText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  pressed: { opacity: 0.85 },

  mRow: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 5,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  mTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  mName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  mMeta: { fontSize: font.sm, color: colors.textMuted },
  mStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

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

  roleOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.sm,
  },
  roleOptionCurrent: { backgroundColor: colors.surfaceMuted, opacity: 0.75 },
  roleOptionText: { flex: 1, fontSize: font.md, color: colors.text },
  currentTag: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint },
  adminNote: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.md,
  },
  adminNoteText: { flex: 1, fontSize: font.xs, color: colors.textMuted, lineHeight: 16 },

  errorBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: '#FDF2F1', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
  warnBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  warnText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },
  code: { fontWeight: '700' },
  notice: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.text },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBtn: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
});
