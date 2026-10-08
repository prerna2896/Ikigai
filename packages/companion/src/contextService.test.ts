import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  determineConversationId,
  isPersonaStale,
  isRecentInteractionStale,
  SESSION_GAP_MS,
  PERSONA_STALE_DAYS,
  PERSONA_STALE_MESSAGE_COUNT,
} from './contextService';
import { SAMPLE_MESSAGES, SAMPLE_CONTEXTS } from './sampleData';

describe('determineConversationId', () => {
  test('no prior message → a fresh id', () => {
    const id = determineConversationId({ lastMessage: null, now: new Date('2026-09-20T10:00:00.000Z') });
    assert.match(id, /^[0-9a-f-]{36}$/i);
  });

  test('within the session gap → reuses the last message\'s conversationId', () => {
    const now = new Date(new Date(SAMPLE_MESSAGES.recentUserMessage.createdAt).getTime() + SESSION_GAP_MS - 1);
    const id = determineConversationId({ lastMessage: SAMPLE_MESSAGES.recentUserMessage, now });
    assert.equal(id, SAMPLE_MESSAGES.recentUserMessage.conversationId);
  });

  test('exactly at the session gap boundary → still the SAME conversation (strictly greater-than triggers a new one)', () => {
    const now = new Date(new Date(SAMPLE_MESSAGES.recentUserMessage.createdAt).getTime() + SESSION_GAP_MS);
    const id = determineConversationId({ lastMessage: SAMPLE_MESSAGES.recentUserMessage, now });
    assert.equal(id, SAMPLE_MESSAGES.recentUserMessage.conversationId);
  });

  test('past the session gap → a fresh id, not the old conversationId', () => {
    const now = new Date(new Date(SAMPLE_MESSAGES.recentUserMessage.createdAt).getTime() + SESSION_GAP_MS + 1);
    const id = determineConversationId({ lastMessage: SAMPLE_MESSAGES.recentUserMessage, now });
    assert.notEqual(id, SAMPLE_MESSAGES.recentUserMessage.conversationId);
  });

  test('a message from days ago → a fresh id', () => {
    const id = determineConversationId({
      lastMessage: SAMPLE_MESSAGES.oldUserMessage,
      now: new Date('2026-09-20T10:00:00.000Z'),
    });
    assert.notEqual(id, SAMPLE_MESSAGES.oldUserMessage.conversationId);
  });
});

describe('isPersonaStale', () => {
  const now = new Date('2026-09-20T10:00:00.000Z');

  test('null context → stale (nothing built yet)', () => {
    assert.equal(isPersonaStale({ context: null, totalMessageCount: 5, now }), true);
  });

  test('context exists but personaUpdatedAt is null → stale', () => {
    assert.equal(
      isPersonaStale({ context: SAMPLE_CONTEXTS.freshNeverBuilt, totalMessageCount: 5, now }),
      true,
    );
  });

  test('recently updated, few new messages → NOT stale', () => {
    assert.equal(
      isPersonaStale({ context: SAMPLE_CONTEXTS.personaRecent, totalMessageCount: 12, now }),
      false,
    );
  });

  test(`older than ${PERSONA_STALE_DAYS} days → stale, even with no new messages`, () => {
    assert.equal(
      isPersonaStale({
        context: SAMPLE_CONTEXTS.personaStaleByAge,
        totalMessageCount: SAMPLE_CONTEXTS.personaStaleByAge!.personaSourceMessageCount,
        now,
      }),
      true,
    );
  });

  test(`>= ${PERSONA_STALE_MESSAGE_COUNT} new messages since last recompute → stale, even if recently updated`, () => {
    const totalMessageCount = SAMPLE_CONTEXTS.personaStaleByMessageCount!.personaSourceMessageCount + PERSONA_STALE_MESSAGE_COUNT;
    assert.equal(
      isPersonaStale({ context: SAMPLE_CONTEXTS.personaStaleByMessageCount, totalMessageCount, now }),
      true,
    );
  });

  test(`exactly ${PERSONA_STALE_MESSAGE_COUNT - 1} new messages → NOT yet stale by the message-count trigger`, () => {
    const totalMessageCount = SAMPLE_CONTEXTS.personaRecent!.personaSourceMessageCount + (PERSONA_STALE_MESSAGE_COUNT - 1);
    assert.equal(
      isPersonaStale({ context: SAMPLE_CONTEXTS.personaRecent, totalMessageCount, now }),
      false,
    );
  });
});

describe('isRecentInteractionStale', () => {
  test('null context → stale', () => {
    assert.equal(isRecentInteractionStale({ context: null, currentConversationId: 'conv-1' }), true);
  });

  test('context exists but recentInteractionConversationId is null → stale', () => {
    assert.equal(
      isRecentInteractionStale({ context: SAMPLE_CONTEXTS.freshNeverBuilt, currentConversationId: 'conv-1' }),
      true,
    );
  });

  test('matches the current conversation → NOT stale (already refreshed for this session)', () => {
    assert.equal(
      isRecentInteractionStale({
        context: SAMPLE_CONTEXTS.recentInteractionMatchingConversation,
        currentConversationId: 'conv-1',
      }),
      false,
    );
  });

  test('a different conversation id → stale (a new session has started since last refresh)', () => {
    assert.equal(
      isRecentInteractionStale({
        context: SAMPLE_CONTEXTS.recentInteractionStaleConversation,
        currentConversationId: 'conv-NEW',
      }),
      true,
    );
  });
});
