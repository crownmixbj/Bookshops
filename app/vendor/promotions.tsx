import { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/vendor/VendorShell';
import {
  VendorGate,
  PageHeading,
  FilterPills,
  MigrationNeeded,
  InlineMessage,
  StatusPill,
  pageStyles,
} from '../../components/vendor/VendorPageParts';
import { DateField } from '../../components/vendor/DateField';
import { PromoCard } from '../../components/dashboard/PromoCard';
import { WorkspaceFooter } from '../../components/layout/WorkspaceFooter';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import {
  useVendorPromotions,
  PRIORITY_OPTIONS,
  HEADLINE_MIN,
  HEADLINE_MAX,
  DETAILS_MAX,
  AUDIENCE_MAX,
  MAX_LEAD_DAYS,
  MAX_OPEN_DEALS,
  type PromoPriority,
  type PromoShop,
  type VendorDeal,
  type DealStatus,
} from '../../hooks/useVendorPromotions';
import type { Promo } from '../../hooks/useDashboardPromo';
import {
  addDays,
  daysBetween,
  endOfDay,
  formatDay,
  formatInstant,
  keyOf,
  startsAtFor,
  todayKey,
  type DayKey,
} from '../../lib/promoDates';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * Promotions — a shop books its own sponsored deal in the buyer
 * dashboard's promo slot.
 *
 * The shop half of the card (name, photo, rating, city, verified tick)
 * is bound from the vendor row and cannot be typed in here: a buyer is
 * shown the shop as LOCI knows it, not as the ad says it is. The shop
 * only writes the offer and chooses when and how prominently it runs.
 *
 * The preview on the right is the real buyer PromoCard, fed the same
 * shape useDashboardPromo builds, so what the shop sees is what a parent
 * will see.
 */

/** The longest run the form offers: 31 calendar days including the first. */
const RUN_DAYS = 30;

const STATUS_COPY: Record<DealStatus, { label: string; fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  live: { label: 'Live', fg: colors.success, bg: '#E4F2E8', icon: 'radio-button-on' },
  scheduled: { label: 'Scheduled', fg: colors.navy, bg: '#E8EEF8', icon: 'time-outline' },
  paused: { label: 'Paused', fg: colors.warning, bg: colors.warningBg, icon: 'pause-circle-outline' },
  ended: { label: 'Ended', fg: colors.textMuted, bg: colors.surfaceMuted, icon: 'checkmark-done-outline' },
  cancelled: { label: 'Cancelled', fg: colors.textMuted, bg: colors.surfaceMuted, icon: 'close-circle-outline' },
};

type ListTab = 'current' | 'past';

export default function VendorPromotionsScreen() {
  const { contentPadding, isDesktop, isMobile } = useLayout();
  const { role } = useShell();
  const { shop, deals, openCount, loading, error, migration, refresh, create, cancel, uploadLogo } =
    useVendorPromotions();

  // ---- form state ---------------------------------------------------
  const today = todayKey();
  const [headline, setHeadline] = useState('');
  const [audience, setAudience] = useState('');
  const [details, setDetails] = useState('');
  const [startKey, setStartKey] = useState<DayKey>(today);
  const [endKey, setEndKey] = useState<DayKey>(addDays(today, 6));
  const [priority, setPriority] = useState<PromoPriority>(1);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const [tab, setTab] = useState<ListTab>('current');
  const scrollRef = useRef<ScrollView>(null);

  const endMax = addDays(startKey, RUN_DAYS);
  const runDays = daysBetween(startKey, endKey) + 1;

  function changeStart(key: DayKey) {
    setStartKey(key);
    // Keep the end inside the new window rather than silently invalid.
    if (endKey < key) setEndKey(addDays(key, Math.max(runDays - 1, 0)));
    else if (endKey > addDays(key, RUN_DAYS)) setEndKey(addDays(key, RUN_DAYS));
  }

  const trimmed = headline.trim();
  const headlineError =
    trimmed.length === 0
      ? 'Write the offer buyers will see.'
      : trimmed.length < HEADLINE_MIN
      ? `At least ${HEADLINE_MIN} characters.`
      : null;
  const atLimit = openCount >= MAX_OPEN_DEALS;
  const blocked = !shop || !shop.eligible || atLimit;
  const canSubmit = !blocked && !headlineError && !submitting;

  const previewPromo = useMemo(
    () => buildPreview(shop, trimmed || '15% OFF JSS1 Booklists', audience.trim() || null, details.trim() || null, endOfDay(endKey)),
    [shop, trimmed, audience, details, endKey]
  );

  const current = deals.filter((d) => d.status === 'live' || d.status === 'scheduled' || d.status === 'paused');
  const past = deals.filter((d) => d.status === 'ended' || d.status === 'cancelled');

  if (role !== 'vendor') return <VendorGate area="Promotions" />;

  if (migration === 'missing') {
    return (
      <ScrollView contentContainerStyle={[pageStyles.scrollContent, { padding: contentPadding }]}>
        <MigrationNeeded feature="Promotions" file="bookshops_vendor_promotions.sql" onRetry={refresh} />
        <WorkspaceFooter />
      </ScrollView>
    );
  }

  async function submit() {
    setTouched(true);
    setFormError(null);
    setNotice(null);
    if (!canSubmit) return;

    setSubmitting(true);
    const startsAt = startsAtFor(startKey);
    const result = await create({
      headline: trimmed,
      audience,
      details,
      startsAt,
      endsAt: endOfDay(endKey),
      priority,
    });
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setNotice({
      tone: 'success',
      text:
        startKey === today
          ? 'Your promotion is live on the buyer dashboard.'
          : `Your promotion is scheduled to start ${formatDay(startKey)}.`,
    });
    setHeadline('');
    setAudience('');
    setDetails('');
    setPriority(1);
    setTouched(false);
    setTab('current');
    // The confirmation is at the top of the page; the button is not.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function changePhoto() {
    setPhotoBusy(true);
    setNotice(null);
    const result = await uploadLogo();
    setPhotoBusy(false);
    if (result && !result.ok) setNotice({ tone: 'error', text: result.message });
    if (result?.ok) setNotice({ tone: 'success', text: 'Shop photo updated. It shows on all your promotions.' });
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={pageStyles.scroll}
      contentContainerStyle={[pageStyles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <PageHeading
        title="Promotions"
        subtitle="Put a flash offer in front of parents on the buyer dashboard"
        right={
          !loading && (
            <View style={styles.quota}>
              <Text style={styles.quotaValue}>
                {openCount}/{MAX_OPEN_DEALS}
              </Text>
              <Text style={styles.quotaLabel}>live or scheduled</Text>
            </View>
          )
        }
      />

      {!!error && <InlineMessage tone="error">{error}</InlineMessage>}
      {!!notice && <InlineMessage tone={notice.tone}>{notice.text}</InlineMessage>}

      {!loading && !shop && (
        <InlineMessage tone="info">
          Your shop isn’t set up yet. Add your business details in Settings, then come back to run a promotion.
        </InlineMessage>
      )}
      {!loading && shop && !shop.eligible && (
        <InlineMessage tone="info">
          {shop.approval_status !== 'approved'
            ? 'Promotions open once LOCI has approved your shop. You can prepare an offer and preview it here in the meantime.'
            : 'Your shop is paused, so promotions are not shown to buyers. Reactivate it in Settings to run one.'}
        </InlineMessage>
      )}

      {loading ? (
        <View style={pageStyles.loading}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : (
        <>
          {/* ---- create --------------------------------------------- */}
          <View style={[styles.createRow, isDesktop && styles.createRowWide]}>
            <View style={styles.formCol}>
              <Panel title="New flash promotion">
                <View style={styles.form}>
                  {/* Shop — bound, not typed */}
                  {shop && (
                    <View style={styles.shop}>
                      <ShopAvatar shop={shop} />
                      <View style={styles.shopMain}>
                        <View style={styles.shopNameRow}>
                          <Text style={styles.shopName} numberOfLines={1}>
                            {shop.store_name}
                          </Text>
                          {shop.verified && (
                            <Ionicons name="checkmark-circle" size={14} color={colors.success} accessibilityLabel="Verified shop" />
                          )}
                        </View>
                        <Text style={styles.shopMeta} numberOfLines={1}>
                          {shopMeta(shop)}
                        </Text>
                        <View style={styles.shopActions}>
                          <Pressable onPress={changePhoto} disabled={photoBusy} accessibilityRole="button" hitSlop={6}>
                            <Text style={styles.link}>
                              {photoBusy ? 'Uploading…' : shop.logo_url ? 'Change shop photo' : 'Add shop photo'}
                            </Text>
                          </Pressable>
                          <Text style={styles.dot}>·</Text>
                          <Pressable onPress={() => router.push('/vendor/settings')} accessibilityRole="link" hitSlop={6}>
                            <Text style={styles.link}>Edit shop details</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )}

                  <Field
                    label="Promo offer"
                    required
                    value={headline}
                    onChangeText={setHeadline}
                    placeholder="e.g. 15% OFF JSS1 Booklists"
                    maxLength={HEADLINE_MAX}
                    counter
                    error={touched ? headlineError : null}
                    hint="The headline parents see. Keep it to the offer itself."
                  />

                  <Field
                    label="Applies to"
                    value={audience}
                    onChangeText={setAudience}
                    placeholder="e.g. JSS1–JSS3"
                    maxLength={AUDIENCE_MAX}
                    hint="Shown as a tag, e.g. a class or year group."
                  />

                  <Field
                    label="Small print"
                    value={details}
                    onChangeText={setDetails}
                    placeholder="e.g. On textbooks for lists sent directly to our shop. Discount shown on your quote."
                    maxLength={DETAILS_MAX}
                    counter
                    multiline
                    hint="How the offer works and how to claim it."
                  />

                  <View style={[styles.pair, isMobile && styles.pairStacked]}>
                    <View style={!isMobile && styles.pairItem}>
                      <DateField
                        label="Start date"
                        value={startKey}
                        onChange={changeStart}
                        min={today}
                        max={addDays(today, MAX_LEAD_DAYS)}
                        hint={startKey === today ? 'Starts as soon as you launch' : 'Starts at midnight'}
                      />
                    </View>
                    <View style={!isMobile && styles.pairItem}>
                      <DateField
                        label="End date"
                        value={endKey}
                        onChange={setEndKey}
                        min={startKey}
                        max={endMax}
                        hint={`Runs to the end of the day · ${runDays} day${runDays === 1 ? '' : 's'}`}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldBlock}>
                    <Text style={styles.label}>Priority</Text>
                    <View style={[styles.priorities, isMobile && styles.prioritiesStacked]}>
                      {PRIORITY_OPTIONS.map((p) => {
                        const on = p.value === priority;
                        return (
                          <Pressable
                            key={p.value}
                            onPress={() => setPriority(p.value)}
                            style={({ pressed }) => [styles.priority, on && styles.priorityOn, pressed && !on && styles.pressedBg]}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: on }}
                          >
                            <View style={styles.priorityHead}>
                              <Ionicons
                                name={on ? 'radio-button-on' : 'radio-button-off'}
                                size={16}
                                color={on ? colors.orangeDark : colors.textFaint}
                              />
                              <Text style={[styles.priorityLabel, on && styles.priorityLabelOn]}>{p.label}</Text>
                              <Text style={styles.stars}>{'▲'.repeat(p.value)}</Text>
                            </View>
                            <Text style={styles.priorityHint}>{p.hint}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.hint}>
                      The slot shows one deal at a time. Higher priority goes first; deals of equal priority take turns.
                    </Text>
                  </View>

                  {atLimit && (
                    <InlineMessage tone="info">
                      You have {MAX_OPEN_DEALS} promotions live or scheduled. Cancel one below to book another.
                    </InlineMessage>
                  )}
                  {!!formError && <InlineMessage tone="error">{formError}</InlineMessage>}

                  <Pressable
                    onPress={submit}
                    disabled={blocked || submitting}
                    style={({ pressed }) => [
                      styles.cta,
                      (blocked || (touched && !!headlineError)) && styles.ctaDisabled,
                      pressed && canSubmit && styles.ctaPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: blocked, busy: submitting }}
                  >
                    {submitting ? (
                      <ActivityIndicator color={colors.onNavy} size="small" />
                    ) : (
                      <Ionicons name="megaphone-outline" size={18} color={blocked ? '#6B7A94' : colors.onNavy} />
                    )}
                    <Text style={[styles.ctaText, blocked && styles.ctaTextDisabled]}>
                      {startKey === today ? 'Launch promotion' : `Schedule for ${formatDay(startKey)}`}
                    </Text>
                  </Pressable>
                  <Text style={styles.fine}>
                    Shown to parents with a SPONSORED label. Once it is live you can end it early, but not edit it —
                    to change an offer, end it and book a new one.
                  </Text>
                </View>
              </Panel>
            </View>

            <View style={[styles.previewCol, isDesktop && styles.previewColWide]}>
              <Text style={styles.previewLabel}>Preview — as parents will see it</Text>
              <View pointerEvents="none" style={styles.preview}>
                <PromoCard promo={previewPromo} variant="column" onAction={() => {}} onLink={() => {}} />
              </View>
            </View>
          </View>

          {/* ---- campaigns ------------------------------------------ */}
          <Text style={styles.sectionTitle}>Your campaigns</Text>
          <FilterPills
            options={[
              { key: 'current', label: 'Live & upcoming', count: current.length },
              { key: 'past', label: 'Past', count: past.length },
            ]}
            value={tab}
            onChange={setTab}
          />

          {(tab === 'current' ? current : past).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="megaphone-outline" size={26} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>
                {tab === 'current' ? 'No promotions running' : 'No past promotions yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {tab === 'current'
                  ? 'Book one above and it appears here with its live status.'
                  : 'Promotions that have ended or were cancelled are kept here.'}
              </Text>
            </View>
          ) : (
            (tab === 'current' ? current : past).map((d) => (
              <DealRow
                key={d.id}
                deal={d}
                onCancel={async () => {
                  setNotice(null);
                  const r = await cancel(d);
                  setNotice(
                    r.ok
                      ? { tone: 'success', text: d.status === 'live' ? 'Promotion ended. It has left the buyer dashboard.' : 'Scheduled promotion deleted.' }
                      : { tone: 'error', text: r.message }
                  );
                }}
              />
            ))
          )}
        </>
      )}

      <WorkspaceFooter />
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */

function shopMeta(shop: PromoShop): string {
  const parts: string[] = [];
  if (shop.city) parts.push(shop.city);
  parts.push(shop.rating != null ? `★ ${shop.rating.toFixed(1)} (${shop.review_count})` : 'No ratings yet');
  return parts.join(' · ');
}

/** The same shape useDashboardPromo builds for a live paid deal. */
function buildPreview(
  shop: PromoShop | null,
  headline: string,
  audience: string | null,
  details: string | null,
  endsAt: Date
): Promo {
  const name = shop?.store_name ?? 'Your shop';
  return {
    kind: 'sponsored',
    key: 'preview',
    badge: 'SPONSORED',
    badgeTone: 'paid',
    badgeIcon: 'megaphone-outline',
    endsAt: endsAt.toISOString(),
    imageUrl: shop?.logo_url ?? null,
    slides: null,
    visual: { letter: name.slice(0, 1).toUpperCase() },
    title: name,
    verified: !!shop?.verified,
    meta: shop ? shopMeta(shop) : 'Bookshop on LOCI',
    headline,
    tag: audience,
    details,
    cta: {
      label: `Request Quote from ${name}`,
      icon: 'paper-plane-outline',
      action: { type: 'requestQuote', vendorId: shop?.id ?? '', shopName: name },
    },
    link: { label: 'View shop', route: '/' },
    fine: 'Sponsored placement. The discount is applied by the shop on its quote — you still compare before you pay.',
  };
}

function ShopAvatar({ shop }: { shop: PromoShop }) {
  if (shop.logo_url) {
    return <Image source={{ uri: shop.logo_url }} style={styles.avatar} accessibilityLabel={`${shop.store_name} photo`} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarTile]}>
      <Text style={styles.avatarLetter}>{shop.store_name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  counter,
  value,
  maxLength,
  multiline,
  ...input
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  counter?: boolean;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldBlock}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.req}> *</Text> : <Text style={styles.optional}> (optional)</Text>}
        </Text>
        {counter && (
          <Text style={[styles.counter, value.length >= maxLength && styles.counterFull]}>
            {value.length}/{maxLength}
          </Text>
        )}
      </View>
      <TextInput
        {...input}
        value={value}
        maxLength={maxLength}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMulti, !!error && styles.inputError]}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={label}
      />
      {error ? <Text style={styles.error}>{error}</Text> : !!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

function DealRow({ deal, onCancel }: { deal: VendorDeal; onCancel: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = STATUS_COPY[deal.status];
  const prio = PRIORITY_OPTIONS.find((p) => p.value === deal.priority)?.label ?? `Priority ${deal.priority}`;
  const open = deal.status === 'live' || deal.status === 'scheduled' || deal.status === 'paused';
  const byLoci = deal.created_via === 'admin';

  const placement =
    deal.status === 'live'
      ? deal.outranked
        ? 'Live, but a higher-priority deal is showing first right now.'
        : deal.rotation_size && deal.rotation_size > 1
        ? `Showing now, taking turns with ${deal.rotation_size - 1} other deal${deal.rotation_size === 2 ? '' : 's'}.`
        : 'Showing now in the buyer dashboard slot.'
      : deal.status === 'scheduled'
      ? `Goes live ${formatInstant(deal.starts_at)}.`
      : deal.status === 'paused'
      ? 'Not shown while your shop is paused or awaiting approval.'
      : deal.status === 'cancelled' && deal.cancelled_at
      ? `Cancelled ${formatInstant(deal.cancelled_at)}.`
      : `Ended ${formatInstant(deal.ends_at)}.`;

  async function go() {
    setBusy(true);
    await onCancel();
    setBusy(false);
    setConfirming(false);
  }

  return (
    <View style={styles.deal}>
      <View style={styles.dealTop}>
        <StatusPill label={s.label} fg={s.fg} bg={s.bg} icon={s.icon} />
        <Text style={styles.dealPrio}>{prio}</Text>
        {byLoci && <Text style={styles.dealBy}>Booked by LOCI</Text>}
      </View>
      <Text style={styles.dealHeadline}>{deal.headline}</Text>
      {!!deal.audience && (
        <View style={styles.tag}>
          <Text style={styles.tagText}>{deal.audience}</Text>
        </View>
      )}
      <Text style={styles.dealDates}>
        {formatDay(keyOf(deal.starts_at))} → {formatDay(keyOf(new Date(new Date(deal.ends_at).getTime() - 1).toISOString()))}
      </Text>
      <Text style={[styles.placement, deal.outranked && styles.placementWarn]}>{placement}</Text>

      {open && !byLoci && (
        <View style={styles.dealActions}>
          {confirming ? (
            <>
              <Text style={styles.confirmText}>
                {deal.status === 'live' ? 'End this promotion now?' : 'Delete this scheduled promotion?'}
              </Text>
              <Pressable onPress={() => setConfirming(false)} disabled={busy} style={styles.ghost} accessibilityRole="button">
                <Text style={styles.ghostText}>Keep it</Text>
              </Pressable>
              <Pressable onPress={go} disabled={busy} style={styles.danger} accessibilityRole="button">
                {busy ? <ActivityIndicator color={colors.onNavy} size="small" /> : null}
                <Text style={styles.dangerText}>{deal.status === 'live' ? 'End now' : 'Delete'}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setConfirming(true)} style={styles.outline} accessibilityRole="button">
              <Ionicons name={deal.status === 'live' ? 'stop-circle-outline' : 'trash-outline'} size={16} color={colors.danger} />
              <Text style={styles.outlineText}>{deal.status === 'live' ? 'End promotion' : 'Delete'}</Text>
            </Pressable>
          )}
        </View>
      )}
      {open && byLoci && <Text style={styles.hint}>Booked for you by LOCI — contact support to change it.</Text>}
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  pressedBg: { backgroundColor: colors.surfaceMuted },

  quota: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  quotaValue: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  quotaLabel: { fontSize: font.xs, color: colors.textFaint },

  createRow: { gap: spacing.lg },
  createRowWide: { flexDirection: 'row', alignItems: 'flex-start' },
  formCol: { flex: 1, minWidth: 0 },
  previewCol: { alignItems: 'center', marginBottom: spacing.lg },
  previewColWide: { width: 320, alignItems: 'flex-start' },
  previewLabel: {
    fontSize: font.xs,
    fontWeight: '800',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  preview: { maxWidth: 320 },

  form: { padding: spacing.lg, gap: spacing.lg },

  shop: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  avatar: { width: 52, height: 52, borderRadius: radius.md },
  avatarTile: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 22, fontWeight: '800', color: colors.onNavy },
  shopMain: { flex: 1, minWidth: 0, gap: 2 },
  shopNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shopName: { fontSize: font.lg, fontWeight: '700', color: colors.text, flexShrink: 1 },
  shopMeta: { fontSize: font.sm, color: colors.textMuted },
  shopActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2, flexWrap: 'wrap' },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  dot: { color: colors.textFaint },

  pair: { flexDirection: 'row', gap: spacing.md },
  pairStacked: { flexDirection: 'column', gap: spacing.lg },
  pairItem: { flex: 1, minWidth: 0 },

  fieldBlock: { gap: 5 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  req: { color: colors.danger },
  optional: { fontWeight: '400', color: colors.textFaint },
  counter: { fontSize: font.xs, color: colors.textFaint },
  counterFull: { color: colors.warning, fontWeight: '700' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: font.md,
    color: colors.text,
  },
  inputMulti: { minHeight: 76, paddingTop: 11, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  hint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },
  error: { fontSize: font.xs, color: colors.danger, fontWeight: '600' },

  priorities: { flexDirection: 'row', gap: spacing.sm },
  prioritiesStacked: { flexDirection: 'column' },
  priority: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  priorityOn: { borderColor: colors.orange, backgroundColor: '#FDF6F0' },
  priorityHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priorityLabel: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.textMuted },
  priorityLabelOn: { color: colors.text },
  stars: { fontSize: 9, color: colors.orangeDark, letterSpacing: 1 },
  priorityHint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 15 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.lg,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaDisabled: { backgroundColor: '#E3E9F2' },
  ctaText: { fontSize: font.lg, fontWeight: '700', color: colors.onNavy },
  ctaTextDisabled: { color: '#6B7A94' },
  fine: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.sm, marginBottom: spacing.md },

  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  emptyBody: { fontSize: font.md, color: colors.textFaint, textAlign: 'center', maxWidth: 420 },

  deal: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: 6,
    ...shadow.card,
  },
  dealTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  dealPrio: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  dealBy: { fontSize: font.xs, color: colors.navy, fontWeight: '700' },
  dealHeadline: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagText: { fontSize: font.xs, fontWeight: '700', color: colors.navy },
  dealDates: { fontSize: font.sm, color: colors.textMuted },
  placement: { fontSize: font.sm, color: colors.textFaint },
  placementWarn: { color: colors.warning, fontWeight: '600' },

  dealActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
  confirmText: { flex: 1, fontSize: font.sm, color: colors.text, fontWeight: '600', minWidth: 160 },
  outline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#F1C7C2',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  outlineText: { fontSize: font.sm, fontWeight: '700', color: colors.danger },
  ghost: { paddingHorizontal: spacing.md, minHeight: 40, justifyContent: 'center' },
  ghostText: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  dangerText: { fontSize: font.sm, fontWeight: '700', color: colors.onNavy },
});
