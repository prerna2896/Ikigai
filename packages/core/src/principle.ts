// Ikigai principles — the four "rollup" axes that domains contribute to.
// Every WeekDomain stores its principleId explicitly so renaming a domain
// can't silently change which principle it rolls up into.

export const IKIGAI_PRINCIPLE_IDS = [
  'energy',
  'growth',
  'contribution',
  'alignment',
] as const;

export type IkigaiPrincipleId = (typeof IKIGAI_PRINCIPLE_IDS)[number];

export const IKIGAI_PRINCIPLE_LABEL: Record<IkigaiPrincipleId, string> = {
  energy: 'Energy',
  growth: 'Growth',
  contribution: 'Contribution',
  alignment: 'Alignment',
};

// Keyword-based suggestion used in two places only:
//   (1) as the *default* principle when a user creates a custom domain
//       (they can override before saving), and
//   (2) as the one-time migration fallback for legacy domain records
//       that pre-date the explicit `principleId` field.
// It is NOT used at render time — the principle a domain rolls up into
// is whatever `domain.principleId` says it is.
export const suggestPrincipleForName = (
  domainName: string,
): IkigaiPrincipleId => {
  const key = domainName.toLowerCase();
  if (
    key.includes('rest') ||
    key.includes('recharge') ||
    key.includes('sleep')
  ) {
    return 'energy';
  }
  if (
    key.includes('health') ||
    key.includes('fitness') ||
    key.includes('gym')
  ) {
    return 'energy';
  }
  if (
    key.includes('personal growth') ||
    key.includes('learn') ||
    key.includes('skill') ||
    key.includes('practice')
  ) {
    return 'growth';
  }
  if (
    key.includes('work') ||
    key.includes('career') ||
    key.includes('contribute') ||
    key.includes('job')
  ) {
    return 'contribution';
  }
  if (
    key.includes('study') ||
    key.includes('school') ||
    key.includes('class') ||
    key.includes('course') ||
    key.includes('growth')
  ) {
    return 'growth';
  }
  if (
    key.includes('relationship') ||
    key.includes('family') ||
    key.includes('home')
  ) {
    return 'alignment';
  }
  if (key.includes('spirit') || key.includes('faith')) {
    return 'alignment';
  }
  return 'alignment';
};
