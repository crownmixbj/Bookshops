import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Two clients, and the difference matters.
 *
 * `userClient` carries the caller's JWT, so RLS applies and auth.uid()
 * is them. It is used for one thing only: proving who is calling.
 *
 * `serviceClient` bypasses RLS entirely. It is what calls the money
 * functions, because those must run as an authority the buyer does not
 * have — accepting a quote the buyer cannot update, writing an amount
 * the buyer cannot choose.
 */

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** The signed-in user behind this request, or null. */
export async function callerId(req: Request): Promise<string | null> {
  const authorization = req.headers.get('Authorization');
  if (!authorization) return null;

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}
