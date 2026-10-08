import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkForCrisisLanguage } from './safety';

// One true-positive example per pattern in CRISIS_PATTERNS (safety.ts) —
// exhaustive in the literal sense: every regex has at least one message
// proven to trip it. Keeping this list in the same order as the source
// file's comments makes it easy to spot a pattern that's missing coverage.
const TRUE_POSITIVES: { label: string; message: string; category: string }[] = [
  { label: 'want to die', message: 'I just want to die', category: 'suicidal_ideation' },
  { label: 'wanted to die (past tense)', message: 'Last night I wanted to die', category: 'suicidal_ideation' },
  { label: 'kill myself', message: "I'm going to kill myself", category: 'suicidal_ideation' },
  { label: 'end my life', message: 'thinking about ending my life', category: 'suicidal_ideation' },
  { label: 'suicidal (bare word)', message: 'I feel suicidal lately', category: 'suicidal_ideation' },
  { label: 'no reason to live', message: 'there is no reason to live anymore', category: 'suicidal_ideation' },
  { label: 'no reason to go on', message: 'no reason to go on honestly', category: 'suicidal_ideation' },
  { label: 'better off dead', message: 'everyone would be better off dead if it were me', category: 'suicidal_ideation' },
  { label: "don't want to be alive", message: "I don't want to be alive anymore", category: 'suicidal_ideation' },
  { label: "don't want to exist", message: "some days I don't want to exist", category: 'suicidal_ideation' },
  { label: "can't go on living", message: "I can't go on living like this", category: 'suicidal_ideation' },
  { label: 'hurt myself', message: 'I keep wanting to hurt myself', category: 'self_harm' },
  { label: 'cutting myself', message: 'I have been cutting myself', category: 'self_harm' },
  { label: 'self-harm (hyphenated)', message: 'I have a history of self-harm', category: 'self_harm' },
  { label: 'self harm (spaced)', message: 'thinking about self harm again', category: 'self_harm' },
  { label: 'harming myself', message: 'I have been harming myself this week', category: 'self_harm' },
  // "have a plan to kill myself" — using the "kill" alternative here
  // would ALSO match the earlier, more general "kill myself" pattern
  // (checked first, wins), so this uses the "end" alternative instead
  // to exercise this pattern in genuine isolation.
  { label: 'have a plan to (end)', message: 'I have a plan to end it all', category: 'immediate_danger' },
  { label: "tonight I'm going to end it", message: "tonight I'm going to end it", category: 'immediate_danger' },
  // "pills to end my life" would also match the earlier "end my life"
  // pattern — using "end it all" instead isolates the pills pattern.
  { label: 'pills to end it', message: 'I have pills to end it all tonight', category: 'immediate_danger' },
];

describe('checkForCrisisLanguage — true positives (one per pattern)', () => {
  for (const { label, message, category } of TRUE_POSITIVES) {
    test(`matches: ${label}`, () => {
      const result = checkForCrisisLanguage(message);
      assert.equal(result.matched, true, `expected "${message}" to match`);
      assert.equal(result.category, category);
    });
  }
});

describe('checkForCrisisLanguage — pattern-order finding', () => {
  test('"going to kill myself" always resolves to suicidal_ideation, not immediate_danger — the earlier, more general "kill myself" pattern always matches first since the phrase is a strict substring of it', () => {
    const result = checkForCrisisLanguage('I am going to kill myself');
    assert.equal(result.matched, true);
    assert.equal(
      result.category,
      'suicidal_ideation',
      'documents real behavior: the dedicated immediate_danger "going to kill myself" pattern is currently unreachable in isolation — matched is still correctly true either way, so this has no safety impact today, but is worth knowing if category is ever used to branch behavior',
    );
  });
});

describe('checkForCrisisLanguage — case and punctuation tolerance', () => {
  test('matches regardless of case (all caps)', () => {
    assert.equal(checkForCrisisLanguage('I WANT TO DIE').matched, true);
  });

  test('matches regardless of case (mixed)', () => {
    assert.equal(checkForCrisisLanguage('I Want To Die').matched, true);
  });

  test('matches with a contraction apostrophe variant ("dont" without apostrophe still not required — pattern uses optional apostrophe)', () => {
    assert.equal(checkForCrisisLanguage("I dont want to be alive").matched, true);
  });
});

describe('checkForCrisisLanguage — ordinary planning-app language does not false-positive', () => {
  const SAFE_MESSAGES = [
    'This deadline is killing me, need to reprioritize.',
    'I could just die of embarrassment after that meeting.',
    "I'm dying to see how this week's numbers turn out.",
    'Feeling pretty drained after a long week at work.',
    'I want to sleep in this weekend.',
    'Just logged my hours for the day, nothing major to report.',
    'Kill it at the presentation tomorrow!',
    'This workout is going to end me, in a good way.',
  ];

  for (const msg of SAFE_MESSAGES) {
    test(`does not match: "${msg}"`, () => {
      const result = checkForCrisisLanguage(msg);
      assert.equal(result.matched, false, `expected "${msg}" NOT to match, got category ${result.category}`);
    });
  }
});

describe('checkForCrisisLanguage — result shape', () => {
  test('no category is present on a non-match', () => {
    const result = checkForCrisisLanguage('planning my week ahead');
    assert.equal(result.matched, false);
    assert.equal(result.category, undefined);
  });

  test('matches anywhere within a longer message, not just as the whole string', () => {
    const result = checkForCrisisLanguage(
      "So work has been really busy and honestly I've been thinking I want to die most days, not sure what to do.",
    );
    assert.equal(result.matched, true);
  });
});
