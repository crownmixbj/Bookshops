import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/admin/AdminShell';
import {
  StatRow, StatTile, Tabs, SearchBox, Badge, TableSkeleton, EmptyRow, ErrorBanner, InfoBanner,
  tableStyles as t, pageStyles as page, type Tone,
} from '../../components/admin/AdminTable';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import { useAdminSupport, type SupportRow, type ReportStatus } from '../../hooks/useAdminOps';
import { SUPPORT, supportMailto } from '../../lib/support';
import { colors, spacing, radius, font } from '../../theme';

const TABS: { key: 'all' | ReportStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'dismissed', label: 'Dismissed' },
];

const STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'warn' },
  actioned: { label: 'Actioned', tone: 'good' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

const SUBJECT_LABEL: Record<string, string> = {
  review: 'Review', booklist: 'Booklist', vendor: 'Bookshop', quote: 'Quote',
};

/**
 * Customer Support.
 *
 * Built on content_reports, which is what the database actually has:
 * someone reports a review, booklist, shop or quote, and an admin
 * actions or dismisses it.
 *
 * The brief asks for a ticketing system — priorities, categories,
 * assignment, a message thread, replies, an associated order number,
 * "pending vendor response". None of those columns exist, and there is
 * no messages table, so none of them are shown. Inventing a Priority
 * column that every row renders as "Medium" would look complete and
 * tell an admin nothing.
 *
 * What IS wired: reading the report, resolving it with a note through
 * the audited admin_resolve_report RPC, and emailing the reporter.
 */
export default function AdminSupportScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role } = useShell();
  const { rows, stats, loading, error, refresh, resolve } = useAdminSupport();

  const [tab, setTab] = useState<'all' | ReportStatus>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<SupportRow | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (tab === 'all' ? true : r.status === tab))
      .filter((r) =>
        q
          ? r.reference.toLowerCase().includes(q) ||
            (r.reporter_name ?? '').toLowerCase().includes(q) ||
            r.reason.toLowerCase().includes(q)
          : true
      );
  }, [rows, tab, search]);

  if (role !== 'admin') {
    return (
      <View style={page.gate}>
        <Ionicons name="lock-closed-outline" size={30} color={colors.textFaint} />
        <Text style={page.gateTitle}>This area is for administrators</Text>
        <Pressable onPress={() => router.replace('/')} style={page.gateBtn} accessibilityRole="button">
          <Text style={page.gateBtnText}>Back to my dashboard</Text>
        </Pressable>
      </View>
    );
  }

  async function act(status: 'actioned' | 'dismissed') {
    if (!open) return;
    setBusy(true);
    const result = await resolve(open.id, status, note.trim() || undefined);
    setBusy(false);
    setNotice(result.ok
      ? `${open.reference} marked ${status}.`
      : (result.message ?? 'Could not update that report.'));
    if (result.ok) { setOpen(null); setNote(''); }
  }

  return (
    <ScrollView
      style={page.scroll}
      contentContainerStyle={[page.content, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={page.heading}>
        <Text style={page.h1}>Customer Support</Text>
        <Text style={page.h2}>Reported content and disputes</Text>
      </View>

      {!!error && <ErrorBanner message={error.message} onRetry={refresh} />}
      {!!notice && (
        <View style={s.notice}>
          <Ionicons name="information-circle" size={16} color={colors.navy} />
          <Text style={s.noticeText}>{notice}</Text>
        </View>
      )}

      <StatRow>
        <StatTile label="Open Reports" value={stats.open} tone="warn" loading={loading} />
        <StatTile label="Actioned" value={stats.actioned} tone="good" loading={loading} />
        <StatTile label="Dismissed" value={stats.dismissed} loading={loading} />
        <StatTile label="Resolved Today" value={stats.resolvedToday} tone="info" loading={loading} />
      </StatRow>

      <Panel
        title="Reports"
        right={<SearchBox value={search} onChange={setSearch} placeholder="ID, reporter or reason" label="Search reports" />}
      >
        <Tabs tabs={TABS} value={tab} onChange={setTab} />

        {loading ? (
          <TableSkeleton />
        ) : visible.length === 0 ? (
          <EmptyRow>
            {rows.length === 0
              ? 'Nothing has been reported. When a buyer or a bookshop reports a review, booklist, shop or quote, it lands here.'
              : search.trim() ? `Nothing matches “${search.trim()}”.` : 'Nothing in this tab.'}
          </EmptyRow>
        ) : (
          <View>
            {!isMobile && (
              <View style={[t.tr, t.th]}>
                <Text style={[t.cell, s.cRef, t.thText]}>Report</Text>
                <Text style={[t.cell, s.cWho, t.thText]}>Reported by</Text>
                <Text style={[t.cell, s.cKind, t.thText]}>About</Text>
                <Text style={[t.cell, s.cReason, t.thText]}>Reason</Text>
                <Text style={[t.cell, s.cDate, t.thText]}>Received</Text>
                <Text style={[t.cell, s.cStatus, t.thText]}>Status</Text>
                <Text style={[t.cell, s.cAct, t.thText]}>Actions</Text>
              </View>
            )}

            {visible.map((r) => {
              const st = STATUS[r.status];
              const openBtn = (
                <Pressable
                  onPress={() => { setNote(r.resolution_note ?? ''); setOpen(r); }}
                  style={({ pressed }) => [t.btn, pressed && t.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open report ${r.reference}`}
                >
                  <Text style={t.btnText}>Open</Text>
                </Pressable>
              );

              return isMobile ? (
                <View key={r.id} style={t.mRow}>
                  <View style={t.mTop}>
                    <Text style={t.strong} numberOfLines={1}>{r.reporter_name ?? 'Unknown'}</Text>
                    <Badge label={st.label} tone={st.tone} />
                  </View>
                  <Text style={t.mMeta} numberOfLines={2}>{r.reason}</Text>
                  <Text style={t.mMeta}>
                    {SUBJECT_LABEL[r.subject_type] ?? r.subject_type} · {r.reference} ·{' '}
                    {new Date(r.created_at).toLocaleDateString('en-NG')}
                  </Text>
                  <View style={t.actions}>{openBtn}</View>
                </View>
              ) : (
                <View key={r.id} style={t.tr}>
                  <Text style={[t.cell, s.cRef, t.mono]}>{r.reference}</Text>
                  <View style={s.cWho}>
                    <Text style={t.cell} numberOfLines={1}>{r.reporter_name ?? 'Unknown'}</Text>
                    {!!r.reporter_role && (
                      <Text style={t.subtle}>
                        {r.reporter_role === 'vendor' ? 'Vendor' : r.reporter_role === 'admin' ? 'Admin' : 'Buyer'}
                      </Text>
                    )}
                  </View>
                  <Text style={[t.cell, s.cKind]}>{SUBJECT_LABEL[r.subject_type] ?? r.subject_type}</Text>
                  <Text style={[t.cell, s.cReason]} numberOfLines={2}>{r.reason}</Text>
                  <Text style={[t.cell, s.cDate]}>{new Date(r.created_at).toLocaleDateString('en-NG')}</Text>
                  <View style={s.cStatus}><Badge label={st.label} tone={st.tone} /></View>
                  <View style={s.cAct}>{openBtn}</View>
                </View>
              );
            })}
          </View>
        )}
      </Panel>

      <InfoBanner>
        This reads content_reports. There is no ticket system behind it — no priority, category,
        assignment or message thread exists in the schema, so none is shown. Replies go by email
        for now; a real inbox needs a messages table.
      </InfoBanner>

      <Footer audience="admin" />

      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={s.scrim} onPress={() => setOpen(null)} accessibilityLabel="Close" />
        <View style={s.modalWrap} pointerEvents="box-none">
          <View style={s.modal}>
            <View style={s.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>Report {open?.reference}</Text>
                <Text style={s.modalSub}>
                  {open?.reporter_name ?? 'Unknown'} · about a{' '}
                  {(SUBJECT_LABEL[open?.subject_type ?? ''] ?? open?.subject_type ?? '').toLowerCase()}
                </Text>
              </View>
              <Pressable onPress={() => setOpen(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>What they said</Text>
                <Text style={s.reason}>{open?.reason}</Text>
              </View>

              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>Subject reference</Text>
                <Text style={s.mono}>{open?.subject_id}</Text>
                <Text style={s.footnote}>
                  The id of the {(SUBJECT_LABEL[open?.subject_type ?? ''] ?? 'item').toLowerCase()} being
                  reported. There is no deep link to it yet.
                </Text>
              </View>

              {open?.status !== 'open' && (
                <View style={{ gap: spacing.sm }}>
                  <Text style={s.sectionTitle}>Resolution</Text>
                  <Text style={s.reason}>
                    {open?.resolution_note || 'Resolved without a note.'}
                  </Text>
                  {!!open?.resolved_at && (
                    <Text style={s.footnote}>
                      {new Date(open.resolved_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </Text>
                  )}
                </View>
              )}

              {open?.status === 'open' && (
                <View style={{ gap: spacing.sm }}>
                  <Text style={s.sectionTitle}>Resolution note</Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="What did you do about it? The reporter can see this."
                    placeholderTextColor={colors.textFaint}
                    style={s.input}
                    multiline
                    accessibilityLabel="Resolution note"
                  />
                </View>
              )}
            </ScrollView>

            <View style={s.actions}>
              {open?.status === 'open' ? (
                <>
                  <Pressable
                    onPress={() => act('actioned')}
                    disabled={busy}
                    style={({ pressed }) => [s.btn, s.btnGo, pressed && t.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Mark actioned"
                  >
                    <Text style={s.btnGoText}>{busy ? 'Saving…' : 'Mark actioned'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => act('dismissed')}
                    disabled={busy}
                    style={({ pressed }) => [s.btn, s.btnPlain, pressed && t.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss report"
                  >
                    <Text style={s.btnPlainText}>Dismiss</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={s.footnote}>This report is already resolved.</Text>
              )}

              <Pressable
                onPress={() =>
                  Linking.openURL(
                    supportMailto({ subject: `LOCI report ${open?.reference}` })
                  ).catch(() => {
                    // No mail client on this machine.
                  })
                }
                style={({ pressed }) => [s.btn, s.btnPlain, pressed && t.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Email ${SUPPORT.email}`}
              >
                <Ionicons name="mail-outline" size={14} color={colors.navy} />
                <Text style={s.btnPlainText}>Reply by email</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  cRef: { flex: 0.8 },
  cWho: { flex: 1.2 },
  cKind: { flex: 0.8 },
  cReason: { flex: 2 },
  cDate: { flex: 0.9 },
  cStatus: { flex: 0.9, alignItems: 'flex-start' },
  cAct: { flex: 0.8, alignItems: 'flex-start' },

  notice: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.text },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.4)' },
  modalWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 540, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  modalHead: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  modalSub: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  sectionTitle: {
    fontSize: font.xs, fontWeight: '800', color: colors.textFaint,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  reason: { fontSize: font.md, color: colors.text, lineHeight: 21 },
  mono: { fontSize: font.sm, color: colors.textMuted, letterSpacing: 0.3 },
  footnote: { flex: 1, fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },
  input: {
    minHeight: 80, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted, padding: spacing.md, fontSize: font.md,
    color: colors.text, textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center',
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 9,
  },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  btnPlain: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  btnPlainText: { color: colors.navy, fontSize: font.sm, fontWeight: '700' },
});
