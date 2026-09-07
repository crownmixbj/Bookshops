import { Platform } from '/sessions/rcw-01nxvu91ldivpkyxb3xsnua9/mnt/BookShops/.rn.stub.mjs';
import * as ImagePicker from '/sessions/rcw-01nxvu91ldivpkyxb3xsnua9/mnt/BookShops/.ip.stub.mjs';
import { supabase } from '/sessions/rcw-01nxvu91ldivpkyxb3xsnua9/mnt/BookShops/.sbfn.stub.mjs';
export const BUCKET = 'booklists';
/**
 * Opens the camera (or the photo library) and returns the chosen image.
 * Returns null when the person cancels or declines the permission.
 *
 * Two implementations, because the two platforms fail in opposite ways.
 * See each one.
 */
export function pickBooklistImage(source = 'library') {
  return Platform.OS === 'web' ? pickImageWeb(source) : pickImageNative(source);
}

/**
 * Web: build and click a hidden file input SYNCHRONOUSLY.
 *
 * Synchronous because a browser only opens a file dialog while the click
 * that asked for it is still the live user gesture; every `await` before
 * the `.click()` risks spending it. expo-image-picker awaits a
 * permission call first, which is why "Take a photo" did nothing on
 * localhost — no dialog, no error, no console line.
 *
 * `capture="environment"` asks a phone browser for the rear camera and
 * is ignored by desktop browsers, which fall back to the file chooser.
 * That is the wanted behaviour in both places.
 *
 * How this settles is the part that bit us, so it is spelled out:
 *
 *   change  a file was chosen. Always trusted, whenever it arrives.
 *   cancel  the dialog was dismissed. Supported by Chrome 113+,
 *           Safari 16.4+ and Firefox 91+, and it is exact.
 *
 * There is deliberately NO "the window got focus back, so they must have
 * cancelled" timer on browsers that fire `cancel`. That heuristic was
 * here and it was wrong: focus can return to the window while the OS
 * dialog is still open, and the timer then resolved null and tore the
 * input down a moment before the real `change` arrived — silently
 * discarding the photo the person had just chosen. A guarded version of
 * it survives only for browsers with no `cancel` event at all, and even
 * there it never removes the input while a selection could still land.
 */
function pickImageWeb(source) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source === 'camera') input.setAttribute('capture', 'environment');
    // Off-screen rather than display:none — Safari has historically
    // ignored .click() on an input that is not rendered at all.
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.top = '0';
    input.style.opacity = '0';
    let settled = false;
    let focusTimer;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (focusTimer) clearTimeout(focusTimer);
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      finish({
        // A blob: URL, which the caller owns and must revoke — see
        // releaseImage(). Not revoked here: the review screen renders
        // from this uri and the upload reads it back through fetch().
        uri: URL.createObjectURL(file),
        mimeType: file.type || 'image/jpeg',
        fileName: file.name || `booklist-${Date.now()}.jpg`
      });
    });
    input.addEventListener('cancel', () => finish(null));
    function onWindowFocus() {
      // Legacy path only. Long enough that a dialog still being used
      // does not trip it, and it re-checks the input before giving up.
      focusTimer = setTimeout(() => {
        if (!settled && !input.files?.length) finish(null);
      }, 1500);
    }

    // Feature-detected, not assumed: where `cancel` exists it is exact,
    // and the focus heuristic must not run alongside it.
    const supportsCancel = 'oncancel' in input;
    if (!supportsCancel) {
      window.addEventListener('focus', onWindowFocus, {
        once: true
      });
    }
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Frees a picked image.
 *
 * On web `uri` is a blob: URL held by the document until it is revoked,
 * so a buyer who picks six photos before settling on one leaves six full
 * images pinned in memory. No-op for a native file:// uri.
 *
 * Call this when the image is REPLACED or discarded — never while
 * something is still rendering it. A revoked blob URL renders as a
 * broken image, which is precisely the "wrong photo" class of bug.
 */
export function releaseImage(image) {
  if (!image?.uri?.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(image.uri);
  } catch {
    // Already revoked, or no URL API. Nothing to do either way.
  }
}

/**
 * Native: ask, then launch.
 *
 * The caller must have dismissed any open Modal FIRST and waited for it
 * to actually be gone — see hooks/useCreateBooklist. On iOS a picker
 * presented from underneath a still-mounted Modal is simply never
 * shown: no error, no camera, nothing.
 *
 * A refused permission throws rather than returning null, so the caller
 * can say why. Returning null here made a refusal indistinguishable
 * from a cancel, and the buyer got no explanation at all.
 */
async function pickImageNative(source) {
  const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(source === 'camera' ? 'Camera access is needed to photograph the booklist. Turn it on for LOCI in your device settings.' : 'Photo access is needed to pick the booklist. Turn it on for LOCI in your device settings.');
  }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    // Deliberately off. iOS forces a SQUARE crop here, which cuts
    // the bottom off a portrait sheet of paper — and the bottom of
    // a school booklist is more books. The whole page has to reach
    // the parser.
    allowsEditing: false
  }) : await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsEditing: false
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? `booklist-${Date.now()}.jpg`
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
export function draftImageKey() {
  const c = globalThis.crypto;
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
export async function uploadBooklistImage(userId, key, image) {
  const ext = (image.fileName.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `${userId}/${key}.${ext}`;

  // React Native's fetch handles file:// URIs; on web the uri is a blob:
  // or data: URL. Both resolve to a Blob, which supabase-js accepts.
  const response = await fetch(image.uri);
  const blob = await response.blob();
  const {
    error
  } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: image.mimeType,
    upsert: true
  });
  if (error) throw error;
  return path;
}

/** Signs a stored object path for display. The bucket is private. */
export async function signBooklistImage(path, expiresInSeconds = 3600) {
  const {
    data,
    error
  } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
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

/**
 * Which parser backs parseBooklistImage.
 *
 * 'edge' — the default — calls the `parse-booklist` Edge Function, which
 * is where the vision model lives. 'off' skips reading entirely and
 * sends the buyer straight to typing.
 *
 * There is deliberately no 'mock'. A fixture mode used to be the
 * DEFAULT here, and it returned the same twelve JSS 1 textbooks for
 * every photo — so a parent who photographed a Lagos State JSS 3
 * literature list was shown "Intensive English Language for JSS 1" and
 * eleven other books they had never asked for, with no indication any
 * of it was invented. Sending that to vendors gets the wrong books
 * quoted and the wrong money taken. Fixtures do not belong on a path a
 * real buyer can reach.
 */
const PARSER_MODE = process.env.EXPO_PUBLIC_BOOKLIST_PARSER ?? 'edge';

/** Name of the Edge Function to invoke when PARSER_MODE is 'edge'. */
const PARSER_FUNCTION = 'parse-booklist';

/**
 * What the buyer is told when nothing could be read.
 *
 * Says what happened, and both ways forward — the photo is already
 * attached, so a shop can read the list even if we could not.
 */
export const OCR_UNREADABLE_NOTE = "We couldn't automatically read this photo. Please type your books below, or send the raw photo directly to shops.";

/** The honest empty result. No items, and `parsed: false` so the UI can say so. */
function unreadable(note = OCR_UNREADABLE_NOTE) {
  return {
    school_name: '',
    class_level: '',
    items: [],
    parsed: false,
    note
  };
}

/**
 * Turns a booklist photo into a structured, editable list.
 *
 * Give it a stored object path in the `booklists` bucket; get back a
 * header guess and line items in the shape the review modal edits and
 * the submit step inserts. Nothing here writes to the database — the
 * buyer confirms first, always.
 *
 * This never throws and never invents. Every failure — parser switched
 * off, function not deployed, model down, malformed JSON — resolves to
 * an empty list plus a note, because the photo is already uploaded and
 * the buyer can still type the books or let a shop read the picture.
 * Throwing would have been fine too; returning fake books never was.
 */
export async function parseBooklistImage(imagePath) {
  if (PARSER_MODE === 'off') {
    return unreadable('Automatic reading is switched off for this build. Type your books below, or send the raw photo directly to shops.');
  }
  try {
    const {
      data,
      error
    } = await supabase.functions.invoke(PARSER_FUNCTION, {
      body: {
        imagePath
      }
    });
    if (error) throw error;
    const result = normaliseParseResponse(data);
    // A response with no usable lines is a failure to read, not a
    // booklist with no books on it. Say so rather than presenting an
    // empty table as though the photo were blank.
    return result.items.length ? result : unreadable();
  } catch (e) {
    // Logged for the developer, not shown raw to the buyer: the message
    // is usually "Failed to send a request to the Edge Function", which
    // tells a parent nothing.
    console.warn(`[booklist] ${PARSER_FUNCTION} could not read ${imagePath}:`, e);
    return unreadable();
  }
}

/**
 * Coerces whatever the parser returned into ParseResult.
 *
 * A vision model's JSON is a suggestion, not a contract, so this is
 * deliberately paranoid. Anything missing degrades to a blank
 * field the buyer can fill in, which is the whole point of the review
 * step.
 */
export function normaliseParseResponse(raw) {
  const data = raw ?? {};
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems.map((entry, i) => {
    const item = entry ?? {};
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
      selected: true
    };
  }).filter(item => item !== null);
  return {
    school_name: String(data.school_name ?? '').trim(),
    class_level: String(data.class_level ?? '').trim(),
    items,
    parsed: items.length > 0,
    note: items.length ? '' : 'Nothing could be read from that photo — add the items yourself and vendors will quote them.'
  };
}

/** A blank line for the review table's "+ Add item" button. */
export function blankItem() {
  return {
    id: draftImageKey(),
    title: '',
    author: '',
    category: 'other',
    quantity: 1,
    unit_price: null,
    selected: true
  };
}

/** Heuristic used by a future parser to bucket a line into a category. */
export function guessCategory(title) {
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
export const DRAFT_STATUS = 'draft';
export const PUBLISHED_STATUS = 'pending_quote';

/**
 * Where a published list is sent.
 *
 * The two fields travel together because the database insists they
 * agree — book_requests_dispatch_target_agree rejects a direct request
 * with no shop and an open one that names a shop. Passing them as one
 * value makes the invalid pair hard to construct in the first place.
 */

/** The default: every approved, active vendor may quote it. */
export const OPEN_MARKET = {
  type: 'open_market',
  vendorId: null
};

/** Addressed to one shop, and visible to no other. */
export function directTo(vendorId) {
  return {
    type: 'direct',
    vendorId
  };
}

/** The columns a dispatch writes, validated so the pair cannot disagree. */
function dispatchColumns(dispatch) {
  if (dispatch.type === 'direct' && !dispatch.vendorId) {
    throw new Error('Choose a shop to send this booklist to.');
  }
  return {
    dispatch_type: dispatch.type,
    // Explicitly null, not omitted: switching a list back to the open
    // market has to CLEAR the shop it was addressed to, or the constraint
    // rejects the update and the list stays where it was.
    target_vendor_id: dispatch.type === 'direct' ? dispatch.vendorId : null
  };
}

/** The header fields a buyer may edit on their own booklist. */

/**
 * A line as the edit modal holds it.
 *
 * `id` is the database row id, or null for a line the buyer has just
 * added and that has never been saved. `key` is the React key and stays
 * stable across a save — reusing `id` for both would remount every new
 * row the moment it acquired one, which drops focus mid-typing.
 */

/** Turns saved rows into the shape the edit modal works with. */
export function toEditableItems(rows) {
  return rows.map(row => ({
    id: row.id,
    key: row.id,
    title: row.title,
    author: row.author ?? '',
    category: row.category,
    quantity: row.quantity
  }));
}

/** A blank row for the edit modal's "+ Add Book Item" button. */
export function blankEditableItem() {
  return {
    id: null,
    key: draftImageKey(),
    title: '',
    author: '',
    category: 'other',
    quantity: 1
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
export async function updateBookRequest(requestId, header, items) {
  const school = header.school_name.trim();
  if (!school) throw new Error('A booklist needs a school name.');

  // --- header ---
  const {
    error: headerError,
    data: headerRows
  } = await supabase.from('book_requests').update({
    school_name: school,
    class_level: header.class_level.trim(),
    ...(header.status ? {
      status: header.status
    } : {}),
    // Routing is written in the same statement as the status, so a
    // list can never be live in the queue with the wrong audience.
    ...(header.status === PUBLISHED_STATUS && header.dispatch ? dispatchColumns(header.dispatch) : {})
  }).eq('id', requestId).select('id');
  if (headerError) throw headerError;
  // RLS refuses by matching nothing, not by erroring. Without this check
  // a save on someone else's list — or on a list in a status the policy
  // excludes — reports success and changes nothing.
  if (!headerRows?.length) {
    throw new Error('That booklist could not be updated. It may have been deleted, or a vendor may have already quoted it.');
  }

  // --- line items ---
  const live = items.filter(item => item.title.trim().length > 0);
  const {
    data: existing,
    error: existingError
  } = await supabase.from('book_request_items').select('id').eq('request_id', requestId);
  if (existingError) throw existingError;
  const keptIds = new Set(live.map(item => item.id).filter(Boolean));
  const removedIds = (existing ?? []).map(row => row.id).filter(id => !keptIds.has(id));
  if (removedIds.length) {
    const {
      error
    } = await supabase.from('book_request_items').delete().in('id', removedIds);
    if (error) throw error;
  }
  const updates = live.map((item, position) => ({
    item,
    position
  })).filter(({
    item
  }) => item.id !== null);
  for (const {
    item,
    position
  } of updates) {
    const {
      error
    } = await supabase.from('book_request_items').update({
      title: item.title.trim(),
      author: item.author.trim() || null,
      category: guessCategory(item.title),
      quantity: item.quantity,
      position,
      // A line a human has edited is no longer an unreviewed machine
      // guess, so it loses the "read from photo — check this line"
      // warning the card shows.
      parsed: false
    }).eq('id', item.id);
    if (error) throw error;
  }
  const inserts = live.map((item, position) => ({
    item,
    position
  })).filter(({
    item
  }) => item.id === null).map(({
    item,
    position
  }) => ({
    request_id: requestId,
    title: item.title.trim(),
    author: item.author.trim() || null,
    category: guessCategory(item.title),
    quantity: item.quantity,
    parsed: false,
    position
  }));
  if (inserts.length) {
    const {
      error
    } = await supabase.from('book_request_items').insert(inserts);
    if (error) throw error;
  }
  return {
    inserted: inserts.length,
    updated: updates.length,
    deleted: removedIds.length
  };
}

/**
 * Publishes a draft so vendors can quote it.
 *
 * Refuses an empty list. A request with no items reaches every vendor's
 * queue as a row with nothing to price, and the only thing they can do
 * with it is decline it — which costs the buyer a vendor.
 */
export async function publishBookRequest(requestId, dispatch = OPEN_MARKET) {
  const {
    count,
    error: countError
  } = await supabase.from('book_request_items').select('id', {
    count: 'exact',
    head: true
  }).eq('request_id', requestId);
  if (countError) throw countError;
  if (!count) {
    // A photo is a list. When the parser could not read one, the buyer
    // is told they may send the picture on its own — a shop opens the
    // request, reads it and quotes, which is what already happens over
    // WhatsApp. Refusing here would make that promise a lie. What is
    // still refused is a request with neither books nor a photo: there
    // would be nothing in it to quote.
    const {
      data: request,
      error: lookupError
    } = await supabase.from('book_requests').select('image_path').eq('id', requestId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!request?.image_path) {
      throw new Error('Add at least one book, or attach a photo of the list, before sending this to vendors.');
    }
  }
  const {
    data,
    error
  } = await supabase.from('book_requests').update({
    status: PUBLISHED_STATUS,
    ...dispatchColumns(dispatch)
  }).eq('id', requestId).select('id');
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
export async function routeBookRequest(requestId, dispatch) {
  const {
    data,
    error
  } = await supabase.from('book_requests').update({
    ...dispatchColumns(dispatch),
    updated_at: new Date().toISOString()
  }).eq('id', requestId).select('id');
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
export async function deleteBookRequest(requestId) {
  const {
    data,
    error
  } = await supabase.from('book_requests').delete().eq('id', requestId).select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('That booklist could not be deleted. Lists that a vendor has already quoted or that have been ordered are kept — cancel it instead.');
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
export function describeBooklistError(error) {
  const e = error;
  const message = e?.message ?? '';

  // 23514 = check_constraint_violation, 42703 = undefined_column,
  // PGRST204 = PostgREST cannot find the column in its schema cache.
  // All three mean the same thing here: a migration has not been run.
  const missingColumn = e?.code === '42703' || e?.code === 'PGRST204';
  if (/dispatch_type/i.test(message) || /dispatch_target_agree/i.test(message)) {
    if (missingColumn || e?.code === '23514') {
      return 'Sending to a specific shop is not enabled on this database yet. Run ' + 'bookshops_dispatch_routing.sql in the Supabase SQL editor.';
    }
  }
  if (e?.code === '23514' && /status/i.test(message)) {
    return 'Drafts are not enabled on this database yet. Run bookshops_booklist_drafts.sql ' + 'in the Supabase SQL editor — it adds "draft" to book_requests_status_check.';
  }
  return message || String(error);
}