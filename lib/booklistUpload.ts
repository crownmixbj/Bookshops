import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../utils/supabase';
import type { DispatchType, ItemCategory } from '../types/db';

export const BUCKET = 'booklists';

export interface PickedImage {
  uri: string;
  mimeType: string;
  fileName: string;
}

/**
 * Opens the camera roll (or camera) and returns the chosen image.
 * Returns null when the user cancels or declines the permission.
 */
export async function pickBooklistImage(
  source: 'library' | 'camera' = 'library'
): Promise<PickedImage | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsEditing: false,
        });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? `booklist-${Date.now()}.jpg`,
  };
}

/**
 * A path-safe id for an image uploaded before its request row exists.
 *
 * The review-and-edit step happens BEFORE anything is written to
 * book_requests — the buyer may still cancel — so there is no request id
 * to key the object by yet. crypto.randomUUID is present on web and on
 * Hermes with the RN polyfill, absent on older runtimes; the fallback is
 * unique enough for an object name scoped to one user's folder.
 */
export function draftImageKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Uploads the image to the `booklists` bucket.
 *
 * The object path MUST start with the uploader's user id — the
 * `booklists_insert_own_folder` storage policy checks exactly that, so a
 * path in any other shape is rejected by Postgres, not just by
 * convention. Everything after that first segment is free, which is what
 * lets a draft key stand in for a request id.
 *
 * Returns the object path. Store that, not a URL: the bucket is private
 * and signed URLs expire.
 */
export async function uploadBooklistImage(
  userId: string,
  key: string,
  image: PickedImage
): Promise<string> {
  const ext = (image.fileName.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `${userId}/${key}.${ext}`;

  // React Native's fetch handles file:// URIs; on web the uri is a blob:
  // or data: URL. Both resolve to a Blob, which supabase-js accepts.
  const response = await fetch(image.uri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: image.mimeType,
    upsert: true,
  });
  if (error) throw error;

  return path;
}

/** Signs a stored object path for display. The bucket is private. */
export async function signBooklistImage(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/* ------------------------------------------------------------------ */
/* Document parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * One line as it comes back from the parser and as the review table
 * edits it.
 *
 * `id` is a client-side key only — it identifies the row inside the
 * review modal so React can track it through edits, insertions and
 * deletions. It is deliberately NOT the database id; book_request_items
 * rows do not exist until the buyer submits.
 *
 * `selected` starts true. Unchecking is how a buyer says "I already own
 * this one" — unselected lines are dropped at submit so vendors only
 * quote what is actually needed.
 */
export interface ParsedItem {
  id: string;
  title: string;
  /** Author or publisher. Empty string when the list did not name one. */
  author: string;
  category: ItemCategory;
  quantity: number;
  unit_price: number | null;
  selected: boolean;
}

export interface ParseResult {
  /** Best guess at the school, for the editable header. '' when unknown. */
  school_name: string;
  /** Best guess at the class or grade, e.g. 'JSS 1'. '' when unknown. */
  class_level: string;
  items: ParsedItem[];
  /** False when no parser ran, so the UI can say so rather than imply OCR happened. */
  parsed: boolean;
  note: string;
}

/**
 * Which parser backs parseBooklistImage.
 *
 * 'mock' is the default so the review-and-edit flow can be exercised
 * end to end without an OCR bill or an API key. Set
 * EXPO_PUBLIC_BOOKLIST_PARSER=edge on the build host to switch to the
 * Supabase Edge Function. Read at build time, not runtime — Expo inlines
 * EXPO_PUBLIC_* into the bundle.
 */
const PARSER_MODE = (process.env.EXPO_PUBLIC_BOOKLIST_PARSER ?? 'mock') as
  | 'mock'
  | 'edge'
  | 'off';

/** Name of the Edge Function to invoke when PARSER_MODE is 'edge'. */
const PARSER_FUNCTION = 'parse-booklist';

let mockCounter = 0;

/**
 * Fixture data — a real JSS 1 list, so the review table is exercised
 * with the messy shapes that actually turn up: titles with no author,
 * an author given as initials, a dictionary and a hymn book that are not
 * subject textbooks, and enough rows to scroll.
 *
 * The first three lines are the contract in the spec; the rest are here
 * because a three-row table hides every layout problem worth finding.
 */
const MOCK_ITEMS: Array<Pick<ParsedItem, 'title' | 'author'>> = [
  { title: 'Intensive English Language for JSS 1', author: '' },
  { title: 'New General Mathematics', author: 'A.O. Kalejaiye' },
  { title: 'Oxford Advanced Learners Dictionary', author: '' },
  { title: 'Science Teacher Association of Nigeria Science Project Book 1', author: '' },
  { title: 'New Intensive Agriculture Science', author: 'E.E. Okoro' },
  { title: 'WABP Business Studies Book 1 for Junior School', author: 'D. Osu' },
  { title: 'Cultural and Creative Art for Junior Secondary School', author: '' },
  { title: 'Basic Technology', author: 'Evans' },
  { title: 'Comprehensive Physical Education', author: 'J.O. Ufi & E. Ojeme' },
  { title: 'Home Economics', author: 'Elizabeth U. Aryahaha' },
  { title: 'Holy Bible Revised Standard Version', author: '' },
  { title: 'Basic Fact Social Studies', author: '' },
];

/**
 * Turns a booklist photo into a structured, editable list.
 *
 * Give it a stored object path in the `booklists` bucket; get back a
 * header guess and line items in the shape the review modal edits and
 * the submit step inserts. Nothing here writes to the database — the
 * buyer confirms first, always.
 *
 * The mock path returns fixture data immediately so the whole flow is
 * testable locally. The real path is the Edge Function below.
 */
export async function parseBooklistImage(imagePath: string): Promise<ParseResult> {
  if (PARSER_MODE === 'edge') return parseViaEdgeFunction(imagePath);
  if (PARSER_MODE === 'mock') return mockParse();

  console.warn(
    '[booklist] parseBooklistImage is disabled (EXPO_PUBLIC_BOOKLIST_PARSER=off). Path:',
    imagePath
  );
  return {
    school_name: '',
    class_level: '',
    items: [],
    parsed: false,
    note: 'Automatic reading is not set up yet — add the items yourself and vendors will quote them.',
  };
}

/** Local development stand-in. Shaped exactly like the real response. */
async function mockParse(): Promise<ParseResult> {
  // A beat of latency on purpose: without it the "Reading your list…"
  // state never renders, so its layout goes untested until production.
  await new Promise((resolve) => setTimeout(resolve, 900));

  return {
    school_name: 'St. Columbanus Secondary School',
    class_level: 'JSS 1',
    parsed: true,
    note: '',
    items: MOCK_ITEMS.map((item) => ({
      id: `mock-${mockCounter++}`,
      title: item.title,
      author: item.author,
      category: guessCategory(item.title),
      quantity: 1,
      unit_price: null,
      selected: true,
    })),
  };
}

/**
 * Production path — NOT WIRED UP YET.
 *
 * TODO(parsing): deploy `supabase/functions/parse-booklist` and delete
 * the throw below. The function is where the vision call belongs, not
 * the client: it holds the model API key server-side, it can sign the
 * private object itself with the service role, and it can be rate
 * limited per user. A key shipped in an Expo bundle is a public key.
 *
 * The function should:
 *   1. verify the caller's JWT and that they own `imagePath`
 *      (the first path segment must equal auth.uid());
 *   2. create a short-lived signed URL for the object;
 *   3. send it to a vision model — OpenAI gpt-4o / Gemini 1.5 Pro —
 *      asking for STRICT JSON, no prose:
 *        { school_name, class_level,
 *          items: [{ title, author, quantity }] }
 *      System prompt worth keeping: Nigerian school booklists number
 *      their lines, wrap long titles across two lines, and write the
 *      author after "by". Instruct it to rejoin wrapped lines, strip
 *      the leading numbering, and leave author empty rather than
 *      guessing one.
 *   4. return that JSON unchanged. Everything below the API boundary
 *      stays the same, so no caller changes when this lands.
 *
 * Wiring, once deployed — this is the whole body:
 *
 *   const { data, error } = await supabase.functions.invoke(
 *     PARSER_FUNCTION,
 *     { body: { imagePath } }
 *   );
 *   if (error) throw error;
 *   return normaliseParseResponse(data);
 */
async function parseViaEdgeFunction(imagePath: string): Promise<ParseResult> {
  throw new Error(
    `The booklist parser Edge Function (${PARSER_FUNCTION}) is not deployed yet. ` +
      `Set EXPO_PUBLIC_BOOKLIST_PARSER=mock to use the local stand-in. Path: ${imagePath}`
  );
}

/**
 * Coerces whatever the parser returned into ParseResult.
 *
 * Kept out of parseViaEdgeFunction so it is already here, and already
 * defensive, when the function lands: a vision model's JSON is a
 * suggestion, not a contract. Anything missing degrades to a blank
 * field the buyer can fill in, which is the whole point of the review
 * step.
 */
export function normaliseParseResponse(raw: unknown): ParseResult {
  const data = (raw ?? {}) as {
    school_name?: unknown;
    class_level?: unknown;
    items?: unknown;
  };
  const rawItems = Array.isArray(data.items) ? data.items : [];

  const items: ParsedItem[] = rawItems
    .map((entry, i): ParsedItem | null => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const title = String(item.title ?? '').trim();
      if (!title) return null;
      const quantity = Number(item.quantity);
      return {
        id: String(item.id ?? `parsed-${i}`),
        title,
        author: String(item.author ?? '').trim(),
        category: guessCategory(title),
        // Clamped to the quantity CHECK constraint on book_request_items,
        // so a hallucinated 0 or 9999 cannot fail the whole insert.
        quantity: Number.isFinite(quantity) ? Math.min(Math.max(Math.round(quantity), 1), 500) : 1,
        unit_price: null,
        selected: true,
      };
    })
    .filter((item): item is ParsedItem => item !== null);

  return {
    school_name: String(data.school_name ?? '').trim(),
    class_level: String(data.class_level ?? '').trim(),
    items,
    parsed: items.length > 0,
    note: items.length
      ? ''
      : 'Nothing could be read from that photo — add the items yourself and vendors will quote them.',
  };
}

/** A blank line for the review table's "+ Add item" button. */
export function blankItem(): ParsedItem {
  return {
    id: draftImageKey(),
    title: '',
    author: '',
    category: 'other',
    quantity: 1,
    unit_price: null,
    selected: true,
  };
}

/** Heuristic used by a future parser to bucket a line into a category. */
export function guessCategory(title: string): ItemCategory {
  const t = title.toLowerCase();
  if (/(uniform|shirt|short|skirt|trouser|blazer|tie|sock|shoe|sandal)/.test(t)) return 'uniform';
  if (/(pen|pencil|biro|crayon|eraser|ruler|sharpener|note ?book|exercise book|cardboard|file|folder|scissors|glue)/.test(t)) {
    return 'stationery';
  }
  if (/(mathematics|english|science|history|dictionary|textbook|reader|atlas|bible|quran)/.test(t)) {
    return 'textbook';
  }
  return 'other';
}

/* ------------------------------------------------------------------ */
/* Booklist records — create, edit, publish, delete                    */
/* ------------------------------------------------------------------ */

/**
 * The two status values this app writes, in one place.
 *
 * PUBLISHED_STATUS is deliberately the SINGULAR 'pending_quote'. It is
 * not a typo and it is not free to change: vendor_request_queue() filters
 * `status in ('pending_quote','quoted')`, and SendBooklistModal,
 * useProfileDetails and the admin screens all match the same string. A
 * plural value here compiles, saves, and silently hides every published
 * list from every vendor.
 *
 * Both values require bookshops_booklist_drafts.sql to have been run —
 * before that, book_requests_status_check rejects 'draft' outright.
 */
export const DRAFT_STATUS = 'draft' as const;
export const PUBLISHED_STATUS = 'pending_quote' as const;

/**
 * Where a published list is sent.
 *
 * The two fields travel together because the database insists they
 * agree — book_requests_dispatch_target_agree rejects a direct request
 * with no shop and an open one that names a shop. Passing them as one
 * value makes the invalid pair hard to construct in the first place.
 */
export interface Dispatch {
  type: DispatchType;
  /** The shop's vendors.id. Required for 'direct', null otherwise. */
  vendorId: string | null;
}

/** The default: every approved, active vendor may quote it. */
export const OPEN_MARKET: Dispatch = { type: 'open_market', vendorId: null };

/** Addressed to one shop, and visible to no other. */
export function directTo(vendorId: string): Dispatch {
  return { type: 'direct', vendorId };
}

/** The columns a dispatch writes, validated so the pair cannot disagree. */
function dispatchColumns(dispatch: Dispatch) {
  if (dispatch.type === 'direct' && !dispatch.vendorId) {
    throw new Error('Choose a shop to send this booklist to.');
  }
  return {
    dispatch_type: dispatch.type,
    // Explicitly null, not omitted: switching a list back to the open
    // market has to CLEAR the shop it was addressed to, or the constraint
    // rejects the update and the list stays where it was.
    target_vendor_id: dispatch.type === 'direct' ? dispatch.vendorId : null,
  };
}

/** The header fields a buyer may edit on their own booklist. */
export interface BooklistHeader {
  school_name: string;
  class_level: string;
}

/**
 * A line as the edit modal holds it.
 *
 * `id` is the database row id, or null for a line the buyer has just
 * added and that has never been saved. `key` is the React key and stays
 * stable across a save — reusing `id` for both would remount every new
 * row the moment it acquired one, which drops focus mid-typing.
 */
export interface EditableItem {
  id: string | null;
  key: string;
  title: string;
  author: string;
  category: ItemCategory;
  quantity: number;
}

export interface SaveResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/** Turns saved rows into the shape the edit modal works with. */
export function toEditableItems(
  rows: Array<{
    id: string;
    title: string;
    author?: string | null;
    category: ItemCategory;
    quantity: number;
  }>
): EditableItem[] {
  return rows.map((row) => ({
    id: row.id,
    key: row.id,
    title: row.title,
    author: row.author ?? '',
    category: row.category,
    quantity: row.quantity,
  }));
}

/** A blank row for the edit modal's "+ Add Book Item" button. */
export function blankEditableItem(): EditableItem {
  return {
    id: null,
    key: draftImageKey(),
    title: '',
    author: '',
    category: 'other',
    quantity: 1,
  };
}

/**
 * Saves a booklist's header and its line items.
 *
 * Not a delete-all-and-reinsert. That would be three lines shorter and
 * would break two things: quote_items.request_item_id points at these
 * rows, so recreating them orphans every vendor's pricing; and the ids
 * would churn on every keystroke-save, so an edit during quoting would
 * silently detach the quotes from the list they priced.
 *
 * Instead the array is diffed against what is stored:
 *   rows with an id      -> UPDATE (position comes from array order)
 *   rows without an id   -> INSERT
 *   stored ids not sent  -> DELETE
 *
 * Blank titles are dropped rather than saved: an empty "+ Add Book Item"
 * row the buyer never filled in is not an item, and book_request_items
 * has a length CHECK that would reject it anyway.
 *
 * `status` is optional so "Save & Send to Vendors" is ONE round trip and
 * one atomic-enough moment — saving and then publishing separately can
 * leave a list published with the pre-edit content if the second call
 * fails.
 */
export async function updateBookRequest(
  requestId: string,
  header: BooklistHeader & {
    status?: typeof DRAFT_STATUS | typeof PUBLISHED_STATUS;
    /** Only meaningful alongside a publish; ignored when saving a draft. */
    dispatch?: Dispatch;
  },
  items: EditableItem[]
): Promise<SaveResult> {
  const school = header.school_name.trim();
  if (!school) throw new Error('A booklist needs a school name.');

  // --- header ---
  const { error: headerError, data: headerRows } = await supabase
    .from('book_requests')
    .update({
      school_name: school,
      class_level: header.class_level.trim(),
      ...(header.status ? { status: header.status } : {}),
      // Routing is written in the same statement as the status, so a
      // list can never be live in the queue with the wrong audience.
      ...(header.status === PUBLISHED_STATUS && header.dispatch
        ? dispatchColumns(header.dispatch)
        : {}),
    })
    .eq('id', requestId)
    .select('id');
  if (headerError) throw headerError;
  // RLS refuses by matching nothing, not by erroring. Without this check
  // a save on someone else's list — or on a list in a status the policy
  // excludes — reports success and changes nothing.
  if (!headerRows?.length) {
    throw new Error(
      'That booklist could not be updated. It may have been deleted, or a vendor may have already quoted it.'
    );
  }

  // --- line items ---
  const live = items.filter((item) => item.title.trim().length > 0);

  const { data: existing, error: existingError } = await supabase
    .from('book_request_items')
    .select('id')
    .eq('request_id', requestId);
  if (existingError) throw existingError;

  const keptIds = new Set(live.map((item) => item.id).filter(Boolean) as string[]);
  const removedIds = (existing ?? []).map((row) => row.id).filter((id) => !keptIds.has(id));

  if (removedIds.length) {
    const { error } = await supabase.from('book_request_items').delete().in('id', removedIds);
    if (error) throw error;
  }

  const updates = live
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => item.id !== null);

  for (const { item, position } of updates) {
    const { error } = await supabase
      .from('book_request_items')
      .update({
        title: item.title.trim(),
        author: item.author.trim() || null,
        category: guessCategory(item.title),
        quantity: item.quantity,
        position,
        // A line a human has edited is no longer an unreviewed machine
        // guess, so it loses the "read from photo — check this line"
        // warning the card shows.
        parsed: false,
      })
      .eq('id', item.id as string);
    if (error) throw error;
  }

  const inserts = live
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => item.id === null)
    .map(({ item, position }) => ({
      request_id: requestId,
      title: item.title.trim(),
      author: item.author.trim() || null,
      category: guessCategory(item.title),
      quantity: item.quantity,
      parsed: false,
      position,
    }));

  if (inserts.length) {
    const { error } = await supabase.from('book_request_items').insert(inserts);
    if (error) throw error;
  }

  return { inserted: inserts.length, updated: updates.length, deleted: removedIds.length };
}

/**
 * Publishes a draft so vendors can quote it.
 *
 * Refuses an empty list. A request with no items reaches every vendor's
 * queue as a row with nothing to price, and the only thing they can do
 * with it is decline it — which costs the buyer a vendor.
 */
export async function publishBookRequest(
  requestId: string,
  dispatch: Dispatch = OPEN_MARKET
): Promise<void> {
  const { count, error: countError } = await supabase
    .from('book_request_items')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId);
  if (countError) throw countError;

  if (!count) {
    throw new Error('Add at least one book before sending this list to vendors.');
  }

  const { data, error } = await supabase
    .from('book_requests')
    .update({ status: PUBLISHED_STATUS, ...dispatchColumns(dispatch) })
    .eq('id', requestId)
    .select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('That booklist could not be published. It may have been deleted.');
  }
}

/**
 * Changes where an already-published list is sent, without touching its
 * status.
 *
 * Separate from publishBookRequest because the two are different acts:
 * publishing takes a draft live, whereas this re-routes something that
 * is already live and may already be 'quoted'. Reusing publish here
 * would drag such a list back to 'pending_quote' and lose that.
 *
 * Both columns move together — see dispatchColumns. Writing
 * target_vendor_id on its own trips book_requests_dispatch_target_agree,
 * which is exactly the mistake this function exists to prevent.
 */
export async function routeBookRequest(requestId: string, dispatch: Dispatch): Promise<void> {
  const { data, error } = await supabase
    .from('book_requests')
    .update({ ...dispatchColumns(dispatch), updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('That booklist could not be sent. It may have been deleted.');
  }
}

/**
 * Deletes a booklist and, by cascade, its line items.
 *
 * The rows-affected check is the point of this function. `requests_delete_own`
 * permits a delete only while the list is a draft or unquoted, and a
 * DELETE that RLS refuses is not an error — Postgres reports success
 * having removed nothing. Without the check the UI would confirm the
 * deletion, close the dialog, and show the list again on the next
 * refresh with no explanation.
 */
export async function deleteBookRequest(requestId: string): Promise<void> {
  const { data, error } = await supabase
    .from('book_requests')
    .delete()
    .eq('id', requestId)
    .select('id');
  if (error) throw error;

  if (!data?.length) {
    throw new Error(
      'That booklist could not be deleted. Lists that a vendor has already quoted or that have been ordered are kept — cancel it instead.'
    );
  }
}

/**
 * Turns a Postgres error into something a person can act on.
 *
 * There is exactly one failure worth translating: 23514 is a CHECK
 * constraint violation, and the only check these writes can trip is
 * book_requests_status_check rejecting 'draft' on a project that has not
 * run bookshops_booklist_drafts.sql. Raw, it reads:
 *
 *   new row for relation "book_requests" violates check constraint
 *   "book_requests_status_check"
 *
 * — which tells a buyer nothing and sends a developer looking in the
 * wrong place. Everything else passes through unchanged rather than
 * being papered over with a friendlier lie.
 *
 * The alternative — catching this and quietly saving as 'pending_quote'
 * instead — was rejected on purpose: it would publish to vendors a list
 * the buyer had just asked to keep private.
 */
export function describeBooklistError(error: unknown): string {
  const e = error as { code?: string; message?: string };
  const message = e?.message ?? '';

  // 23514 = check_constraint_violation, 42703 = undefined_column,
  // PGRST204 = PostgREST cannot find the column in its schema cache.
  // All three mean the same thing here: a migration has not been run.
  const missingColumn = e?.code === '42703' || e?.code === 'PGRST204';

  if (/dispatch_type/i.test(message) || /dispatch_target_agree/i.test(message)) {
    if (missingColumn || e?.code === '23514') {
      return (
        'Sending to a specific shop is not enabled on this database yet. Run ' +
        'bookshops_dispatch_routing.sql in the Supabase SQL editor.'
      );
    }
  }

  if (e?.code === '23514' && /status/i.test(message)) {
    return (
      'Drafts are not enabled on this database yet. Run bookshops_booklist_drafts.sql ' +
      'in the Supabase SQL editor — it adds "draft" to book_requests_status_check.'
    );
  }

  return message || String(error);
}
