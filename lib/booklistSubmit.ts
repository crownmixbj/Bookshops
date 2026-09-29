import { supabase } from '../utils/supabase';
import { DRAFT_STATUS, PUBLISHED_STATUS, assertCanRequestQuote } from './booklistUpload';
import { hasDelivery, saveRequestDelivery, type DeliveryChoice } from './requestDelivery';

/**
 * Writes a reviewed booklist: the request row, its lines, and where it
 * is to be delivered.
 *
 * Shared by the review modal (a signed-in buyer pressing send, or a guest
 * whose send resumes after signing in inside the sheet) and by
 * PendingBooklistResumer (a guest who had to leave the page to sign up),
 * so a booklist is written the same way whichever path it took.
 *
 * `publish` sets the status in the SAME insert rather than insert-then-
 * update: a second call that failed would leave the buyer looking at a
 * success message for a list no shop can see.
 */

export interface SubmitLine {
  title: string;
  author: string;
  quantity: number;
  category: string;
  /** True only for lines the photo parser produced. */
  parsed: boolean;
}

export interface SubmitBooklistInput {
  userId: string;
  school: string;
  classLevel: string;
  childId?: string | null;
  imagePath: string | null;
  lines: SubmitLine[];
  publish: boolean;
  delivery: DeliveryChoice;
}

export interface SubmitBooklistResult {
  requestId: string;
  itemCount: number;
  /** Non-empty when the list saved but its delivery address did not. */
  deliveryNote: string;
}

export async function submitBooklist(input: SubmitBooklistInput): Promise<SubmitBooklistResult> {
  // Sending counts toward the daily limit; saving a draft does not.
  if (input.publish) await assertCanRequestQuote();

  const { data: created, error: insertError } = await supabase
    .from('book_requests')
    .insert({
      buyer_id: input.userId,
      school_name: input.school.trim(),
      class_level: input.classLevel.trim(),
      image_path: input.imagePath,
      // Only sent when chosen, so a project that has not run
      // bookshops_buyer_portal.sql never sees an unknown column.
      ...(input.childId ? { child_id: input.childId } : {}),
      // The SINGULAR 'pending_quote' — see PUBLISHED_STATUS.
      status: input.publish ? PUBLISHED_STATUS : DRAFT_STATUS,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;
  const requestId = created.id as string;

  const rows = input.lines.map((line, i) => ({
    request_id: requestId,
    title: line.title.trim(),
    // Required for books; stationery and uniform lines legitimately store ''.
    author: line.author.trim(),
    category: line.category,
    quantity: line.quantity,
    parsed: line.parsed,
    position: i,
  }));

  // Photo-only: nothing to insert. An empty insert is a 400 in PostgREST.
  const { error: itemsError } = rows.length
    ? await supabase.from('book_request_items').insert(rows)
    : { error: null };

  if (itemsError) {
    // bookshops_booklist_author.sql may not have been run on this
    // project. Drop the author and retry rather than fail the list.
    const missingAuthor =
      /author/i.test(itemsError.message) &&
      /(column|schema cache|does not exist)/i.test(itemsError.message);
    if (!missingAuthor) throw itemsError;
    const { error: retryError } = await supabase
      .from('book_request_items')
      .insert(rows.map(({ author: _author, ...rest }) => rest));
    if (retryError) throw retryError;
  }

  // The destination. A failure here must not lose the list (it is saved),
  // so it is reported, not thrown.
  let deliveryNote = '';
  if (hasDelivery(input.delivery)) {
    try {
      await saveRequestDelivery(requestId, input.delivery);
    } catch (e) {
      console.warn('[booklist] delivery address not saved:', (e as Error).message);
      deliveryNote =
        ' Its delivery address could not be saved — your default address is used if you have one.';
    }
  }

  return { requestId, itemCount: rows.length, deliveryNote };
}
