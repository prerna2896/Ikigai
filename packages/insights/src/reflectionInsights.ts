import { z } from 'zod';

// A "knowledge base" built from the person's own /reflect entries: for
// each reflection, which domain (if any) it's actually about, and what
// mood is expressed in it. This is a deliberate, explicit exception to
// the data-minimization stance the rest of @ikigai/insights holds
// (never send raw reflection/note text — see summary.ts) — the user
// asked for it directly, understanding the tradeoff. Scope stays
// narrow: this route only ever TAGS reflections (domain + mood), never
// summarizes or quotes them back, and the tags feed a deterministic
// template (see lib/reflectionKnowledgeBase.ts's ENCOURAGEMENT_BY_MOOD),
// not a second freeform LLM sentence — after the length/grounding
// fragility repeatedly hit while iterating on the main insight
// (packages/insights/src/prompt.ts's rule 2b), a second open-ended
// generation here would risk the exact same failure class for a much
// lower-stakes feature.

export type ReflectionMood = 'positive' | 'negative' | 'mixed' | 'neutral';

export type ReflectionForAnalysis = {
  id: string;
  categoryId: string | null;
  text: string;
};

export type ReflectionTag = {
  reflectionId: string;
  // Exact domain name (matched against the list given), or null when
  // the reflection doesn't clearly relate to one specific domain —
  // expected to be the common case, not the exception.
  domainName: string | null;
  mood: ReflectionMood;
};

export const reflectionTagSchema = z.object({
  reflectionId: z.string().min(1).max(60),
  domainName: z.string().max(80).nullable(),
  mood: z.enum(['positive', 'negative', 'mixed', 'neutral']),
});

export const reflectionAnalysisResultSchema = z.object({
  tags: z.array(reflectionTagSchema).max(30),
});

export function buildReflectionAnalysisSystemPrompt(): string {
  return `You're tagging a person's own private weekly reflection notes for later use by their planning companion — this output is never shown to the person directly, only used to decide which domain a short, separate encouragement line might reference.

For each reflection given, decide:
1. domainName — which ONE of the given domains (use the exact name given) this reflection is clearly about. Use null whenever it's not clearly about one specific domain — that's the correct answer for most reflections (general mood, work-life balance, unrelated topics). Never force a match to the nearest-sounding domain; a wrong match is worse than null.
2. mood — the emotional tone actually expressed in THAT reflection: "positive" (satisfied, energized, proud, grateful), "negative" (frustrated, drained, disappointed, anxious), "mixed" (genuinely both), or "neutral" (factual, no real emotional charge). Read only what's written; don't infer feelings the text doesn't support.

Return exactly one tag per reflection id given, in the same order, using the reflectionId provided.`;
}

export function buildReflectionAnalysisUserPrompt(
  reflections: ReflectionForAnalysis[],
  domainNames: string[],
): string {
  const domainLines = domainNames.map((d) => `- ${d}`).join('\n');
  const reflectionLines = reflections
    .map((r) => `- reflectionId="${r.id}" [${r.categoryId ?? 'note'}]: "${r.text}"`)
    .join('\n');
  return `## Domains to match against (use null if none clearly fit)
${domainLines || '(none)'}

## Reflections to tag
${reflectionLines}`;
}

// Bounded, pre-approved phrase templates per mood — same reasoning as
// packages/insights/src/prompt.ts's OVERACHIEVEMENT_WIN_PHRASES etc.:
// a single fixed line per mood was found (via direct user testing) to
// read as an obviously canned, repeated phrase across regenerations of
// the same reflection tags. Adding options here is safe in a way an
// LLM-composed line would not be — every option is still hand-written,
// still never quotes or summarizes the actual reflection text, and
// picking one is a closed choice, not open composition. `{domain}` is
// the substitution point for the caller-resolved domain label.
const ENCOURAGEMENT_TEMPLATES: Record<ReflectionMood, string[]> = {
  positive: [
    "You've spoken well of {domain} before — good that it's getting real time this week.",
    "{domain}'s been a bright spot for you before — good to see it getting real time.",
    "You've said good things about {domain} before — that's showing up again this week.",
  ],
  mixed: [
    "{domain}'s been a mixed bag for you before — showing up for it anyway still counts.",
    "{domain} hasn't always been easy for you — still, you kept it in the picture this week.",
    "You've had mixed feelings about {domain} before — you made room for it anyway.",
  ],
  negative: [
    "{domain}'s felt heavy for you before — worth noticing you made room for it anyway.",
    "You've said {domain} felt like a lot before — still, you didn't skip it this week.",
    "{domain} hasn't been easy for you lately — showing up for it anyway is worth noticing.",
  ],
  neutral: [
    '{domain} keeps getting your attention lately — that consistency adds up.',
    "You've kept coming back to {domain} — that steadiness is worth noticing.",
    '{domain} has quietly stayed part of your week — consistency like that adds up.',
  ],
};

function pickTemplate(mood: ReflectionMood, random: () => number): string {
  const options = ENCOURAGEMENT_TEMPLATES[mood];
  const index = Math.min(options.length - 1, Math.floor(random() * options.length));
  return options[index];
}

// Deterministic, not a second LLM sentence — see the file-level comment
// above for why. Picks from a small set of pre-approved templates per
// mood (see ENCOURAGEMENT_TEMPLATES), parameterized only by the
// domain's own label (already resolved the same way the main insight
// resolves domain names — see signals.ts principleLabelFor — by the
// caller, not here). Returns null when there's no reflection data for
// this domain at all, rather than fabricating generic encouragement
// that isn't actually grounded in anything the person wrote. `random`
// is injectable (defaults to Math.random) so tests can assert
// deterministically — same pattern as prompt.ts's pickPhrase.
export function encouragementLineFor(
  domainLabel: string,
  mood: ReflectionMood | null | undefined,
  random: () => number = Math.random,
): string | null {
  if (mood == null) return null;
  return pickTemplate(mood, random).replaceAll('{domain}', domainLabel);
}
