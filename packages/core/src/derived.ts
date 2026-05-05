import type { Settings } from './types';

export const STRICTNESS_BUFFER_MAP: Record<Settings['strictness'], number> = {
  very_flexible: 30,
  somewhat_flexible: 20,
  structured: 15,
  very_structured: 10,
  no_buffer: 0,
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
    typeof input.bufferPercent === 'number' ? input.bufferPercent : 20;

  // Math: hours_to_plan = total * (1 - buffer%). Sleep / maintenance / job /
  // classes are kept around as a reference breakdown of where the plannable
  // hours typically go — they are no longer subtracted from the plannable
  // total.
  const totalWeekHours = 168;
  const sleepHoursWeek = Math.round(sleepHoursPerDay * 7);
  const maintenanceHoursWeek = Math.round(maintenanceHoursPerDay * 7);
  const commitmentsHoursWeek = Math.round(jobHoursPerWeek + classHoursPerWeek);
  const referenceFilledHours =
    sleepHoursWeek + maintenanceHoursWeek + commitmentsHoursWeek;
  const bufferHours = Math.round((totalWeekHours * bufferPercent) / 100);
  const estimatedPlanForHours = Math.max(
    0,
    Math.round(totalWeekHours - bufferHours),
  );

  return {
    totalWeekHours,
    sleepHoursWeek,
    maintenanceHoursWeek,
    commitmentsHoursWeek,
    referenceFilledHours,
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
