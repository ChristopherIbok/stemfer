'use client';

import { useRef, useEffect, memo } from 'react';

interface Props {
  peaks:  number[];
  width:  number;
  height: number;
  color?: string;
}

export const WaveformCanvas = memo(function WaveformCanvas({
  peaks,
  width,
  height,
  color = '#22c55e',
}: Props) {
  const ref          = useRef<HTMLCanvasElement>(null);
  const prevDrawKey  = useRef('');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks.length || width <= 0 || height <= 0) return;

    /* Skip if nothing meaningful changed (same peaks/size/color) */
    const drawKey = `${peaks.length}:${width}:${height}:${color}`;
    if (drawKey === prevDrawKey.current) return;
    prevDrawKey.current = drawKey;

    const dpr = Math.min(window.devicePixelRatio || 1, 2); /* cap at 2× — no need for 3× on waveforms */
    canvas.width  = width  * dpr;
    canvas.height = height * dpr;
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid  = height / 2;
    const barW = width / peaks.length;

    /* Gradient fill */
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0,   `${color}55`);
    grad.addColorStop(0.5, `${color}cc`);
    grad.addColorStop(1,   `${color}55`);
    ctx.fillStyle = grad;

    /* Render in a single path batch for best GPU throughput */
    ctx.beginPath();
    peaks.forEach((peak, i) => {
      const x = i * barW;
      const h = Math.max(1, peak * mid);
      ctx.rect(x, mid - h, Math.max(1, barW - 0.5), h * 2);
    });
    ctx.fill();

    /* Center line */
    ctx.strokeStyle = `${color}33`;
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
  }, [peaks, width, height, color]);

  return (
    <canvas
      ref={ref}
      className="block"
      style={{ width, height, imageRendering: 'pixelated' }}
      aria-hidden="true"
    />
  );
}, (prev, next) =>
  /* Custom comparison — avoid re-render if peaks reference didn't change */
  prev.peaks === next.peaks &&
  prev.width === next.width &&
  prev.height === next.height &&
  prev.color === next.color
);
