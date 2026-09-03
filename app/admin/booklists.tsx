import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
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
import { useAdminBooklists, useBooklistDetail, type BooklistRow, type RequestStatus } from '../../hooks/useAdminOps';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * The statuses book_requests actually has. The brief asked for an
 * "Expired" tab, but nothing expires a booklist — there is no job and no
 * column for it. Showing an Expired tab that is permanently empty would
 * imply a lifecycle the marketplace does not have, so the fourth state
 * is Cancelled, which is real.
 */
const TABS: { key: 'all' | RequestStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending_quote', label: 'New Request' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'ordered', label: 'Fulfilled' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  // No tab of its own — a draft is the buyer's unfinished work, not a
  // queue an administrator is meant to work through. It still needs an
  // entry here or the row renders with an undefined badge under "All".
  draft: { label: 'Draft', tone: 'neutral' },
  pending_quote: { label: 'New', tone: 'warn' },
  quoted: { label: 'Quoted', tone: 'info' },
  ordered: { label: 'Fulfilled', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

export default function AdminBooklistsScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { role } = useShell();
  const { rows, stats, loading, error, refresh } = useAdminBooklists();

  const [tab, setTab] = useState<'all' | RequestStatus>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<BooklistRow | null>(null);
  const { items, quotes, loading: detailLoading } = useBooklistDetail(open?.id ?? null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (tab === 'all' ? true : r.status === tab))
      .filter((r) =>
        q
          ? r.reference.toLowerCase().includes(q) ||
            r.school_name.toLowerCase().includes(q) ||
            r.class_level.toLowerCase().includes(q)
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

  return (
    <ScrollView
      style={page.scroll}
      contentContainerStyle={[page.content, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={page.heading}>
        <Text style={page.h1}>Booklist Hub</Text>
        <Text style={page.h2}>Every booklist request on the marketplace</Text>
      </View>

      {!!error && <ErrorBanner message={error.message} onRetry={refresh} />}

      <StatRow>
        <StatTile label="Total Submitted" value={stats.total} loading={loading} />
        <StatTile label="Awaiting Quotes" value={stats.open} tone="warn" loading={loading} />
        <StatTile label="Quoted" value={stats.quoted} tone="info" loading={loading} />
        <StatTile label="Fulfilled" value={stats.ordered} tone="good" loading={loading} />
      </StatRow>

      <Panel
        title="Requests"
        right={<SearchBox value={search} onChange={setSearch} placeholder="ID, school or level" label="Search booklists" />}
      >
        <Tabs tabs={TABS} value={tab} onChange={setTab} />

        {loading ? (
          <TableSkeleton />
        ) : visible.length === 0 ? (
          <EmptyRow>
            {rows.length === 0
              ? 'No booklists have been submitted yet.'
              : search.trim() ? `Nothing matches “${search.trim()}”.` : 'Nothing in this tab.'}
          </EmptyRow>
        ) : (
          <View>
            {!isMobile && (
              <View style={[t.tr, t.th]}>
                <Text style={[t.cell, s.cRef, t.thText]}>Request</Text>
                <Text style={[t.cell, s.cSchool, t.thText]}>School / Level</Text>
                <Text style={[t.cell, s.cNum, t.thText]}>Items</Text>
                <Text style={[t.cell, s.cNum, t.thText]}>Quotes</Text>
                <Text style={[t.cell, s.cDate, t.thText]}>Submitted</Text>
                <Text style={[t.cell, s.cStatus, t.thText]}>Status</Text>
                <Text style={[t.cell, s.cAct, t.thText]}>Actions</Text>
              </View>
            )}

            {visible.map((r) => {
              const st = STATUS[r.status];
              const view = (
                <Pressable
                  onPress={() => setOpen(r)}
                  style={({ pressed }) => [t.btn, pressed && t.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`View full list and quotes for ${r.reference}`}
                >
                  <Text style={t.btnText}>View list & quotes</Text>
                </Pressable>
              );

              return isMobile ? (
                <View key={r.id} style={t.mRow}>
                  <View style={t.mTop}>
                    <Text style={t.strong} numberOfLines={1}>{r.school_name}</Text>
                    <Badge label={st.label} tone={st.tone} />
                  </View>
                  <Text style={t.mMeta}>{r.class_level} · {r.reference}</Text>
                  <Text style={t.mMeta}>
                    {r.itemCount} item{r.itemCount === 1 ? '' : 's'} · {r.quoteCount} quote
                    {r.quoteCount === 1 ? '' : 's'} · {new Date(r.created_at).toLocaleDateString('en-NG')}
                  </Text>
                  <View style={t.actions}>{view}</View>
                </View>
              ) : (
                <View key={r.id} style={t.tr}>
                  <Text style={[t.cell, s.cRef, t.mono]}>{r.reference}</Text>
                  <View style={s.cSchool}>
                    <Text style={t.strong} numberOfLines={1}>{r.school_name}</Text>
                    <Text style={t.subtle} numberOfLines={1}>
                      {r.class_level}{r.buyer_name ? ` · ${r.buyer_name}` : ''}
                    </Text>
                  </View>
                  <Text style={[t.cell, s.cNum]}>{r.itemCount}</Text>
                  <Text style={[t.cell, s.cNum]}>{r.quoteCount}</Text>
                  <Text style={[t.cell, s.cDate]}>{new Date(r.created_at).toLocaleDateString('en-NG')}</Text>
                  <View style={s.cStatus}><Badge label={st.label} tone={st.tone} /></View>
                  <View style={s.cAct}>{view}</View>
                </View>
              );
            })}
          </View>
        )}
      </Panel>

      <InfoBanner>
        Nothing expires a booklist — there is no scheduled job and no expiry column — so the
        fourth tab is Cancelled rather than an Expired tab that would always be empty.
      </InfoBanner>

      <Footer audience="admin" />

      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={s.scrim} onPress={() => setOpen(null)} accessibilityLabel="Close" />
        <View style={s.modalWrap} pointerEvents="box-none">
          <View style={s.modal}>
            <View style={s.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>{open?.school_name}</Text>
                <Text style={s.modalSub}>
                  {open?.class_level} · {open?.reference}
                  {open?.buyer_name ? ` · ${open.buyer_name}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => setOpen(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}>
              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>Items requested</Text>
                {detailLoading ? (
                  <TableSkeleton />
                ) : items.length === 0 ? (
                  <Text style={s.note}>
                    No line items. The buyer sent a photo of the list without typing it out, or the
                    parser has not run.
                  </Text>
                ) : (
                  items.map((i) => (
                    <View key={i.id} style={s.itemRow}>
                      <Text style={s.itemQty}>{i.quantity}×</Text>
                      <Text style={s.itemTitle} numberOfLines={2}>{i.title}</Text>
                      <Text style={t.subtle}>{i.category}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={{ gap: spacing.sm }}>
                <Text style={s.sectionTitle}>Quotes submitted</Text>
                {detailLoading ? (
                  <TableSkeleton />
                ) : quotes.length === 0 ? (
                  <Text style={s.note}>No shop has quoted on this booklist yet.</Text>
                ) : (
                  quotes.map((q) => (
                    <View key={q.id} style={s.quoteRow}>
                      <Text style={s.quoteVendor} numberOfLines={1}>{q.vendor}</Text>
                      <Text style={s.quoteTotal}>{formatNaira(q.total)}</Text>
                      <Badge
                        label={q.status}
                        tone={q.status === 'accepted' ? 'good' : q.status === 'rejected' ? 'bad' : 'info'}
                      />
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  cRef: { flex: 0.9 },
  cSchool: { flex: 1.8 },
  cNum: { flex: 0.6 },
  cDate: { flex: 1 },
  cStatus: { flex: 0.9, alignItems: 'flex-start' },
  cAct: { flex: 1.4, alignItems: 'flex-start' },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.4)' },
  modalWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
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
  note: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  itemRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  itemQty: { width: 32, fontSize: font.md, fontWeight: '700', color: colors.navy },
  itemTitle: { flex: 1, fontSize: font.md, color: colors.text },
  quoteRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
  },
  quoteVendor: { flex: 1, fontSize: font.md, color: colors.text },
  quoteTotal: { fontSize: font.md, fontWeight: '800', color: colors.text },
});
