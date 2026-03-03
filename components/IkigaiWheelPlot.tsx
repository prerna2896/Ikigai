'use client';

import { useMemo, useState } from 'react';
import type { WeekDomain } from '@ikigai/core';
import {
  applyLabelSpacing,
  computeSegments,
  polarToCartesian,
  type LabelPoint,
} from './plotMath';

const COLOR_MAP: Record<string, string> = {
  dusty_teal: '#6FA8A3',
  sage: '#8FB59B',
  muted_indigo: '#7E8DBA',
  soft_clay: '#C48C78',
  desaturated_amber: '#D0A15D',
  muted_plum: '#B08AAE',
  slate_blue: '#6C8BB1',
};

type IkigaiWheelPlotProps = {
  domains: WeekDomain[];
  onSelectDomain: (domainId: string) => void;
  activeDomainId?: string | null;
  showSkeleton?: boolean;
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

export default function IkigaiWheelPlot({
  domains,
  onSelectDomain,
  activeDomainId,
  showSkeleton = false,
}: IkigaiWheelPlotProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const plotDomains = useMemo(() => {
    return domains.map((domain) => ({
      id: domain.id,
      label: domain.name,
      hours: domain.plannedHours || 0,
      color: COLOR_MAP[domain.colorKey] ?? '#7A7F86',
    }));
  }, [domains]);

  const size = 640;
  const center = size / 2;
  const innerRadius = 24;
  const baseRadius = 200;
  const labelRadius = baseRadius + 135;
  const viewPadding = 190;

  const segments = useMemo(() => {
    return computeSegments(plotDomains, baseRadius, innerRadius);
  }, [plotDomains, baseRadius, innerRadius]);

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

  const activeDomain = useMemo(() => {
    const id = activeDomainId ?? hoveredId ?? focusedId;
    if (!id) {
      return null;
    }
    return segments.find((segment) => segment.id === id) ?? null;
  }, [activeDomainId, hoveredId, focusedId, segments]);

  if (segments.length === 0) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`${-viewPadding} ${-viewPadding} ${size + viewPadding * 2} ${
          size + viewPadding * 2
        }`}
        aria-label="Ikigai week plot"
        role="img"
        className="mx-auto"
      >
        {showSkeleton ? (
          <circle
            cx={center}
            cy={center}
            r={baseRadius}
            fill="none"
            stroke="var(--mutedText)"
            strokeOpacity="0.25"
            strokeWidth="1"
          />
        ) : null}
      </svg>
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
        aria-label="Ikigai week plot"
        role="img"
        className="mx-auto"
      >
        <defs>
          <filter id="shadowSoft" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="6"
              stdDeviation="8"
              floodColor="#8f9aa5"
              floodOpacity="0.22"
            />
          </filter>
          <filter id="shadowStrong" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="8"
              stdDeviation="10"
              floodColor="#6f7c88"
              floodOpacity="0.32"
            />
          </filter>
        </defs>
        {segments.map((segment, index) => {
          const hovered = hoveredId === segment.id;
          const active = activeDomainId === segment.id;
          const focused = focusedId === segment.id;
          const highlight = hovered || active || focused;
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
              data-testid={`plot-segment-${index}`}
              style={{
                transform: `translate(${lift.x}px, ${lift.y}px)`,
                transition: 'transform 120ms ease, opacity 120ms ease',
                opacity: highlight ? 0.9 : showSkeleton ? 0.3 : 0.52,
                filter: highlight ? 'url(#shadowStrong)' : 'url(#shadowSoft)',
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredId(segment.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectDomain(segment.id)}
              onFocus={() => setFocusedId(segment.id)}
              onBlur={() => setFocusedId(null)}
              aria-label={`Plan domain: ${segment.label}`}
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
          const labelX = label.x;
          const labelY = label.y;
          const labelLines =
            segment.label.length > 18
              ? segment.label.split(' ').reduce<string[]>((lines, word) => {
                  if (lines.length === 0) {
                    return [word];
                  }
                  const last = lines[lines.length - 1];
                  if (last.length + word.length + 1 <= 18 && lines.length < 2) {
                    lines[lines.length - 1] = `${last} ${word}`;
                  } else if (lines.length < 2) {
                    lines.push(word);
                  } else {
                    lines[1] = `${lines[1]} ${word}`;
                  }
                  return lines;
                }, [])
              : [segment.label];
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
                  `${labelX + (label.side === 'right' ? -10 : 10)},${labelY}`,
                ].join(' ')}
                stroke="var(--mutedText)"
                strokeWidth={1}
                strokeOpacity={0.28}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                fill="none"
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor={label.side === 'right' ? 'start' : 'end'}
                dominantBaseline="middle"
                fill="var(--mutedText)"
                fontSize="16"
                fontWeight="500"
              >
                {labelLines.map((line, idx) => (
                  <tspan key={line} x={labelX} dy={idx === 0 ? 0 : 14}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      {activeDomain ? (
        <div className="text-xs text-mutedText">
          <span className="font-medium text-text">{activeDomain.label}</span> —{' '}
          {Math.round(activeDomain.hours)}h planned (
          {Math.round(activeDomain.share * 100)}%)
        </div>
      ) : (
        <div className="text-xs text-mutedText">
          Hover or select a domain to see exact hours.
        </div>
      )}
    </div>
  );
}
