/**
 * CORS and response helpers.
 *
 * The web build calls these functions from the browser, so a preflight
 * has to be answered or every request fails before it is made.
 */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Errors are returned with a message the screen can show. They are
 * deliberately about the request, never about the database — a
 * Postgres error string is a map of your schema.
 */
export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null;
}
