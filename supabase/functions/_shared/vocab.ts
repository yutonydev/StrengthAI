// The exercise vocabulary, shared by the browser and the edge function. Lives here
// because a Deno function can only import from inside supabase/functions/. Two copies
// had already drifted. Convergence aids for the model, not whitelists.

// Reuse one of these when it fits; inventing a new name is fine when none does.
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

// At most one modifier per group, which stops "seated" and "standing" both coming back.
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

// Fixed names, or per-muscle volume across weeks becomes meaningless.
export const MUSCLES = [
  'pectorals', 'upper chest',
  'lats', 'upper back', 'traps', 'lower back',
  'front delts', 'side delts', 'rear delts',
  'biceps', 'triceps', 'brachialis', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors',
  'abs', 'obliques',
];

// Broad grouping for weekly training goals.
export const BODY_PARTS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];

// Anatomical, never trainer shorthand. An array per variant: elbow extension fatigue
// accumulates across bench, dips and pushdowns regardless of what they are called.
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

// The alias cache key. Shared so client and server normalize identically, or every
// lookup misses. Hyphens kept: canonical names contain them.
export function normalizePhrase(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
