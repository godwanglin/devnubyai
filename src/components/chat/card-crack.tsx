"use client";

import React from "react";

interface CrackLine {
  d: string;
  width: number;
  delay: number;
}

interface CrackShard {
  points: string;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
}

export interface CrackShape {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: CrackLine[];
  ring: string;
  shards: CrackShard[];
}

const BRANCHES = 8;

/**
 * Random crack pattern radiating from (x, y) on a `width`×`height` card: jagged main
 * branches (some forking), a small crater ring and a few shards. Call it from an event
 * handler (it's random) and render the result with `CardCrack`.
 */
export function generateCrack(x: number, y: number, width: number, height: number): CrackShape {
  const rand = (min: number, max: number) => min + Math.random() * (max - min);
  const reach = Math.max(width, height);
  const lines: CrackLine[] = [];

  function branch(sx: number, sy: number, angle: number, length: number, segments: number, w: number, delay: number, depth: number) {
    let px = sx;
    let py = sy;
    let a = angle;
    let d = `M${px.toFixed(1)} ${py.toFixed(1)}`;
    const step = length / segments;
    for (let i = 0; i < segments; i++) {
      a += rand(-0.38, 0.38);
      px += Math.cos(a) * step * rand(0.7, 1.3);
      // Cards are wide and short: squash the vertical spread a little
      py += Math.sin(a) * step * rand(0.7, 1.3) * 0.8;
      d += ` L${px.toFixed(1)} ${py.toFixed(1)}`;
      if (depth === 0 && i === Math.floor(segments / 2) && Math.random() < 0.6) {
        branch(px, py, a + rand(0.5, 0.9) * (Math.random() < 0.5 ? -1 : 1), length * 0.45, 4, w * 0.6, delay + 120, 1);
      }
    }
    lines.push({ d, width: w, delay });
  }

  for (let i = 0; i < BRANCHES; i++) {
    const angle = (i / BRANCHES) * Math.PI * 2 + rand(-0.3, 0.3);
    branch(x, y, angle, reach * rand(0.22, 0.5), Math.round(rand(5, 7)), rand(1.3, 2.1), rand(0, 90), 0);
  }

  // Crater: a small jagged ring around the hit point
  const ringPoints: string[] = [];
  const r0 = rand(9, 13);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = r0 * rand(0.75, 1.25);
    ringPoints.push(`${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r * 0.85).toFixed(1)}`);
  }
  const ring = `M${ringPoints.join(" L")} Z`;

  const shards: CrackShard[] = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + rand(-0.4, 0.4);
    const s = rand(3, 6);
    const cx = x + Math.cos(a) * 6;
    const cy = y + Math.sin(a) * 6;
    const points = [0, 1, 2]
      .map((k) => {
        const pa = a + (k * Math.PI * 2) / 3 + rand(-0.5, 0.5);
        return `${(cx + Math.cos(pa) * s).toFixed(1)},${(cy + Math.sin(pa) * s).toFixed(1)}`;
      })
      .join(" ");
    const dist = rand(28, 60);
    return {
      points,
      dx: Math.cos(a) * dist,
      dy: Math.sin(a) * dist - rand(6, 16),
      rot: rand(-240, 240),
      delay: rand(0, 60),
    };
  });

  return { x, y, width, height, lines, ring, shards };
}

/**
 * Animated crack overlay for a card; place it inside the card (`relative overflow-hidden`).
 * Flash → crater → cracks drawing outward → shards falling off (~0.7s)
 */
export function CardCrack({ crack }: { crack: CrackShape }) {
  return (
    <svg
      aria-hidden="true"
      className="dn-crack pointer-events-none absolute inset-0 w-full h-full"
      viewBox={`0 0 ${crack.width} ${crack.height}`}
      preserveAspectRatio="none"
    >
      <circle className="dn-crack-flash" cx={crack.x} cy={crack.y} r={Math.max(crack.width, crack.height) * 0.35} />
      <path className="dn-crack-crater" d={crack.ring} />
      {crack.lines.map((line, i) => (
        <g key={i}>
          <path
            className="dn-crack-shadow"
            d={line.d}
            pathLength={1}
            style={{ strokeWidth: line.width + 1.6, animationDelay: `${line.delay}ms` }}
          />
          <path
            className="dn-crack-line"
            d={line.d}
            pathLength={1}
            style={{ strokeWidth: line.width, animationDelay: `${line.delay}ms` }}
          />
        </g>
      ))}
      {crack.shards.map((s, i) => (
        <polygon
          key={i}
          className="dn-crack-shard"
          points={s.points}
          style={
            {
              "--dx": `${s.dx}px`,
              "--dy": `${s.dy}px`,
              "--rot": `${s.rot}deg`,
              animationDelay: `${s.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </svg>
  );
}
