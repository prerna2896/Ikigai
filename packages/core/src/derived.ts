import type { Settings } from './types';

export const STRICTNESS_BUFFER_MAP: Record<Settings['strictness'], number> = {
  very_flexible: 40,
  somewhat_flexible: 30,
  structured: 20,
  very_structured: 10,
};

export const getBufferPercentForStrictness = (
  strictness: Settings['strictness'],
): number => STRICTNESS_BUFFER_MAP[strictness];

type WeeklyCapacityInput = Partial<{
  sleepHoursPerDay: number;
  maintenanceHoursPerDay: number;
  jobHoursPerWeek: number;
  classHoursPerWeek: number;
  bufferPercent: number;
}>;

export const computeWeeklyCapacity = (input: WeeklyCapacityInput) => {
  const sleepHoursPerDay =
    typeof input.sleepHoursPerDay === 'number' ? input.sleepHoursPerDay : 8;
  const maintenanceHoursPerDay =
    typeof input.maintenanceHoursPerDay === 'number'
      ? input.maintenanceHoursPerDay
      : 1;
  const jobHoursPerWeek =
    typeof input.jobHoursPerWeek === 'number' ? input.jobHoursPerWeek : 0;
  const classHoursPerWeek =
    typeof input.classHoursPerWeek === 'number' ? input.classHoursPerWeek : 0;
  const bufferPercent =
    typeof input.bufferPercent === 'number' ? input.bufferPercent : 30;

  const totalWeekHours = 168;
  const sleepHoursWeek = Math.round(sleepHoursPerDay * 7);
  const maintenanceHoursWeek = Math.round(maintenanceHoursPerDay * 7);
  const commitmentsHoursWeek = Math.round(jobHoursPerWeek + classHoursPerWeek);
  const remainingBeforeBuffer = Math.max(
    0,
    totalWeekHours - sleepHoursWeek - maintenanceHoursWeek - commitmentsHoursWeek,
  );
  const bufferHours = Math.round((remainingBeforeBuffer * bufferPercent) / 100);
  const estimatedPlanForHours = Math.max(
    0,
    Math.round(remainingBeforeBuffer - bufferHours),
  );

  return {
    totalWeekHours,
    sleepHoursWeek,
    maintenanceHoursWeek,
    commitmentsHoursWeek,
    remainingBeforeBuffer,
    bufferPercent,
    bufferHours,
    estimatedPlanForHours,
  };
};

export const getOpeningRemark = (input: {
  tone: Settings['preferredTone'];
  planningStyle: Settings['strictness'];
  bufferPercent: number;
}) => {
  const tone = input.tone ?? 'unsure';
  switch (tone) {
    case 'structured_grounding':
      return {
        title: 'Let’s make a clear week.',
        body: 'Start with a few tasks you already expect. Domains can adjust around them.',
      };
    case 'calm_spacious':
      return {
        title: 'Let’s set gentle intention.',
        body: 'Start with a few tasks. A rough plan is enough.',
      };
    case 'light_exploratory':
      return {
        title: 'Let’s sketch the week.',
        body: 'Add a few tasks, then adjust as you go. This is a draft, not a contract.',
      };
    default:
      return {
        title: 'Let’s start simple.',
        body: 'Add the first task. You can rename and adjust anytime.',
      };
  }
};
