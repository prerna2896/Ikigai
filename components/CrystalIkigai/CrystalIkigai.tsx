'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CRYSTAL_THEMES,
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
  onSelectDomain?: (domainId: string | null) => void;
};

const formatHours = (n: number) => {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : rounded.toString();
};

export default function CrystalIkigai({
  domains,
  variant,
  size = 540,
  showSkeleton = false,
  activeDomainId = null,
  onSelectDomain,
}: CrystalIkigaiProps) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38;
  const innerR = size * 0.085;
  const labelR = maxR + 22;
  // Asymmetric padding: side labels need horizontal room, but the top/
  // bottom labels live just outside the ring so we trim the vertical
  // gap to keep the plot compact.
  const viewPadX = 115;
  const viewPadY = 30;
  const wrapperWidth = size + viewPadX * 2;

  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Pointer-down anywhere outside the chart wrapper clears the pinned
  // domain. We use mousedown rather than click so the deselect happens
  // before any focus/blur on the new target — and we ignore clicks
  // inside the wrapper because segments handle their own selection.
  useEffect(() => {
    if (!onSelectDomain || !activeDomainId) return;
    const handle = (event: MouseEvent) => {
      const node = wrapperRef.current;
      if (!node) return;
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      onSelectDomain(null);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onSelectDomain, activeDomainId]);

  // Only show domains that actually have planned hours. Domains with no
  // tasks (target === 0) would render as zero-area wedges and clutter the
  // chart, so filter them out before any geometry/colour assignment.
  const visibleDomains = useMemo(
    () => domains.filter((d) => d.target > 0),
    [domains],
  );

  const progress = useEntryProgress(1200, [variant, visibleDomains.length]);

  const theme = CRYSTAL_THEMES[variant];
  const { palette, isDark, ringColor } = theme;

  const themed = useMemo(
    () =>
      // Bind each wedge's colour to its position in the *unfiltered*
      // domain list. Otherwise dropping a zero-hour domain (filtered
      // out of `visibleDomains`) would shift every subsequent
      // domain's palette index — e.g. Rest & Recharge would inherit
      // Personal Growth's yellow when Personal Growth has 0h.
      visibleDomains.map((d) => {
        const originalIndex = domains.findIndex(
          (candidate) => candidate.id === d.id,
        );
        const colorIndex = originalIndex >= 0 ? originalIndex : 0;
        return {
          ...d,
          color: palette[colorIndex % palette.length],
        };
      }),
    [domains, visibleDomains, palette],
  );

  // Compute each wedge's angular span. Pure linear proportionality
  // collapses small domains into invisible slivers and crowds their
  // labels, so we soften it: a square-root weighting compresses the
  // biggest domain and lifts the smallest, then we enforce a minimum
  // wedge size (~28°) and renormalize so the total still hits 2π.
  const spans = useMemo(() => {
    const N = themed.length;
    if (N === 0) return [] as number[];
    const TWO_PI = Math.PI * 2;
    const MIN_FRACTION = 0.078; // ~28° per wedge floor
    const safeFloor = Math.min(MIN_FRACTION, 1 / N);
    const weights = themed.map((d) => Math.sqrt(Math.max(d.target, 0)));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const baseFractions =
      totalWeight > 0
        ? weights.map((w) => w / totalWeight)
        : Array.from({ length: N }, () => 1 / N);
    const lifted = baseFractions.map((f) => Math.max(f, safeFloor));
    const liftedSum = lifted.reduce((s, f) => s + f, 0);
    return lifted.map((f) => (f / liftedSum) * TWO_PI);
  }, [themed]);

  const wedges = useMemo(() => {
    // Start at 12 o'clock and sweep clockwise so the first domain
    // anchors the top of the circle.
    let cursor = -Math.PI / 2;
    return themed.map((d, i) => {
      const span = spans[i] ?? (Math.PI * 2) / themed.length;
      const a0 = cursor;
      const a1 = a0 + span;
      cursor = a1;
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
      // The inner fill represents *completed* hours only — domains
      // with zero logged hours read as empty (just the planned-hours
      // outer ring is visible). Filling them to full when completed
      // was 0 made it look like the domain was already "done".
      const fillR = innerR + (maxR - innerR) * ratio * eased;
      const hasFill = ratio > 0;
      // Wedges that span more than half the circle (a single dominant
      // domain) need the large-arc-flag set so SVG draws the major arc.
      const largeArc = span > Math.PI ? 1 : 0;
      const pt = (r: number, a: number) => [
        cx + Math.cos(a) * r,
        cy + Math.sin(a) * r,
      ];
      const wedge = (r: number) => {
        const [x0, y0] = pt(innerR, a0);
        const [x1, y1] = pt(r, a0);
        const [x2, y2] = pt(r, a1);
        const [x3, y3] = pt(innerR, a1);
        return `M ${x0} ${y0} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} Z`;
      };
      return {
        id: d.id,
        color: d.color,
        name: d.name,
        completed: d.completed,
        target: d.target,
        i,
        aMid,
        span,
        outline: wedge(maxR),
        fill: hasFill ? wedge(fillR) : null,
        ratio,
      };
    });
  }, [themed, spans, maxR, innerR, cx, cy, progress, showSkeleton]);

  // Hover always wins over the externally-pinned domain so peeking at
  // another wedge's stats doesn't require unpinning first.
  const active = hovered ?? activeDomainId;
  const activeWedge = active
    ? (wedges.find((w) => w.id === active) ?? null)
    : null;
  const activeIsPinned = Boolean(
    activeWedge && activeDomainId && activeWedge.id === activeDomainId,
  );

  const viewBox = `${-viewPadX} ${-viewPadY} ${size + viewPadX * 2} ${
    size + viewPadY * 2
  }`;

  // Resolve a pointer event to one of three outcomes using angle
  // math instead of SVG hit-testing:
  //   - 'wedge' (with the wedge): the cursor is inside the donut or
  //     within a small label margin, so we treat the click/hover as
  //     pointing at that wedge.
  //   - 'inner': cursor is inside the centre cap. Ignore — clicks in
  //     the centre are too easy to mis-register accidentally.
  //   - 'outside': cursor is in the empty space far outside the
  //     chart (e.g. a corner of the SVG). Treat as a click on the
  //     chart's background → clear the pinned domain.
  // The OUTER_THRESHOLD is generous (maxR + 50) so clicks aimed at
  // the visible outer edge or labels still dispatch to a wedge, but
  // clicks well outside the chart visually still feel like "I'm
  // dismissing this".
  const findHitAt = (
    event: React.PointerEvent | React.MouseEvent,
  ):
    | { kind: 'inner' }
    | { kind: 'outside' }
    | { kind: 'wedge'; wedge: (typeof wedges)[number] } => {
    const svg = svgRef.current;
    if (!svg) return { kind: 'inner' };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { kind: 'inner' };
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const dx = local.x - cx;
    const dy = local.y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < innerR) return { kind: 'inner' };
    const OUTER_THRESHOLD = maxR + 50;
    if (r > OUTER_THRESHOLD) return { kind: 'outside' };
    const startAngle = -Math.PI / 2;
    const TWO_PI = Math.PI * 2;
    const cursorAngle = Math.atan2(dy, dx);
    let rel = cursorAngle - startAngle;
    rel = ((rel % TWO_PI) + TWO_PI) % TWO_PI;
    let cum = 0;
    for (const w of wedges) {
      if (rel < cum + w.span) return { kind: 'wedge', wedge: w };
      cum += w.span;
    }
    const last = wedges[wedges.length - 1];
    return last ? { kind: 'wedge', wedge: last } : { kind: 'inner' };
  };

  if (themed.length === 0) {
    return (
      <div
        ref={wrapperRef}
        className="flex w-full flex-col items-center gap-4"
      >
        <svg
          viewBox={viewBox}
          style={{ width: wrapperWidth, maxWidth: '100%', height: 'auto' }}
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
        <p
          className="text-sm text-mutedText"
          data-testid="crystal-legend-empty"
        >
          Add a task to a domain to see its slice appear.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="flex w-full flex-col items-center gap-5"
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={{ width: wrapperWidth, maxWidth: '100%', height: 'auto' }}
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
              <stop
                offset="0%"
                stopColor={w.color}
                stopOpacity={theme.innerGradientStart}
              />
              <stop
                offset="100%"
                stopColor={w.color}
                stopOpacity={theme.innerGradientEnd}
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
              stopOpacity={theme.glowOpacity}
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
            pointerEvents="none"
          />
        ))}

        {wedges.map((w) => {
          const isActive = active === w.id;
          const dim = active !== null && !isActive;
          // Only the pinned wedge lifts. Lifting on hover too caused
          // a "moving target" bug — the 280ms translate animation
          // would shift the wedge under the cursor mid-click, so
          // mousedown landed on the wedge but mouseup didn't, and
          // the browser never fired a click. Restricting the lift to
          // activeDomainId means hover only changes opacity/stroke
          // (which don't affect hit-testing) and clicks always land.
          const isPinned = activeDomainId === w.id;
          const lift = isPinned ? 10 : 0;
          const tx = Math.cos(w.aMid) * lift;
          const ty = Math.sin(w.aMid) * lift;
          return (
            <g
              key={w.id}
              data-testid={`plot-segment-${w.i}`}
              data-domain-id={w.id}
              data-color={w.color}
              data-span-deg={Math.round((w.span * 180) / Math.PI)}
              data-mid-angle-rad={w.aMid}
              data-has-fill={w.fill ? 'true' : 'false'}
              data-active={isActive ? 'true' : 'false'}
              data-pinned={isPinned ? 'true' : 'false'}
              transform={`translate(${tx} ${ty})`}
              style={{
                transition:
                  'transform 240ms cubic-bezier(.2,.8,.2,1), opacity 200ms',
                opacity: dim ? 0.4 : 1,
              }}
              filter={isDark && isActive ? `url(#cr-${variant}-bloom)` : undefined}
              aria-label={`Domain: ${w.name}`}
              pointerEvents="none"
            >
              <path
                d={w.outline}
                fill="black"
                opacity={theme.wedgeShadowOpacity}
                filter={`url(#cr-${variant}-shadow)`}
                transform="translate(2 4)"
              />
              <path
                d={w.outline}
                fill={w.color}
                fillOpacity={theme.outerFillOpacity}
                stroke={w.color}
                strokeOpacity={theme.outerStrokeOpacity}
                strokeWidth={1}
              />
              {w.fill ? (
                <>
                  <path
                    d={w.fill}
                    fill={`url(#cr-${variant}-${w.i})`}
                    stroke={w.color}
                    strokeOpacity={0.85}
                    strokeWidth={1.2}
                  />
                  <path
                    d={w.fill}
                    fill="white"
                    fillOpacity={theme.wedgeOverlayOpacity}
                    style={{ mixBlendMode: 'overlay' }}
                  />
                </>
              ) : null}
            </g>
          );
        })}

        <circle
          cx={cx}
          cy={cy}
          r={innerR + 28}
          fill={`url(#cr-${variant}-glow)`}
          pointerEvents="none"
        />
        <circle
          cx={cx}
          cy={cy}
          r={innerR + 16}
          fill={theme.centerFill}
          stroke={theme.centerStroke}
          strokeWidth={1.5}
          pointerEvents="none"
        />

        {wedges.map((w) => {
          // Pick a label position and anchor based on which sector of
          // the circle the wedge sits in. Pure cos-based start/end
          // anchoring crowds top/bottom labels into the wedge above
          // them — split the circle into 8 zones and use middle
          // anchors for the top/bottom and side anchors for east/west.
          const cosA = Math.cos(w.aMid);
          const sinA = Math.sin(w.aMid);
          const horizontal = Math.abs(cosA) < 0.35;
          const textAnchor: 'start' | 'middle' | 'end' = horizontal
            ? 'middle'
            : cosA >= 0
              ? 'start'
              : 'end';
          // Bottom labels need extra clearance so descenders don't
          // touch the wedge edge; top labels sit just above.
          const verticalOffset = horizontal ? (sinA >= 0 ? 20 : -8) : 5;
          const x = cx + cosA * labelR;
          const y = cy + sinA * labelR;
          const isActiveLabel = active === w.id;
          return (
            <text
              key={`t-${w.id}`}
              x={x}
              y={y + verticalOffset}
              fontSize={18}
              fontWeight={isActiveLabel ? 600 : 500}
              textAnchor={textAnchor}
              fill="currentColor"
              opacity={(isActiveLabel ? 1 : 0.92) * progress}
              className="text-text"
              pointerEvents="none"
            >
              {w.name}
            </text>
          );
        })}

        {/*
          A single transparent rect — covering the entire viewBox —
          owns hit-testing for the whole plot. We dispatch via angle
          math (findWedgeAt) rather than letting SVG resolve which
          path was painted under the cursor. That side-steps anti-
          aliasing at radial boundaries (the Work / Study ↔ Health
          gap) and z-order ambiguity: every click maps to exactly
          one wedge by mathematics. The rect deliberately covers
          beyond maxR so clicks on the visible outer edge — and on
          the labels themselves — still dispatch instead of falling
          through to nothing. Drawn last so it sits above the
          decorative paths.
        */}
        <rect
          data-testid="crystal-hit-disc"
          x={-viewPadX}
          y={-viewPadY}
          width={size + viewPadX * 2}
          height={size + viewPadY * 2}
          fill="transparent"
          pointerEvents={onSelectDomain ? 'all' : 'none'}
          style={{ cursor: onSelectDomain ? 'pointer' : 'default' }}
          onMouseMove={(event) => {
            const hit = findHitAt(event);
            setHovered(hit.kind === 'wedge' ? hit.wedge.id : null);
          }}
          onMouseLeave={() => setHovered(null)}
          onClick={(event) => {
            event.stopPropagation();
            const hit = findHitAt(event);
            if (hit.kind === 'wedge') {
              onSelectDomain?.(hit.wedge.id);
            } else if (hit.kind === 'outside') {
              // Clicked the empty white space outside the chart →
              // dismiss the pinned domain, mirroring "click outside
              // to deselect".
              onSelectDomain?.(null);
            }
            // 'inner' (centre cap) is intentionally a no-op.
          }}
        />
      </svg>

      <CrystalLegend
        wedge={activeWedge}
        showPinHint={Boolean(onSelectDomain) && !activeIsPinned}
      />
    </div>
  );
}

function CrystalLegend({
  wedge,
  showPinHint,
}: {
  wedge:
    | {
        id: string;
        color: string;
        name: string;
        completed: number;
        target: number;
      }
    | null;
  showPinHint: boolean;
}) {
  if (!wedge) {
    return (
      <p
        className="text-sm text-mutedText"
        data-testid="crystal-legend-idle"
      >
        Hover or click a domain to see its details.
      </p>
    );
  }

  const hasCompletion = wedge.completed > 0;
  const percent = wedge.target > 0
    ? Math.round((wedge.completed / wedge.target) * 100)
    : 0;

  return (
    <div
      className="flex flex-col items-center gap-1 text-center"
      data-testid="crystal-legend"
      data-domain-id={wedge.id}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: wedge.color }}
        />
        <span
          className="text-base font-semibold text-text"
          data-testid="crystal-legend-name"
        >
          {wedge.name}
        </span>
      </div>
      <p
        className="text-sm text-mutedText"
        data-testid="crystal-legend-stats"
      >
        {hasCompletion ? (
          <>
            {formatHours(wedge.completed)} of {formatHours(wedge.target)}h
            <span aria-hidden="true"> · </span>
            {percent}% complete
          </>
        ) : (
          <>{formatHours(wedge.target)}h planned</>
        )}
      </p>
      {showPinHint ? (
        <p className="text-sm text-mutedText">Click to pin this domain.</p>
      ) : null}
    </div>
  );
}
