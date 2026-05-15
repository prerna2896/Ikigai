export const getDomainIcon = (domainName: string) => {
  const key = domainName.toLowerCase();

  // Sleep & rest
  if (key.includes('sleep') || key.includes('rest') || key.includes('recharge')) return '😴';

  // Work & professional
  if (key.includes('work') || key.includes('office') || key.includes('job') || key.includes('career')) return '💼';
  if (key.includes('study') || key.includes('school') || key.includes('learn')) return '📚';

  // Health & wellness
  if (key.includes('health') || key.includes('fitness') || key.includes('exercise')) return '🫁';

  // Home & life maintenance
  if (key.includes('home') || key.includes('house') || key.includes('maintenance') || key.includes('chore')) return '🏠';

  // Travel & leisure
  if (key.includes('travel') || key.includes('vacation') || key.includes('trip')) return '✈️';
  if (key.includes('tv') || key.includes('entertainment') || key.includes('watch')) return '📺';
  if (key.includes('reading') || key.includes('book')) return '📖';

  // Relationships & social
  if (key.includes('relationship') || key.includes('partner') || key.includes('dating')) return '🤝';
  if (key.includes('family') || key.includes('parent') || key.includes('child')) return '👨‍👩‍👧‍👦';
  if (key.includes('social') || key.includes('friend') || key.includes('dinner') || key.includes('meal')) return '🍽️';

  // Personal development
  if (key.includes('growth') || key.includes('wonder') || key.includes('reflect') || key.includes('develop')) return '🌱';

  return '•';
};