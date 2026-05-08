'use client';

import { useEffect, useRef, useState } from 'react';

type PlanActionsMenuProps = {
  canUpdate: boolean;
  onUpdate: () => void;
  onReset: () => void;
};

export default function PlanActionsMenu({
  canUpdate,
  onUpdate,
  onReset,
}: PlanActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Plan actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="plan-actions-toggle"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 text-mutedText transition-colors hover:border-slate-400 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 8a5.5 5.5 0 1 0 1.7-3.95" />
          <path d="M2.5 3v3h3" />
        </svg>
      </button>
      {open ? (
        <ul
          role="menu"
          data-testid="plan-actions-menu"
          className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-slate-200 bg-surface text-sm shadow-lg"
        >
          {canUpdate ? (
            <li>
              <button
                type="button"
                role="menuitem"
                data-testid="plan-action-update"
                onClick={() => {
                  setOpen(false);
                  onUpdate();
                }}
                className="block w-full px-3 py-2 text-left text-text transition-colors hover:bg-bg/40"
              >
                Update plan
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              role="menuitem"
              data-testid="plan-action-reset"
              onClick={() => {
                setOpen(false);
                onReset();
              }}
              className="block w-full px-3 py-2 text-left text-rose-700 transition-colors hover:bg-rose-50"
            >
              Reset week
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
