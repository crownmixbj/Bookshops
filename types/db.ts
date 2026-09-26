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

/**
 * 'escrow_held' is money taken and held by LOCI; 'escrow_released' is
 * money that has since gone to the vendor. Neither is 'paid' — 'paid'
 * is kept for legacy rows and direct settlement, and treating escrowed
 * money as the vendor's is the mistake this distinction exists to stop.
 *
 * Requires bookshops_escrow_checkout.sql.
 */
export type PaymentStatus =
  | 'pending'
  | 'escrow_held'
  | 'escrow_released'
  | 'paid'
  | 'failed'
  | 'refunded';

/** Payment states where the buyer's money has actually been taken. */
export const SETTLED_PAYMENT_STATUSES: PaymentStatus[] = ['escrow_held', 'escrow_released', 'paid'];

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

  /**
   * Public https URL of the shop photo (shop-media bucket). Optional on
   * the type: absent until bookshops_vendor_promotions.sql has run.
   */
  logo_url?: string | null;

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

/**
 * One row of the vendor's "My Booklists", as returned by the
 * `vendor_quote_list()` RPC.
 *
 * Every row is a quote this vendor wrote, so the customer's name is
 * always present — unlike VendorQueueRow, where it is withheld until the
 * vendor has engaged with the request.
 */
export interface VendorQuoteRow {
  quote_id: string;
  request_id: string;
  reference: string;
  quote_status: QuoteStatus;
  school_name: string;
  class_level: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_price: number;
  /** Lines this vendor priced and marked available. */
  quoted_item_count: number;
  /** Lines the buyer asked for. */
  requested_item_count: number;
  /** Lines this vendor marked out of stock. */
  unavailable_count: number;
  order_id: string | null;
  order_fulfillment_status: FulfillmentStatus | null;
  is_targeted: boolean;
  /**
   * The buyer's words when they declined, when they gave any.
   *
   * Null for every other status — a withdrawn quote is the shop's own
   * doing and an expired one is nobody's, so neither carries a reason.
   */
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * What the vendor's quote list shows, which is not quotes.status.
 *
 * 'ordered' is not a quote status at all — it comes from an orders row
 * existing — and 'declined' folds three database values that mean the
 * same thing to a shop: the buyer said no, the vendor pulled out, or it
 * timed out. Either way the work is finished and nothing can be done.
 */
export type VendorQuoteState = 'draft' | 'sent' | 'accepted' | 'ordered' | 'declined';

/** The filter tabs on the vendor's My Booklists page. */
export type VendorQuoteTab = 'all' | 'pending' | 'accepted' | 'declined' | 'draft';

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

/** The shop a booklist was addressed to, embedded on the request. */
export interface TargetVendor {
  id: string;
  store_name: string;
  city: string | null;
  is_active: boolean;
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
   * The child this list is for. Optional on the type, not just
   * nullable: a build that has not run bookshops_buyer_portal.sql has no
   * such column, so a select omits the key rather than returning null.
   */
  child_id?: string | null;
  /**
   * The shop behind target_vendor_id, embedded by the query.
   *
   * Null both when the list is open to the market and when the targeted
   * shop is no longer visible to this buyer — vendors_select_active
   * hides a deactivated one — so the id above is what proves a list was
   * addressed, and this is only how it gets a name.
   */
  target_vendor?: TargetVendor | null;
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

  /** Our reference, generated before the charge. The idempotency key. */
  payment_reference: string | null;
  payment_provider: 'paystack' | 'test' | null;
  /** Paystack's own transaction id, which is what their support asks for. */
  gateway_reference: string | null;
  paid_at: string | null;
  escrow_released_at: string | null;

  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_notes: string | null;
  /** Snapshot of the rate charged. `amount` already includes it. */
  delivery_fee: number;

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

  /** Set when this order was paid as part of a multi-quote checkout. */
  checkout_group_id?: string | null;

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

/**
 * A requested line with the pricing quote's numbers folded in.
 *
 * Prices live on `quote_items`, not on `book_request_items` — the same
 * line costs different money at different shops — so the figures a
 * buyer sees are resolved per booklist against whichever quote the card
 * is headlining. See lib/booklistPricing.ts.
 */
export interface PricedLineFields {
  /** Per-copy price from the quote, else the request row's own. Null when unpriced. */
  effectiveUnitPrice: number | null;
  /** Copies the price applies to. A shop may quote fewer than were asked for. */
  effectiveQuantity: number;
  /** effectiveUnitPrice × effectiveQuantity. Null when unpriced or out of stock. */
  lineTotal: number | null;
  /** False when the pricing vendor marked this line out of stock. */
  isAvailable: boolean;
  /** 'quote' — read off quote_items. 'request' — the buyer's own estimate. 'none' — unpriced. */
  priceSource: 'quote' | 'request' | 'none';
}

/** A full request line with the pricing quote's numbers folded in. */
export interface PricedBooklistItem extends BookRequestItem, PricedLineFields {}

export interface BooklistItemGroup {
  category: ItemCategory;
  items: PricedBooklistItem[];
  /** Sum of the priced, in-stock lines in this group. */
  subtotal: number;
  /** In-stock lines in this group with no price yet. */
  unpricedCount: number;
}

export interface Booklist extends BookRequest {
  /** The child this list is for, resolved from child_id. Null when unlabelled. */
  child: Child | null;
  items: PricedBooklistItem[];
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
  /** True when at least one in-stock line still has no price. */
  hasUnpricedItems: boolean;
  /** Lines the pricing vendor marked out of stock. Excluded from the total. */
  unavailableCount: number;
  /**
   * False when the headline figure and the sum of the lines beneath it
   * disagree — a stale quotes.total_price, or lines the buyer cannot
   * see. The card says so rather than showing two numbers that do not
   * add up.
   */
  totalMatchesLines: boolean;
}

/* ------------------------------------------------------------------ */
/* Household, address book, alerts (bookshops_buyer_portal.sql)        */
/* ------------------------------------------------------------------ */

/** A child in the buyer's household. Never visible to vendors. */
export interface Child {
  id: string;
  parent_id: string;
  full_name: string;
  school_name: string | null;
  class_level: string | null;
  created_at: string;
  updated_at: string;
}

export type EditableChild = Pick<Child, 'full_name' | 'school_name' | 'class_level'>;

/** A saved delivery address. The default one prefills checkout. */
export interface DeliveryAddress {
  id: string;
  profile_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  address: string;
  city: string;
  state: string | null;
  lga: string | null;
  landmark: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type EditableAddress = Omit<DeliveryAddress, 'id' | 'profile_id' | 'created_at' | 'updated_at'>;

export type NotificationKind =
  | 'quote_received'
  | 'quote_updated'
  | 'quote_withdrawn'
  | 'message'
  | 'payment_held'
  | 'order_dispatched'
  | 'order_delivered'
  | 'order_cancelled'
  | 'escrow_released';

/** One in-app alert. Written by database triggers, never by the client. */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** An in-app route ('/quotes/…'). The CHECK constraint keeps it relative. */
  link: string | null;
  quote_id: string | null;
  order_id: string | null;
  request_id: string | null;
  created_at: string;
  read_at: string | null;
}
