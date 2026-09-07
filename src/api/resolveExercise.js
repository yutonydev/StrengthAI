// Client-side resolver orchestration. Three gates, cheapest first: findLocal (this lifter
// typed the phrase before — instant, offline, free), the junk filter, then the edge
// function (shared cache, then the model). Nothing here decides what an exercise IS.
import { supabase } from './db';
import { findLocal, isPlausibleExercise, normalizePhrase } from '@/lib/resolver';

// Returns { status, base?, mods?, muscles?, body_part?, note?, confidence?, source?,
// variant?, reason?, raw }. `rejected` is the only status that blocks logging;
// `unresolved` (no model, or capped) never does — it saves as typed and can be re-resolved,
// because a workout must be loggable offline and out of credit.
export async function resolveExercise(text, variants = []) {
  const raw = String(text || '').trim();
  const phrase = normalizePhrase(raw);

  // ---- gate 1: their own history --------------------------------------------------
  const local = findLocal(raw, variants);
  if (local) {
    return {
      status: 'known',
      variant: local,
      base: local.base,
      mods: local.mods ?? [],
      muscles: local.muscles ?? [],
      muscle: local.muscle,
      joint_actions: local.joint_actions ?? [],
      body_part: local.body_part,
      // `load_note`, not `note` — that is the column on exercise_variants. Reading the wrong
      // name made this always '', so pressing Enter on a phrase already in the registry
      // replaced the local match (which reads it correctly) with one that had silently
      // dropped the loading note, and the "Why the load will differ" panel vanished.
      note: local.load_note ?? '',
      confidence: 'high',
      source: 'local',
      raw,
    };
  }

  // ---- gate 2: junk ---------------------------------------------------------------
  const plausible = isPlausibleExercise(phrase);
  if (!plausible.ok) {
    return { status: 'rejected', reason: plausible.reason, source: 'local', raw };
  }

  // ---- gate 3: cache, then the model ----------------------------------------------
  try {
    // Send the most-used slice of their registry so the model reuses their existing tags
    // rather than inventing a parallel name for a lift they already train. Capped at 40 to
    // keep the prompt — and the per-call cost — bounded.
    const registry = [...variants]
      .sort((a, b) => (b.uses || 0) - (a.uses || 0))
      .slice(0, 40)
      .map((v) => ({ base: v.base, mods: v.mods ?? [] }));

    const { data, error } = await supabase.functions.invoke('resolve-exercise', {
      body: { text: phrase, registry },
    });

    if (error) throw error;

    if (data?.ok === false) {
      // Rejected is a judgment; capped and unavailable are failures. Only the first blocks.
      if (data.rejected) {
        return { status: 'rejected', reason: data.reason, source: 'ai', raw };
      }
      return {
        status: 'unresolved',
        reason: data.reason ?? 'I could not reach the coach just now.',
        capped: !!data.capped,
        raw,
      };
    }

    return {
      status: 'resolved',
      base: data.base,
      mods: data.mods ?? [],
      muscles: data.muscles ?? [],
      muscle: data.muscle,
      joint_actions: data.joint_actions ?? [],
      body_part: data.body_part,
      note: data.note ?? '',
      confidence: data.confidence ?? 'high',
      source: data.source ?? 'ai',
      raw,
    };
  } catch (err) {
    // Loud in the console, soft in the UI. Offline is not an error the lifter caused, and
    // they are standing at a rack — never block the log.
    console.error('[resolveExercise] failed', err);
    return {
      status: 'unresolved',
      reason: 'I could not reach the coach just now — logging it as you typed it.',
      raw,
    };
  }
}
