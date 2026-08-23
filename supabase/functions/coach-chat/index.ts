/**
 * coach-chat — the conversational coach.
 *
 * The model never queries the database. It gets a facts payload computed by
 * `buildCoachFacts` in src/lib/coach.js — tested pure functions over logged sets — and
 * nothing else. That is what makes "cite the numbers you used" enforceable: every figure it
 * can quote came from a function the lifter can check against their own Progress screen, so
 * an invented number is catchable rather than plausible.
 *
 * Two things it can DO, both validated server-side against the caller's own rows: create a
 * template, and stage exercises into a session. It cannot write a weight, a rep count or an
 * RIR. Those are user-entered, always — a fabricated set would corrupt the trend line this
 * app exists to keep honest, invisibly.
 *
 * Runs server-side so the API key is never in the browser and the daily cap cannot be
 * edited by the client.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight, userIdFrom } from '../_shared/http.ts';
import { capFromEnv, checkCap, dayKey } from '../_shared/usage.ts';

// Pinned to a version alias, never `-latest`. `claude-3-5-haiku-latest` broke the resolver
// once already: the dated model behind it retired, calls started 404ing, and because a 404
// and a network failure land in the same catch on the client it read as bad wifi for days.
//
// Sonnet rather than the resolver's Haiku: this answers open training-science questions
// rather than extracting fields from a phrase, and the reasoning gap shows.
const MODEL = Deno.env.get('COACH_CHAT_MODEL') ?? 'claude-sonnet-5';

// Daily rather than monthly, unlike the resolver. Resolve calls cache forever so their cost
// curve flattens; a chat turn is personal and never repeats, so the cap is the only brake.
//
// Parsed through capFromEnv rather than Number(): a typo'd secret would otherwise become NaN
// and disable the cap entirely, silently.
const DAILY_CAP = capFromEnv(Deno.env.get('COACH_CHAT_DAILY_CAP'), 40, 'COACH_CHAT_DAILY_CAP');

// Bounds the cost of a long conversation. The facts payload carries the training history, so
// dropping older turns loses conversational thread, not data about the lifter.
const MAX_HISTORY = 20;

// Raised from 1200 after a live answer came back cut off mid-word. Coaching replies that
// explain a plateau and then qualify what the data cannot show run long, and an answer whose
// caveat got truncated is worse than a shorter one — the hedge is the part that matters.
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

WHAT YOU CAN DO

You have exactly two tools: create_template and stage_session. Use them when the lifter asks
for a workout built or an exercise queued up, and reference only variant ids that appear in
the facts payload.

You never write a weight, a rep count, or an RIR, and you never mark a set as logged. Those
are entered by the lifter, always. stage_session's target_sets is a count of empty set
prompts to display — it is a plan for how many sets to do, not a record that they were done.

When you call a tool, also write a sentence saying what you did and why, in the same grounded
voice as everything else.

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
        variant_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Exercise variant ids, in the order they should be performed. Must come from the ' +
            'facts payload — you cannot invent an exercise the lifter has never logged.',
        },
      },
      required: ['name', 'variant_ids'],
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
        variant_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exercise variant ids to append, in order. Must come from the facts payload.',
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
              sets: { type: 'integer', minimum: 1, maximum: 10 },
            },
            required: ['variant_id', 'sets'],
          },
        },
      },
      required: ['variant_ids'],
    },
  },
];

type Admin = ReturnType<typeof createClient>;

/**
 * Ownership check for every id the model hands back.
 *
 * The model is told to use ids from the facts payload, which only ever contains the caller's
 * own variants. This re-checks anyway: a prompt is guidance, not a guarantee, and an id that
 * slipped through from somewhere else would attach another account's exercise to this
 * lifter's session. Same reasoning as the resolver enforcing its tagging rule server-side.
 */
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

async function runCreateTemplate(admin: Admin, userId: string, input: Record<string, unknown>) {
  const variantIds = await ownedVariantIds(admin, userId, input.variant_ids);
  if (!variantIds.length) {
    return { ok: false, reason: 'None of those exercises are in your registry.' };
  }

  const name = String(input.name ?? '').trim().slice(0, 60) || 'Coach workout';
  const { data, error } = await admin
    .from('workout_templates')
    .insert({ user_id: userId, name, exercise_order: variantIds })
    .select()
    .single();

  if (error) throw new Error(`template create failed: ${error.message}`);
  return { ok: true, template: data, variantIds };
}

async function runStageSession(admin: Admin, userId: string, input: Record<string, unknown>) {
  const variantIds = await ownedVariantIds(admin, userId, input.variant_ids);
  if (!variantIds.length) {
    return { ok: false, reason: 'None of those exercises are in your registry.' };
  }

  // target_sets arrives as a list so the tool schema stays well-typed, and is stored as the
  // {variantId: count} map the session row and ExerciseBlock both expect. Anything naming an
  // exercise that failed the ownership check is dropped with it.
  const allowed = new Set(variantIds);
  const targets: Record<string, number> = {};
  for (const row of Array.isArray(input.target_sets) ? input.target_sets : []) {
    const id = String((row as Record<string, unknown>)?.variant_id ?? '');
    const n = Number((row as Record<string, unknown>)?.sets);
    if (allowed.has(id) && Number.isFinite(n) && n >= 1) targets[id] = Math.min(10, Math.round(n));
  }

  // Same single-active-session guard the app uses: resume the open one, start one if there
  // is none. Two active sessions would make "resume workout" ambiguous forever after.
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
    return { ok: true, session: data, variantIds, created: true };
  }

  // Append rather than replace, and skip anything already queued — the lifter may have built
  // half the session by hand before asking.
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
  return { ok: true, session: data, variantIds: added, created: false };
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

    // Facts ride in front of the conversation rather than in the system prompt so they can
    // be refreshed every turn — the lifter may log a set mid-conversation.
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
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, tools: TOOLS, messages }),
    });

    if (!res.ok) {
      // Loud on purpose. A silent failure here is indistinguishable from bad wifi on the
      // client, which is exactly how the retired-model outage went unnoticed for days.
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

    // The model ran out of room mid-answer. Observed live: a reply about a bench plateau
    // stopped mid-word at "(Bench" and was served as though it were finished, which is worse
    // than a short answer — the lifter cannot tell the difference between a complete thought
    // and a severed one.
    const truncated = payload?.stop_reason === 'max_tokens';
    if (truncated) {
      console.warn('[coach-chat] response hit max_tokens', { model: MODEL, max_tokens: MAX_TOKENS });
    }

    // A truncated response can also cut a tool_use block in half, leaving `input` partial:
    // variant_ids missing entries, target_sets half-parsed, a template named from a clipped
    // string. Executing that would write real rows from an incomplete instruction, so a
    // truncated turn never runs a tool. Nothing is staged, and the lifter is told to retry.
    const call = truncated
      ? null
      : blocks.find((b: Record<string, unknown>) => b?.type === 'tool_use');

    if (truncated && blocks.some((b: Record<string, unknown>) => b?.type === 'tool_use')) {
      console.warn('[coach-chat] discarded a tool_use from a truncated response');
    }

    // Count the call whatever happens next: the model call is what costs money, and a tool
    // that fails to execute has still been paid for.
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
            ? await runCreateTemplate(admin, userId, input)
            : call.name === 'stage_session'
              ? await runStageSession(admin, userId, input)
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

    // A tool call with no accompanying prose would render as an empty bubble. The prompt asks
    // for a sentence; this is the floor if it forgets.
    const replyText = text || (toolCall?.result?.ok ? 'Done — see below.' : 'I could not put that together.');

    return json({
      ok: true,
      // The marker is appended rather than the text being hidden: a half-answer still carries
      // real information, and the lifter should see both it and the fact that it stopped early.
      text: truncated ? `${replyText}${TRUNCATION_MARKER}` : replyText,
      truncated,
      toolCall,
    });
  } catch (err) {
    console.error('[coach-chat] unhandled', err);
    return json({ ok: false, unavailable: true, reason: 'I could not reach the coach just now.' });
  }
});
