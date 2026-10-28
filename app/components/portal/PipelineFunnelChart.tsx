"use client";

import { useEffect, useState, type CSSProperties } from "react";

export type PipelineFunnelStage = {
  key: string;
  label: string;
  value: number;
  hint?: string;
  onClick?: () => void;
};

type PipelineFunnelChartProps = {
  stages: PipelineFunnelStage[];
  className?: string;
  /** Conversion shown between this stage and the previous one. */
  conversionLabel?: (stage: PipelineFunnelStage, index: number) => string;
};

const VIEW_W = 1000;
const VIEW_H = 340;
const CHART_TOP = 100;
const CHART_BOTTOM = 278;
const PAD_X = 20;
const MAX_H = CHART_BOTTOM - CHART_TOP;
const MIN_H = Math.round(MAX_H * 0.2);
const STAGGER_MS = 160;
const RISE_MS = 520;

function defaultConversion(
  stage: PipelineFunnelStage,
  index: number,
  stages: PipelineFunnelStage[],
) {
  if (index === 0) return "";
  const prev = stages[index - 1]?.value ?? 0;
  if (prev <= 0) return "0%";
  const pct = (stage.value / prev) * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

function stageTops(count: number) {
  if (count <= 1) return [CHART_TOP];
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(count - 1, 1);
    const height = MAX_H - t * (MAX_H - MIN_H);
    return CHART_BOTTOM - height;
  });
}

function truncateLabel(label: string, maxChars: number) {
  const trimmed = label.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Locale-stable so SSR and the browser match (avoids hydration mismatches). */
function formatCount(value: number) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function stageTitle(stage: PipelineFunnelStage) {
  const base = `${stage.label}: ${formatCount(stage.value)}`;
  return stage.hint ? `${base} — ${stage.hint}` : base;
}

export default function PipelineFunnelChart({
  stages,
  className,
  conversionLabel,
}: PipelineFunnelChartProps) {
  const [animating, setAnimating] = useState(false);

  const stagesSignature = stages
    .map((stage) => `${stage.key}:${stage.value}`)
    .join("|");

  useEffect(() => {
    if (stages.length === 0) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setAnimating(false);
      return;
    }
    setAnimating(false);
    const start = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimating(true));
    });
    return () => cancelAnimationFrame(start);
  }, [stages.length, stagesSignature]);

  if (stages.length === 0) {
    return null;
  }

  const n = stages.length;
  const tops = stageTops(n);
  const segW = (VIEW_W - PAD_X * 2) / n;
  const labelMax = n >= 8 ? 10 : n >= 6 ? 14 : 22;

  return (
    <div
      className={`${className ?? "pipeline-funnel"}${
        animating ? " is-animating" : " is-ready"
      }`}
      role="img"
      aria-label="Pipeline funnel"
      style={
        {
          "--pipeline-rise-ms": `${RISE_MS}ms`,
          "--pipeline-stagger-ms": `${STAGGER_MS}ms`,
        } as CSSProperties
      }
    >
      <svg
        className="pipeline-funnel-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {stages.map((stage, index) => {
          const x0 = PAD_X + index * segW;
          const x1 = x0 + segW;
          const yL = tops[index];
          const yR =
            index < n - 1
              ? tops[index + 1]
              : tops[index] + (CHART_BOTTOM - tops[index]) * 0.12;
          const points = `${x0},${yL} ${x1},${yR} ${x1},${CHART_BOTTOM} ${x0},${CHART_BOTTOM}`;
          const clickable = Boolean(stage.onClick);
          return (
            <polygon
              key={stage.key}
              className={`pipeline-funnel-seg${index === 0 ? " is-first" : ""}${
                clickable ? " is-clickable" : ""
              }`}
              points={points}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={stage.onClick}
              onKeyDown={
                clickable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        stage.onClick?.();
                      }
                    }
                  : undefined
              }
              style={{ "--pipeline-delay": `${index * STAGGER_MS}ms` } as CSSProperties}
            >
              <title>{stageTitle(stage)}</title>
            </polygon>
          );
        })}

        <line
          className="pipeline-funnel-baseline"
          x1={PAD_X}
          x2={VIEW_W - PAD_X}
          y1={CHART_BOTTOM}
          y2={CHART_BOTTOM}
        />

        {stages.map((stage, index) => {
          const x0 = PAD_X + index * segW;
          const x1 = x0 + segW;
          const midX = (x0 + x1) / 2;
          const yL = tops[index];
          const labelY = Math.max(36, yL - 48);
          const conversion =
            index === 0
              ? ""
              : (conversionLabel?.(stage, index) ??
                defaultConversion(stage, index, stages));
          const delay = { "--pipeline-delay": `${index * STAGGER_MS}ms` } as CSSProperties;
          return (
            <g key={`meta-${stage.key}`} className="pipeline-funnel-meta" style={delay}>
              <text className="pipeline-funnel-value" x={midX} y={labelY} textAnchor="middle">
                {formatCount(stage.value)}
              </text>
              <text
                className="pipeline-funnel-label"
                x={midX}
                y={labelY + 24}
                textAnchor="middle"
              >
                {truncateLabel(stage.label, labelMax)}
              </text>
              {conversion ? (
                <text
                  className="pipeline-funnel-pct"
                  x={x0}
                  y={CHART_BOTTOM + 30}
                  textAnchor="middle"
                >
                  <title>Conversion rate</title>
                  {conversion}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
