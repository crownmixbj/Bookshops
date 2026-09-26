import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUserId } from '../lib/loadState';
import { compressBooklistImage } from '../lib/imageCompression';
import { draftImageKey, pickBooklistImage, releaseImage } from '../lib/booklistUpload';

/**
 * Self-serve promotions: the shop's own sponsored deals on the buyer
 * dashboard.
 *
 * Writes go straight into public.sponsored_deals. That is safe because
 * of bookshops_vendor_promotions.sql, not because of anything here: RLS
 * limits a shop to its own rows, and the guard trigger forces the badge,
 * caps priority, length and volume, and allows cancelling but not
 * editing. The checks in this file exist to give a friendly message
 * before the round trip — the database would refuse anyway.
 *
 * Reads come from vendor_sponsored_deals(), which adds what a shop
 * cannot work out from its own rows: whether its live deal is actually
 * being shown, or is outranked by a higher-priority booking.
 */

export type PromoPriority = 1 | 2 | 3;

export const PRIORITY_OPTIONS: { value: PromoPriority; label: string; hint: string }[] = [
  { value: 1, label: 'Standard', hint: 'Shares the slot with other Standard deals' },
  { value: 2, label: 'Boosted', hint: 'Shown ahead of Standard deals' },
  { value: 3, label: 'Top', hint: 'Shown ahead of Boosted and Standard deals' },
];

export const HEADLINE_MIN = 4;
export const HEADLINE_MAX = 90;
export const DETAILS_MAX = 240;
export const AUDIENCE_MAX = 40;
export const MAX_RUN_DAYS = 31;
export const MAX_LEAD_DAYS = 90;
export const MAX_OPEN_DEALS = 3;

export type DealStatus = 'live' | 'scheduled' | 'ended' | 'cancelled' | 'paused';

export interface VendorDeal {
  id: string;
  headline: string;
  details: string | null;
  audience: string | null;
  starts_at: string;
  ends_at: string;
  priority: number;
  created_via: 'admin' | 'vendor';
  cancelled_at: string | null;
  status: DealStatus;
  /** Live, but a higher-priority deal is being shown instead. */
  outranked: boolean;
  /** Live and in front: how many deals share the slot, this one included. */
  rotation_size: number | null;
}

/** The shop fields the form binds to. Read-only here — edited in Settings. */
export interface PromoShop {
  id: string;
  store_name: string;
  city: string | null;
  rating: number | null;
  review_count: number;
  verified: boolean;
  logo_url: string | null;
  /** Approved and active — the only state in which a deal is shown. */
  eligible: boolean;
  approval_status: string;
  is_active: boolean;
}

export interface NewDeal {
  headline: string;
  audience?: string;
  details?: string;
  startsAt: Date;
  endsAt: Date;
  priority: PromoPriority;
}

type Result = { ok: true } | { ok: false; message: string };

const MISSING = new Set(['42703', '42883', 'PGRST202', 'PGRST204']);
const SHOP_MEDIA_BUCKET = 'shop-media';
const LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

function friendly(message: string, hint?: string | null): string {
  if (/row-level security/i.test(message)) {
    return 'Your shop needs to be approved and active before it can run promotions.';
  }
  return [message, hint].filter(Boolean).join(' — ');
}

export function useVendorPromotions() {
  const [shop, setShop] = useState<PromoShop | null>(null);
  const [deals, setDeals] = useState<VendorDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState<'unknown' | 'ok' | 'missing'>('unknown');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const uid = await getSessionUserId();
      if (!uid) {
        setShop(null);
        setDeals([]);
        return;
      }

      const [shopRes, dealRes] = await Promise.all([
        supabase
          .from('vendors')
          .select('id, store_name, city, rating, review_count, verified_at, logo_url, is_active, approval_status')
          .eq('profile_id', uid)
          .maybeSingle(),
        supabase.rpc('vendor_sponsored_deals'),
      ]);

      if (shopRes.error || dealRes.error) {
        const e = shopRes.error ?? dealRes.error!;
        if (MISSING.has(e.code ?? '')) {
          setMigration('missing');
          return;
        }
        throw new Error(e.message);
      }
      setMigration('ok');

      const v = shopRes.data as Record<string, any> | null;
      setShop(
        v
          ? {
              id: v.id,
              store_name: v.store_name ?? 'Your shop',
              city: v.city ?? null,
              rating: v.rating == null ? null : Number(v.rating),
              review_count: Number(v.review_count ?? 0),
              verified: !!v.verified_at,
              logo_url: v.logo_url ?? null,
              eligible: !!v.is_active && v.approval_status === 'approved',
              approval_status: v.approval_status ?? 'pending',
              is_active: !!v.is_active,
            }
          : null
      );

      setDeals(
        ((dealRes.data ?? []) as Record<string, any>[]).map((d) => ({
          id: d.deal_id,
          headline: d.headline,
          details: d.details ?? null,
          audience: d.audience ?? null,
          starts_at: d.starts_at,
          ends_at: d.ends_at,
          priority: Number(d.priority ?? 0),
          created_via: d.created_via === 'admin' ? 'admin' : 'vendor',
          cancelled_at: d.cancelled_at ?? null,
          status: d.status as DealStatus,
          outranked: !!d.outranked,
          rotation_size: d.rotation_size == null ? null : Number(d.rotation_size),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Live or scheduled — what counts against the three-deal limit. */
  const openCount = deals.filter((d) => d.status === 'live' || d.status === 'scheduled' || d.status === 'paused').length;

  const create = useCallback(
    async (deal: NewDeal): Promise<Result> => {
      if (!shop) return { ok: false, message: 'Set up your shop in Settings first.' };
      if (!shop.eligible) {
        return { ok: false, message: 'Your shop needs to be approved and active before it can run promotions.' };
      }

      const { error: insertError } = await supabase
        .from('sponsored_deals')
        .insert({
          vendor_id: shop.id,
          headline: deal.headline.trim(),
          audience: deal.audience?.trim() || null,
          details: deal.details?.trim() || null,
          starts_at: deal.startsAt.toISOString(),
          ends_at: deal.endsAt.toISOString(),
          priority: deal.priority,
        })
        .select('id')
        .single();

      if (insertError) {
        return { ok: false, message: friendly(insertError.message, (insertError as { hint?: string }).hint) };
      }
      await load();
      return { ok: true };
    },
    [shop, load]
  );

  /**
   * Scheduled deals are deleted outright — buyers never saw them. A live
   * deal is cancelled instead (is_active = false), which takes it off the
   * dashboard at once but keeps the record of what was shown.
   *
   * `.select()` on both, because a write that RLS filters out affects
   * zero rows WITHOUT an error. Checking the returned rows is how a
   * silent no-op becomes a message.
   */
  const cancel = useCallback(
    async (deal: VendorDeal): Promise<Result> => {
      if (deal.status === 'scheduled' || deal.status === 'paused') {
        const { data, error: delError } = await supabase
          .from('sponsored_deals')
          .delete()
          .eq('id', deal.id)
          .select('id');
        if (delError) return { ok: false, message: friendly(delError.message) };
        if (data && data.length > 0) {
          await load();
          return { ok: true };
        }
        // It started between loading the page and pressing the button:
        // fall through and cancel it instead.
      }

      const { data, error: updError } = await supabase
        .from('sponsored_deals')
        .update({ is_active: false })
        .eq('id', deal.id)
        .select('id');
      if (updError) return { ok: false, message: friendly(updError.message, (updError as { hint?: string }).hint) };
      if (!data || data.length === 0) return { ok: false, message: 'That promotion could not be found. Refresh and try again.' };
      await load();
      return { ok: true };
    },
    [load]
  );

  /**
   * Choose a shop photo and save it as vendors.logo_url. It is the shop's
   * photo, not the deal's, so it is reused on every promotion and stays
   * when a promotion ends.
   */
  const uploadLogo = useCallback(async (): Promise<Result | null> => {
    if (!shop) return { ok: false, message: 'Set up your shop in Settings first.' };
    const picked = await pickBooklistImage('library');
    if (!picked) return null; // cancelled

    const { image, compressed } = await compressBooklistImage(picked);
    try {
      const mime = image.mimeType.toLowerCase();
      if (!LOGO_TYPES.has(mime)) {
        return { ok: false, message: 'Use a JPG, PNG or WebP photo.' };
      }
      const blob = await (await fetch(image.uri)).blob();
      if (blob.size > LOGO_MAX_BYTES) {
        return { ok: false, message: 'That photo is over 2 MB. Choose a smaller one.' };
      }

      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      // A new name each time, so browsers and CDNs never serve the old photo.
      const path = `${shop.id}/logo-${draftImageKey()}.${ext}`;
      const { error: upError } = await supabase.storage
        .from(SHOP_MEDIA_BUCKET)
        .upload(path, blob, { contentType: mime, upsert: false });
      if (upError) return { ok: false, message: friendly(upError.message) };

      const publicUrl = supabase.storage.from(SHOP_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
      const { error: saveError } = await supabase
        .from('vendors')
        .update({ logo_url: publicUrl })
        .eq('id', shop.id);
      if (saveError) return { ok: false, message: friendly(saveError.message) };

      // Best effort: the previous photo is clutter once replaced.
      const prev = shop.logo_url?.split(`/${SHOP_MEDIA_BUCKET}/`)[1];
      if (prev) supabase.storage.from(SHOP_MEDIA_BUCKET).remove([decodeURIComponent(prev)]).catch(() => {});

      setShop((s) => (s ? { ...s, logo_url: publicUrl } : s));
      return { ok: true };
    } finally {
      if (compressed) releaseImage(image);
      releaseImage(picked);
    }
  }, [shop]);

  return { shop, deals, openCount, loading, error, migration, refresh: load, create, cancel, uploadLogo };
}
