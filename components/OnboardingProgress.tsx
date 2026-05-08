'use client';

type OnboardingProgressProps = {
  step: number;
  total: number;
  label?: string;
};

export function OnboardingProgress({ step, total, label }: OnboardingProgressProps) {
  const segments = Array.from({ length: total }, (_, index) => index < step);

  return (
    <div className="space-y-2">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        {segments.map((filled, index) => (
          <div
            key={index}
            className={`h-1 rounded-full transition-colors duration-300 ${
              filled ? 'bg-accent' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-mutedText">
        Step {step} of {total}
        {label ? ` · ${label}` : ''}
      </p>
    </div>
  );
}
