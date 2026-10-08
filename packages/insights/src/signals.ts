import { IKIGAI_PRINCIPLE_LABEL } from '@ikigai/core';
import type { WeeklyDomainSummary, WeeklyMetricsSummary } from './summary';

// Deterministic "is this actually worth mentioning" gate. The model's
// job is narrowed to phrasing an already-confirmed signal, not judging
// raw numbers itself — that judgment call is what produced false
// positives (celebrating a domain for merely finishing its normal
// planned tasks; flagging day-1 sparse data as a problem) when it lived
// entirely in prompt instructions. Computing it here means it's
// unit-testable without any LLM variance, and callers can skip the
// network call entirely when nothing crosses threshold.
//
// Two independent checks per domain (and once overall), per the
// explicit design: allocation (how much time was planned, then vs now)
// and completion (of what was planned, how much actually got done, then
// vs now) — checked separately, not blended into one score, because
// they're different failure modes: undercommitting to a domain (planned
// hours themselves shrank) can look fine on a completion-ratio-only
// view if the person still finishes their now-smaller plan.

export type SignalReason =
  | 'completion_drop'
  | 'completion_improved'
  | 'sustained_strong'
  | 'allocation_drop'
  | 'overachievement_tradeoff'
  | 'sustained_underdelivery'
  | 'overall_decline_ambiguous';

export type WeeklySignal = {
  kind: 'celebrate' | 'attention';
  scope: 'overall' | 'domain';
  domainName?: string;
  // Only set for 'overachievement_tradeoff' — the domain(s) that appear
  // to have been squeezed out (e.g. Work overachieved, Rest + Family
  // dropped). Up to 2, matching the same "combine at most two" cap
  // used everywhere else a sentence names more than one domain.
  relatedDomainNames?: string[];
  reason: SignalReason;
  detail: string;
  // The domain's standout task (see WeeklyTaskSummary in summary.ts),
  // carried onto the signal when this signal is about that domain —
  // deterministic, same as domainName: the model may optionally name
  // this specific task instead of/alongside the domain, never invent
  // one of its own. Absent when the domain has no clear standout task.
  taskName?: string;
};

// Severity never crosses the network — it's only how THIS module orders
// signals before returning the public WeeklySignal[]. Exists because a
// real week can have two genuinely severe problems (e.g. Health AND a
// side project both dropped hard) and the model was observed picking
// whichever one it found more nameable rather than the more severe one
// — "problems before wins" alone doesn't rank problems against each
// other. Sorting by actual magnitude here, deterministically, means the
// signal list's order IS the priority order, not something the model
// has to infer from reading numbers in prose.
type ScoredSignal = WeeklySignal & { severity: number };

// Thresholds — deliberately conservative (a few tuning passes already
// showed loose ones create false positives on ordinary weeks). Tune
// here, not in prompt wording.
const MIN_MEANINGFUL_HOURS = 2; // below this, numbers are too small to mean anything
const MIN_PRIOR_HOURS_FOR_ALLOCATION_CHECK = 3;
const COMPLETION_DROP_THRESHOLD = 0.3; // 30 percentage points
const COMPLETION_IMPROVE_THRESHOLD = 0.3;
const SUSTAINED_STRONG_THRESHOLD = 0.85;
const ALLOCATION_DROP_RATIO = 0.4; // planned hours shrank by 40%+ vs prior week
const OVERACHIEVEMENT_RATIO = 1.3; // completed 30%+ more than planned, this week
const SUSTAINED_UNDERDELIVERY_RATIO = 0.4; // stayed under 40% completion...
const SUSTAINED_UNDERDELIVERY_MIN_WEEKS = 4; // ...for at least this many consecutive weeks (this week included)
const OVERALL_DECLINE_RATIO = 0.3; // total LOGGED hours (not ratio-to-plan) dropped 30%+ vs prior week

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

// Kenji's phrasing reads far more like a person, and far less like a
// dashboard, when a signal's detail text names the Ikigai principle
// behind a domain ("Alignment") rather than the raw domain/task label
// ("drawing") — direct, repeated user feedback on the phrasing (not a
// hunch) drove this. Left as a prompt instruction alone, the model
// complied inconsistently (it's a style preference, easy to drift from
// under other pressure) — same class of problem "should this fire"
// was, so it moves into deterministic code for the same reason.
// Falls back to the literal domain name when two+ domains share a
// principle, since "Growth slipped while Growth improved" would be a
// straightforwardly wrong sentence, not just a style miss.
export function principleLabelFor(
  domains: Pick<WeeklyDomainSummary, 'name' | 'principleId'>[],
  domain: Pick<WeeklyDomainSummary, 'name' | 'principleId'>,
): string {
  const sharedCount = domains.filter((d) => d.principleId === domain.principleId).length;
  return sharedCount === 1 ? IKIGAI_PRINCIPLE_LABEL[domain.principleId] : domain.name;
}

// The name actually used for a domain in signal detail text — the
// domain's standout task (see WeeklyTaskSummary in summary.ts) when it
// has one, else the principle label above. Deterministic for the exact
// reason principleLabelFor is deterministic: a live batch test of the
// alternative — giving the model both the principle word and the task
// name with an instruction to pick one — produced a real, repeatable
// violation (5/12 runs kept BOTH, e.g. "Alignment's had less of your
// time lately, especially with your guitar practice") even with an
// explicit rule against it, the same failure shape "leave an optional
// composition choice to the model" has already produced elsewhere in
// this file. Baking the choice directly into the text removes it as a
// decision at all — the model only ever sees ONE already-resolved name,
// same as it always has for principle labels.
function nameFor(
  domains: Pick<WeeklyDomainSummary, 'name' | 'principleId'>[],
  domain: Pick<WeeklyDomainSummary, 'name' | 'principleId'> & { topTask?: { name: string } | null },
): string {
  return domain.topTask?.name ?? principleLabelFor(domains, domain);
}

// A signal's label is resolved against ALL domains in the plan (see
// above) at the time it's computed — correct for that signal on its
// own, but when two signals end up named in the SAME sentence later
// (selectSignalsForInsight), "ambiguous against the whole plan" is the
// wrong scope: it only matters whether the label is ambiguous against
// the ONE OTHER domain actually being mentioned alongside it. Without
// this, a domain could fall back to its raw name only because some
// THIRD, unmentioned domain happens to share its principle — reading
// as a mismatched pair ("Family and Energy") even though nothing
// ambiguous is actually in the sentence. Re-resolves the label scoped
// to just the pair and patches the already-built detail string.
function relabelForPair(
  signal: WeeklySignal,
  allDomains: WeeklyDomainSummary[],
  pairDomains: Pick<WeeklyDomainSummary, 'name' | 'principleId'>[],
): WeeklySignal {
  const domain = allDomains.find((d) => d.name === signal.domainName);
  // A domain named by its own task has no principle-sharing ambiguity
  // to fix in the first place — task names aren't drawn from the
  // shared, finite IKIGAI_PRINCIPLE_LABEL pool, so this whole check
  // doesn't apply to it.
  if (!domain || domain.topTask) return signal;
  const globalLabel = principleLabelFor(allDomains, domain);
  const pairLabel = principleLabelFor(pairDomains, domain);
  if (globalLabel === pairLabel || !signal.detail.includes(globalLabel)) return signal;
  return { ...signal, detail: signal.detail.replace(globalLabel, pairLabel) };
}

// Raw logged hours dropping hard, independent of plan — deliberately a
// DIFFERENT check from the ratio-based 'overall' completion_drop below
// (which compares logged/planned, so a smaller plan can mask a real
// falloff in actual hours). This is the one signal this module
// DELIBERATELY doesn't try to explain: whether it's a genuine
// disruption or just a change in logging habits isn't answerable from
// hours data — trying to guess produces a confident-sounding sentence
// that's just as likely to be wrong as right. The detail stays a bare
// fact; the caller (see app/insights/page.tsx's occupied-prompt) is
// expected to ask the person directly rather than have Kenji assert a
// cause. Takes priority over everything else when it fires (see
// selectSignalsForInsight) — a real overall falloff is the more
// fundamental thing to know before any single domain's story.
function checkOverallDecline(
  totals: Pick<WeeklyMetricsSummary['totals'], 'loggedHours'>,
  priorWeek: Pick<WeeklyMetricsSummary['totals'], 'loggedHours'>,
): ScoredSignal | null {
  if (priorWeek.loggedHours < MIN_MEANINGFUL_HOURS) return null;
  const dropRatio = (priorWeek.loggedHours - totals.loggedHours) / priorWeek.loggedHours;
  if (dropRatio < OVERALL_DECLINE_RATIO) return null;
  return {
    kind: 'attention',
    scope: 'overall',
    reason: 'overall_decline_ambiguous',
    detail: `Logged hours dropped from ${priorWeek.loggedHours}h to ${totals.loggedHours}h this week, across the board.`,
    severity: dropRatio,
  };
}

function checkCompletionPair(
  scope: 'overall' | 'domain',
  domainName: string | undefined,
  label: string,
  plannedHours: number,
  completionRatio: number,
  priorPlannedHours: number,
  priorCompletionRatio: number,
  taskName?: string,
): ScoredSignal | null {
  if (plannedHours < MIN_MEANINGFUL_HOURS || priorPlannedHours < MIN_MEANINGFUL_HOURS) {
    return null;
  }
  const drop = priorCompletionRatio - completionRatio;
  const improve = completionRatio - priorCompletionRatio;

  if (drop >= COMPLETION_DROP_THRESHOLD) {
    return {
      kind: 'attention',
      scope,
      domainName,
      reason: 'completion_drop',
      detail: `${label} completion dropped from ${pct(priorCompletionRatio)} to ${pct(completionRatio)} week over week.`,
      severity: drop,
      taskName,
    };
  }
  if (improve >= COMPLETION_IMPROVE_THRESHOLD && completionRatio >= 0.7) {
    return {
      kind: 'celebrate',
      scope,
      domainName,
      reason: 'completion_improved',
      detail: `${label} completion improved from ${pct(priorCompletionRatio)} to ${pct(completionRatio)} week over week.`,
      severity: improve,
      taskName,
    };
  }
  if (completionRatio >= SUSTAINED_STRONG_THRESHOLD && priorCompletionRatio >= SUSTAINED_STRONG_THRESHOLD) {
    return {
      kind: 'celebrate',
      scope,
      domainName,
      reason: 'sustained_strong',
      detail: `${label} has held at ${pct(completionRatio)}+ completion for two weeks running.`,
      severity: completionRatio,
      taskName,
    };
  }
  return null;
}

function checkAllocationDrop(
  domain: WeeklyDomainSummary,
  allDomains: WeeklyDomainSummary[],
): ScoredSignal | null {
  const priorPlanned = domain.priorPlannedHours;
  if (priorPlanned == null || priorPlanned < MIN_PRIOR_HOURS_FOR_ALLOCATION_CHECK) {
    return null;
  }
  const dropRatio = (priorPlanned - domain.plannedHours) / priorPlanned;
  if (dropRatio < ALLOCATION_DROP_RATIO) return null;
  const label = nameFor(allDomains, domain);
  return {
    kind: 'attention',
    scope: 'domain',
    domainName: domain.name,
    reason: 'allocation_drop',
    detail: `Planned hours for ${label} dropped from ${priorPlanned}h to ${domain.plannedHours}h week over week — a shrinking commitment, independent of whether the smaller plan got done.`,
    severity: dropRatio,
    taskName: domain.topTask?.name,
  };
}

// A domain that's been quietly under-delivered for weeks running,
// distinct from a fresh drop: nothing CHANGED this week (drop needs a
// notably-higher prior week), it's just been low all along. Different
// failure mode from completion_drop, different phrasing needed too —
// "X dropped" is wrong when nothing dropped recently; it's been here.
// priorRatios covers weeks BEFORE the immediate prior week, most-
// recent-first (see buildWeeklySummary.ts) — this week and the prior
// week are checked directly against the domain's own fields, since
// those are already given.
function checkSustainedUnderdelivery(
  domain: WeeklyDomainSummary,
  priorRatios: number[],
  allDomains: WeeklyDomainSummary[],
): ScoredSignal | null {
  if (domain.plannedHours < MIN_MEANINGFUL_HOURS) return null;
  if (domain.completionRatio >= SUSTAINED_UNDERDELIVERY_RATIO) return null;
  if (
    domain.priorCompletionRatio == null ||
    domain.priorCompletionRatio >= SUSTAINED_UNDERDELIVERY_RATIO
  ) {
    return null;
  }

  let streak = 2; // this week + the immediate prior week, both already confirmed below threshold
  for (const ratio of priorRatios) {
    if (ratio >= SUSTAINED_UNDERDELIVERY_RATIO) break;
    streak += 1;
  }
  if (streak < SUSTAINED_UNDERDELIVERY_MIN_WEEKS) return null;

  const label = nameFor(allDomains, domain);
  return {
    kind: 'attention',
    scope: 'domain',
    domainName: domain.name,
    reason: 'sustained_underdelivery',
    detail: `${label} has stayed under ${pct(SUSTAINED_UNDERDELIVERY_RATIO)} completion for ${streak} weeks running.`,
    // How far under the bar right now, not just that the streak
    // crossed the minimum — a domain sitting at 5% is a bigger deal
    // than one hovering at 35%, even at the same streak length.
    severity: SUSTAINED_UNDERDELIVERY_RATIO - domain.completionRatio,
    taskName: domain.topTask?.name,
  };
}

export function computeWeeklySignals(
  summary: Pick<WeeklyMetricsSummary, 'totals' | 'priorWeek' | 'domains'>,
  priorRatiosByDomain: Record<string, number[]> = {},
): WeeklySignal[] {
  // No prior week at all → no baseline to compare against. Never fires
  // in a person's first tracked week, by design — there's nothing to
  // call a deviation yet.
  if (!summary.priorWeek) return [];

  const signals: ScoredSignal[] = [];

  const domainSignals: ScoredSignal[] = [];
  for (const domain of summary.domains) {
    if (domain.priorCompletionRatio == null) continue; // domain didn't exist last week

    // Allocation drop takes priority over completion for the same
    // domain in the same pass — if the commitment itself shrank, that's
    // the more specific, more actionable thing to name; a completion
    // signal on top would be redundant noise about the same shrinkage.
    const allocationSignal = checkAllocationDrop(domain, summary.domains);
    if (allocationSignal) {
      domainSignals.push(allocationSignal);
      continue;
    }

    const completionSignal = checkCompletionPair(
      'domain',
      domain.name,
      nameFor(summary.domains, domain),
      domain.plannedHours,
      domain.completionRatio,
      domain.priorPlannedHours ?? 0,
      domain.priorCompletionRatio,
      domain.topTask?.name,
    );
    if (completionSignal) {
      domainSignals.push(completionSignal);
      continue;
    }

    // Only reached when nothing changed sharply enough this week to
    // register above — this is where a quiet, ongoing pattern gets a
    // chance to surface instead of just going unmentioned forever.
    const chronicSignal = checkSustainedUnderdelivery(
      domain,
      priorRatiosByDomain[domain.name] ?? [],
      summary.domains,
    );
    if (chronicSignal) domainSignals.push(chronicSignal);
  }

  // Cross-domain reallocation: a domain that ran well past its own plan
  // this week, paired with the domain(s) that dropped in the same week
  // — reads as the same hours having moved from one to the other(s)
  // (e.g. more Work, less Rest and Family). Judged against THIS week's
  // own plan, not a prior week, so it can fire even in a domain's first
  // tracked week. Names up to 2 droppers (most severe first) — enough
  // to show the actual shift (both what rose AND what it came from)
  // without overloading one sentence; a person should be able to sense
  // "hours moved toward X" even when several things absorbed the cost,
  // not just see the winner in isolation. Folds each named dropper's
  // standalone drop signal into this one instead of leaving both — one
  // nuanced signal beats separate, disconnected ones for what's really
  // the same shift.
  const overachieved = summary.domains
    .filter(
      (d) => d.plannedHours >= MIN_MEANINGFUL_HOURS && d.completionRatio >= OVERACHIEVEMENT_RATIO,
    )
    .sort((a, b) => b.completionRatio - a.completionRatio)[0];
  const droppedSignals = overachieved
    ? domainSignals
        .filter((s) => s.reason === 'completion_drop' && s.domainName !== overachieved.name)
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 2)
    : [];

  if (overachieved && droppedSignals.length > 0) {
    droppedSignals.forEach((s) => domainSignals.splice(domainSignals.indexOf(s), 1));
    // The overachieving domain may ALSO independently qualify for its
    // own completion_improved (e.g. a big jump vs its prior week) —
    // drop that too so Work isn't reported twice under two reasons.
    const ownSignalIndex = domainSignals.findIndex((s) => s.domainName === overachieved.name);
    if (ownSignalIndex !== -1) domainSignals.splice(ownSignalIndex, 1);

    const droppedPairs = droppedSignals.map((s) => ({
      signal: s,
      domain: summary.domains.find((d) => d.name === s.domainName),
    }));
    // Scoped to just this group, not the whole plan — same reasoning as
    // relabelForPair below: a domain elsewhere sharing a principle with
    // one of THESE shouldn't force this self-contained sentence to mix
    // a label with a raw name.
    const pairDomains = [
      overachieved,
      ...droppedPairs.map((p) => p.domain).filter((d): d is WeeklyDomainSummary => Boolean(d)),
    ];
    const overachievedLabel = nameFor(pairDomains, overachieved);
    const droppedLabels = droppedPairs.map((p) =>
      p.domain ? nameFor(pairDomains, p.domain) : (p.signal.domainName ?? 'that area'),
    );
    const droppedPhrase =
      droppedLabels.length === 2
        ? `${droppedLabels[0]} and ${droppedLabels[1]} both slipped`
        : `${droppedLabels[0]} slipped`;

    signals.push({
      // Not 'celebrate' — this signal only exists BECAUSE another
      // domain genuinely dropped (that's what droppedSignals.length > 0
      // means). "Everything improved or held steady" is never true
      // when this fires, so per the same standard every other signal
      // is held to, it's worth attention, not applause — even though
      // the domain that rose did, on its own, do well. The phrasing
      // still leads with that win (see prompt.ts rule 2b); only the
      // tone/mood changes.
      kind: 'attention',
      scope: 'domain',
      domainName: overachieved.name,
      relatedDomainNames: droppedSignals
        .map((s) => s.domainName)
        .filter((n): n is string => Boolean(n)),
      reason: 'overachievement_tradeoff',
      detail: `${overachievedLabel} came in at ${pct(overachieved.completionRatio)} of plan this week, while ${droppedPhrase} week over week — likely the same hours moving between them.`,
      // Severity of the WORST embedded problem — a reallocation
      // wrapping a 50-point drop is a bigger deal than one wrapping a
      // 15-point drop, and needs to compete on those terms against
      // other attention signals (see the priority-tier comment below).
      severity: droppedSignals[0].severity,
      taskName: overachieved.topTask?.name,
    });
  }

  // Overall-scope check runs LAST, not first, and is gated on whether a
  // reallocation story above already explains the numbers. A domain
  // that genuinely took more time than planned is a KNOWN account of
  // where the hours went, even without knowing why that domain needed
  // more — "ambiguous, cause unknown" is the wrong frame once there's a
  // concrete redistribution pattern sitting right there in the data;
  // it would bury the more informative, more accurate story under a
  // vaguer one. Only ask the open "what was going on" question when
  // NOTHING in the data explains the drop — no domain rose to absorb it.
  const reallocationFired = overachieved != null && droppedSignals.length > 0;
  if (!reallocationFired) {
    const overallDecline = checkOverallDecline(summary.totals, summary.priorWeek);
    if (overallDecline) {
      signals.push(overallDecline);
    } else {
      const overall = checkCompletionPair(
        'overall',
        undefined,
        'overall',
        summary.totals.plannedHours,
        summary.totals.completionRatio,
        summary.priorWeek.plannedHours,
        summary.priorWeek.completionRatio,
      );
      if (overall) signals.push(overall);
    }
  }

  signals.push(...domainSignals);

  // Priority is a TIER: everything that isn't a pure celebration
  // (completion_improved, sustained_strong) belongs in the top tier —
  // overachievement_tradeoff is 'attention'-kind now too (see above),
  // so the explicit OR here is redundant in practice but kept as a
  // defensive, self-documenting condition rather than relying solely
  // on `kind` staying in sync with that decision. Within a tier, most
  // severe first — this is what makes "signals are given in priority
  // order" true, rather than something the model has to infer from
  // reading numbers in prose. Severity is intentionally not comparable
  // ACROSS reasons with real precision (a 0.6 completion-ratio drop
  // isn't "double" a 0.3 allocation-ratio drop) — it's a rough
  // ordering, not a score — good enough to get the worse-of-two
  // problems listed first.
  const priorityTier = (s: ScoredSignal) =>
    s.kind === 'attention' || s.reason === 'overachievement_tradeoff' ? 0 : 1;
  return signals
    .sort((a, b) => {
      const tierDiff = priorityTier(a) - priorityTier(b);
      if (tierDiff !== 0) return tierDiff;
      return b.severity - a.severity;
    })
    .map(({ severity: _severity, ...signal }) => signal);
}

// Which signal(s) the model actually gets shown, out of the full
// (already-priority-sorted) list `computeWeeklySignals` returns. This
// used to be a prompt instruction ("pick the most important, or the
// first two if both are problems") — observed failure mode: given 3+
// signals, the model would sometimes blend domain names ACROSS
// signals it was never told to combine (e.g. pairing one signal's win
// with a completely different signal's problem), asserting a
// relationship that was never in the data. Moving the choice of WHICH
// signals are even visible into code means that specific confusion is
// no longer possible — the model only ever sees the signal(s) it's
// meant to speak about, never a longer list to choose from.
//
// Two genuinely independent domain problems, whenever at least two
// exist ANYWHERE in the list, always win over a solo anything else —
// including a solo overachievement_tradeoff, even one that outranks
// them individually. Two real, unrelated problems is a more holistic,
// more useful answer than one combined narrative about a single pair
// of domains, especially since a tradeoff only ever explains ONE of
// several problems in a genuinely rough week. Falls back to the single
// top signal — whatever it is — only when fewer than two independent
// problems exist to combine.
//
// `domains` is optional (defaults to skipping relabeling) so existing
// callers/tests that only care about which signals get picked, not
// their exact wording, don't need to thread it through — but the real
// route always passes it, since two domains named in one sentence need
// their labels re-checked against EACH OTHER, not the whole plan (see
// relabelForPair) — a domain can correctly get a principle label solo
// and still need to fall back to its own name once paired with the
// specific other domain actually being mentioned alongside it.
export function selectSignalsForInsight(
  signals: WeeklySignal[],
  domains: WeeklyDomainSummary[] = [],
): WeeklySignal[] {
  if (signals.length === 0) return [];
  // Absolute priority, never combined with anything else: if overall
  // logged hours genuinely fell off a cliff, that's a more fundamental
  // question than any single domain's story, and — since the cause is
  // deliberately left unguessed (see checkOverallDecline) — diluting it
  // with unrelated domain detail would bury the one thing worth asking
  // the person about directly.
  const overallDecline = signals.find((s) => s.reason === 'overall_decline_ambiguous');
  if (overallDecline) return [overallDecline];

  // overachievement_tradeoff is excluded here even though it's now
  // 'attention'-kind and 'domain'-scoped (see computeWeeklySignals) —
  // it already names up to 3 domains on its own (the riser + up to 2
  // droppers), so treating it as ONE combinable "independent problem"
  // would let it get paired with a THIRD, unrelated domain, exactly
  // the cross-signal grounding confusion selectSignalsForInsight was
  // built to prevent in the first place. It can still be outranked by
  // two genuinely independent problems (see below); it just never
  // joins them as one of the two.
  const independentProblems = signals.filter(
    (s) => s.kind === 'attention' && s.scope === 'domain' && s.reason !== 'overachievement_tradeoff',
  );
  if (independentProblems.length >= 2) {
    const [first, second] = independentProblems;
    const pairDomains = [first, second]
      .map((s) => domains.find((d) => d.name === s.domainName))
      .filter((d): d is WeeklyDomainSummary => Boolean(d));
    if (pairDomains.length === 2) {
      return [
        relabelForPair(first, domains, pairDomains),
        relabelForPair(second, domains, pairDomains),
      ];
    }
    return [first, second];
  }
  return [signals[0]];
}
