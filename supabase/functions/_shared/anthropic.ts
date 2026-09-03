/**
 * The headers every call to the Anthropic API needs, in one place.
 *
 * WHY THIS EXISTS — it is not just deduplication.
 *
 * Anthropic issues two kinds of API key, and they do not behave the same way:
 *
 *   - A WORKSPACE-SCOPED key already knows which workspace it acts in. Three headers and
 *     you are done, which is what this app assumed for its whole life.
 *
 *   - An IDENTITY-LINKED key is tied to a person rather than a workspace, so the API cannot
 *     infer where the request belongs. It refuses with a 400 until you name the workspace in
 *     an `anthropic-workspace-id` header.
 *
 * Rotating a key silently changed which kind was in use, and every model call started
 * failing with:
 *
 *     anthropic error 400 — "anthropic-workspace-id is required when authenticating with
 *     an identity-linked API key; send the id of the workspace this request acts in."
 *
 * Because both functions fail soft — a lifter mid-workout gets "I could not reach the coach
 * just now" and their set still saves — that 400 was indistinguishable from bad wifi from
 * inside the app, and only the edge-function logs told the truth. Exactly the shape of the
 * retired-model outage described in resolve-exercise/index.ts.
 *
 * So the header is OPTIONAL here rather than required. Set `ANTHROPIC_WORKSPACE_ID` and it
 * is sent; leave it unset and it is omitted. That makes the code correct for both kinds of
 * key, which means swapping keys can never reintroduce this — and nothing has to be
 * redeployed to switch between them.
 *
 * `workspaceId` is a parameter rather than a `Deno.env` read inside this function so the
 * logic stays pure and testable under vitest, which has no `Deno` global. Same reasoning as
 * `capFromEnv` in usage.ts.
 */
export function anthropicHeaders(
  apiKey: string,
  workspaceId?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey ?? '',
    'anthropic-version': '2023-06-01',
  };

  // Trimmed, and an empty or whitespace-only value counts as unset. A secret that was
  // cleared, or saved with a stray newline from a copy-paste, must not turn into a header
  // containing nothing — that is a 400 with a more confusing message than sending no header
  // at all.
  const ws = String(workspaceId ?? '').trim();
  if (ws) headers['anthropic-workspace-id'] = ws;

  return headers;
}
