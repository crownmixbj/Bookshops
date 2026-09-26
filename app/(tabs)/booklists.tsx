import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { BooklistCard } from '../../components/booklists/BooklistCard';
import { CreateBooklistModal } from '../../components/CreateBooklistModal';
import { BooklistReviewModal } from '../../components/booklists/BooklistReviewModal';
import { EditBooklistModal } from '../../components/booklists/EditBooklistModal';
import { ConfirmDialog } from '../../components/booklists/ConfirmDialog';
import { DispatchModal } from '../../components/booklists/DispatchModal';
import {
  publishBookRequest,
  deleteBookRequest,
  describeBooklistError,
  type Dispatch,
} from '../../lib/booklistUpload';

import { useLayout } from '../../hooks/useLayout';
import { useBooklists } from '../../hooks/useBooklists';
import { useCreateBooklist } from '../../hooks/useCreateBooklist';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font, shadow } from '../../theme';
import type { Booklist } from '../../types/db';
import { BundleCheckoutCard } from '../../components/booklists/BundleCheckoutCard';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';

/**
 * Edit / Publish / Delete, threaded down to every card in a section.
 *
 * Grouped into one object rather than three props because they always
 * travel together, and because the card decides for itself which of
 * them apply — a delivered booklist gets the same handlers and shows
 * none of the buttons.
 */
interface CardActions {
  onEdit: (booklist: Booklist) => void;
  onPublish: (booklist: Booklist) => void;
  onDelete: (booklist: Booklist) => void;
  /** Id of the booklist whose Publish is in flight, if any. */
  publishingId: string | null;
}

interface SectionProps {
  title: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  booklists: Booklist[];
  emptyText: string;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  actions: CardActions;
}

function Section({
  title,
  caption,
  icon,
  booklists,
  emptyText,
  defaultExpanded = false,
  collapsible = false,
  actions,
}: SectionProps) {
  // Archived history is collapsed by default — it grows without bound and
  // is the least useful thing on the page day to day.
  const [collapsed, setCollapsed] = useState(collapsible);

  return (
    <View style={styles.section}>
      <Pressable
        onPress={collapsible ? () => setCollapsed((v) => !v) : undefined}
        style={styles.sectionHead}
        accessibilityRole={collapsible ? 'button' : undefined}
      >
        <Ionicons name={icon} size={17} color={colors.navy} />
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>
            {title}
            <Text style={styles.sectionCount}>  {booklists.length}</Text>
          </Text>
          <Text style={styles.sectionCaption}>{caption}</Text>
        </View>
        {collapsible && (
          <Ionicons
            name={collapsed ? 'chevron-down' : 'chevron-up'}
            size={17}
            color={colors.textMuted}
          />
        )}
      </Pressable>

      {!collapsed &&
        (booklists.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        ) : (
          booklists.map((b, i) => (
            <BooklistCard
              key={b.id}
              booklist={b}
              defaultExpanded={defaultExpanded && i === 0}
              // The destination comes from the card, which resolved it
              // with quoteCta(). This used to be router.push('/') — the
              // one button on the screen that offers to show a buyer
              // their quotes dropped them back on the dashboard.
              onPressQuotes={(_b, path) => router.push(path as never)}
              onEdit={actions.onEdit}
              onPublish={actions.onPublish}
              onDelete={actions.onDelete}
              publishing={actions.publishingId === b.id}
            />
          ))
        ))}
    </View>
  );
}

/**
 * My Booklists — the management hub for a buyer's school supply requests.
 *
 * Three sections, derived in useBooklists rather than here:
 *   Active     quoted or ordered; something is happening
 *   Drafts     raised, no vendor has quoted yet
 *   Archived   delivered or cancelled
 */
export default function BooklistsScreen() {
  const { isMobile, contentPadding } = useLayout();
  // The create flow, shared with the Booklist Hub so both screens offer
  // the same three choices and land in the same place.
  const create = useCreateBooklist();
  const [flash, setFlash] = useState<string | null>(null);

  // Edit / publish / delete on an existing list.
  const [editing, setEditing] = useState<Booklist | null>(null);
  const [deleting, setDeleting] = useState<Booklist | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  /** The list awaiting a routing choice. Null keeps DispatchModal unmounted. */
  const [dispatchFor, setDispatchFor] = useState<Booklist | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The search box lives in the shell's top bar so its text survives
  // navigation; this screen just reads what was typed.
  const { search } = useShell();

  const { sections, children, userId, loading, refreshing, error, refresh, revalidate } = useBooklists();
  /** 'all', 'none' (lists not tied to a child), or a child id. */
  const [childFilter, setChildFilter] = useState<string>('all');

  /** Shown after a booklist is created or changed, once its modal has closed. */
  async function handleSubmitted(message: string) {
    setFlash(message);
    setActionError(null);
    // Background, not a reload: these cards are already showing the
    // booklists they need to. Throwing them back to a skeleton because
    // a NEW one was created is the bug, not the loading indicator.
    await revalidate();
  }

  /**
   * Draft -> pending_quote, which is what puts the list in front of
   * vendors. publishBookRequest refuses an empty list and checks that a
   * row was actually updated, so a policy refusal surfaces here as a
   * message rather than as a button that appears to work.
   */
  async function handlePublish(booklist: Booklist, dispatch: Dispatch) {
    setPublishingId(booklist.id);
    setActionError(null);
    try {
      await publishBookRequest(booklist.id, dispatch);
      setDispatchFor(null);
      setFlash(
        dispatch.type === 'direct'
          ? `${booklist.school_name} was sent to that shop. Only they can see it.`
          : `${booklist.school_name} is now with vendors. Quotes will appear here.`
      );
      await revalidate();
    } catch (e) {
      setActionError(describeBooklistError(e));
      setDispatchFor(null);
    } finally {
      setPublishingId(null);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setActionError(null);
    try {
      await deleteBookRequest(deleting.id);
      setFlash(`Deleted the booklist for ${deleting.school_name}.`);
      setDeleting(null);
      await revalidate();
    } catch (e) {
      setActionError(describeBooklistError(e));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  const cardActions: CardActions = {
    onEdit: setEditing,
    // Publish asks where first. Routing is not reversible once a vendor
    // starts pricing, so it is a decision rather than a default.
    onPublish: setDispatchFor,
    onDelete: setDeleting,
    publishingId,
  };

  const q = search.trim().toLowerCase();
  const filter = (list: Booklist[]) =>
    list
      .filter((b) =>
        childFilter === 'all' ? true : childFilter === 'none' ? !b.child : b.child?.id === childFilter
      )
      .filter((b) =>
        q
          ? b.school_name.toLowerCase().includes(q) ||
            b.class_level.toLowerCase().includes(q) ||
            (b.child?.full_name ?? '').toLowerCase().includes(q) ||
            b.items.some((i) => i.title.toLowerCase().includes(q))
          : true
      );

  const totalCount =
    sections.active.length + sections.draft.length + sections.archived.length;

  return (
    <>

      <CreateBooklistModal
        visible={create.choosing}
        onClose={create.close}
        onPick={create.onPick}
        onDismissed={create.onDismissed}
        title={create.title}
        onTitleChange={create.setTitle}
      />

      <BooklistReviewModal
        visible={create.image !== null}
        userId={userId}
        image={create.image}
        initialSchool={create.title}
        onClose={create.clearImage}
        onSubmitted={handleSubmitted}
      />

      <EditBooklistModal
        booklist={editing}
        onClose={() => setEditing(null)}
        onSaved={handleSubmitted}
      />

      {dispatchFor && (
        <DispatchModal
          schoolName={dispatchFor.school_name}
          busy={publishingId === dispatchFor.id}
          onCancel={() => setDispatchFor(null)}
          onConfirm={(dispatch) => handlePublish(dispatchFor, dispatch)}
        />
      )}

      <ConfirmDialog
        visible={deleting !== null}
        title="Delete this booklist?"
        message={
          deleting
            ? `"${deleting.school_name}" and its ${deleting.items.length} item${
                deleting.items.length === 1 ? '' : 's'
              } will be removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.heading, isMobile && styles.headingMobile]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h1}>My Booklists</Text>
              <Text style={styles.h2}>
                {totalCount === 0
                  ? 'Everything you send out for quotes lives here'
                  : `${totalCount} booklist${totalCount === 1 ? '' : 's'} in total`}
              </Text>
            </View>
            <Pressable
              onPress={create.open}
              style={({ pressed }) => [styles.create, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Create a new booklist"
            >
              <Ionicons name="camera" size={17} color={colors.onNavy} />
              <Text style={styles.createText}>Create New Booklist</Text>
            </Pressable>
          </View>

          {flash && (
            <View style={styles.flashBox}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.flashText}>{flash}</Text>
              <Pressable onPress={() => setFlash(null)} hitSlop={6} accessibilityLabel="Dismiss">
                <Ionicons name="close" size={15} color={colors.success} />
              </Pressable>
            </View>
          )}

          {create.error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{create.error}</Text>
              <Pressable onPress={create.clearError} hitSlop={6} accessibilityLabel="Dismiss">
                <Text style={styles.retry}>Dismiss</Text>
              </Pressable>
            </View>
          )}

          {actionError && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{actionError}</Text>
              <Pressable onPress={() => setActionError(null)} hitSlop={6} accessibilityLabel="Dismiss">
                <Text style={styles.retry}>Dismiss</Text>
              </Pressable>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error.message}</Text>
              <Pressable onPress={refresh} hitSlop={6}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* One pill per child. Only once there are children to tell
              apart — a single-child household gets no extra chrome. */}
          {!loading && children.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.childPills}
              style={styles.childPillsScroll}
            >
              {[
                { key: 'all', label: 'All children' },
                ...children.map((c) => ({
                  key: c.id,
                  label: [c.full_name, c.class_level].filter(Boolean).join(' · '),
                })),
                { key: 'none', label: 'Not assigned' },
              ].map((opt) => {
                const on = childFilter === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setChildFilter(opt.key)}
                    style={[styles.childPill, on && styles.childPillOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.childPillText, on && styles.childPillTextOn]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => router.push({ pathname: '/settings', params: { section: 'children' } })}
                style={[styles.childPill, styles.childPillManage]}
                accessibilityRole="button"
              >
                <Ionicons name="settings-outline" size={13} color={colors.navy} />
                <Text style={styles.childPillText}>Manage</Text>
              </Pressable>
            </ScrollView>
          )}

          {!loading && <BundleCheckoutCard booklists={filter(sections.active)} />}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : (
            <>
              <Section
                title="Active"
                caption="Quoted and waiting on you to choose a shop"
                icon="flash-outline"
                booklists={filter(sections.active)}
                defaultExpanded
                emptyText="Nothing active. Once a vendor quotes one of your lists it moves here."
                actions={cardActions}
              />
              <Section
                title="Drafts & Pending"
                caption="Drafts you are still writing, and lists sent out with no quotes back yet"
                icon="time-outline"
                booklists={filter(sections.draft)}
                emptyText="No lists waiting on quotes. Create one and vendors will price it."
                actions={cardActions}
              />
              <Section
                title="Archived"
                caption="Ordered, delivered or cancelled — tracked on My Orders"
                icon="archive-outline"
                booklists={filter(sections.archived)}
                collapsible
                emptyText="Nothing archived yet."
                actions={cardActions}
              />
            </>
          )}
          <Footer />
        </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  childPillsScroll: { flexGrow: 0, marginBottom: spacing.lg },
  childPills: { gap: spacing.sm },
  childPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
  },
  childPillOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  childPillManage: { borderStyle: 'dashed' },
  childPillText: { fontSize: font.sm, fontWeight: '600', color: colors.navy },
  childPillTextOn: { color: colors.onNavy },
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  headingMobile: { flexDirection: 'column', alignItems: 'stretch' },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  create: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    ...shadow.card,
  },
  createText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  section: { marginBottom: spacing.xl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  sectionCount: { color: colors.textFaint, fontWeight: '700' },
  sectionCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    padding: spacing.xl,
  },
  emptyText: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

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
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },

  flashBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E8F5EE',
    borderColor: '#BEE3CE',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  flashText: { flex: 1, fontSize: font.sm, color: colors.success, fontWeight: '600' },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
  pressed: { opacity: 0.85 },
});
