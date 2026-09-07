/**
 * Read a photographed school booklist into structured lines.
 *
 * Deploy with JWT verification ON.
 *
 *   POST { imagePath }  ->  { school_name, class_level, items: [...] }
 *
 * Why this lives server-side and not in the app:
 *   - the model API key stays here. A key inlined into an Expo bundle
 *     is a published key.
 *   - the `booklists` bucket is private, and only the service role can
 *     sign an object without being its owner.
 *   - one place to rate limit, so a stuck retry loop cannot run up a
 *     vision bill.
 *
 * It returns lines; it never writes any. The buyer confirms every title
 * in the review modal before a single row reaches book_request_items.
 *
 * Env: OPENAI_API_KEY, and optionally BOOKLIST_VISION_MODEL
 * (default gpt-4o-mini).
 *
 *   supabase secrets set OPENAI_API_KEY=sk-...
 *   supabase functions deploy parse-booklist
 */
import { fail, json, preflight } from '../_shared/http.ts';
import { callerId, serviceClient } from '../_shared/supabase.ts';

const BUCKET = 'booklists';
const MODEL = Deno.env.get('BOOKLIST_VISION_MODEL') ?? 'gpt-4o-mini';
const SIGNED_URL_TTL = 120;

/**
 * Written against how Nigerian school booklists actually print.
 *
 * They number their lines, wrap a long title across two rows, group by
 * subject or by GROUP/PROSE/DRAMA headings, and put the author in its
 * own column. The instruction that matters most is the last one:
 * inventing a plausible textbook is far worse than leaving a field
 * empty, because a title nobody asked for still gets quoted and paid
 * for.
 */
const SYSTEM_PROMPT = `You read photographs of school booklists from Nigerian schools and return JSON.

Return STRICT JSON only. No prose, no markdown, no code fences.

Shape:
{"school_name": string, "class_level": string, "items": [{"title": string, "author": string, "quantity": number}]}

Rules:
- One entry per book or item the list asks the parent to buy.
- Rejoin titles wrapped across two lines into one title.
- Strip leading numbering ("1.", "i)", "-") from titles.
- Column headings (GROUP, BOOK TITLE, AUTHOR, PUBLISHER, YEAR) and section
  headings (POETRY, PROSE, DRAMA, ENGLISH STUDIES) are NOT items. Do not
  emit them. Use them only as context.
- author: the author column if there is one, else "". A publisher is not
  an author; if only a publisher is given, leave author "".
- quantity: the number of copies requested; 1 when unstated.
- school_name / class_level: "" when the photo does not clearly say.
- If the photo is unreadable, or is not a booklist, return
  {"school_name":"","class_level":"","items":[]}.
- NEVER invent a title, an author or a school. An empty field is correct;
  a guessed one is a book the parent will be charged for.`;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const userId = await callerId(req);
    if (!userId) return fail('Sign in to read a booklist photo.', 401);

    const body = await req.json().catch(() => null);
    const imagePath = String(body?.imagePath ?? '').trim();
    if (!imagePath) return fail('imagePath is required.');

    // Ownership, enforced here because the service role below ignores
    // RLS. Object paths are `<uid>/<key>.<ext>` — the same shape
    // booklists_insert_own_folder enforces on write. Without this check
    // any signed-in user could read any other buyer's booklist photo.
    const [owner, ...rest] = imagePath.split('/');
    if (owner !== userId || rest.length === 0 || imagePath.includes('..')) {
      return fail('That photo does not belong to you.', 403);
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      // 501, not 500: nothing is broken, the parser simply is not
      // configured. The app degrades to "type your books" either way.
      return fail('The booklist parser is not configured on this project.', 501);
    }

    const admin = serviceClient();
    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(imagePath, SIGNED_URL_TTL);

    if (signError || !signed?.signedUrl) {
      return fail('That photo could not be opened.', 404);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        // Forces syntactically valid JSON, which removes a whole class
        // of "the model wrapped it in ```json" parse failures.
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this booklist and return the JSON.' },
              { type: 'image_url', image_url: { url: signed.signedUrl, detail: 'high' } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[parse-booklist] vision call failed', response.status, detail.slice(0, 500));
      return fail('The reading service is unavailable right now.', 502);
    }

    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return fail('The reading service returned nothing usable.', 502);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error('[parse-booklist] non-JSON content:', content.slice(0, 500));
      return fail('The reading service returned nothing usable.', 502);
    }

    // Returned as-is. normaliseParseResponse on the client is what
    // coerces and validates it, so both sides stay defensive and there
    // is exactly one place that decides what a line looks like.
    return json(parsed);
  } catch (e) {
    console.error('[parse-booklist] unhandled', e);
    return fail('That photo could not be read.', 500);
  }
});
