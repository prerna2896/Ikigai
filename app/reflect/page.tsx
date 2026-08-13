'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../lib/errors';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { WeekNote, WeekPlan } from '@ikigai/core';
import {
  decodeReflectionNote,
  encodeReflectionNote,
  formatReflectionTimestamp,
  reflectionCategoryLabel,
  type ParsedReflectionNote,
  type ReflectionCategoryId,
} from '../../lib/reflectionNotes';
import { useRepository } from '../../components/RepositoryProvider';
import { useCloudSyncVersion } from '../../components/CloudSyncProvider';
import type { WeekNoteRepository } from '@ikigai/storage';
import { useStashedField } from '../../lib/useStashedField';
import { StashRestoreBanner } from '../../components/StashRestoreBanner';

// Session-storage keys for the two long-form text inputs on this
// page. Draft is scoped per reflection-category so switching between
// categories doesn't cross-pollinate drafts; check-in is a single
// singleton key. See lib/formStash.ts for the namespace + envelope.
//
// When no category is open we still have to give useStashedField a
// stable key (hooks can't be conditional). The `__none__` sentinel
// slot is never actually written to — stashForm is only called via
// setValue, which we never call while no category is active.
const NO_CATEGORY_KEY = '__none__';
const stashKey = {
  draft: (categoryId: CategoryId | null) =>
    `reflect.draft:${categoryId ?? NO_CATEGORY_KEY}`,
  checkIn: () => 'reflect.checkIn',
} as const;

type CategoryId = ReflectionCategoryId;
type ParsedNote = ParsedReflectionNote;
type ViewMode = 'add' | 'history';

type Category = {
  id: CategoryId;
  title: string;
  description: string;
  placeholder: string;
};

const CATEGORIES: Category[] = [
  {
    id: 'on_mind',
    title: 'What’s on your mind?',
    description: 'Anything looping in your head right now.',
    placeholder: 'Just a few words is enough…',
  },
  {
    id: 'helped',
    title: 'What moved you forward',
    description: 'Small wins or moments that supported your goals.',
    placeholder: 'What helped today?',
  },
  {
    id: 'hindered',
    title: 'What pulled you back',
    description: 'Friction or distractions that got in the way.',
    placeholder: 'What got in the way?',
  },
  {
    id: 'lessons',
    title: 'Lessons & reminders',
    description: 'Notes for the rest of this week.',
    placeholder: 'A line or two is plenty…',
  },
];

const CHECK_IN_EMOJIS = ['😄', '😭', '😌', '😴', '⭐'] as const;

const QUOTE = 'Clarity comes from looking, not from forcing.';

export default function ReflectPage() {
  return (
    <Suspense fallback={null}>
      <ReflectPageContent />
    </Suspense>
  );
}

function ReflectPageContent() {
  const searchParams = useSearchParams();
  const { weekPlanRepo, weekNoteRepo } = useRepository();
  const cloudVersion = useCloudSyncVersion();
  const initialView: ViewMode =
    searchParams.get('view') === 'history' ? 'history' : 'add';
  const [view, setView] = useState<ViewMode>(initialView);

  useEffect(() => {
    const next = searchParams.get('view') === 'history' ? 'history' : 'add';
    setView(next);
  }, [searchParams]);

  const [latestWeek, setLatestWeek] = useState<WeekPlan | null>(null);
  const [notes, setNotes] = useState<ParsedNote[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<CategoryId | null>(
    null,
  );
  // Category-scoped draft. The hook is keyed on activeCategoryId, so
  // opening a new category re-derives pendingRestore against that
  // category's slot in sessionStorage — no more manual retrieveForm
  // in openCategory().
  const {
    value: draft,
    setValue: setDraft,
    pendingRestore: draftRestore,
    restore: restoreDraft,
    discard: discardDraft,
    clear: clearDraft,
  } = useStashedField<string>(stashKey.draft(activeCategoryId), '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const [checkInEmoji, setCheckInEmoji] = useState<string | null>(null);
  const {
    value: checkInText,
    setValue: setCheckInText,
    pendingRestore: checkInRestore,
    restore: restoreCheckIn,
    discard: discardCheckIn,
    clear: clearCheckIn,
  } = useStashedField<string>(stashKey.checkIn(), '');
  const [isSavingCheckIn, setIsSavingCheckIn] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const refreshLatestNotes = useCallback(
    async (repo: WeekNoteRepository, plan: WeekPlan) => {
      const records = await repo.listWeekNotes(plan.id);
      const parsed = records.map(decodeReflectionNote);
      parsed.sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
      setNotes(parsed);
    },
    [],
  );

  useEffect(() => {
    if (!weekPlanRepo || !weekNoteRepo) return;
    let cancelled = false;
    weekPlanRepo
      .listWeekPlans()
      .then(async (plans) => {
        if (cancelled || plans.length === 0) return;
        const sorted = [...plans].sort((a, b) =>
          a.weekStartISO < b.weekStartISO ? 1 : -1,
        );
        setLatestWeek(sorted[0]);
        await refreshLatestNotes(weekNoteRepo, sorted[0]);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshLatestNotes, weekPlanRepo, weekNoteRepo, cloudVersion]);

  useEffect(() => {
    if (!activeCategoryId) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveCategoryId(null);
        setJustSavedId(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeCategoryId]);

  const recentCheckInEmojis = useMemo(
    () =>
      notes
        .filter((n) => n.categoryId === 'check_in' && Boolean(n.emoji))
        .slice(0, 5)
        .map((n) => n.emoji as string),
    [notes],
  );

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.id === activeCategoryId) ?? null,
    [activeCategoryId],
  );

  const activeEntries = useMemo(() => {
    if (!activeCategoryId) return [];
    return notes.filter(
      (note) => note.categoryId === activeCategoryId && note.text.trim().length,
    );
  }, [notes, activeCategoryId]);

  const openCategory = (id: CategoryId) => {
    // Just switch the active id — useStashedField re-keys on
    // activeCategoryId and re-derives pendingRestore itself, so we
    // no longer read stash directly here.
    setActiveCategoryId(id);
    setJustSavedId(null);
    setError(null);
  };

  const closeModal = () => {
    // Leave the stash in place — user closed the modal but didn't
    // save. If they reopen the same category the banner will offer
    // to restore. Only saves + explicit Discard clear the stash.
    setActiveCategoryId(null);
    setJustSavedId(null);
  };

  const handleSave = async () => {
    if (!activeCategory) return;
    const text = draft.trim();
    if (!text) {
      setError('Add a few words before saving.');
      return;
    }
    if (!latestWeek) {
      setError('Set up a week plan to save reflections.');
      return;
    }
    if (!weekNoteRepo) return;
    try {
      setIsSaving(true);
      setError(null);
      const nowIso = new Date().toISOString();
      const newNote: WeekNote = {
        id: crypto.randomUUID(),
        weekId: latestWeek.id,
        note: encodeReflectionNote(activeCategory.id, text),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await weekNoteRepo.saveWeekNote(newNote);
      await refreshLatestNotes(weekNoteRepo, latestWeek);
      setJustSavedId(newNote.id);
      setDraft('');
      // Successful save = draft is now persisted in cloud, no longer
      // an in-progress local artifact.
      clearDraft();
      closeModal();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const canSaveCheckIn = Boolean(checkInEmoji) || checkInText.trim().length > 0;

  const handleSaveCheckIn = async () => {
    if (!latestWeek) {
      setCheckInError('Set up a week plan to save check-ins.');
      return;
    }
    if (!canSaveCheckIn) {
      setCheckInError('Pick an emoji or add a word.');
      return;
    }
    if (!weekNoteRepo) return;
    try {
      setIsSavingCheckIn(true);
      setCheckInError(null);
      const nowIso = new Date().toISOString();
      const newNote: WeekNote = {
        id: crypto.randomUUID(),
        weekId: latestWeek.id,
        note: encodeReflectionNote('check_in', checkInText.trim(), {
          emoji: checkInEmoji,
        }),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await weekNoteRepo.saveWeekNote(newNote);
      await refreshLatestNotes(weekNoteRepo, latestWeek);
      setCheckInEmoji(null);
      setCheckInText('');
      clearCheckIn();
      setCheckInStatus('Logged.');
      window.setTimeout(() => setCheckInStatus(null), 1500);
    } catch (err) {
      setCheckInError(errorMessage(err));
    } finally {
      setIsSavingCheckIn(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
          A quick pause
        </p>
        <h1 className="text-3xl font-semibold text-text">Reflect</h1>
        <p className="text-sm text-mutedText sm:text-base">
          {view === 'add'
            ? 'Tap a card to leave a note. Every entry stays with this week.'
            : 'Everything you’ve saved against this week.'}
        </p>
      </header>

      <div
        className="inline-flex items-center gap-1 self-start rounded-full border border-slate-200 bg-white p-1 text-xs"
        role="tablist"
        aria-label="Reflect view"
        data-testid="reflect-view-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === 'add'}
          onClick={() => setView('add')}
          data-testid="reflect-view-add"
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            view === 'add'
              ? 'bg-accent text-white shadow-sm'
              : 'text-mutedText hover:text-text'
          }`}
        >
          Add
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'history'}
          onClick={() => setView('history')}
          data-testid="reflect-view-history"
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            view === 'history'
              ? 'bg-accent text-white shadow-sm'
              : 'text-mutedText hover:text-text'
          }`}
        >
          Past · {notes.filter((n) => n.text || n.emoji).length}
        </button>
      </div>

      {!latestWeek ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          Reflections attach to a week.{' '}
          <Link
            href="/week/plan"
            className="text-text underline-offset-2 hover:underline"
          >
            Set up a week
          </Link>{' '}
          first.
        </div>
      ) : null}

      {error && !activeCategoryId ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          {error}
        </div>
      ) : null}

      {view === 'add' ? (
      <>
      <section
        className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5"
        aria-labelledby="check-in-heading"
      >
        <div className="flex items-center justify-between gap-3">
          <p
            id="check-in-heading"
            className="text-xs uppercase tracking-[0.2em] text-mutedText"
          >
            How did today feel?
          </p>
          {checkInStatus ? (
            <span className="text-xs text-mutedText" aria-live="polite">
              {checkInStatus}
            </span>
          ) : recentCheckInEmojis.length > 0 ? (
            <span className="text-sm" aria-label="Recent check-ins">
              {recentCheckInEmojis.join(' ')}
            </span>
          ) : null}
        </div>
        {checkInRestore !== null ? (
          <div className="mt-3">
            <StashRestoreBanner
              onRestore={restoreCheckIn}
              onDiscard={discardCheckIn}
            />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1"
            role="radiogroup"
            aria-label="How did today feel?"
          >
            {CHECK_IN_EMOJIS.map((emoji) => {
              const selected = checkInEmoji === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() =>
                    setCheckInEmoji(selected ? null : emoji)
                  }
                  className={`rounded-full p-1.5 text-xl leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 ${
                    selected
                      ? 'bg-accentSoft ring-2 ring-accent ring-offset-1'
                      : 'hover:bg-slate-100'
                  }`}
                >
                  <span aria-hidden>{emoji}</span>
                  <span className="sr-only">Select {emoji}</span>
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={checkInText}
            onChange={(event) => setCheckInText(event.target.value)}
            placeholder="One word — what stood out?"
            aria-label="One word — what stood out?"
            className="min-w-[180px] flex-1 border-0 border-b border-slate-200 bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-mutedText focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSaveCheckIn}
            disabled={isSavingCheckIn || !canSaveCheckIn || !latestWeek}
            className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingCheckIn ? 'Saving…' : 'Save log'}
          </button>
        </div>
        {checkInError ? (
          <p role="alert" className="mt-2 text-xs text-rose-600">
            {checkInError}
          </p>
        ) : null}
      </section>

      <section
        className="grid gap-4 sm:grid-cols-2"
        aria-label="Reflection categories"
      >
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => openCategory(category.id)}
            className="flex h-full flex-col rounded-2xl border border-slate-200 bg-surface p-5 text-left shadow-sm transition-colors hover:border-accent/50 hover:bg-accentSoft/40 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            aria-label={`Open ${category.title}`}
          >
            <h2 className="text-base font-semibold text-text">
              {category.title}
            </h2>
            <p className="mt-1 text-xs text-mutedText">
              {category.description}
            </p>
          </button>
        ))}
      </section>

      <p className="text-center text-sm italic text-mutedText">
        &ldquo;{QUOTE}&rdquo;
      </p>
      </>
      ) : (
        <PastReflections notes={notes} />
      )}

      {activeCategory ? (
        <ReflectModal
          category={activeCategory}
          entries={activeEntries}
          draft={draft}
          onDraftChange={setDraft}
          draftRestore={draftRestore}
          onRestoreDraft={restoreDraft}
          onDiscardDraft={discardDraft}
          onClose={closeModal}
          onSave={handleSave}
          isSaving={isSaving}
          justSavedId={justSavedId}
          error={error}
          canSave={Boolean(latestWeek)}
        />
      ) : null}
    </main>
  );
}

const CATEGORY_ORDER: ReflectionCategoryId[] = [
  'on_mind',
  'helped',
  'hindered',
  'lessons',
  'check_in',
];

function PastReflections({ notes }: { notes: ParsedNote[] }) {
  const groups = useMemo(() => {
    const buckets = new Map<ReflectionCategoryId, ParsedNote[]>();
    for (const note of notes) {
      if (!note.categoryId) continue;
      const hasContent = note.text.trim().length > 0 || Boolean(note.emoji);
      if (!hasContent) continue;
      const list = buckets.get(note.categoryId) ?? [];
      list.push(note);
      buckets.set(note.categoryId, list);
    }
    return CATEGORY_ORDER.flatMap((id) => {
      const entries = buckets.get(id);
      if (!entries || entries.length === 0) return [];
      return [{ id, entries }];
    });
  }, [notes]);

  if (groups.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-surface p-6 text-sm text-mutedText shadow-sm">
        Nothing saved against this week yet. Add your first note from the Add
        tab.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="reflect-history-list">
      {groups.map((group) => {
        const isCheckIn = group.id === 'check_in';
        return (
          <section
            key={group.id}
            className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm"
            data-testid="reflect-history-group"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs uppercase tracking-[0.18em] text-mutedText">
                {isCheckIn
                  ? 'Check-ins'
                  : reflectionCategoryLabel(group.id)}
              </h2>
              <span className="text-[11px] text-mutedText">
                {group.entries.length}{' '}
                {group.entries.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {isCheckIn ? (
              <ul
                className="mt-3 flex flex-wrap gap-2"
                aria-label="Check-ins"
              >
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-2 rounded-full border border-slate-200 bg-bg/40 px-3 py-1 text-xs text-mutedText"
                    data-testid="reflect-history-entry"
                    title={formatReflectionTimestamp(entry.createdAt)}
                  >
                    {entry.emoji ? (
                      <span aria-hidden className="text-base leading-none">
                        {entry.emoji}
                      </span>
                    ) : null}
                    {entry.text ? (
                      <span className="text-text">{entry.text}</span>
                    ) : null}
                    <span className="text-[10px] text-mutedText">
                      {formatReflectionTimestamp(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <ol className="mt-3 space-y-2">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-xl border border-slate-100 bg-bg/40 px-3 py-2"
                    data-testid="reflect-history-entry"
                  >
                    <p className="whitespace-pre-wrap text-sm text-text">
                      {entry.text}
                    </p>
                    <p className="mt-1 text-[10px] text-mutedText">
                      {formatReflectionTimestamp(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

type ReflectModalProps = {
  category: Category;
  entries: ParsedNote[];
  draft: string;
  onDraftChange: (value: string) => void;
  draftRestore: string | null;
  onRestoreDraft: () => void;
  onDiscardDraft: () => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
  justSavedId: string | null;
  error: string | null;
  canSave: boolean;
};

function ReflectModal({
  category,
  entries,
  draft,
  onDraftChange,
  draftRestore,
  onRestoreDraft,
  onDiscardDraft,
  onClose,
  onSave,
  isSaving,
  justSavedId,
  error,
  canSave,
}: ReflectModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reflect-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />
      <div className="relative z-10 flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-mutedText">
              Reflect
            </p>
            <h2
              id="reflect-modal-title"
              className="mt-1 text-lg font-semibold text-text"
            >
              {category.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-mutedText transition-colors hover:bg-slate-100 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <label
            htmlFor="reflect-draft"
            className="text-xs uppercase tracking-[0.18em] text-mutedText"
          >
            Add a new note
          </label>
          {draftRestore !== null ? (
            <div className="mt-2">
              <StashRestoreBanner
                onRestore={onRestoreDraft}
                onDiscard={onDiscardDraft}
              />
            </div>
          ) : null}
          <textarea
            id="reflect-draft"
            rows={4}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={category.placeholder}
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-text placeholder:text-mutedText focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
            autoFocus
          />
          {error ? (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || !canSave}
              className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save note'}
            </button>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <p className="text-xs uppercase tracking-[0.18em] text-mutedText">
              Previously saved · {entries.length}
            </p>
            {entries.length === 0 ? (
              <p className="mt-3 text-sm text-mutedText">
                Nothing saved here yet.
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className={`rounded-xl border p-3 ${
                      entry.id === justSavedId
                        ? 'border-accent/40 bg-accentSoft'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="text-xs uppercase tracking-[0.16em] text-mutedText">
                      {formatReflectionTimestamp(entry.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text">
                      {entry.text}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
