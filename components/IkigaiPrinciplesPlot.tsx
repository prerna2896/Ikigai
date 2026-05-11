'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WeekDomain } from '@ikigai/core';

export type IkigaiPrincipleId =
  | 'energy'
  | 'growth'
  | 'contribution'
  | 'alignment';

type IkigaiPrinciplesPlotProps = {
  domains: WeekDomain[];
  /** taskId → hours logged this week. Used to render the inner
   *  "completed" diamond on top of the planned outline. */
  taskCompletedHours?: Record<string, number>;
  onSelectPrinciple?: (principleId: IkigaiPrincipleId | null) => void;
  activePrincipleId?: IkigaiPrincipleId | null;
};

type Principle = {
  id: IkigaiPrincipleId;
  label: string;
  color: string;
  // Cardinal angle in radians. Top = -π/2, right = 0, bottom = π/2, left = π.
  angle: number;
};

// Order matters: each principle's filled triangle covers the quadrant
// from its own axis to the next clockwise axis. Top → right → bottom →
// left keeps the visual mapping intuitive (Alignment top, Energy right,
// Growth bottom, Contribution left, just like the reference).
const PRINCIPLES: Principle[] = [
  { id: 'alignment', label: 'Alignment', color: '#B38CB6', angle: -Math.PI / 2 },
  { id: 'energy', label: 'Energy', color: '#7FB7AD', angle: 0 },
  { id: 'growth', label: 'Growth', color: '#A6BE84', angle: Math.PI / 2 },
  {
    id: 'contribution',
    label: 'Contribution',
    color: '#8AA8D6',
    angle: Math.PI,
  },
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

const formatHours = (n: number) => {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toString();
};

type PrincipleTotals = Record<
  IkigaiPrincipleId,
  {
    plannedHours: number;
    completedHours: number;
    domains: { name: string; planned: number; completed: number }[];
  }
>;

const emptyTotals = (): PrincipleTotals => ({
  energy: { plannedHours: 0, completedHours: 0, domains: [] },
  growth: { plannedHours: 0, completedHours: 0, domains: [] },
  contribution: { plannedHours: 0, completedHours: 0, domains: [] },
  alignment: { plannedHours: 0, completedHours: 0, domains: [] },
});

export default function IkigaiPrinciplesPlot({
  domains,
  taskCompletedHours,
  onSelectPrinciple,
  activePrincipleId,
}: IkigaiPrinciplesPlotProps) {
  const [hovered, setHovered] = useState<IkigaiPrincipleId | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sum planned/completed hours per principle, plus track which domains
  // feed each so the legend can break a principle down.
  const totals = useMemo(() => {
    const acc = emptyTotals();
    domains.forEach((domain) => {
      const id = getPrincipleForDomain(domain.name);
      const planned = domain.plannedHours || 0;
      const completed = domain.tasks.reduce(
        (sum, task) =>
          sum + (taskCompletedHours?.[task.id] ?? 0),
        0,
      );
      acc[id].plannedHours += planned;
      acc[id].completedHours += completed;
      if (planned > 0 || completed > 0) {
        acc[id].domains.push({
          name: domain.name,
          planned,
          completed,
        });
      }
    });
    (Object.keys(acc) as IkigaiPrincipleId[]).forEach((id) => {
      acc[id].domains.sort((a, b) => b.planned - a.planned);
    });
    return acc;
  }, [domains, taskCompletedHours]);

  const totalPlanned = useMemo(
    () =>
      (Object.keys(totals) as IkigaiPrincipleId[]).reduce(
        (sum, id) => sum + totals[id].plannedHours,
        0,
      ),
    [totals],
  );

  const totalCompleted = useMemo(
    () =>
      (Object.keys(totals) as IkigaiPrincipleId[]).reduce(
        (sum, id) => sum + totals[id].completedHours,
        0,
      ),
    [totals],
  );

  // Active = hover wins, falls back to externally-pinned principle.
  const active = hovered ?? activePrincipleId ?? null;

  // Pointer-down outside the chart wrapper clears the pinned principle.
  useEffect(() => {
    if (!onSelectPrinciple || !activePrincipleId) return;
    const handle = (event: MouseEvent) => {
      const node = wrapperRef.current;
      if (!node) return;
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      onSelectPrinciple(null);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onSelectPrinciple, activePrincipleId]);

  const size = 540;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.36;
  const labelOffset = 28;
  const viewPadX = 130;
  const viewPadY = 50;
  const wrapperWidth = size + viewPadX * 2;
  const viewBox = `${-viewPadX} ${-viewPadY} ${size + viewPadX * 2} ${
    size + viewPadY * 2
  }`;

  // Normalise vertices against the busiest principle's planned hours.
  // Floor at a small share so the diamond doesn't collapse to a sliver
  // when a single principle dominates.
  const peakHours = useMemo(
    () =>
      Math.max(
        1,
        ...(Object.keys(totals) as IkigaiPrincipleId[]).map(
          (id) => totals[id].plannedHours,
        ),
      ),
    [totals],
  );

  // Minimum visible vertex distance keeps every principle pickable
  // even when it has zero hours. Otherwise vertices stack at the
  // centre and the diamond reads as a single triangle.
  const MIN_VERTEX_FRACTION = 0.18;

  const vertices = useMemo(() => {
    return PRINCIPLES.map((p) => {
      const t = totals[p.id];
      const plannedRatio = t.plannedHours / peakHours;
      const plannedR = Math.max(plannedRatio * maxR, MIN_VERTEX_FRACTION * maxR);
      const completedRatio = t.plannedHours > 0
        ? Math.min(1, t.completedHours / t.plannedHours) * plannedRatio
        : 0;
      const completedR = completedRatio * maxR;
      return {
        ...p,
        plannedHours: t.plannedHours,
        completedHours: t.completedHours,
        domainBreakdown: t.domains,
        plannedR,
        completedR,
        plannedX: cx + Math.cos(p.angle) * plannedR,
        plannedY: cy + Math.sin(p.angle) * plannedR,
        completedX: cx + Math.cos(p.angle) * completedR,
        completedY: cy + Math.sin(p.angle) * completedR,
        labelX: cx + Math.cos(p.angle) * (maxR + labelOffset),
        labelY: cy + Math.sin(p.angle) * (maxR + labelOffset),
      };
    });
  }, [totals, peakHours, cx, cy, maxR, labelOffset]);

  const wedges = useMemo(() => {
    // Each principle owns the quadrant from its own axis to the next
    // clockwise axis. We render BOTH a washed-out planned triangle
    // (target shape) and a saturated completed triangle (progress)
    // for each principle in its own colour — same visual language as
    // the domains chart's outer ring + inner fill.
    return vertices.map((v, i) => {
      const next = vertices[(i + 1) % vertices.length];
      const plannedPath = `M ${cx} ${cy} L ${v.plannedX} ${v.plannedY} L ${next.plannedX} ${next.plannedY} Z`;
      const completedPath = `M ${cx} ${cy} L ${v.completedX} ${v.completedY} L ${next.completedX} ${next.completedY} Z`;
      // Hit-zone spans the principle's quadrant. Matches the visible
      // triangle so clicks always go to the principle whose colour
      // the user is pointing at.
      const aStart = v.angle;
      const aEnd = v.angle + Math.PI / 2;
      const startX = cx + Math.cos(aStart) * maxR;
      const startY = cy + Math.sin(aStart) * maxR;
      const endX = cx + Math.cos(aEnd) * maxR;
      const endY = cy + Math.sin(aEnd) * maxR;
      const hitPath = `M ${cx} ${cy} L ${startX} ${startY} A ${maxR} ${maxR} 0 0 1 ${endX} ${endY} Z`;
      const hasCompletion = v.completedHours > 0;
      return { ...v, plannedPath, completedPath, hitPath, hasCompletion };
    });
  }, [vertices, cx, cy, maxR]);

  // True when *any* principle has logged hours — used by the legend
  // to switch between planned-only and completion formats.
  const anyCompletion = useMemo(
    () => vertices.some((v) => v.completedR > 0),
    [vertices],
  );

  const activePrinciple = active
    ? (wedges.find((w) => w.id === active) ?? null)
    : null;

  const allEmpty = totalPlanned === 0;
  const activeIsPinned = Boolean(
    active && activePrincipleId && active === activePrincipleId,
  );

  return (
    <div
      ref={wrapperRef}
      className="flex w-full flex-col items-center gap-5"
    >
      <svg
        viewBox={viewBox}
        style={{ width: wrapperWidth, maxWidth: '100%', height: 'auto' }}
        className="overflow-visible"
        role="img"
        aria-label="Ikigai principles plot"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onSelectPrinciple?.(null);
          }
        }}
      >
        {/* Concentric dotted gridlines */}
        {[0.33, 0.66, 1].map((f, idx) => (
          <circle
            key={`grid-${idx}`}
            cx={cx}
            cy={cy}
            r={maxR * f}
            fill="none"
            stroke="rgba(0,0,0,0.08)"
            strokeDasharray="2 4"
            pointerEvents="none"
          />
        ))}

        {/* Cardinal axis lines — horizontal + vertical through the centre */}
        <line
          x1={cx - maxR}
          y1={cy}
          x2={cx + maxR}
          y2={cy}
          stroke="rgba(0,0,0,0.1)"
          strokeWidth="1"
          pointerEvents="none"
        />
        <line
          x1={cx}
          y1={cy - maxR}
          x2={cx}
          y2={cy + maxR}
          stroke="rgba(0,0,0,0.1)"
          strokeWidth="1"
          pointerEvents="none"
        />

        {/* Planned-outline triangles (washed out). Each wedge touches
            two principle vertices (its own and the next clockwise), so
            both adjacent wedges are "active" for a given principle —
            that way hovering Growth highlights the whole lower half of
            the diamond, not just the slice owned by Growth's id. */}
        {wedges.map((w, i) => {
          const nextId = wedges[(i + 1) % wedges.length].id;
          const isActive =
            active !== null && (active === w.id || active === nextId);
          const dim = active !== null && !isActive;
          const fillOpacity = isActive ? 0.45 : dim ? 0.1 : 0.32;
          return (
            <path
              key={`planned-${w.id}`}
              d={w.plannedPath}
              fill={w.color}
              fillOpacity={fillOpacity}
              stroke={w.color}
              strokeOpacity={isActive ? 0.7 : 0.45}
              strokeWidth={1}
              pointerEvents="none"
              style={{
                transition: 'fill-opacity 200ms, stroke-opacity 200ms',
              }}
            />
          );
        })}

        {/* Completion fill — one saturated triangle per principle in
            that principle's own colour, matching the domains chart's
            "outer washed ring + inner saturated fill" pattern. When a
            principle has no logged hours its completion vertex sits
            at the centre so its triangle collapses (zero area), which
            means principles with progress show up as bold colour and
            empty ones simply don't paint. */}
        {anyCompletion
          ? wedges.map((w, i) => {
              const nextW = wedges[(i + 1) % wedges.length];
              const isActive =
                active !== null && (active === w.id || active === nextW.id);
              const dim = active !== null && !isActive;
              if (!w.hasCompletion && !nextW.hasCompletion) {
                // Both this principle AND the next one (which shares
                // the triangle's far vertex) have zero completion —
                // skip rendering to avoid empty paths in the DOM.
                return null;
              }
              return (
                <path
                  key={`completed-${w.id}`}
                  data-testid={`principle-completion-${w.id}`}
                  data-principle-id={w.id}
                  d={w.completedPath}
                  fill={w.color}
                  fillOpacity={isActive ? 0.7 : dim ? 0.3 : 0.55}
                  stroke={w.color}
                  strokeOpacity={isActive ? 0.85 : 0.55}
                  strokeWidth={1.2}
                  pointerEvents="none"
                  style={{
                    transition: 'fill-opacity 200ms, stroke-opacity 200ms',
                  }}
                />
              );
            })
          : null}

        {/* Invisible 90° hit zones — full quadrant per principle so
            hover/click works even when a neighbour is at zero hours. */}
        {wedges.map((w, i) => (
          <path
            key={`hit-${w.id}`}
            d={w.hitPath}
            data-testid={`plot-segment-${i}`}
            data-principle-id={w.id}
            data-planned-hours={w.plannedHours}
            data-completed-hours={w.completedHours}
            data-has-completion={w.hasCompletion ? 'true' : 'false'}
            fill="transparent"
            stroke="none"
            style={{ cursor: onSelectPrinciple ? 'pointer' : 'default' }}
            onMouseEnter={() => setHovered(w.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={(event) => {
              event.stopPropagation();
              onSelectPrinciple?.(w.id);
            }}
            aria-label={`Ikigai principle: ${w.label}`}
          />
        ))}

        {/* Cardinal labels */}
        {vertices.map((v) => {
          const cosA = Math.cos(v.angle);
          const sinA = Math.sin(v.angle);
          const horizontal = Math.abs(cosA) < 0.35;
          const textAnchor: 'start' | 'middle' | 'end' = horizontal
            ? 'middle'
            : cosA >= 0
              ? 'start'
              : 'end';
          const verticalOffset = horizontal ? (sinA >= 0 ? 18 : -8) : 5;
          const isActiveLabel = active === v.id;
          return (
            <text
              key={`label-${v.id}`}
              x={v.labelX}
              y={v.labelY + verticalOffset}
              fontSize={18}
              fontWeight={isActiveLabel ? 600 : 500}
              textAnchor={textAnchor}
              fill="currentColor"
              opacity={isActiveLabel ? 1 : 0.78}
              className="text-text"
            >
              {v.label}
            </text>
          );
        })}
      </svg>

      <PrincipleLegend
        principle={activePrinciple}
        totalPlanned={totalPlanned}
        totalCompleted={totalCompleted}
        empty={allEmpty}
        showPinHint={Boolean(onSelectPrinciple) && !activeIsPinned}
      />
    </div>
  );
}

function PrincipleLegend({
  principle,
  totalPlanned,
  totalCompleted,
  empty,
  showPinHint,
}: {
  principle:
    | {
        id: IkigaiPrincipleId;
        label: string;
        color: string;
        plannedHours: number;
        completedHours: number;
        domainBreakdown: { name: string; planned: number; completed: number }[];
      }
    | null;
  totalPlanned: number;
  totalCompleted: number;
  empty: boolean;
  showPinHint: boolean;
}) {
  if (empty) {
    return (
      <p
        className="text-sm text-mutedText"
        data-testid="principle-legend-empty"
      >
        Add tasks to a domain to populate the principles plot.
      </p>
    );
  }

  if (!principle) {
    return (
      <p
        className="text-sm text-mutedText"
        data-testid="principle-legend-idle"
      >
        Hover or click a principle to see its details.
      </p>
    );
  }

  const hasCompletion =
    principle.completedHours > 0 || totalCompleted > 0;
  const completedPercent =
    principle.plannedHours > 0
      ? Math.round(
          (principle.completedHours / principle.plannedHours) * 100,
        )
      : 0;
  const plannedPercent =
    totalPlanned > 0
      ? Math.round((principle.plannedHours / totalPlanned) * 100)
      : 0;

  return (
    <div
      className="flex flex-col items-center gap-1 text-center"
      data-testid="principle-legend"
      data-principle-id={principle.id}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: principle.color }}
        />
        <span
          className="text-base font-semibold text-text"
          data-testid="principle-legend-name"
        >
          {principle.label}
        </span>
        <span className="text-base text-mutedText">—</span>
        <span
          className="text-base text-mutedText"
          data-testid="principle-legend-stats"
        >
          {hasCompletion ? (
            <>
              {formatHours(principle.completedHours)} of{' '}
              {formatHours(principle.plannedHours)}h planned (
              {completedPercent}% complete)
            </>
          ) : (
            <>
              {formatHours(principle.plannedHours)}h planned ({plannedPercent}%)
            </>
          )}
        </span>
      </div>
      {principle.domainBreakdown.length > 0 ? (
        <p
          className="text-sm text-mutedText"
          data-testid="principle-legend-domains"
        >
          {principle.domainBreakdown
            .map((d) =>
              hasCompletion
                ? `${d.name} ${formatHours(d.completed)}/${formatHours(d.planned)}h`
                : `${d.name} ${formatHours(d.planned)}h`,
            )
            .join(' · ')}
        </p>
      ) : (
        <p className="text-sm text-mutedText">
          No domains rolled up here yet.
        </p>
      )}
      {showPinHint ? (
        <p className="text-sm text-mutedText">
          Click to pin this principle.
        </p>
      ) : null}
    </div>
  );
}
