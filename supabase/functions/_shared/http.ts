import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Request plumbing shared by the edge functions: CORS, JSON replies, and the user gate.
 *
 * Both functions had their own verbatim copy of all three. That is harmless right up until
 * one of them is edited — a CORS header added to one function and not the other is a bug
 * that only appears in the browser, only in production, and only for whichever call the
 * lifter happened to make first.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** A JSON response carrying the CORS headers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** The preflight reply, or null when this is not a preflight. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null;
}

/**
 * The caller's user id from their JWT, or null.
 *
 * Builds its own client rather than taking `createClient` as a parameter. Injecting it meant
 * hand-writing a type for it here, and a hand-written signature that merely *looks* right is
 * the worst option for the one call that decides whether a request is authenticated at all:
 * the real third parameter is SupabaseClientOptions, and parameters are contravariant, so
 * declaring it `unknown` is a type error Deno would only surface at deploy.
 *
 * Uses the ANON key with the caller's Authorization header, never the service-role key —
 * this call is what establishes *who* is asking, so it has to run with their own
 * credentials. The service-role client is created separately, afterwards, only for the work
 * that legitimately crosses RLS (the shared alias cache, the usage counters).
 */
export async function userIdFrom(authHeader: string): Promise<string | null> {
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data } = await anon.auth.getUser();
  return data?.user?.id ?? null;
}
