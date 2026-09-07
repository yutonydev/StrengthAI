// Anthropic headers. The workspace header is OPTIONAL: an identity-linked key is
// refused with a 400 without it, a workspace-scoped key must not receive it. Set
// ANTHROPIC_WORKSPACE_ID and it is sent. workspaceId is a parameter, not a Deno.env
// read, so this stays testable under vitest.
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
