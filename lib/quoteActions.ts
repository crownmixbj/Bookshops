import { supabase } from '../utils/supabase';

/**
 * Buyer-side writes against a quote.
 *
 * There is exactly one, and it goes through an RPC rather than a table
 * write. A buyer has no UPDATE policy on `quotes` at all, deliberately:
 * a row-level policy cannot restrict which COLUMNS an update touches, so
 * any buyer permitted to set status='rejected' would equally be
 * permitted to set total_price=1 and then pay that. `buyer_decline_quote`
 * grants the one transition and nothing else.
 */

/**
 * Decline one shop's quote.
 *
 * `reason` is optional and is stored on the quote for the shop to read.
 * Passing an empty or whitespace-only string is the same as passing
 * null — the function trims and nullifies server-side too, so a reason
 * of "   " never reaches the vendor's screen as a blank quotation.
 *
 * Throws with a sentence fit to show the buyer. The RPC raises three
 * distinct conditions and each needs different words:
 *
 *   no_data_found            the quote is gone, or is not theirs
 *   insufficient_privilege   likewise — deliberately indistinguishable
 *   invalid_parameter_value  it is no longer 'sent'
 *
 * The last one is the common one and is not an error the buyer caused:
 * a shop can withdraw a quote while the buyer is looking at it.
 */
export async function declineQuote(quoteId: string, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('buyer_decline_quote', {
    p_quote_id: quoteId,
    p_reason: reason && reason.trim().length ? reason.trim() : null,
  });

  if (!error) return;

  // PostgREST surfaces a RAISE as the message, which these were written
  // to be readable as. The fallbacks below only matter when something
  // else fails — a dropped connection, or the migration not yet run.
  const message = error.message ?? '';

  if (/does not exist|could not find the function/i.test(message)) {
    throw new Error(
      'Declining is not available on this build yet — bookshops_buyer_decline_quote.sql has not been run.'
    );
  }
  if (/no longer be declined/i.test(message)) {
    throw new Error(message);
  }
  if (/no longer exists/i.test(message)) {
    throw new Error('That quote is no longer available.');
  }

  throw new Error(message || 'That quote could not be declined. Please try again.');
}
