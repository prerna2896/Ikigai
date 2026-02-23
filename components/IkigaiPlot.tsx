'use client';

import { useMemo, useState } from 'react';
import type { WeekDomain } from '@ikigai/core';

const COLOR_MAP: Record<string, string> = {
  dusty_teal: '#6FA8A3',
  sage: '#8FB59B',
  muted_indigo: '#7E8DBA',
  soft_clay: '#C48C78',
  desaturated_amber: '#D0A15D',
  muted_plum: '#B08AAE',
  slate_blue: '#6C8BB1',
};

type IkigaiPlotProps = {
  domains: WeekDomain[];
  onSelectDomain: (domainId: string) => void;
  activeDomainId?: string | null;
  showSkeleton?: boolean;
};

const polarToCartesian = (cx: number, cy: number, radius: number, angle: number) => {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
};

const buildFacetPath = (
  cx: number,
  cy: number,
  outerStart: { x: number; y: number },
  outerMid: { x: number; y: number },
  outerEnd: { x: number; y: number },
) => {
  return [
    `M ${cx} ${cy}`,
    `L ${outerStart.x} ${outerStart.y}`,
    `Q ${outerMid.x} ${outerMid.y} ${outerEnd.x} ${outerEnd.y}`,
    'Z',
  ].join(' ');
};

export default function IkigaiPlot({
  domains,
  onSelectDomain,
  activeDomainId,
  showSkeleton = false,
}: IkigaiPlotProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const normalizedHours = useMemo(() => {
    if (domains.length === 0) {
      return [] as number[];
    }
    const raw = domains.map((domain) => domain.plannedHours || 0);
    const hasAny = raw.some((hours) => hours > 0);
    return hasAny ? raw : raw.map(() => 1);
  }, [domains]);

  const maxHours = Math.max(...normalizedHours, 1);
  const baseRadius = 36;
  const radiusScale = 96;
  const skeletonOpacity = 0.18;
  const defaultOpacity = showSkeleton ? skeletonOpacity : 0.45;
  const hoverOpacity = showSkeleton ? 0.28 : 0.6;
  const activeOpacity = showSkeleton ? 0.35 : 0.7;

  const angleSize = domains.length > 0 ? (Math.PI * 2) / domains.length : 0;
  const radii = domains.map((_, index) => {
    const hours = normalizedHours[index] ?? 0;
    const normalized = Math.pow(hours / maxHours, 0.6);
    const jitter = 1 + (index % 4) * 0.6;
    return baseRadius + radiusScale * normalized + jitter;
  });
  const boundaryAngles = domains.map((_, index) => {
    const jitter = index % 2 === 0 ? 0.05 : -0.035;
    return -Math.PI / 2 + index * angleSize + jitter;
  });
  const maxRadius = radii.length > 0 ? Math.max(...radii) : baseRadius;
  const labelRadius = maxRadius + 44;

  return (
    <svg
      width="420"
      height="420"
      viewBox="-70 -70 460 460"
      className="mx-auto overflow-visible"
      aria-label="Ikigai week plot"
      role="img"
    >
      <defs>
        <filter id="shadowSoft" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#8f9aa5" floodOpacity="0.25" />
        </filter>
        <filter id="shadowStrong" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#6f7c88" floodOpacity="0.35" />
        </filter>
        <filter id="shadowFaint" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#9aa3ad" floodOpacity="0.15" />
        </filter>
      </defs>
      {domains.map((domain, index) => {
        const startAngle = boundaryAngles[index];
        const endAngle = boundaryAngles[(index + 1) % boundaryAngles.length];
        const midAngle = (startAngle + endAngle) / 2;
        const prevIndex = (index - 1 + radii.length) % radii.length;
        const nextIndex = (index + 1) % radii.length;
        const rStart = (radii[prevIndex] + radii[index]) / 2;
        const rEnd = (radii[index] + radii[nextIndex]) / 2;
        const startPoint = polarToCartesian(160, 160, rStart, startAngle);
        const endPoint = polarToCartesian(160, 160, rEnd, endAngle);
        const midPoint = polarToCartesian(
          160,
          160,
          radii[index] + 4,
          midAngle,
        );
        const path = buildFacetPath(160, 160, startPoint, midPoint, endPoint);
        const hovered = hoveredId === domain.id;
        const active = activeDomainId === domain.id;
        const fill = COLOR_MAP[domain.colorKey] ?? '#7A7F86';
        const edgePoint = polarToCartesian(160, 160, radii[index] + 6, midAngle);
        const labelPoint = polarToCartesian(160, 160, labelRadius, midAngle);
        const textAnchor = labelPoint.x >= 160 ? 'start' : 'end';
        const labelOffsetX = textAnchor === 'start' ? 8 : -8;
        const labelOffsetY =
          midAngle > Math.PI / 2 || midAngle < -Math.PI / 2 ? 10 : -10;
        const labelParts =
          domain.name.length > 16
            ? domain.name.split(' ').reduce<string[]>((lines, word) => {
                if (lines.length === 0) {
                  return [word];
                }
                const last = lines[lines.length - 1];
                if (last.length + word.length + 1 <= 16 && lines.length < 2) {
                  lines[lines.length - 1] = `${last} ${word}`;
                } else if (lines.length < 2) {
                  lines.push(word);
                } else {
                  lines[1] = `${lines[1]} ${word}`;
                }
                return lines;
              }, [])
            : [domain.name];

        return (
          <g key={domain.id}>
            <g
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                transform: hovered ? 'translateY(-2px)' : 'translateY(0px)',
                cursor: 'pointer',
                opacity: hovered ? hoverOpacity : active ? activeOpacity : defaultOpacity,
                transition: 'transform 120ms ease, opacity 120ms ease',
                filter: showSkeleton
                  ? 'url(#shadowFaint)'
                  : hovered
                    ? 'url(#shadowStrong)'
                    : 'url(#shadowSoft)',
              }}
              onMouseEnter={() => setHoveredId(domain.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectDomain(domain.id)}
              aria-label={`Plan domain: ${domain.name}`}
            >
              <path
                d={path}
                fill={fill}
                stroke={
                  active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)'
                }
                strokeWidth={active ? 1.6 : 0.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
            <g
              style={{
                transition: 'opacity 120ms ease',
                opacity: active || hovered ? 0.95 : 0.65,
              }}
            >
              <line
                x1={edgePoint.x}
                y1={edgePoint.y}
                x2={labelPoint.x + labelOffsetX}
                y2={labelPoint.y + labelOffsetY}
                stroke="var(--mutedText)"
                strokeWidth={1}
                strokeOpacity={0.3}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={labelPoint.x + labelOffsetX}
                y={labelPoint.y + labelOffsetY}
                textAnchor={textAnchor}
                dominantBaseline="middle"
                fill={active || hovered ? 'var(--text)' : 'var(--mutedText)'}
                fontSize="12"
                fontWeight={active || hovered ? 600 : 500}
              >
                {labelParts.map((part, idx) => (
                  <tspan
                    key={part}
                    x={labelPoint.x + labelOffsetX}
                    dy={idx === 0 ? 0 : 14}
                  >
                    {part}
                  </tspan>
                ))}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
