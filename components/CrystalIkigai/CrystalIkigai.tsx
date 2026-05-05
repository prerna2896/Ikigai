'use client';

import { useMemo, useState } from 'react';
import {
  CRYSTAL_PALETTES,
  type CrystalDomain,
  type CrystalVariant,
} from './types';
import { useEntryProgress } from './useEntry';

type CrystalIkigaiProps = {
  domains: CrystalDomain[];
  variant: CrystalVariant;
  size?: number;
  showSkeleton?: boolean;
  activeDomainId?: string | null;
  onSelectDomain?: (domainId: string) => void;
};

export default function CrystalIkigai({
  domains,
  variant,
  size = 560,
  showSkeleton = false,
  activeDomainId = null,
  onSelectDomain,
}: CrystalIkigaiProps) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.32;
  const innerR = size * 0.04;
  const labelR = maxR + 28;
  const viewPadding = 110;

  const [hovered, setHovered] = useState<string | null>(null);
  const progress = useEntryProgress(1200, [variant, domains.length]);

  const palette = CRYSTAL_PALETTES[variant];
  const isDark = variant === 'aurora';
  const ringColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  const themed = useMemo(
    () =>
      domains.map((d, i) => ({
        ...d,
        color: palette[i % palette.length],
      })),
    [domains, palette],
  );

  const slice = (Math.PI * 2) / Math.max(themed.length, 1);
  const start = -Math.PI / 2 - slice / 2;

  const wedges = useMemo(() => {
    return themed.map((d, i) => {
      const a0 = start + i * slice;
      const a1 = a0 + slice;
      const aMid = (a0 + a1) / 2;
      const ratio =
        d.target > 0
          ? Math.min(1, Math.max(0, d.completed / d.target))
          : showSkeleton
            ? 0
            : 1;
      const local = Math.max(
        0,
        Math.min(1, (progress - i * 0.06) / (1 - i * 0.06 || 1)),
      );
      const eased = 1 - Math.pow(1 - local, 3);
      const fillR = innerR + (maxR - innerR) * ratio * eased;
      const pt = (r: number, a: number) => [
        cx + Math.cos(a) * r,
        cy + Math.sin(a) * r,
      ];
      const wedge = (r: number) => {
        const [x0, y0] = pt(innerR, a0);
        const [x1, y1] = pt(r, a0);
        const [x2, y2] = pt(r, a1);
        const [x3, y3] = pt(innerR, a1);
        return `M ${x0} ${y0} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} L ${x3} ${y3} Z`;
      };
      return {
        id: d.id,
        color: d.color,
        name: d.name,
        completed: d.completed,
        target: d.target,
        i,
        aMid,
        outline: wedge(maxR),
        fill: wedge(fillR),
        ratio,
      };
    });
  }, [themed, slice, start, maxR, innerR, cx, cy, progress, showSkeleton]);

  const active = activeDomainId ?? hovered;

  if (themed.length === 0) {
    return (
      <svg
        viewBox={`${-viewPadding} ${-viewPadding} ${size + viewPadding * 2} ${
          size + viewPadding * 2
        }`}
        width="100%"
        className="overflow-visible"
        role="img"
        aria-label="Crystal ikigai plot"
      >
        {showSkeleton ? (
          <circle
            cx={cx}
            cy={cy}
            r={maxR}
            fill="none"
            stroke={ringColor}
            strokeDasharray="2 4"
          />
        ) : null}
      </svg>
    );
  }

  return (
    <svg
      viewBox={`${-viewPadding} ${-viewPadding} ${size + viewPadding * 2} ${
        size + viewPadding * 2
      }`}
      width="100%"
      className="overflow-visible"
      role="img"
      aria-label="Crystal ikigai plot"
    >
      <defs>
        {wedges.map((w) => (
          <linearGradient
            key={w.i}
            id={`cr-${variant}-${w.i}`}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop offset="0%" stopColor={w.color} stopOpacity="1" />
            <stop
              offset="100%"
              stopColor={w.color}
              stopOpacity={isDark ? '0.55' : '0.45'}
            />
          </linearGradient>
        ))}
        <radialGradient
          id={`cr-${variant}-glow`}
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop
            offset="0%"
            stopColor="white"
            stopOpacity={isDark ? 0.18 : 0.6}
          />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <filter
          id={`cr-${variant}-shadow`}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feGaussianBlur stdDeviation="3" />
        </filter>
        {isDark ? (
          <filter
            id={`cr-${variant}-bloom`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ) : null}
      </defs>

      {[0.33, 0.66, 1].map((f, idx) => (
        <circle
          key={idx}
          cx={cx}
          cy={cy}
          r={innerR + (maxR - innerR) * f}
          fill="none"
          stroke={ringColor}
          strokeDasharray="2 4"
        />
      ))}

      {wedges.map((w) => {
        const isActive = active === w.id;
        const dim = active !== null && !isActive;
        const lift = isActive ? 10 : 0;
        const tx = Math.cos(w.aMid) * lift;
        const ty = Math.sin(w.aMid) * lift;
        return (
          <g
            key={w.id}
            data-testid={`plot-segment-${w.i}`}
            transform={`translate(${tx} ${ty})`}
            style={{
              transition:
                'transform 280ms cubic-bezier(.2,.8,.2,1), opacity 200ms',
              cursor: onSelectDomain ? 'pointer' : 'default',
              opacity: dim ? 0.35 : 1,
            }}
            onMouseEnter={() => setHovered(w.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelectDomain?.(w.id)}
            filter={isDark && isActive ? `url(#cr-${variant}-bloom)` : undefined}
            aria-label={`Domain: ${w.name}`}
          >
            <path
              d={w.outline}
              fill="black"
              opacity={isDark ? 0.25 : 0.08}
              filter={`url(#cr-${variant}-shadow)`}
              transform="translate(2 4)"
            />
            <path
              d={w.outline}
              fill={w.color}
              fillOpacity={isDark ? 0.14 : 0.18}
              stroke={w.color}
              strokeOpacity={isDark ? 0.7 : 0.5}
            />
            <path
              d={w.fill}
              fill={`url(#cr-${variant}-${w.i})`}
              stroke={w.color}
              strokeWidth={1.2}
            />
            <path
              d={w.fill}
              fill="white"
              fillOpacity={isDark ? 0.08 : 0.12}
              style={{ mixBlendMode: 'overlay' }}
            />
          </g>
        );
      })}

      <circle cx={cx} cy={cy} r={innerR + 14} fill={`url(#cr-${variant}-glow)`} />
      <circle
        cx={cx}
        cy={cy}
        r={innerR + 8}
        fill="white"
        stroke={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.18)'}
        strokeWidth={1}
      />

      {wedges.map((w) => {
        const x = cx + Math.cos(w.aMid) * labelR;
        const y = cy + Math.sin(w.aMid) * labelR;
        const isRight = Math.cos(w.aMid) >= 0;
        return (
          <text
            key={`t-${w.id}`}
            x={x}
            y={y + 4}
            fontSize={13}
            textAnchor={isRight ? 'start' : 'end'}
            fill="currentColor"
            opacity={0.78 * progress}
            className="text-mutedText"
          >
            {w.name}
          </text>
        );
      })}
    </svg>
  );
}
