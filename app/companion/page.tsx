'use client';

// Kenji companion — the ongoing chat surface, extending the one-line
// weekly insight into a real back-and-forth. Signed-in only (see
// docs/specs/ai-companion.md); local-only users never reach this page.
//
// Not wired yet: this week's WeeklyMetricsSummary (the optional
// `weeklySummary` field /api/companion/message already accepts) —
// building it here would mean duplicating app/insights/page.tsx's
// week-plan/week-log data-fetching pipeline. The route already
// degrades gracefully without it (empty signals/goals section in the
// reply prompt). A reasonable fast-follow, not done in this pass.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRepository } from '../../components/RepositoryProvider';
import { CompanionDisclosureModal } from '../../components/CompanionDisclosureModal';
import ModernMonk from '../../components/ModernMonk';
import { useTheme, getMonkVariantForTheme } from '../../hooks/useTheme';
import { createClient } from '../../lib/supabase/client';
import { errorMessage } from '../../lib/errors';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function CompanionPage() {
  const { status, userId, settingsRepo } = useRepository();
  const theme = useTheme();
  const monkVariant = getMonkVariantForTheme(theme);

  const [disclosureAcknowledged, setDisclosureAcknowledged] = useState<boolean | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Disclosure state — read via the same settingsRepo every other page
  // uses (local for signed-out, cloud for signed-in), consistent with
  // aiInsightsEnabled's own read path.
  useEffect(() => {
    if (status !== 'signed-in' || !settingsRepo) return;
    let cancelled = false;
    settingsRepo
      .getSettings()
      .then((settings) => {
        if (!cancelled) setDisclosureAcknowledged(Boolean(settings.companionDisclosureAcknowledgedAt));
      })
      .catch(() => {
        if (!cancelled) setDisclosureAcknowledged(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, settingsRepo]);

  // History — read directly via the browser Supabase client (RLS-
  // scoped), same as every other page reads its own data. No GET route.
  useEffect(() => {
    if (status !== 'signed-in' || !userId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data, error: fetchError } = await supabase
        .from('companion_messages')
        .select('id, role, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (fetchError) {
        setError(errorMessage(fetchError));
      } else {
        setMessages(
          (data ?? []).map((row: { id: string; role: string; content: string }) => ({
            id: row.id,
            role: row.role as 'user' | 'assistant',
            content: row.content,
          })),
        );
      }
      setHistoryLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, userId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  const acknowledgeDisclosure = async () => {
    if (!settingsRepo) return;
    // Pessimistic on purpose: the modal stays open (and the button
    // shows "Saving…") until the write actually lands, rather than
    // flipping disclosureAcknowledged optimistically and racing a
    // reload or navigation against an in-flight save — a real failure
    // mode this surfaced during testing (a reload right after clicking
    // Continue could outrun the save and re-show the modal next time).
    setAcknowledging(true);
    try {
      const current = await settingsRepo.getSettings();
      await settingsRepo.saveSettings({
        ...current,
        companionDisclosureAcknowledgedAt: new Date().toISOString(),
      });
      setDisclosureAcknowledged(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAcknowledging(false);
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setError(null);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const response = await fetch('/api/companion/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const body = (await response.json()) as
        | { reply: string; conversationId: string; crisis: boolean }
        | { error: string };
      if (!response.ok || 'error' in body) {
        throw new Error('error' in body ? body.error : `status ${response.status}`);
      }
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: body.reply },
      ]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <main
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-6 py-12"
      data-testid="companion-page"
    >
      <header className="flex items-center gap-3">
        <ModernMonk variant={monkVariant} mood="calm" size={64} message="" />
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-mutedText">Companion</p>
          <h1 className="text-2xl font-semibold text-text">Talk with Kenji</h1>
        </div>
      </header>

      {status === undefined ? (
        <p className="text-sm text-mutedText">Loading…</p>
      ) : status !== 'signed-in' ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-surface p-6 text-center shadow-sm">
          <p className="text-sm text-text">Sign in to talk with Kenji.</p>
          <p className="text-sm text-mutedText">
            The companion chat is only available for signed-in accounts — it needs somewhere
            to remember your conversation.
          </p>
          <Link
            href="/login?next=/companion"
            data-testid="companion-signin"
            className="mt-2 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Sign in
          </Link>
        </section>
      ) : disclosureAcknowledged === null || !historyLoaded ? (
        <p className="text-sm text-mutedText">Loading…</p>
      ) : (
        <>
          {!disclosureAcknowledged ? (
            <CompanionDisclosureModal
              onAcknowledge={() => void acknowledgeDisclosure()}
              saving={acknowledging}
            />
          ) : null}

          {error ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {error}
            </div>
          ) : null}

          <div
            ref={listRef}
            data-testid="companion-message-list"
            className="flex min-h-[50vh] flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border border-slate-200 bg-surface p-4"
          >
            {messages.length === 0 ? (
              <p className="text-sm text-mutedText">
                Say whatever&apos;s on your mind — Kenji&apos;s listening.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === 'user'
                      ? 'ml-auto bg-accent text-white'
                      : 'mr-auto bg-slate-100 text-text'
                  }`}
                >
                  {m.content}
                </div>
              ))
            )}
            {sending ? (
              <p className="mr-auto text-xs italic text-mutedText">Kenji is thinking…</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={!disclosureAcknowledged || sending}
              placeholder="Type a message…"
              data-testid="companion-input"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!disclosureAcknowledged || sending || draft.trim().length === 0}
              data-testid="companion-send"
              className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Send
            </button>
          </div>
        </>
      )}
    </main>
  );
}
