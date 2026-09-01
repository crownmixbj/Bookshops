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

import { TopBar } from '../../components/dashboard/TopBar';
import { Sidebar, NAV_ITEMS } from '../../components/dashboard/Sidebar';
import { ProfileMenu } from '../../components/profile/ProfileMenu';
import { SupportMenu } from '../../components/support/SupportMenu';
import { SupportDrawer } from '../../components/support/SupportDrawer';
import { BooklistCard } from '../../components/booklists/BooklistCard';
import { CreateBooklistModal } from '../../components/booklists/CreateBooklistModal';

import { useLayout } from '../../hooks/useLayout';
import { useBooklists } from '../../hooks/useBooklists';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font, shadow } from '../../theme';
import type { Booklist } from '../../types/db';

interface SectionProps {
  title: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  booklists: Booklist[];
  emptyText: string;
  defaultExpanded?: boolean;
  collapsible?: boolean;
}

function Section({
  title,
  caption,
  icon,
  booklists,
  emptyText,
  defaultExpanded = false,
  collapsible = false,
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
              onPressQuotes={() => router.push('/')}
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');

  const { sections, userId, loading, refreshing, error, refresh, reload } = useBooklists();

  /**
   * Only these routes exist as files today. The sidebar also lists My
   * Orders, Saved Shops and Settings — pushing those would land the user
   * on expo-router's "Unmatched Route" screen, so they are inert until
   * their screens are built. typedRoutes is what surfaced this: it
   * rejects a plain string that is not a real route.
   */
  const IMPLEMENTED = { dashboard: '/', booklists: '/booklists', orders: '/orders', saved: '/saved', settings: '/settings' } as const;

  async function handleNavigate(item: (typeof NAV_ITEMS)[number]) {
    if (item.key === 'logout') {
      await supabase.auth.signOut();
      return;
    }
    const target = IMPLEMENTED[item.key as keyof typeof IMPLEMENTED];
    if (target && target !== '/booklists') router.push(target);
  }

  const q = search.trim().toLowerCase();
  const filter = (list: Booklist[]) =>
    q
      ? list.filter(
          (b) =>
            b.school_name.toLowerCase().includes(q) ||
            b.class_level.toLowerCase().includes(q) ||
            b.items.some((i) => i.title.toLowerCase().includes(q))
        )
      : list;

  const totalCount =
    sections.active.length + sections.draft.length + sections.archived.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TopBar
        query={search}
        onQueryChange={setSearch}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={() => setProfileOpen(true)}
        onSupportPress={() => setSupportOpen(true)}
      />

      <ProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <SupportMenu
        visible={supportOpen}
        onClose={() => setSupportOpen(false)}
        onOpenChat={() => setChatOpen(true)}
      />
      <SupportDrawer visible={chatOpen} onClose={() => setChatOpen(false)} />
      <CreateBooklistModal
        visible={creating}
        userId={userId}
        onClose={() => setCreating(false)}
        onCreated={reload}
      />

      <View style={styles.body}>
        <Sidebar
          activeKey="booklists"
          onNavigate={handleNavigate}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
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
              onPress={() => setCreating(true)}
              style={({ pressed }) => [styles.create, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Create a new booklist"
            >
              <Ionicons name="camera" size={17} color={colors.onNavy} />
              <Text style={styles.createText}>Create New Booklist</Text>
            </Pressable>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error.message}</Text>
              <Pressable onPress={refresh} hitSlop={6}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            </View>
          )}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : (
            <>
              <Section
                title="Active"
                caption="Quoted or ordered — waiting on you or on a vendor"
                icon="flash-outline"
                booklists={filter(sections.active)}
                defaultExpanded
                emptyText="Nothing active. Once a vendor quotes one of your lists it moves here."
              />
              <Section
                title="Drafts & pending"
                caption="Sent out, no quotes back yet"
                icon="time-outline"
                booklists={filter(sections.draft)}
                emptyText="No lists waiting on quotes. Create one and vendors will price it."
              />
              <Section
                title="Archived"
                caption="Delivered or cancelled"
                icon="archive-outline"
                booklists={filter(sections.archived)}
                collapsible
                emptyText="Nothing archived yet."
              />
            </>
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
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
  pressed: { opacity: 0.85 },
});
