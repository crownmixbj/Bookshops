/**
 * Hand-written types for the Bookshops schema.
 *
 * These mirror the live database as of the booklist-items migration. If
 * you change the schema, regenerate rather than hand-edit:
 *
 *   npx supabase gen types typescript --project-id stychjbzqqfbzmwrdhnf > types/supabase.ts
 *
 * and re-point the aliases at the bottom. Kept by hand for now so the
 * app compiles without a Supabase CLI login.
 */

export type UserRole = 'buyer' | 'vendor' | 'admin';

/**
 * 'draft' is the buyer's own workspace: saved, editable, invisible to
 * every vendor. vendor_request_queue() filters on the two middle values,
 * so nothing else needs to know about it.
 *
 * Requires bookshops_booklist_drafts.sql — book_requests_status_check
 * rejects 'draft' until that has run.
 */
export type RequestStatus = 'draft' | 'pending_quote' | 'quoted' | 'ordered' | 'cancelled';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type FulfillmentStatus =
  | 'processing'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

export type ItemCategory = 'textbook' | 'stationery' | 'uniform' | 'other';

/**
 * Who a published booklist reaches.
 *
 * 'open_market' — every approved, active vendor may quote it.
 * 'direct'      — only target_vendor_id may see it at all. The queue RPC
 *                 and requests_select_visible both enforce that; it is
 *                 not a display preference.
 *
 * A CHECK keeps this in step with target_vendor_id: direct always names
 * a shop, open_market never does. Requires bookshops_dispatch_routing.sql.
 */
export type DispatchType = 'open_market' | 'direct';

export type ThemePreference = 'light' | 'dark' | 'system';

export type VendorApprovalStatus = 'pending' | 'approved' | 'rejected';

export type AdminActionKind =
  | 'set_role'
  | 'suspend_user'
  | 'unsuspend_user'
  | 'approve_vendor'
  | 'reject_vendor'
  | 'feature_vendor'
  | 'unfeature_vendor'
  | 'resolve_report';

export type ReportSubject = 'review' | 'booklist' | 'vendor' | 'quote';
export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface Profile {
  id: string;
  full_name: string;
  phone_number: string | null;
  role: UserRole;

  /** Prefills checkout. orders.delivery_* is the record of where an order went. */
  default_delivery_address: string | null;
  default_delivery_city: string | null;
  default_delivery_phone: string | null;
  /**
   * State, LGA and landmark — how an address is actually located and
   * found here. Optional on the type, not just nullable: a build that
   * has not run bookshops_delivery_address.sql has no such columns, so
   * a select omits the keys rather than returning null.
   */
  default_delivery_state?: string | null;
  default_delivery_lga?: string | null;
  default_delivery_landmark?: string | null;

  notify_email_orders: boolean;
  notify_email_quotes: boolean;
  notify_push_orders: boolean;
  notify_push_quotes: boolean;
  notify_sms_orders: boolean;
  notify_sms_quotes: boolean;

  /** Stored but not applied yet — the app renders light-only. */
  theme_preference: ThemePreference;
  /** Constrained to 'NGN' in the database. */
  preferred_currency: string;

  /** Set by an admin. Blocks writes; reads still work. */
  suspended_at: string | null;
  suspension_reason: string | null;

  created_at: string;
  updated_at: string;
}

/** The subset of a profile this account's owner may edit. */
export type EditableProfile = Pick<
  Profile,
  | 'full_name'
  | 'phone_number'
  | 'default_delivery_address'
  | 'default_delivery_city'
  | 'default_delivery_state'
  | 'default_delivery_lga'
  | 'default_delivery_landmark'
  | 'default_delivery_phone'
  | 'notify_email_orders'
  | 'notify_email_quotes'
  | 'notify_push_orders'
  | 'notify_push_quotes'
  | 'notify_sms_orders'
  | 'notify_sms_quotes'
  | 'theme_preference'
>;

/** The subset of a vendor row its owner may edit from Settings. */
export type EditableVendor = Pick<
  Vendor,
  'store_name' | 'address' | 'city' | 'phone' | 'email' | 'busy_mode'
>;

export interface Vendor {
  id: string;
  profile_id: string;
  store_name: string;
  address: string;
  city: string;
  is_active: boolean;
  /** Published business contact — not the owner's personal number. */
  phone: string | null;
  email: string | null;

  /** Set by an administrator once identity and address are checked. */
  verified_at: string | null;
  /** Derived from vendor_reviews by trigger. Never write directly. */
  rating: number | null;
  review_count: number;
  /** Maintained by trigger as orders reach delivered. */
  completed_orders: number;

  /** Peak-season flag the vendor sets themselves. */
  busy_mode: boolean;
  busy_note: string | null;

  /** Admin review state. Buyers only ever see 'approved' shops. */
  approval_status: VendorApprovalStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  featured: boolean;

  created_at: string;
  updated_at: string;
}

/** A vendor's priced line on a quote. Never written by the buyer. */
export interface QuoteItem {
  id: string;
  quote_id: string;
  /** Links back to the buyer's line, so the two can be compared. */
  request_item_id: string | null;
  title: string;
  quantity: number;
  /** Null until the vendor prices it. */
  unit_price: number | null;
  /** The availability switch. False keeps the line but excludes it from the total. */
  is_available: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * One row of the vendor's queue, as returned by the
 * `vendor_request_queue()` RPC.
 *
 * customer_name and customer_phone are null until this vendor has
 * engaged with the request — quoted it, or been sent it directly. That
 * gate lives in the database function, not here.
 */
export interface VendorQueueRow {
  request_id: string;
  reference: string;
  school_name: string;
  class_level: string;
  created_at: string;
  item_count: number;
  is_targeted: boolean;
  my_quote_id: string | null;
  my_quote_status: QuoteStatus | null;
  customer_name: string | null;
  customer_phone: string | null;
}

/** How a queue row reads to the vendor. */
export type QueueBadge = 'new' | 'processing' | 'pending' | 'sent' | 'accepted';

export interface AdminAction {
  id: string;
  actor_id: string;
  action: AdminActionKind;
  subject_type: 'profile' | 'vendor' | 'report';
  subject_id: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ContentReport {
  id: string;
  reporter_id: string | null;
  subject_type: ReportSubject;
  subject_id: string;
  reason: string;
  status: ReportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

/** Shape returned by the admin_platform_stats() RPC. */
export interface PlatformStats {
  totals: {
    users: number;
    vendors: number;
    orders: number;
    booklists: number;
    revenue: number;
  };
  /** 14 daily values per metric, oldest first — what each sparkline draws. */
  series: {
    users: number[];
    vendors: number[];
    orders: number[];
    booklists: number[];
    revenue: number[];
  };
  pending: {
    vendor_approvals: number;
    open_reports: number;
  };
}

/** One entry in the derived platform activity feed. */
export interface ActivityEntry {
  id: string;
  kind: 'admin' | 'order' | 'signup' | 'quote';
  icon: string;
  text: string;
  at: string;
}

export interface SavedShop {
  profile_id: string;
  vendor_id: string;
  created_at: string;
}

export interface RecentlyViewedShop {
  profile_id: string;
  vendor_id: string;
  viewed_at: string;
}

export interface VendorReview {
  id: string;
  order_id: string;
  vendor_id: string;
  buyer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

/** A vendor as the Saved Shops page renders it. */
export interface ShopView extends Vendor {
  isSaved: boolean;
  /** When this person saved it, or last viewed it. */
  savedAt: string | null;
  viewedAt: string | null;
  isVerified: boolean;
}

export interface BookRequest {
  id: string;
  buyer_id: string;
  school_name: string;
  class_level: string;
  /**
   * Set when the buyer addressed this list to one shop. Null = open to
   * the whole market. Always non-null when dispatch_type is 'direct',
   * always null when it is 'open_market' — book_requests_dispatch_target_agree
   * makes the other two combinations impossible to store.
   */
  target_vendor_id: string | null;
  /**
   * Optional on the type, not just nullable: a build that has not run
   * bookshops_dispatch_routing.sql has no such column, so a select
   * omits the key rather than returning null. Read it as
   * `?? 'open_market'`, which is what the column defaults to.
   */
  dispatch_type?: DispatchType;
  /** Legacy; never populated. Use image_path. */
  image_url: string | null;
  /** Object path in the `booklists` bucket. Sign it to display. */
  image_path: string | null;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
}

export interface BookRequestItem {
  id: string;
  request_id: string;
  title: string;
  /**
   * Author or publisher as it appeared on the school list.
   *
   * Optional on the type, not just nullable: builds that have not run
   * bookshops_booklist_author.sql yet have no such column, so a select
   * simply omits the key rather than returning null.
   */
  author?: string | null;
  category: ItemCategory;
  quantity: number;
  /** Null until a vendor has priced the line. */
  unit_price: number | null;
  /** True when the row came from the photo parser rather than a human. */
  parsed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: string;
  request_id: string;
  vendor_id: string;
  total_price: number;
  item_breakdown: unknown[];
  status: QuoteStatus;
  created_at: string;
  updated_at: string;
  /** Present when the query embeds `vendors ( ... )`. Null under RLS denial. */
  vendors?: Pick<Vendor, 'id' | 'store_name' | 'city' | 'is_active'> | null;
}

export interface Order {
  id: string;
  quote_id: string;
  buyer_id: string;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;

  /** Snapshotted from the accepted quote at placement. */
  amount: number | null;
  currency: string;

  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_notes: string | null;

  /** Stamped by the stamp_order_fulfillment trigger, not the client. */
  placed_at: string;
  processing_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;

  tracking_carrier: string | null;
  tracking_number: string | null;
  /** Always https — enforced by a CHECK constraint. */
  tracking_url: string | null;

  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* View models for the Orders page                                     */
/* ------------------------------------------------------------------ */

/** The four steps a buyer is shown, collapsed from FulfillmentStatus. */
export type TrackerStep = 'placed' | 'processing' | 'dispatched' | 'delivered';

export interface TrackerStage {
  step: TrackerStep;
  label: string;
  /** Null when the step has not been reached. */
  at: string | null;
  state: 'done' | 'current' | 'upcoming';
}

export interface OrderView extends Order {
  quote: Quote | null;
  vendor: Vendor | null;
  request: BookRequest | null;
  items: BookRequestItem[];
  /** Sum of the priced lines; may differ from `amount`, which is authoritative. */
  itemsTotal: number;
  itemCount: number;
  stages: TrackerStage[];
  isComplete: boolean;
  isCancelled: boolean;
  /** Short human reference, e.g. LOCI-3F9A2C. */
  reference: string;
}

/* ------------------------------------------------------------------ */
/* View models the Booklists page works with                           */
/* ------------------------------------------------------------------ */

/** Which section of the page a request belongs in. */
export type BooklistBucket = 'active' | 'draft' | 'archived';

export interface BooklistItemGroup {
  category: ItemCategory;
  items: BookRequestItem[];
  /** Sum of quantity × unit_price for priced lines only. */
  subtotal: number;
  /** Lines in this group with no price yet. */
  unpricedCount: number;
}

export interface Booklist extends BookRequest {
  items: BookRequestItem[];
  groups: BooklistItemGroup[];
  quotes: Quote[];
  order: Order | null;
  bucket: BooklistBucket;
  /** Total item count, counting quantities: three copies of one title is 3. */
  itemCount: number;
  /**
   * Number of LINES on the list — what the serial numbers in the card
   * count up to. Distinct from itemCount, which counts copies: a list of
   * 12 titles where one is ordered twice is lineCount 12, itemCount 13.
   */
  lineCount: number;
  /**
   * Best available money figure: the accepted quote if there is one,
   * otherwise the cheapest live quote, otherwise the sum of the line
   * items the buyer entered. `source` says which, so the UI can label it
   * honestly rather than presenting an estimate as a price.
   */
  estimatedTotal: number;
  totalSource: 'order' | 'quote' | 'items' | 'none';
  /** True when at least one line has no unit_price yet. */
  hasUnpricedItems: boolean;
}
