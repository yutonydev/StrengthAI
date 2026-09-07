import { createClient } from 'jsr:@supabase/supabase-js@2';

// CORS, JSON replies and the user gate, shared by both edge functions.

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

// Uses the ANON key with the caller's header — this call establishes who is asking, so
// it must run with their credentials, not the service role.
export async function userIdFrom(authHeader: string): Promise<string | null> {
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data } = await anon.auth.getUser();
  return data?.user?.id ?? null;
}
