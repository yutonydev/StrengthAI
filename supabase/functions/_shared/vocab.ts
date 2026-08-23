/**
 * The exercise vocabulary — the single copy, shared by the browser and the edge function.
 *
 * WHY THIS FILE LIVES HERE, under supabase/ rather than src/lib/:
 *
 * These lists have exactly two consumers and they run in different runtimes. The Deno edge
 * function can only import from inside `supabase/functions/`, so that is the only directory
 * both sides can physically reach — the client can import from anywhere, the function
 * cannot. `_shared/` is already the established home for that (see usage.ts). Vite compiles
 * the .ts on the way into the browser bundle; Deno reads it directly.
 *
 * This used to be two hand-maintained copies, one in src/lib/resolver.js and one inlined at
 * the top of resolve-exercise/index.ts. They had already drifted — 'back extension' was
 * listed twice on the client and once on the server — and nothing would have caught it.
 * Drift here is uniquely expensive: the whole point of a fixed vocabulary is that a lift
 * described two different ways six weeks apart lands on ONE trend line, and the server's
 * copy is what the model is actually shown. A term the client believes is canonical but the
 * server has never heard of is a trend line that silently forks.
 *
 * These are convergence aids given to the model, NOT whitelists. A movement missing from
 * VOCAB_BASES still resolves fine. Do not turn any of this into matching logic — see the
 * architecture note in src/lib/resolver.js for what that cost last time.
 */

/**
 * Canonical movement names. The model is told to reuse one of these when it fits and to
 * invent a new name only when nothing does.
 */
export const VOCAB_BASES = [
  // chest
  'bench press', 'incline press', 'decline press', 'chest press', 'chest fly', 'push-up', 'dip',
  // shoulders
  'overhead press', 'push press', 'arnold press', 'lateral raise', 'front raise',
  'upright row', 'rear delt fly', 'face pull',
  // back
  'lat pulldown', 'straight-arm pulldown', 'pull-up', 'row', 'pullover', 'shrug',
  'back extension', 'good morning',
  // arms
  'curl', 'reverse curl', 'preacher curl', 'wrist curl', 'tricep extension', 'pushdown',
  'tricep kickback', 'skull crusher', 'jm press',
  // legs
  'squat', 'leg press', 'hack squat', 'leg extension', 'romanian deadlift', 'stiff leg deadlift',
  'deadlift',
  'rack pull', 'hamstring curl', 'nordic curl', 'hip thrust', 'glute kickback',
  'hip abduction', 'hip adduction', 'lunge', 'split squat', 'step-up', 'calf raise',
  // core
  'crunch', 'leg raise', 'ab wheel', 'plank', 'pallof press', 'woodchop',
  // full body
  'clean', 'snatch', 'thruster', 'farmer carry', 'sled push', 'kettlebell swing',
];

/**
 * Canonical modifier strings, grouped by the dimension they vary. Grouping matters: the
 * model is told a variant may carry at most one modifier per group, which stops it
 * returning both "seated" and "standing", or both "rope" and "straight bar".
 */
export const VOCAB_MODS: Record<string, string[]> = {
  implement: ['barbell', 'dumbbell', 'cable', 'machine', 'smith machine', 'kettlebell',
    'plate loaded', 'bodyweight', 'band', 'landmine', 'trap bar', 'ez bar', 'safety bar'],
  attachment: ['rope', 'straight bar', 'v-bar', 'single handle', 'cuff', 'wide bar',
    'lat bar', 'stirrup'],
  grip: ['narrow grip', 'wide grip', 'neutral grip', 'supinated', 'pronated', 'mixed grip',
    'false grip', 'hook grip'],
  stance: ['feet up', 'heel elevated', 'toes elevated', 'sumo', 'conventional', 'staggered',
    'wide stance', 'narrow stance', 'b stance'],
  angle: ['seated', 'standing', 'lying', 'prone', 'incline', 'decline', 'chest supported',
    'bent over', 'kneeling', 'high to low', 'low to high', 'behind the neck', 'front rack',
    'zercher', 'overhead'],
  tempo: ['paused', 'slow eccentric', 'explosive', 'cluster', '1.5 rep'],
  rom: ['deficit', 'partial', 'lengthened partial', 'pin', 'block', 'floor', 'full rom'],
  load: ['banded', 'chains', 'accommodating resistance'],
  side: ['single arm', 'single leg', 'alternating'],
};

/**
 * Canonical muscle names. This is the vocabulary that makes cross-movement fatigue
 * detection possible — if the model calls it "tricep" one week and "triceps brachii" the
 * next, weekly volume per muscle becomes meaningless.
 */
export const MUSCLES = [
  'pectorals', 'upper chest',
  'lats', 'upper back', 'traps', 'lower back',
  'front delts', 'side delts', 'rear delts',
  'biceps', 'triceps', 'brachialis', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors',
  'abs', 'obliques',
];

/**
 * Broad grouping, for weekly training goals.
 *
 * Widened from the original chest/back/arms/legs. Shoulders were being filed under arms and
 * core had nowhere to go at all, which made per-muscle volume dishonest the moment anyone
 * trained delts directly.
 */
export const BODY_PARTS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];

/**
 * Joint actions. The third axis after muscle and modifier.
 *
 * Anatomical, not gym vernacular: "vertical push" is a trainer's category, whereas a
 * machine shoulder press is shoulder abduction plus elbow extension. The joint action is
 * what is objectively true about the movement, and it is what accumulates — elbow extension
 * fatigue builds across bench, dips and pushdowns regardless of what those lifts are called.
 *
 * A lift has as many actions as it has working joints, so this is an ARRAY per variant.
 * Isometric trunk demands (anti-extension on a plank) count; passive stabilising does not.
 */
export const JOINT_ACTIONS = [
  // glenohumeral
  'shoulder flexion', 'shoulder extension', 'shoulder abduction', 'shoulder adduction',
  'shoulder horizontal adduction', 'shoulder horizontal abduction',
  'shoulder internal rotation', 'shoulder external rotation',
  // scapular
  'scapular retraction', 'scapular protraction', 'scapular elevation', 'scapular depression',
  // elbow / wrist
  'elbow flexion', 'elbow extension', 'wrist flexion', 'wrist extension',
  // hip / knee / ankle
  'hip extension', 'hip flexion', 'hip abduction', 'hip adduction',
  'knee extension', 'knee flexion',
  'plantarflexion', 'dorsiflexion',
  // trunk
  'spinal flexion', 'spinal extension', 'spinal rotation', 'lateral flexion',
  'anti-extension', 'anti-rotation', 'anti-lateral-flexion',
];

/**
 * Lowercase, collapse whitespace, strip punctuation. The alias cache key.
 *
 * Shared for the same reason as the lists: the client sends this phrase and the server looks
 * it up. If the two normalizations ever disagreed, every lookup would miss and every repeat
 * of a phrase would be billed to the model again.
 *
 * Hyphens are kept deliberately — canonical names contain them (`push-up`,
 * `straight-arm pulldown`, `v-bar`) and the cache key has to be stable.
 */
export function normalizePhrase(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
