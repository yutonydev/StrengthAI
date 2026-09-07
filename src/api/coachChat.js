// Chat coach orchestration. Computes the facts payload locally and sends it alongside the
// conversation; the model never queries the database, so its numbers stay checkable against
// the lifter's own Progress screen. Recomputed every turn — someone can log a set
// mid-conversation, and a stale payload is wrong in the most confusing way possible.
import {
  supabase,
  flags as flagsApi,
  goals as goalsApi,
  profile as profileApi,
  readiness as readinessApi,
  sessions as sessionsApi,
  sets as setsApi,
  variants as variantsApi,
} from './db';
import { buildCoachFacts } from '@/lib/coach';

/** Pulls the whole picture and reduces it to the facts payload. */
export async function loadCoachFacts() {
  const [profile, variants, sets, sessions, readiness, goals, excluded] = await Promise.all([
    profileApi.get(),
    variantsApi.list(),
    setsApi.all(),
    sessionsApi.list(),
    readinessApi.list(),
    goalsApi.list(),
    flagsApi.byStatus('excluded'),
  ]);

  return buildCoachFacts({
    variants,
    sets,
    sessions,
    readiness,
    goals,
    profile,
    excludedSessionIds: new Set(excluded.map((f) => f.session_id)),
  });
}

// One conversational turn. Returns { status: 'answered'|'capped'|'unavailable', text?,
// toolCall?: { name, input, result }, reason? }.
export async function askCoach(messages, facts) {
  try {
    const { data, error } = await supabase.functions.invoke('coach-chat', {
      body: { messages, facts },
    });

    if (error) throw error;

    if (data?.ok === false) {
      return {
        status: data.capped ? 'capped' : 'unavailable',
        reason: data.reason ?? 'I could not reach the coach just now.',
      };
    }

    return { status: 'answered', text: data.text ?? '', toolCall: data.toolCall ?? null };
  } catch (err) {
    // Loud in the console, soft in the UI — same reasoning as the resolver. The difference
    // is that a failed chat turn costs the lifter nothing but a retry, so there is no
    // fallback path to build here.
    console.error('[askCoach] failed', err);
    return { status: 'unavailable', reason: 'I could not reach the coach just now.' };
  }
}
