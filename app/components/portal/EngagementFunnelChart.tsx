"use client";

import { useEffect, useState, type CSSProperties } from "react";

export type EngagementFunnelStage = {
  key: string;
  label: string;
  hint?: string;
  value: number;
  color?: string;
  onClick?: () => void;
};

type EngagementFunnelChartProps = {
  stages: EngagementFunnelStage[];
  height?: number;
  className?: string;
  conversionLabel?: (stage: EngagementFunnelStage, index: number) => string;
};

const FILL_MS = 520;
const STAGGER_MS = 420;
const MOUTH_MS = 280;
const MAX_SIDE_INSET = 42;

function defaultConversion(
  stage: EngagementFunnelStage,
  index: number,
  stages: EngagementFunnelStage[],
) {
  if (index === 0) {
    return "100%";
  }
  const prev = stages[index - 1]?.value ?? 0;
  if (prev <= 0) {
    return "0%";
  }
  return `${Math.round((stage.value / prev) * 100)}%`;
}

function stageClipPath(index: number, total: number) {
  const count = Math.max(total, 1);
  const topInset = (index / count) * MAX_SIDE_INSET;
  const bottomInset = ((index + 1) / count) * MAX_SIDE_INSET;
  return `polygon(${topInset}% 0, ${100 - topInset}% 0, ${100 - bottomInset}% 100%, ${bottomInset}% 100%)`;
}

function stageColors(color: string | undefined, index: number, total: number) {
  if (color) {
    return {
      top: `color-mix(in srgb, ${color} 58%, #fff)`,
      bottom: `color-mix(in srgb, ${color} 82%, #1a1028)`,
    };
  }
  const t = total <= 1 ? 0 : index / (total - 1);
  const light = Math.round(42 + t * 30);
  const deep = Math.round(72 + t * 20);
  return {
    top: `color-mix(in srgb, var(--purple) ${light}%, #fff)`,
    bottom:
      t > 0.66
        ? `color-mix(in srgb, var(--purple) 68%, #1a1028)`
        : `color-mix(in srgb, var(--purple) ${deep}%, #fff)`,
  };
}

export default function EngagementFunnelChart({
  stages,
  height = 360,
  className,
  conversionLabel,
}: EngagementFunnelChartProps) {
  const [animating, setAnimating] = useState(false);

  const stagesSignature = stages
    .map((stage) => `${stage.key}:${stage.value}:${stage.color ?? ""}`)
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

  const stageHeight = Math.max(
    48,
    Math.min(72, Math.floor((height - 28) / stages.length)),
  );

  return (
    <div className={className ?? "engagement-funnel"}>
      <div
        className={`engagement-funnel-visual${
          animating ? " is-filling" : " is-ready"
        }`}
        role="img"
        aria-label="Engagement funnel"
        style={
          {
            "--funnel-fill-ms": `${FILL_MS}ms`,
            "--funnel-stagger-ms": `${STAGGER_MS}ms`,
            "--funnel-mouth-ms": `${MOUTH_MS}ms`,
            "--funnel-stage-count": String(stages.length),
          } as CSSProperties
        }
      >
        <div className="engagement-funnel-mouth" aria-hidden="true">
          <div className="engagement-funnel-mouth-ring" />
          <div className="engagement-funnel-mouth-hole" />
        </div>
        <div className="engagement-funnel-body">
          {stages.map((stage, index) => {
            const conversion =
              conversionLabel?.(stage, index) ??
              defaultConversion(stage, index, stages);
            const colors = stageColors(stage.color, index, stages.length);
            const delayMs =
              MOUTH_MS + (stages.length - 1 - index) * STAGGER_MS;
            const style = {
              height: index === 0 ? stageHeight + 14 : stageHeight,
              clipPath: stageClipPath(index, stages.length),
              "--stage-delay": `${delayMs}ms`,
              "--stage-top": colors.top,
              "--stage-bottom": colors.bottom,
            } as CSSProperties;
            const content = (
              <>
                <span className="engagement-funnel-stage-water" aria-hidden="true" />
                <span className="engagement-funnel-stage-label">{stage.label}</span>
                <span className="engagement-funnel-stage-value">
                  {stage.value.toLocaleString()}
                </span>
                <span className="engagement-funnel-stage-pct">{conversion}</span>
              </>
            );
            return stage.onClick ? (
              <button
                key={stage.key}
                type="button"
                className={`engagement-funnel-stage stage-${index}`}
                style={style}
                onClick={stage.onClick}
              >
                {content}
              </button>
            ) : (
              <div
                key={stage.key}
                className={`engagement-funnel-stage stage-${index}`}
                style={style}
              >
                {content}
              </div>
            );
          })}
        </div>
        <div
          className="engagement-funnel-spout"
          aria-hidden="true"
          style={
            {
              "--stage-delay": `0ms`,
            } as CSSProperties
          }
        />
        <div
          className="engagement-funnel-shadow"
          aria-hidden="true"
          style={
            {
              "--stage-delay": `${MOUTH_MS + stages.length * STAGGER_MS}ms`,
            } as CSSProperties
          }
        />
      </div>
    </div>
  );
}
