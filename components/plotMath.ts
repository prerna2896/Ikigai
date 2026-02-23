export type PlotDomain = {
  id: string;
  label: string;
  hours: number;
  color: string;
};

export type PlotSegment = PlotDomain & {
  startAngle: number;
  endAngle: number;
  midAngle: number;
  outerRadius: number;
  share: number;
};

export type LabelPoint = {
  id: string;
  x: number;
  y: number;
  side: 'left' | 'right';
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const polarToCartesian = (
  cx: number,
  cy: number,
  radius: number,
  angle: number,
) => ({
  x: cx + radius * Math.cos(angle),
  y: cy + radius * Math.sin(angle),
});

export const computeSegments = (
  domains: PlotDomain[],
  baseRadius: number,
  innerRadius: number,
) => {
  const withHours = domains.filter((domain) => domain.hours > 0);
  if (withHours.length === 0) {
    return [] as PlotSegment[];
  }

  const total = withHours.reduce((sum, domain) => sum + domain.hours, 0);
  const tempered = withHours.map((domain) => Math.sqrt(domain.hours));
  const temperedSum = tempered.reduce((sum, value) => sum + value, 0) || 1;

  let cursor = -Math.PI / 2;
  return withHours.map((domain, index) => {
    const weight = tempered[index] / temperedSum;
    const angleSize = weight * Math.PI * 2;
    const startAngle = cursor;
    const endAngle = cursor + angleSize;
    const midAngle = (startAngle + endAngle) / 2;
    cursor = endAngle;

    const rawShare = total > 0 ? domain.hours / total : 0;
    const clampedShare = clamp(rawShare, 0.08, 0.26);
    const normalizedShare = (clampedShare - 0.08) / 0.18;
    const outerRadius = baseRadius * (0.94 + 0.14 * normalizedShare);

    return {
      ...domain,
      startAngle,
      endAngle,
      midAngle,
      outerRadius,
      share: rawShare,
      hours: domain.hours,
    };
  });
};

export const applyLabelSpacing = (labels: LabelPoint[], spacing: number) => {
  const left = labels
    .filter((label) => label.side === 'left')
    .sort((a, b) => a.y - b.y);
  const right = labels
    .filter((label) => label.side === 'right')
    .sort((a, b) => a.y - b.y);

  const adjust = (items: LabelPoint[]) => {
    const result: LabelPoint[] = [];
    for (const label of items) {
      const prev = result[result.length - 1];
      if (prev && label.y < prev.y + spacing) {
        result.push({ ...label, y: prev.y + spacing });
      } else {
        result.push(label);
      }
    }
    return result;
  };

  return [...adjust(left), ...adjust(right)];
};

export const arcPath = (
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) => {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return {
    start,
    end,
    d: `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
  };
};
