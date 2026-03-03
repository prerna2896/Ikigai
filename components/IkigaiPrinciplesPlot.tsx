'use client';

import { useMemo, useState } from 'react';
import type { WeekDomain } from '@ikigai/core';
import {
  applyLabelSpacing,
  computeSegments,
  polarToCartesian,
  type LabelPoint,
} from './plotMath';

export type IkigaiPrincipleId =
  | 'energy'
  | 'growth'
  | 'contribution'
  | 'alignment';

type IkigaiPrinciplesPlotProps = {
  domains: WeekDomain[];
  onSelectPrinciple?: (principleId: IkigaiPrincipleId) => void;
  activePrincipleId?: IkigaiPrincipleId | null;
};

type Principle = {
  id: IkigaiPrincipleId;
  label: string;
  color: string;
};

const PRINCIPLES: Principle[] = [
  { id: 'energy', label: 'Energy', color: '#7FB7AD' },
  { id: 'growth', label: 'Growth', color: '#A6BE84' },
  { id: 'contribution', label: 'Contribution', color: '#D0A15D' },
  { id: 'alignment', label: 'Alignment', color: '#B38CB6' },
];

export const getPrincipleForDomain = (
  domainName: string,
): IkigaiPrincipleId => {
  const key = domainName.toLowerCase();
  if (key.includes('rest') || key.includes('recharge') || key.includes('sleep')) {
    return 'energy';
  }
  if (key.includes('health') || key.includes('fitness') || key.includes('gym')) {
    return 'energy';
  }
  if (key.includes('growth') || key.includes('learn') || key.includes('study')) {
    return 'growth';
  }
  if (key.includes('work') || key.includes('career') || key.includes('contribute')) {
    return 'contribution';
  }
  if (key.includes('relationship') || key.includes('family') || key.includes('home')) {
    return 'alignment';
  }
  if (key.includes('spirit') || key.includes('faith')) {
    return 'alignment';
  }
  return 'alignment';
};

const buildQuadPath = (
  cx: number,
  cy: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
  outerStart: { x: number; y: number },
  outerEnd: { x: number; y: number },
) => {
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  return [
    `M ${innerStart.x} ${innerStart.y}`,
    `L ${outerStart.x} ${outerStart.y}`,
    `L ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
};

export default function IkigaiPrinciplesPlot({
  domains,
  onSelectPrinciple,
  activePrincipleId,
}: IkigaiPrinciplesPlotProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const principleTotals = useMemo(() => {
    const totals: Record<Principle['id'], number> = {
      energy: 0,
      growth: 0,
      contribution: 0,
      alignment: 0,
    };
    domains.forEach((domain) => {
      const principle = getPrincipleForDomain(domain.name);
      totals[principle] += domain.plannedHours || 0;
    });
    return PRINCIPLES.map((principle) => ({
      id: principle.id,
      label: principle.label,
      color: principle.color,
      hours: totals[principle.id],
    }));
  }, [domains]);

  const size = 640;
  const center = size / 2;
  const innerRadius = 24;
  const baseRadius = 200;
  const labelRadius = baseRadius + 135;
  const viewPadding = 190;

  const segments = useMemo(() => {
    return computeSegments(principleTotals, baseRadius, innerRadius);
  }, [principleTotals, baseRadius, innerRadius]);

  const boundaryPoints = useMemo(() => {
    if (segments.length === 0) {
      return [] as { angle: number; point: { x: number; y: number } }[];
    }
    const boundaries = segments.map((segment) => segment.startAngle);
    const boundaryRadii = boundaries.map((_, index) => {
      const prevIndex = (index - 1 + segments.length) % segments.length;
      return (segments[prevIndex].outerRadius + segments[index].outerRadius) / 2;
    });
    return boundaries.map((angle, index) => ({
      angle,
      point: polarToCartesian(center, center, boundaryRadii[index], angle),
    }));
  }, [segments, center]);

  const labelPoints = useMemo(() => {
    if (segments.length === 0) {
      return [] as LabelPoint[];
    }
    const points = segments.map((segment) => {
      const anchor = polarToCartesian(
        center,
        center,
        labelRadius,
        segment.midAngle,
      );
      const side = anchor.x >= center ? 'right' : 'left';
      return {
        id: segment.id,
        x: side === 'right' ? center + labelRadius : center - labelRadius,
        y: anchor.y,
        side,
      } as LabelPoint;
    });
    return applyLabelSpacing(points, 16);
  }, [segments, center, labelRadius]);

  const labelMap = useMemo(() => {
    const map = new Map<string, LabelPoint>();
    labelPoints.forEach((point) => map.set(point.id, point));
    return map;
  }, [labelPoints]);

  const activeSegment = useMemo(() => {
    const id = activePrincipleId ?? hoveredId ?? focusedId;
    if (!id) {
      return null;
    }
    return segments.find((segment) => segment.id === id) ?? null;
  }, [activePrincipleId, hoveredId, focusedId, segments]);

  if (segments.length === 0) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`${-viewPadding} ${-viewPadding} ${size + viewPadding * 2} ${
          size + viewPadding * 2
        }`}
        aria-label="Ikigai principles plot"
        role="img"
        className="mx-auto"
      />
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox={`${-viewPadding} ${-viewPadding} ${size + viewPadding * 2} ${
          size + viewPadding * 2
        }`}
        aria-label="Ikigai principles plot"
        role="img"
        className="mx-auto"
      >
        <defs>
          <filter id="shadowSoftPrinciples" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="6"
              stdDeviation="8"
              floodColor="#8f9aa5"
              floodOpacity="0.18"
            />
          </filter>
          <filter id="shadowStrongPrinciples" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="8"
              stdDeviation="10"
              floodColor="#6f7c88"
              floodOpacity="0.3"
            />
          </filter>
        </defs>
        {segments.map((segment, index) => {
          const hovered = hoveredId === segment.id;
          const active = activePrincipleId === segment.id;
          const focused = focusedId === segment.id;
          const highlight = hovered || focused || active;
          const outerStart =
            boundaryPoints[index]?.point ??
            polarToCartesian(center, center, segment.outerRadius, segment.startAngle);
          const outerEnd =
            boundaryPoints[(index + 1) % boundaryPoints.length]?.point ??
            polarToCartesian(center, center, segment.outerRadius, segment.endAngle);
          const path = buildQuadPath(
            center,
            center,
            innerRadius,
            segment.startAngle,
            segment.endAngle,
            outerStart,
            outerEnd,
          );
          const lift = highlight
            ? polarToCartesian(0, 0, 7, segment.midAngle)
            : { x: 0, y: 0 };
          return (
            <g
              key={segment.id}
              style={{
                transform: `translate(${lift.x}px, ${lift.y}px)`,
                transition: 'transform 120ms ease, opacity 120ms ease',
                opacity: highlight ? 0.9 : 0.55,
                filter: highlight
                  ? 'url(#shadowStrongPrinciples)'
                  : 'url(#shadowSoftPrinciples)',
              }}
              onMouseEnter={() => setHoveredId(segment.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectPrinciple?.(segment.id as IkigaiPrincipleId)}
              onFocus={() => setFocusedId(segment.id)}
              onBlur={() => setFocusedId(null)}
              aria-label={`Ikigai principle: ${segment.label}`}
            >
              <path
                d={path}
                fill={segment.color}
                stroke="rgba(255,255,255,0.42)"
                strokeWidth={highlight ? 1.2 : 0.8}
                strokeLinejoin="round"
              />
            </g>
          );
        })}
        {segments.map((segment) => {
          const label = labelMap.get(segment.id);
          if (!label) {
            return null;
          }
          const anchor = polarToCartesian(
            center,
            center,
            segment.outerRadius + 6,
            segment.midAngle,
          );
          return (
            <g key={`${segment.id}-label`}>
              <polyline
                points={[
                  `${anchor.x},${anchor.y}`,
                  `${
                    label.side === 'right'
                      ? center + baseRadius + 48
                      : center - baseRadius - 48
                  },${anchor.y}`,
                  `${label.x + (label.side === 'right' ? -10 : 10)},${label.y}`,
                ].join(' ')}
                stroke="var(--mutedText)"
                strokeWidth={1}
                strokeOpacity={0.28}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                fill="none"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.side === 'right' ? 'start' : 'end'}
                dominantBaseline="middle"
                fill="var(--mutedText)"
                fontSize="16"
                fontWeight="500"
              >
                {segment.label}
              </text>
            </g>
          );
        })}
      </svg>
      {activeSegment ? (
        <div className="text-xs text-mutedText">
          <span className="font-medium text-text">{activeSegment.label}</span> —{' '}
          {Math.round(activeSegment.hours)}h planned (
          {Math.round(activeSegment.share * 100)}%)
        </div>
      ) : (
        <div className="text-xs text-mutedText">
          Hover a principle to see exact hours.
        </div>
      )}
    </div>
  );
}
