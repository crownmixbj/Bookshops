import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import {
  FilterPills,
  MigrationNeeded,
  InlineMessage,
  StatusPill,
  relativeStamp,
  shortDate,
} from '../../components/vendor/VendorPageParts';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import {
  useBuyerMessages,
  MESSAGE_MAX,
  type BuyerThread,
  type ThreadMessage,
} from '../../hooks/useBuyerMessages';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import type { FulfillmentStatus } from '../../types/db';

/**
 * Messages — the buyer's conversations with shops, one thread per quote.
 *
 * Keyed on the quote, so a parent with two children at two schools has
 * two separate conversations with the same shop, each tied to the list
 * it is about, and to the order once that quote has been paid for.
 *
 * `?quote=<id>` opens a thread directly. The quote page, the order card
 * and message notifications all link here that way.
 */

type Filter = 'all' | 'unread' | 'orders';

/** Buyer-facing words. The vendor's "To pack" means nothing to a parent. */
const ORDER_COPY: Record<FulfillmentStatus, { label: string; fg: string; bg: string }> = {
  processing: { label: 'Being prepared', fg: colors.warning, bg: colors.warningBg },
  ready: { label: 'Packed', fg: colors.navy, bg: '#E8EEF8' },
  dispatched: { label: 'On the way', fg: colors.navyLight, bg: '#E8EEF8' },
  delivered: { label: 'Delivered', fg: colors.success, bg: '#E4F2E8' },
  cancelled: { label: 'Cancelled', fg: colors.danger, bg: '#FCEAE8' },
};

const QUICK_ASKS = [
  'When can you deliver?',
  'Do you have the latest edition of every book?',
  'Can you substitute anything that is out of stock?',
];

export default function BuyerMessagesScreen() {
  const { search } = useShell();
  const { isMobile, contentPadding } = useLayout();
  const params = useLocalSearchParams<{ quote?: string }>();
  const initial = typeof params.quote === 'string' ? params.quote : null;

  const inbox = useBuyerMessages(initial);
  const { threads, loading, error, migration, refresh, activeId, active, open, unreadTotal } = inbox;

  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (initial) open(initial);
  }, [initial, open]);

  // Desktop opens the most recent conversation rather than an empty
  // pane. A phone shows the list first, which is what it has room for.
  useEffect(() => {
    if (!isMobile && !activeId && !initial && threads.length > 0) open(threads[0].quote_id);
  }, [isMobile, activeId, initial, threads, open]);

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      threads.filter((t) => {
        if (filter === 'unread' && t.unread_count === 0) return false;
        if (filter === 'orders' && !t.order_id) return false;
        if (!query) return true;
        return [t.store_name, t.child_name, t.school_name, t.class_level, t.reference, t.order_reference]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query));
      }),
    [threads, filter, query]
  );

  const counts = useMemo(
    () => ({
      all: threads.length,
      unread: threads.filter((t) => t.unread_count > 0).length,
      orders: threads.filter((t) => !!t.order_id).length,
    }),
    [threads]
  );

  if (migration === 'missing') {
    return (
      <View style={{ padding: contentPadding }}>
        <MigrationNeeded feature="Messages" file="bookshops_buyer_portal.sql" onRetry={refresh} />
      </View>
    );
  }

  const showList = !isMobile || !activeId;
  const showChat = !isMobile || !!activeId;

  return (
    <View style={[styles.page, { padding: contentPadding }]}>
      {showList && (
        <View style={styles.heading}>
          <Text style={styles.h1} accessibilityRole="header">
            Messages
          </Text>
          <Text style={styles.h2}>
            {loading
              ? 'Loading conversations…'
              : unreadTotal > 0
              ? `${unreadTotal} unread message${unreadTotal === 1 ? '' : 's'}`
              : 'Talk to shops about a quote or an order on its way'}
          </Text>
        </View>
      )}

      {!!error && <InlineMessage tone="error">{error}</InlineMessage>}

      <View style={[styles.panes, isMobile && styles.panesMobile]}>
        {showList && (
          <View style={[styles.listPane, isMobile && styles.listPaneMobile]}>
            <View style={styles.listHead}>
              <FilterPills
                options={[
                  { key: 'all', label: 'All', count: counts.all },
                  { key: 'unread', label: 'Unread', count: counts.unread },
                  { key: 'orders', label: 'Orders', count: counts.orders },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </View>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.navy} />
              </View>
            ) : visible.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="chatbubbles-outline" size={26} color={colors.textFaint} />
                <Text style={styles.emptyTitle}>
                  {threads.length === 0 ? 'No conversations yet' : 'Nothing matches'}
                </Text>
                <Text style={styles.emptyBody}>
                  {threads.length === 0
                    ? 'When a shop quotes one of your booklists you can message them here.'
                    : 'Try another filter, or clear the search at the top.'}
                </Text>
                {threads.length === 0 && (
                  <Pressable
                    onPress={() => router.push('/booklists')}
                    style={({ pressed }) => [styles.emptyBtn, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyBtnText}>Go to my booklists</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <FlatList
                data={visible}
                keyExtractor={(t) => t.quote_id}
                renderItem={({ item }) => (
                  <ThreadRow thread={item} active={item.quote_id === activeId} onPress={() => open(item.quote_id)} />
                )}
              />
            )}
          </View>
        )}

        {showChat && (
          <View style={styles.chatPane}>
            {active ? (
              <ChatPane
                key={active.quote_id}
                thread={active}
                messages={inbox.messages}
                loading={inbox.loadingThread}
                error={inbox.threadError}
                onSend={inbox.send}
                onBack={isMobile ? () => open(null) : undefined}
              />
            ) : activeId && loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.navy} />
              </View>
            ) : (
              <View style={styles.center}>
                <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textFaint} />
                <Text style={styles.emptyTitle}>
                  {activeId ? 'That conversation is not available' : 'Choose a conversation'}
                </Text>
                <Text style={styles.emptyBody}>
                  Pick a shop on the left to see your messages about a quote or an order.
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

function ThreadRow({ thread, active, onPress }: { thread: BuyerThread; active: boolean; onPress: () => void }) {
  const unread = thread.unread_count > 0;
  const preview = thread.last_message
    ? `${thread.last_sender_role === 'buyer' ? 'You: ' : ''}${thread.last_message}`
    : thread.order_id
    ? 'Order placed — say hello'
    : 'Quote received — ask the shop anything';

  const who = [thread.child_name, thread.school_name, thread.class_level].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && !active && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${thread.store_name}, ${who}${unread ? `, ${thread.unread_count} unread` : ''}`}
    >
      <View style={[styles.avatar, thread.order_id && styles.avatarOrder]}>
        <Ionicons name="storefront-outline" size={17} color={colors.navy} />
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, unread && styles.rowNameUnread]} numberOfLines={1}>
            {thread.store_name}
          </Text>
          <Text style={styles.rowTime}>{relativeStamp(thread.last_message_at ?? thread.activity_at)}</Text>
        </View>
        <Text style={styles.rowSub} numberOfLines={1}>
          {thread.order_reference ?? thread.reference} · {who}
        </Text>
        <View style={styles.rowBottom}>
          <Text style={[styles.rowPreview, unread && styles.rowPreviewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {unread && (
            <View style={styles.unread}>
              <Text style={styles.unreadText}>{thread.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */

function ChatPane({
  thread,
  messages,
  loading,
  error,
  onSend,
  onBack,
}: {
  thread: BuyerThread;
  messages: ThreadMessage[];
  loading: boolean;
  error: string | null;
  onSend: (body: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onBack?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const closed = ['rejected', 'withdrawn', 'expired'].includes(thread.quote_status);
  const status = thread.order_fulfillment_status ? ORDER_COPY[thread.order_fulfillment_status] : null;

  const lastSeenId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender_role === 'buyer' && m.read_at) return m.id;
    }
    return null;
  }, [messages]);

  async function submit(text = draft) {
    if (sending || !text.trim()) return;
    setSending(true);
    setSendError(null);
    const result = await onSend(text);
    setSending(false);
    if (result.ok) setDraft('');
    else setSendError(result.message);
  }

  const remaining = MESSAGE_MAX - draft.length;
  const about = [thread.child_name, thread.school_name, thread.class_level].filter(Boolean).join(' · ');

  return (
    <KeyboardAvoidingView
      style={styles.chat}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.chatHead}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to conversations">
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
        )}
        <View style={styles.chatHeadMain}>
          <Text style={styles.chatName} numberOfLines={1}>
            {thread.store_name}
          </Text>
          <Text style={styles.chatSub} numberOfLines={1}>
            {about} · Quote {thread.reference} · {formatNaira(thread.total_price)}
          </Text>
        </View>
        {thread.order_id ? (
          <Pressable
            onPress={() => router.push({ pathname: '/orders', params: { order: thread.order_id! } })}
            style={styles.refChip}
            accessibilityRole="link"
            accessibilityLabel={`Order ${thread.order_reference}, open in My Orders`}
          >
            <Text style={styles.refChipText}>{thread.order_reference}</Text>
            {status && <StatusPill label={status.label} fg={status.fg} bg={status.bg} />}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push(`/quotes/${thread.quote_id}`)}
            style={styles.refChip}
            accessibilityRole="link"
          >
            <Text style={styles.refChipText}>View quote</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      >
        {loading && messages.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.navy} />
          </View>
        ) : error ? (
          <InlineMessage tone="error">{error}</InlineMessage>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptyBody}>
              Messages here are tied to {thread.order_reference ?? `quote ${thread.reference}`}, so{' '}
              {thread.store_name} knows exactly which booklist you mean.
            </Text>
          </View>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            const mine = m.sender_role === 'buyer';
            return (
              <View key={m.id}>
                {newDay && <Text style={styles.day}>{shortDate(m.created_at)}</Text>}
                <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]} selectable>
                      {m.body}
                    </Text>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                      {m.pending
                        ? 'Sending…'
                        : new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
                {m.id === lastSeenId && <Text style={styles.seen}>Seen</Text>}
              </View>
            );
          })
        )}
      </ScrollView>

      {closed ? (
        <View style={styles.closed}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textFaint} />
          <Text style={styles.closedText}>
            This quote was {thread.quote_status === 'rejected' ? 'declined' : thread.quote_status}. You can still
            message the shop, but it is no longer an open offer.
          </Text>
        </View>
      ) : (
        messages.length === 0 &&
        !loading && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quick} style={styles.quickScroll}>
            {QUICK_ASKS.map((q) => (
              <Pressable
                key={q}
                onPress={() => setDraft(q)}
                style={({ pressed }) => [styles.quickChip, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Use message: ${q}`}
              >
                <Text style={styles.quickText} numberOfLines={1}>
                  {q}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )
      )}

      {!!sendError && (
        <View style={styles.sendError}>
          <InlineMessage tone="error">{sendError}</InlineMessage>
        </View>
      )}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${thread.store_name}…`}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          multiline
          maxLength={MESSAGE_MAX}
          accessibilityLabel="Message"
          onKeyPress={(e) => {
            const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
            if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
              (e as unknown as { preventDefault?: () => void }).preventDefault?.();
              submit();
            }
          }}
        />
        <Pressable
          onPress={() => submit()}
          disabled={sending || !draft.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            (sending || !draft.trim()) && styles.sendBtnDisabled,
            pressed && styles.sendBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: sending || !draft.trim(), busy: sending }}
        >
          {sending ? (
            <ActivityIndicator color={colors.onNavy} size="small" />
          ) : (
            <Ionicons name="send" size={18} color={colors.onNavy} />
          )}
        </Pressable>
      </View>
      {remaining < 200 && <Text style={styles.remaining}>{remaining} characters left</Text>}
    </KeyboardAvoidingView>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 0 },
  heading: { marginBottom: spacing.md },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  panes: {
    flex: 1,
    minHeight: 480,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  panesMobile: { minHeight: 0 },

  listPane: { width: 330, borderRightWidth: 1, borderRightColor: colors.border },
  listPaneMobile: { width: '100%', borderRightWidth: 0 },
  listHead: { paddingTop: spacing.md, paddingLeft: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: font.sm, color: colors.textFaint, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  emptyBtn: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  emptyBtnText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  rowActive: { backgroundColor: colors.surfaceMuted, borderLeftColor: colors.orange },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E8EEF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOrder: { backgroundColor: '#FDF1E6' },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  rowNameUnread: { fontWeight: '800' },
  rowTime: { fontSize: font.xs, color: colors.textFaint },
  rowSub: { fontSize: font.xs, color: colors.textFaint },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowPreview: { flex: 1, fontSize: font.sm, color: colors.textMuted },
  rowPreviewUnread: { color: colors.text, fontWeight: '600' },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: colors.onNavy, fontSize: font.xs, fontWeight: '800' },

  chatPane: { flex: 1, minWidth: 0 },
  chat: { flex: 1 },
  chatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatHeadMain: { flex: 1, minWidth: 0 },
  chatName: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  chatSub: { fontSize: font.sm, color: colors.textFaint, marginTop: 2 },
  refChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  refChipText: { fontSize: font.sm, fontWeight: '800', color: colors.navy },

  messages: { flex: 1, backgroundColor: colors.surfaceMuted },
  messagesContent: { padding: spacing.lg, gap: spacing.xs, flexGrow: 1 },
  day: { alignSelf: 'center', fontSize: font.xs, color: colors.textFaint, fontWeight: '700', marginVertical: spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: colors.navy, borderBottomRightRadius: radius.sm },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleText: { fontSize: font.md, color: colors.text, lineHeight: 20 },
  bubbleTextMine: { color: colors.onNavy },
  bubbleTime: { fontSize: 10, color: colors.textFaint, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: colors.onNavyMuted },
  seen: { alignSelf: 'flex-end', fontSize: font.xs, color: colors.textFaint, marginTop: 2 },

  closed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  closedText: { flex: 1, fontSize: font.xs, color: colors.textFaint },

  quickScroll: { flexGrow: 0, borderTopWidth: 1, borderTopColor: colors.border },
  quick: { gap: spacing.sm, padding: spacing.sm },
  quickChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    maxWidth: 320,
  },
  quickText: { fontSize: font.sm, color: colors.navy, fontWeight: '600' },

  sendError: { paddingHorizontal: spacing.md },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: font.md,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: { backgroundColor: colors.orangeDark },
  sendBtnDisabled: { backgroundColor: colors.borderStrong },
  remaining: { fontSize: font.xs, color: colors.textFaint, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
});
