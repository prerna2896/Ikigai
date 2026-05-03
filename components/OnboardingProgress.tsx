'use client';

type OnboardingProgressProps = {
  step: number;
  total: number;
};

export function OnboardingProgress({ step, total }: OnboardingProgressProps) {
  const percent = Math.round((step / total) * 100);

  return (
    <div className="fixed inset-x-0 top-0 z-50">
      <div className="h-1 w-full bg-slate-100">
        <div
          className="h-1 bg-accent transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="px-6 pt-1">
        <p className="text-right text-xs text-mutedText">
          Step {step} of {total}
        </p>
      </div>
    </div>
  );
}
