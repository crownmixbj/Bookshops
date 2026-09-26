import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';
import { categoryImage } from '../lib/categoryImages';
import { supabase } from '../utils/supabase';

/**
 * What the dashboard's permanent right-hand promo slot shows.
 *
 * It is never empty. In order of preference:
 *
 *   1. sponsored  A live paid deal (current_sponsored_deal). Always badged.
 *   2. organic    A genuinely well-performing shop (top_organic_shop),
 *                 badged "TOP RATED" — never "sponsored", because nobody
 *                 paid for it. Skips the shop already in the Featured
 *                 Shops card so the page does not repeat itself.
 *   3. platform   LOCI's own parent-facing card: the Back-to-School
 *                 banner (a looping slideshow of the category photos),
 *                 or on alternate days the booklist scanner. Never a
 *                 vendor-recruitment message — this is a parent's
 *                 dashboard.
 *
 * Every source is normalised into one Promo shape so the card has one
 * layout, one set of borders and one type scale whichever it shows.
 * Both RPCs failing (migration not run, offline) simply falls through
 * to the platform card.
 */

export type PromoAction =
  | { type: 'requestQuote'; vendorId: string; shopName: string }
  | { type: 'route'; route: string }
  | { type: 'createBooklist' };

export interface Promo {
  kind: 'sponsored' | 'organic' | 'platform';
  /** Stable per piece of content — drives the fade-in when it changes. */
  key: string;
  badge: string;
  /** 'paid' is the orange sponsored treatment; 'house' is navy. */
  badgeTone: 'paid' | 'house';
  badgeIcon: keyof typeof Ionicons.glyphMap;
  /** ISO end time for the countdown pill. Paid deals only. */
  endsAt: string | null;
  imageUrl: string | null;
  /**
   * A looping slideshow in place of a single image. Each slide links to
   * its category. Bundled assets, so it works offline and on a guest's
   * first visit.
   */
  slides: { source: ImageSourcePropType; label: string; route: string }[] | null;
  /** Shown on the navy tile when there is no image. */
  visual: { letter: string } | { icon: keyof typeof Ionicons.glyphMap };
  title: string;
  verified: boolean;
  meta: string;
  headline: string;
  tag: string | null;
  details: string | null;
  cta: { label: string; icon: keyof typeof Ionicons.glyphMap; action: PromoAction };
  link: { label: string; route: string } | null;
  fine: string;
}

function ratingMeta(city: string | null, rating: number | null, reviews: number, orders?: number): string {
  const parts: string[] = [];
  if (city) parts.push(city);
  if (rating != null) parts.push(`★ ${rating.toFixed(1)} (${reviews})`);
  if (orders) parts.push(`${orders} orders`);
  return parts.join(' · ') || 'Bookshop on LOCI';
}

/** The category photos the Back-to-School banner cycles through. */
const BACK_TO_SCHOOL_SLIDES = [
  { slug: 'textbooks', label: 'Textbooks' },
  { slug: 'uniforms', label: 'Uniforms' },
  { slug: 'stationery', label: 'Stationery' },
  { slug: 'school-shoes', label: 'School shoes' },
]
  .map((c) => ({ source: categoryImage(c.slug), label: c.label, route: `/categories/${c.slug}` }))
  .filter((s): s is { source: ImageSourcePropType; label: string; route: string } => s.source != null);

/**
 * LOCI's own cards, for when no shop has booked the slot and none has
 * earned it yet. Both speak to parents. They alternate by calendar day
 * so a page view is stable; Back-to-School leads on even days.
 */
function platformPromo(day = new Date()): Promo {
  const scanner = Math.floor(day.getTime() / 86_400_000) % 2 === 1;
  if (!scanner) {
    return {
      kind: 'platform',
      key: 'platform-back-to-school',
      badge: 'BACK TO SCHOOL',
      badgeTone: 'house',
      badgeIcon: 'school-outline',
      endsAt: null,
      imageUrl: null,
      slides: BACK_TO_SCHOOL_SLIDES.length ? BACK_TO_SCHOOL_SLIDES : null,
      visual: { icon: 'school' },
      title: 'Back-to-School Readiness',
      verified: false,
      meta: 'Books · Uniforms · Supplies',
      headline: 'Get every child term-ready in one go.',
      tag: 'All classes',
      details:
        'Send the school booklist once and local bookshops quote the lot — books, uniforms and supplies — so you can compare and order without the market run.',
      cta: { label: 'Create New Booklist', icon: 'add-circle-outline', action: { type: 'createBooklist' } },
      link: { label: 'Explore categories', route: '/categories/textbooks' },
      fine: 'LOCI’s own feature — not a paid placement.',
    };
  }
  return {
    kind: 'platform',
    key: 'platform-scan',
    badge: 'NEW ON LOCI',
    badgeTone: 'house',
    badgeIcon: 'sparkles-outline',
    endsAt: null,
    imageUrl: null,
    slides: null,
    visual: { icon: 'camera' },
    title: 'Booklist scanner',
    verified: false,
    meta: 'Works with printed or handwritten lists',
    headline: 'Snap the school list. Get quotes by tonight.',
    tag: 'Free',
    details:
      'Photograph the booklist the school sent home and we read the titles for you. Check them, send it out, and nearby shops quote on it.',
    cta: { label: 'Scan a booklist', icon: 'camera-outline', action: { type: 'createBooklist' } },
    link: { label: 'Browse bookshops', route: '/shops' },
    fine: 'LOCI’s own feature — not a paid placement.',
  };
}

export function useDashboardPromo(excludeVendorId?: string | null) {
  const [promo, setPromo] = useState<Promo | null>(null);
  const [loading, setLoading] = useState(true);
  const [dealEndsAt, setDealEndsAt] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    // 1. A paid deal.
    const deal = await supabase.rpc('current_sponsored_deal');
    if (!alive.current) return;
    const d = !deal.error && Array.isArray(deal.data) ? (deal.data[0] as any) : null;
    if (d) {
      setDealEndsAt(d.ends_at);
      setPromo({
        kind: 'sponsored',
        key: `deal-${d.deal_id}`,
        badge: d.badge === 'FEATURED DEAL' ? 'FEATURED DEAL' : 'SPONSORED',
        badgeTone: 'paid',
        badgeIcon: 'megaphone-outline',
        endsAt: d.ends_at,
        imageUrl: d.image_url ?? null,
        slides: null,
        visual: { letter: String(d.store_name ?? '?').slice(0, 1).toUpperCase() },
        title: d.store_name,
        verified: !!d.verified,
        meta: ratingMeta(d.city, d.rating == null ? null : Number(d.rating), Number(d.review_count ?? 0)),
        headline: d.headline,
        tag: d.audience ?? null,
        details: d.details ?? null,
        cta: {
          label: `Request Quote from ${d.store_name}`,
          icon: 'paper-plane-outline',
          action: { type: 'requestQuote', vendorId: d.vendor_id, shopName: d.store_name },
        },
        link: { label: 'View shop', route: `/shops/${d.vendor_id}` },
        fine: 'Sponsored placement. The discount is applied by the shop on its quote — you still compare before you pay.',
      });
      setLoading(false);
      return;
    }
    setDealEndsAt(null);

    // 2. A shop that has earned it.
    const top = await supabase.rpc('top_organic_shop', { p_exclude: excludeVendorId ?? null });
    if (!alive.current) return;
    const s = !top.error && Array.isArray(top.data) ? (top.data[0] as any) : null;
    if (s) {
      const rating = s.rating == null ? null : Number(s.rating);
      setPromo({
        kind: 'organic',
        key: `organic-${s.vendor_id}`,
        badge: 'TOP RATED',
        badgeTone: 'house',
        badgeIcon: 'ribbon-outline',
        endsAt: null,
        imageUrl: null,
        slides: null,
        visual: { letter: String(s.store_name ?? '?').slice(0, 1).toUpperCase() },
        title: s.store_name,
        verified: !!s.verified,
        meta: ratingMeta(s.city, rating, Number(s.review_count ?? 0), Number(s.completed_orders ?? 0)),
        headline:
          rating != null
            ? `Rated ${rating.toFixed(1)} by parents on LOCI`
            : `${Number(s.completed_orders ?? 0)} booklists delivered on LOCI`,
        tag: s.city ?? null,
        details: 'Send your booklist straight to this shop and get an itemised quote back.',
        cta: {
          label: `Request Quote from ${s.store_name}`,
          icon: 'paper-plane-outline',
          action: { type: 'requestQuote', vendorId: s.vendor_id, shopName: s.store_name },
        },
        link: { label: 'View shop', route: `/shops/${s.vendor_id}` },
        fine: 'Chosen from buyer ratings and completed orders — not a paid placement.',
      });
      setLoading(false);
      return;
    }

    // 3. LOCI's own card.
    setPromo(platformPromo());
    setLoading(false);
  }, [excludeVendorId]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // A paid deal that runs out while the page is open is replaced on
  // time, not left advertising an offer the shop has stopped honouring.
  useEffect(() => {
    if (!dealEndsAt) return;
    const ms = new Date(dealEndsAt).getTime() - Date.now();
    if (ms > 2_000_000_000) return; // beyond setTimeout's range; the next load catches it
    const t = setTimeout(load, Math.max(ms, 0) + 1000);
    return () => clearTimeout(t);
  }, [dealEndsAt, load]);

  return { promo, loading, reload: load };
}

/** "Ends in 3 days", "Ends in 5 hours", "Ends within the hour". */
export function endsInLabel(endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return 'Ended';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Ends within the hour';
  if (hours < 24) return `Ends in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `Ends in ${days} day${days === 1 ? '' : 's'}`;
}
