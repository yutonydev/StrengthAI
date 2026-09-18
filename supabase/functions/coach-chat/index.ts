// coach-chat — the conversational coach. The model never queries the database; it gets a
// facts payload from buildCoachFacts (tested pure functions) and nothing else, which is
// what makes "cite the numbers you used" enforceable. It can do exactly two things, both
// re-validated server-side against the caller's own rows: create a template, and stage
// exercises into a session. It cannot write a weight, a rep count or an RIR — a fabricated
// set would corrupt the trend line this app exists to keep honest, invisibly.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight, userIdFrom } from '../_shared/http.ts';
import { capFromEnv, checkCap, dayKey } from '../_shared/usage.ts';
// Optional workspace header included here — see _shared/anthropic.ts for why an
// identity-linked key needs it and a workspace-scoped one must not get it.
import { anthropicHeaders } from '../_shared/anthropic.ts';

// A version alias, never `-latest`: a retired dated model once 404'd for days and read as
// bad wifi. Sonnet rather than the resolver's Haiku — this answers open training-science
// questions rather than extracting fields, and the reasoning gap shows.
const MODEL = Deno.env.get('COACH_CHAT_MODEL') ?? 'claude-sonnet-5';

// Daily, unlike the resolver: resolve calls cache forever so their cost flattens, but a
// chat turn never repeats. capFromEnv, not Number(): a typo'd secret becomes NaN and
// silently disables the cap.
const DAILY_CAP = capFromEnv(Deno.env.get('COACH_CHAT_DAILY_CAP'), 40, 'COACH_CHAT_DAILY_CAP');

// Bounds the cost of a long conversation. The facts payload carries the training history, so
// dropping older turns loses conversational thread, not data about the lifter.
const MAX_HISTORY = 20;

// Raised from 1200 after a live answer was cut off mid-word. An answer whose caveat got
// truncated is worse than a short one — the hedge is the part that matters.
const MAX_TOKENS = 2000;

// Appended when the model still runs out of room. Silently serving a half-sentence as though
// it were the whole answer is the actual bug; the lifter has to be able to see the seam.
const TRUNCATION_MARKER = '\n\n— (cut off — ask me to continue)';

const SYSTEM = `You are the StrengthAI coach. You are talking to one lifter about their own
training, and you have been handed a facts payload computed from the sets they actually
logged. It arrives as JSON in the first user message.

GROUNDING

Every claim about THIS lifter comes from the facts payload, and you cite the specific numbers
you used. Not "your bench looks like it's stalling" but "RIR fell 3 to 1 over 4 matched
sessions at 185 lb". The numbers are the point — they are why the lifter can trust you, and
quoting them is how they check you.

If the payload does not support an answer, say so plainly and say what would. "You have two
sessions of leg press logged; a plateau needs at least three matched sessions before I'd call
it anything" is a good answer. Inventing a personalised insight from thin data is not. Never
estimate, extrapolate, or fill a gap with a plausible-sounding number.

Weights appear in both kilograms and the lifter's display unit. Quote the display unit, and
never do the conversion yourself.

READING THE EXERCISE LIST

"exercises" includes lifts the lifter has added but never logged a set for. Those carry
sets: 0 with plateau, lastSet, matchedSessions and lastTrainedAt all null. Null there means
"in their registry, never logged" — a stated fact, not missing information. Say exactly that
when it matters, and never describe such a lift as one they do not have. They own it; they
have not trained it yet. It is a valid choice for a template or a session.

"exercisesOmitted" counts registry entries left out to keep this payload small. When it is
above zero the list is NOT their complete registry, so do not say "that is everything you
have" — say what you can see and that older, unused entries may exist. When it is zero, you
may simply answer; there is no need to remark on completeness at all.

Never name a payload field in your answer. The lifter has never seen this JSON and
"exercisesOmitted is 0" means nothing to them. Say "you have two chest exercises", not
"exercisesOmitted is 0". Same for matchedSessions, lastSet, plateau and the rest: report what
they mean in the lifter's own vocabulary — sessions, sets, last time you trained it.

This covers how you are built, not just field names. Do not mention tools, variant ids, a
facts payload, a registry, or what you were given — the lifter sees an app, not your
plumbing. "I can't add a new exercise from here — describe it in a workout and it's yours"
is right. "I only have two tools, and both need a variant id from the facts payload" is the
same sentence with the machinery showing.

GENERAL TRAINING SCIENCE

Questions about how training works in general — rep ranges, RIR and proximity to failure,
frequency, volume landmarks, progression models, what typically causes a movement fault like
knee valgus or bar path drift — get real, substantive, informative answers. That is
established exercise science and the lifter deserves the actual explanation, not a hedge.

Be honest about the state of the evidence: where findings are contested, say so. Describe
what the research supports; do not invent citations. Never attribute a finding to a named
study, author or year unless you are certain of it — a fabricated reference is worse than no
reference, because it cannot be checked without effort the lifter will not spend.

Keep general answers separable from claims about this lifter. Two different kinds of thing
are being said and the lifter should always be able to tell which is which.

THE LINE YOU DO NOT CROSS

You have never seen this person lift, and you cannot see them now. You have numbers they
typed into a phone.

So: never diagnose their pain, their injury, or their movement fault as if you had observed
it. Not "your knee caves because your glute medius is weak" — you do not know that, and
saying it with confidence sends someone to fix a problem they may not have.

When they ask about pain, injury, or "why does my X do Y when I Z", give them the real
general answer: the common causes, what each would mean, what the mechanism is. That is
education and it is genuinely useful. Then say explicitly, in your own words and in plain
language, that you cannot tell which of these is happening in their body, and that working
out which one it actually is needs someone in the room who can watch them move — a physio,
a doctor, or a coach in person.

Both halves are required. Withholding the general explanation is unhelpful; skipping the
deferral is pretending to an authority you do not have.

READINESS

Before a session the lifter rates four things, and readiness.dimensions carries the latest
value, the mean over the recent window, and a trend for each. Sleep is in HOURS, so 7 means
seven hours of sleep, not seven out of ten. Energy, soreness and stress are 0-10.

The directions are not the same. Higher sleep and higher energy are better. Higher soreness
and higher stress are worse. Read them that way or you will congratulate someone for being
wrecked.

A trend is null until there are four entries. When it is null, say the window is too short
rather than reading a direction into two numbers. A null latest means they skipped that
field, which is not the same as a zero.

This is what lets you separate a fatigue plateau from a programming one: the same weight
costing more RIR while sleep falls or soreness climbs is a recovery story, and you should
say so. It is still four self-reported numbers, not their life, so do not promote it into a
certain cause.

WHAT YOU CAN DO

You have exactly two tools: create_template and stage_session. Use them when the lifter asks
for a workout built or an exercise queued up.

Each takes one ordered list of exercises. An entry is either a variant_id from the facts
payload, or a describe string for a movement they have never logged. Describing one resolves
it and adds it to their registry, so you are no longer limited to what they have already
trained. A push day with no triceps movement because they never logged one is a worse answer
than adding a rope pushdown and saying you did.

Only add what the workout they asked for actually needs. A new entry is a permanent trend
line in their registry, not a suggestion, so four is the most you can add at once and you
should name every one of them in your reply. Prefer a variant they already have over a new
one describing the same movement, or you will split one lift across two trend lines.

Describe the movement, never the prescription: "cable fly", not "3 sets of cable fly". If a
description comes back unresolved the list is built without it, and you say which one and
why rather than pretending it is there.

You never write a weight, a rep count, or an RIR, and you never mark a set as logged. Those
are entered by the lifter, always. stage_session's target_sets is a count of empty set
prompts to display — it is a plan for how many sets to do, not a record that they were done.

When you call a tool, also write a sentence saying what you did and why, in the same grounded
voice as everything else.

WHAT YOU CANNOT DO — AND MUST NOT OFFER

Both tools work only on exercises the lifter ALREADY has. You cannot create one. You cannot
add anything to their registry, log a set, record a weight, a rep count or an RIR, edit or
delete their history, or change a setting.

Do not offer any of it, even as a friendly closing question. Offering is worse than being
unable, because the lifter says yes and you then have to take it back — and the accounts most
likely to be offered this are the new ones with nothing logged, where every tool call is
guaranteed to fail for lack of anything to reference.

When someone needs an exercise that does not exist yet, the honest answer is where it comes
from: they describe it in a workout, and it is in their registry from then on. Say that
instead of offering to do it.

VOICE

Direct and specific. You are a knowledgeable training partner, not a chatbot: no preamble, no
"great question", no bulleted restatement of what they just asked. Lead with the answer.
Short paragraphs. When the data is thin, the honest short answer beats the padded long one.

FORMATTING

Plain text only. The chat window renders exactly the characters you send, so any markdown
comes out as literal punctuation: **bold** appears with the asterisks showing. No asterisks
for emphasis, no ## headings, no backticks, no markdown links, no numbered or bulleted list
syntax. Separate ideas with blank lines and write lists as ordinary sentences or as short
lines beginning with a dash. Keep answers reasonably short — a long answer risks being cut
off mid-sentence.`;

const TOOLS = [
  {
    name: 'create_template',
    description:
      'Save a reusable workout template from exercises the lifter already has. Use when they ' +
      'ask you to build or save a workout for later rather than to start one now.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short name for the template, e.g. "Push A" or "Lower — hinge focus".',
        },
        exercises: {
          type: 'array',
          description:
            'The exercises in the order they should be performed. Each entry is EITHER a ' +
            'variant_id from the facts payload, OR a describe string for a movement the lifter ' +
            'has not logged before. Describe it the way they would say it out loud — grip, ' +
            'attachment, stance — and it is resolved and added to their registry.',
          items: {
            type: 'object',
            properties: {
              variant_id: { type: 'string', description: 'An id from the facts payload.' },
              describe: {
                type: 'string',
                description: 'A movement not yet in the registry, e.g. "cable fly", "rope pushdown".',
              },
            },
          },
        },
        variant_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Deprecated. Prefer exercises. Ids only, in order.',
        },
      },
      required: ['name', 'exercises'],
    },
  },
  {
    name: 'stage_session',
    description:
      'Add exercises to the lifter\'s active workout, starting one if none is open. Use when ' +
      'they want to train these lifts now. Never records sets — only queues the exercises and ' +
      'how many empty set prompts to show for each.',
    input_schema: {
      type: 'object',
      properties: {
        exercises: {
          type: 'array',
          description:
            'The exercises in the order they should be performed. Each entry is EITHER a ' +
            'variant_id from the facts payload, OR a describe string for a movement the lifter ' +
            'has not logged before. Describe it the way they would say it out loud — grip, ' +
            'attachment, stance — and it is resolved and added to their registry.',
          items: {
            type: 'object',
            properties: {
              variant_id: { type: 'string', description: 'An id from the facts payload.' },
              describe: {
                type: 'string',
                description: 'A movement not yet in the registry, e.g. "cable fly", "rope pushdown".',
              },
            },
          },
        },
        variant_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Deprecated. Prefer exercises.',
        },
        target_sets: {
          type: 'array',
          description:
            'How many sets to plan per exercise. A display count only — it shows that many ' +
            'empty "Log set" prompts. It does not log anything.',
          items: {
            type: 'object',
            properties: {
              variant_id: { type: 'string' },
              describe: {
                type: 'string',
                description: 'Use the same describe string when the exercise is a new one.',
              },
              sets: { type: 'integer', minimum: 1, maximum: 10 },
            },
            required: ['sets'],
          },
        },
      },
      required: ['exercises'],
    },
  },
];

type Admin = ReturnType<typeof createClient>;

// Ownership check for every id the model hands back. The prompt is guidance, not a
// guarantee, and a stray id would attach another account's exercise to this lifter.
async function ownedVariantIds(admin: Admin, userId: string, ids: unknown): Promise<string[]> {
  const wanted = (Array.isArray(ids) ? ids : []).map((x) => String(x)).filter(Boolean);
  if (!wanted.length) return [];

  const { data, error } = await admin
    .from('exercise_variants')
    .select('id')
    .eq('user_id', userId)
    .in('id', wanted);

  if (error) throw new Error(`variant lookup failed: ${error.message}`);
  const owned = new Set((data ?? []).map((r: { id: string }) => r.id));
  // Preserve the model's ordering — it reflects the sequence it just explained.
  return wanted.filter((id) => owned.has(id));
}

const MAX_NEW_EXERCISES = 4;
const MAX_EXERCISES = 12;

// The resolver stays the only thing that decides what an exercise is. Calling it over HTTP
// rather than reimplementing it here keeps one copy of the prompt, the vocabulary, the
// dropped-term safety net, the shared alias cache and the monthly cap.
async function addFromDescription(
  admin: Admin,
  userId: string,
  authHeader: string,
  description: string
) {
  let r: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/resolve-exercise`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      },
      body: JSON.stringify({ text: description, registry: [] }),
    });
    r = await res.json();
  } catch (err) {
    console.error('[coach-chat] resolver call failed', err);
    return { ok: false, description, reason: 'I could not reach the resolver just now.' };
  }

  if (!r || r.ok === false || !r.base) {
    return { ok: false, description, reason: String(r?.reason ?? 'that did not resolve to an exercise') };
  }

  const mods = Array.isArray(r.mods) ? [...(r.mods as string[])].sort() : [];
  const muscles = Array.isArray(r.muscles) ? r.muscles : [];
  const jointActions = Array.isArray(r.joint_actions) ? r.joint_actions : [];

  const row: Record<string, unknown> = {
    user_id: userId,
    base: r.base,
    mods,
    muscle: r.muscle,
    body_part: r.body_part,
    source_text: description,
    resolved_by: 'ai',
    ...(r.note ? { load_note: r.note } : {}),
    ...(r.confidence ? { confidence: r.confidence } : {}),
    ...(muscles.length ? { muscles } : {}),
    ...(jointActions.length ? { joint_actions: jointActions } : {}),
  };

  const { data, error } = await admin
    .from('exercise_variants')
    .upsert(row, { onConflict: 'user_id,base,mods' })
    .select('id,base,mods')
    .single();

  if (error) return { ok: false, description, reason: error.message };
  return { ok: true, description, id: data.id as string, base: data.base as string, mods: data.mods as string[] };
}

// One ordered list: each entry is an id the lifter already owns, or a description to resolve.
// Order is the sequence the model just explained, so it is preserved across both kinds.
async function orderedExercises(
  admin: Admin,
  userId: string,
  authHeader: string,
  input: Record<string, unknown>
) {
  const raw = Array.isArray(input.exercises) && input.exercises.length
    ? (input.exercises as Record<string, unknown>[])
    : (Array.isArray(input.variant_ids) ? input.variant_ids : []).map((id) => ({ variant_id: id }));

  const entries = raw.slice(0, MAX_EXERCISES).map((e) => ({
    variant_id: typeof e?.variant_id === 'string' ? e.variant_id : '',
    describe: typeof e?.describe === 'string' ? (e.describe as string).trim().slice(0, 120) : '',
  }));

  const owned = new Set(
    await ownedVariantIds(admin, userId, entries.map((e) => e.variant_id).filter(Boolean))
  );

  const wanted: string[] = [];
  for (const e of entries) {
    if (!e.variant_id && e.describe && !wanted.includes(e.describe)) wanted.push(e.describe);
  }
  const results = await Promise.all(
    wanted.slice(0, MAX_NEW_EXERCISES).map((d) => addFromDescription(admin, userId, authHeader, d))
  );
  const made = new Map(results.filter((r) => r.ok).map((r) => [r.description, r]));

  const ids: string[] = [];
  const added: { name: string; mods: string[] }[] = [];
  for (const e of entries) {
    if (e.variant_id && owned.has(e.variant_id)) {
      if (!ids.includes(e.variant_id)) ids.push(e.variant_id);
      continue;
    }
    const m = e.describe ? made.get(e.describe) : null;
    if (m && !ids.includes(m.id as string)) {
      ids.push(m.id as string);
      added.push({ name: m.base as string, mods: m.mods as string[] });
    }
  }

  const failed = results.filter((r) => !r.ok).map((r) => ({ description: r.description, reason: r.reason }));
  return { ids, added, failed, made };
}

async function runCreateTemplate(
  admin: Admin,
  userId: string,
  authHeader: string,
  input: Record<string, unknown>
) {
  const { ids, added, failed } = await orderedExercises(admin, userId, authHeader, input);
  if (!ids.length) {
    return {
      ok: false,
      reason: failed.length
        ? `I could not add ${failed.map((f) => f.description).join(', ')}.`
        : 'None of those exercises are in your registry.',
      failed,
    };
  }

  const name = String(input.name ?? '').trim().slice(0, 60) || 'Coach workout';
  const { data, error } = await admin
    .from('workout_templates')
    .insert({ user_id: userId, name, exercise_order: ids })
    .select()
    .single();

  if (error) throw new Error(`template create failed: ${error.message}`);
  return { ok: true, template: data, variantIds: ids, added, failed };
}

async function runStageSession(
  admin: Admin,
  userId: string,
  authHeader: string,
  input: Record<string, unknown>
) {
  const { ids: variantIds, added: addedExercises, failed, made } = await orderedExercises(admin, userId, authHeader, input);
  if (!variantIds.length) {
    return {
      ok: false,
      reason: failed.length
        ? `I could not add ${failed.map((f) => f.description).join(', ')}.`
        : 'None of those exercises are in your registry.',
      failed,
    };
  }

  // A list on the wire so the tool schema stays well-typed; stored as the {variantId: count}
  // map the session row expects. Entries that failed the ownership check drop with it.
  const allowed = new Set(variantIds);
  const targets: Record<string, number> = {};
  for (const row of Array.isArray(input.target_sets) ? input.target_sets : []) {
    const r = row as Record<string, unknown>;
    const describe = typeof r?.describe === 'string' ? r.describe.trim() : '';
    // A freshly added exercise has no id the model could have known, so it keys by description.
    const id = String(r?.variant_id ?? (describe ? made.get(describe)?.id ?? '' : ''));
    const n = Number(r?.sets);
    if (allowed.has(id) && Number.isFinite(n) && n >= 1) targets[id] = Math.min(10, Math.round(n));
  }

  // Same single-active-session guard the app uses — two would make "resume" ambiguous.
  const { data: existing, error: findErr } = await admin
    .from('workout_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) throw new Error(`session lookup failed: ${findErr.message}`);

  if (!existing) {
    const { data, error } = await admin
      .from('workout_sessions')
      .insert({
        user_id: userId,
        status: 'active',
        exercise_order: variantIds,
        target_sets: Object.keys(targets).length ? targets : null,
      })
      .select()
      .single();

    if (error) throw new Error(`session start failed: ${error.message}`);
    return { ok: true, session: data, variantIds, created: true, added: addedExercises, failed };
  }

  // Append, skipping duplicates: the lifter may have built half the session by hand.
  const order: string[] = existing.exercise_order ?? [];
  const added = variantIds.filter((id) => !order.includes(id));
  const merged = { ...(existing.target_sets ?? {}), ...targets };

  const { data, error } = await admin
    .from('workout_sessions')
    .update({
      exercise_order: [...order, ...added],
      target_sets: Object.keys(merged).length ? merged : null,
    })
    .eq('id', existing.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`session update failed: ${error.message}`);
  return { ok: true, session: data, variantIds: added, created: false, added: addedExercises, failed };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';

    const userId = await userIdFrom(authHeader);
    if (!userId) return json({ error: 'Not signed in' }, 401);

    const body = await req.json();
    const facts = body?.facts ?? null;

    const history = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: Record<string, unknown>) => m?.role === 'user' || m?.role === 'assistant')
      .map((m: Record<string, unknown>) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content ?? '').slice(0, 4000),
      }))
      .filter((m: { content: string }) => m.content.trim())
      .slice(-MAX_HISTORY);

    if (!history.length) return json({ error: 'Nothing to answer.' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ---- cap, before the model call -------------------------------------------------
    const { data: usageRows, error: usageErr } = await admin
      .from('coach_chat_usage')
      .select('calls')
      .eq('user_id', userId)
      .eq('day', dayKey());

    const cap = checkCap(usageRows, usageErr, DAILY_CAP);

    if (cap.failed) {
      // Fail closed, same as the resolver: an unreadable counter is not proof of zero usage.
      console.error('[coach-chat] usage read failed', usageErr);
      return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
    }

    if (cap.capped) {
      return json({
        ok: false,
        capped: true,
        reason: `That's ${DAILY_CAP} questions today — the daily limit. Everything the coach already worked out is still on your Progress screen, and this resets tomorrow.`,
      });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      console.error('[coach-chat] ANTHROPIC_API_KEY is not set');
      return json({ ok: false, unavailable: true, reason: 'The coach is not configured.' });
    }

    // In front of the conversation, not the system prompt, so they refresh every turn.
    const messages = [
      {
        role: 'user' as const,
        content: `Here are the facts about my training, computed from my logged sets:\n\n${JSON.stringify(facts)}`,
      },
      { role: 'assistant' as const, content: 'Got it — I have your training data. What would you like to know?' },
      ...history,
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(apiKey, Deno.env.get('ANTHROPIC_WORKSPACE_ID')),
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, tools: TOOLS, messages }),
    });

    if (!res.ok) {
      // Loud on purpose: a silent failure here reads as bad wifi on the client.
      console.error('[coach-chat] anthropic error', res.status, (await res.text()).slice(0, 400));
      return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
    }

    const payload = await res.json();
    const blocks = Array.isArray(payload?.content) ? payload.content : [];

    const text = blocks
      .filter((b: Record<string, unknown>) => b?.type === 'text')
      .map((b: Record<string, unknown>) => String(b.text ?? ''))
      .join('\n')
      .trim();

    // Ran out of room mid-answer. Observed live: a reply stopped mid-word and was served as
    // though finished, which the lifter cannot tell apart from a complete thought.
    const truncated = payload?.stop_reason === 'max_tokens';
    if (truncated) {
      console.warn('[coach-chat] response hit max_tokens', { model: MODEL, max_tokens: MAX_TOKENS });
    }

    // Truncation can also halve a tool_use block, leaving `input` partial — executing that
    // writes real rows from an incomplete instruction. So a truncated turn never runs a tool.
    const call = truncated
      ? null
      : blocks.find((b: Record<string, unknown>) => b?.type === 'tool_use');

    if (truncated && blocks.some((b: Record<string, unknown>) => b?.type === 'tool_use')) {
      console.warn('[coach-chat] discarded a tool_use from a truncated response');
    }

    // Counted whatever happens next: a tool that fails to execute was still paid for.
    const { error: bumpErr } = await admin.rpc('bump_coach_chat_usage', { target_user: userId });
    if (bumpErr) console.error('[coach-chat] usage bump failed', bumpErr);

    let toolCall: {
      name: string;
      input: Record<string, unknown>;
      result: { ok: boolean; reason?: string; [k: string]: unknown };
    } | null = null;

    if (call) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      try {
        const result =
          call.name === 'create_template'
            ? await runCreateTemplate(admin, userId, authHeader, input)
            : call.name === 'stage_session'
              ? await runStageSession(admin, userId, authHeader, input)
              : { ok: false, reason: `Unknown tool ${call.name}.` };
        toolCall = { name: call.name, input, result };
      } catch (err) {
        console.error('[coach-chat] tool failed', call.name, err);
        toolCall = {
          name: call.name,
          input,
          result: { ok: false, reason: 'That did not save. Try again in a moment.' },
        };
      }
    }

    // A tool call with no prose renders as an empty bubble. Floor if the prompt is ignored.
    const replyText = text || (toolCall?.result?.ok ? 'Done — see below.' : 'I could not put that together.');

    return json({
      ok: true,
      // Appended, not hidden: a half-answer still carries real information.
      text: truncated ? `${replyText}${TRUNCATION_MARKER}` : replyText,
      truncated,
      toolCall,
    });
  } catch (err) {
    console.error('[coach-chat] unhandled', err);
    return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
  }
});
