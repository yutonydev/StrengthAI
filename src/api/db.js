/**
 * Supabase data layer — everything that touches the database lives here.
 *
 * Screens call these functions and never see Supabase directly, so swapping the
 * backend later means rewriting one file. That is exactly the mistake the Base44
 * version made in reverse: its SDK calls were sprinkled through every page.
 */
import { createClient } from '@supabase/supabase-js';
import { clearCache, invalidate, qk } from './queryCache';
import { clearLocalState } from '@/lib/localState';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

/**
 * Run a write, then refresh the cached reads it invalidates.
 *
 * Invalidation lives here rather than at the call sites on purpose. This is the only
 * file that touches the database, so it is the only place where "what this write
 * changes" is knowable without being remembered — a new screen calling sets.log() gets
 * correct cache behaviour without knowing the cache exists. Refresh happens at the
 * moment of the write, so by the time you reach Progress the data is already fresh.
 */
const touches = (keys, run) => async (...args) => {
  const result = await run(...args);
  invalidate(...keys);
  return result;
};

/** Current user id, or throws — every write needs it, RLS enforces it anyway. */
async function uid() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error('Not signed in');
  return data.user.id;
}

const ok = ({ data, error }) => {
  // never swallow errors silently — that was issue #3 in the backend review
  if (error) throw new Error(error.message);
  return data;
};

/* ------------------------------------------------------------------ auth */

export const auth = {
  signUp: (email, password) => supabase.auth.signUp({ email, password }).then(ok),
  signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }).then(ok),
  // Cache is per-user data held in module scope, so it has to go on the way out —
  // otherwise the next account to sign in on this device renders the previous one's
  // sessions and sets for a moment before its own reads land.
  //
  // localStorage goes with it, and matters more: module scope dies on reload, a stored
  // chat thread does not. See lib/localState.js for what is held there.
  signOut: async () => {
    const result = await supabase.auth.signOut();
    clearCache();
    clearLocalState();
    return result;
  },
  resetPassword: (email) =>
    supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset` }).then(ok),
  updatePassword: (password) => supabase.auth.updateUser({ password }).then(ok),
  onChange: (fn) => supabase.auth.onAuthStateChange((_e, session) => fn(session)),
  session: () => supabase.auth.getSession().then(({ data }) => data.session),
};

export const profile = {
  get: async () => supabase.from('profiles').select('*').eq('id', await uid()).single().then(ok),
  update: touches([qk.profile], async (patch) =>
    supabase.from('profiles').update(patch).eq('id', await uid()).select().single().then(ok)),
};

/* -------------------------------------------------------------- variants */

export const variants = {
  list: async () =>
    supabase.from('exercise_variants').select('*').eq('user_id', await uid())
      .order('uses', { ascending: false }).then(ok),

  /**
   * Create or return the existing variant. `mods` is sorted so the unique index
   * does the deduping — two clients racing on the same description cannot fork
   * the trend line.
   */
  ensure: async ({
    base, mods = [], muscle, muscles, joint_actions, body_part, source_text,
    resolved_by, load_note, confidence,
  }) => {
    const row = {
      user_id: await uid(),
      base,
      mods: [...mods].sort(),
      muscle,
      body_part,
      source_text,
      // Provenance (migration 002). Only sent when known — an upsert that omits a column
      // leaves it alone, so re-logging a variant the model already explained can't wipe
      // the loading note it wrote the first time round.
      ...(resolved_by ? { resolved_by } : {}),
      ...(load_note ? { load_note } : {}),
      ...(confidence ? { confidence } : {}),
      // Muscles (migration 004) — what makes cross-movement fatigue detection possible.
      // Omitted rather than sent empty when unknown, for the same reason as above: an
      // unresolved re-log must not erase muscles a previous resolve established.
      ...(muscles?.length ? { muscles } : {}),
      // Joint actions (migration 007). Omitted when empty for the same reason as muscles: an
      // unresolved re-log, or a variant added before the backfill ran, must not overwrite
      // actions that are already there.
      ...(joint_actions?.length ? { joint_actions } : {}),
    };
    const saved = await supabase.from('exercise_variants')
      .upsert(row, { onConflict: 'user_id,base,mods' })
      .select().single().then(ok);
    invalidate(qk.variants);
    return saved;
  },

  bumpUse: touches([qk.variants], async (id) => supabase.rpc('increment_variant_use', { variant: id })),
};

/* -------------------------------------------------------------- sessions */

export const sessions = {
  list: async (limit = 200) =>
    supabase.from('workout_sessions').select('*').eq('user_id', await uid())
      .order('started_at', { ascending: false }).limit(limit).then(ok),

  active: async () =>
    supabase.from('workout_sessions').select('*').eq('user_id', await uid())
      .eq('status', 'active').order('started_at', { ascending: false })
      .limit(1).maybeSingle().then(ok),

  get: (id) => supabase.from('workout_sessions').select('*').eq('id', id).single().then(ok),

  start: touches([qk.sessions, qk.activeSession], async ({ name = null, template_id = null, exercise_order = [] } = {}) =>
    supabase.from('workout_sessions')
      .insert({ user_id: await uid(), name, template_id, exercise_order, status: 'active' })
      .select().single().then(ok)),

  update: touches([qk.sessions, qk.activeSession], (id, patch) =>
    supabase.from('workout_sessions').update(patch).eq('id', id).select().single().then(ok)),

  finish: touches([qk.sessions, qk.activeSession, qk.sets], (id) =>
    supabase.from('workout_sessions')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', id).select().single().then(ok)),

  // cascade deletes handle sets, readiness and flags
  remove: touches([qk.sessions, qk.activeSession, qk.sets, qk.readiness, qk.excludedFlags], (id) =>
    supabase.from('workout_sessions').delete().eq('id', id).then(ok)),
};

/* ------------------------------------------------------------------ sets */

export const sets = {
  /** Every set for the user. Fine at personal scale; see the note at the bottom. */
  all: async (limit = 5000) =>
    supabase.from('workout_sets').select('*').eq('user_id', await uid())
      .order('logged_at', { ascending: true }).limit(limit).then(ok),

  forSession: (session_id) =>
    supabase.from('workout_sets').select('*').eq('session_id', session_id)
      .order('logged_at', { ascending: true }).then(ok),

  forVariant: async (variant_id, limit = 500) =>
    supabase.from('workout_sets').select('*').eq('user_id', await uid())
      .eq('variant_id', variant_id).order('logged_at', { ascending: true })
      .limit(limit).then(ok),

  log: touches([qk.sets], async (row) =>
    supabase.from('workout_sets').insert({ ...row, user_id: await uid() }).select().single().then(ok)),

  remove: touches([qk.sets], (id) => supabase.from('workout_sets').delete().eq('id', id).then(ok)),
};

/* ------------------------------------------------------------- readiness */

export const readiness = {
  list: async (limit = 200) =>
    supabase.from('readiness_entries').select('*').eq('user_id', await uid())
      .order('created_at', { ascending: true }).limit(limit).then(ok),

  forSession: (session_id) =>
    supabase.from('readiness_entries').select('*').eq('session_id', session_id).maybeSingle().then(ok),

  create: touches([qk.readiness], async (row) =>
    supabase.from('readiness_entries').insert({ ...row, user_id: await uid() }).select().single().then(ok)),
};

/* ----------------------------------------------------------------- flags */

export const flags = {
  byStatus: async (status) =>
    supabase.from('pattern_flags').select('*').eq('user_id', await uid())
      .eq('status', status).order('created_at', { ascending: false }).then(ok),

  create: touches([qk.excludedFlags], async (row) =>
    supabase.from('pattern_flags').insert({ ...row, user_id: await uid() }).select().single().then(ok)),

  update: touches([qk.excludedFlags], (id, patch) =>
    supabase.from('pattern_flags').update(patch).eq('id', id).select().single().then(ok)),
};

/* ------------------------------------------------------------- templates */

export const templates = {
  list: async () =>
    supabase.from('workout_templates').select('*').eq('user_id', await uid())
      .order('created_at', { ascending: false }).then(ok),
  create: touches([qk.templates], async (row = {}) =>
    supabase.from('workout_templates').insert({ ...row, user_id: await uid() }).select().single().then(ok)),
  update: touches([qk.templates], (id, patch) =>
    supabase.from('workout_templates').update(patch).eq('id', id).select().single().then(ok)),
  remove: touches([qk.templates], (id) => supabase.from('workout_templates').delete().eq('id', id).then(ok)),
};

/* ----------------------------------------------------------------- goals */

export const goals = {
  list: async () =>
    supabase.from('strength_goals').select('*, exercise_variants(*)').eq('user_id', await uid())
      .neq('status', 'archived').then(ok),
  create: async (row) =>
    supabase.from('strength_goals').insert({ ...row, user_id: await uid() }).select().single().then(ok),
  update: (id, patch) =>
    supabase.from('strength_goals').update(patch).eq('id', id).select().single().then(ok),
  remove: (id) => supabase.from('strength_goals').delete().eq('id', id).then(ok),
};

export const muscleGoals = {
  list: async () => supabase.from('muscle_goals').select('*').eq('user_id', await uid()).then(ok),
  set: touches([qk.muscleGoals], async (body_part, weekly_target) =>
    supabase.from('muscle_goals')
      .upsert({ user_id: await uid(), body_part, weekly_target }, { onConflict: 'user_id,body_part' })
      .select().single().then(ok)),
};

/* ------------------------------------------------------------- coach out */

export const plans = {
  list: async () =>
    supabase.from('coach_plans').select('*').eq('user_id', await uid()).is('consumed_at', null).then(ok),
  create: async (row) =>
    supabase.from('coach_plans')
      .upsert({ ...row, user_id: await uid() }, { onConflict: 'user_id,variant_id' })
      .select().single().then(ok),
  consume: (id) =>
    supabase.from('coach_plans').update({ consumed_at: new Date().toISOString() }).eq('id', id).then(ok),
  remove: (id) => supabase.from('coach_plans').delete().eq('id', id).then(ok),
};

export const recommendations = {
  open: async () =>
    supabase.from('coach_recommendations').select('*').eq('user_id', await uid())
      .eq('status', 'open').order('created_at', { ascending: false }).then(ok),
  // regardless of status — used for dedup-checking against past (dismissed/accepted)
  // recommendations, not just what's currently shown
  all: async () =>
    supabase.from('coach_recommendations').select('*').eq('user_id', await uid())
      .order('created_at', { ascending: false }).then(ok),
  create: async (row) =>
    supabase.from('coach_recommendations').insert({ ...row, user_id: await uid() }).select().single().then(ok),
  update: (id, patch) =>
    supabase.from('coach_recommendations').update(patch).eq('id', id).select().single().then(ok),
};

export const reports = {
  list: async (limit = 12) =>
    supabase.from('weekly_reports').select('*').eq('user_id', await uid())
      .order('week_start', { ascending: false }).limit(limit).then(ok),
  upsert: async (row) =>
    supabase.from('weekly_reports')
      .upsert({ ...row, user_id: await uid() }, { onConflict: 'user_id,week_start' })
      .select().single().then(ok),
};

/*
 * Scale note (issue #1 from the backend review):
 * `sets.all()` pulls the whole history to compute trends client-side. That is correct
 * and fast for one lifter with a few thousand sets. When it stops being fast, the fix
 * is a `variant_stats` table updated by a trigger on insert — rolling RIR, best e1RM,
 * last load per variant — so the client reads a summary row instead of recomputing
 * from scratch. Don't build that until it hurts.
 */
