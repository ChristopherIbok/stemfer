/**
 * Timecode utilities for Stemfer
 * Format: HH:MM:SS:MS  (hours, minutes, seconds, milliseconds)
 */

export interface Timecode {
  hours:   number;
  minutes: number;
  seconds: number;
  ms:      number;
}

/** Parse "HH:MM:SS:MS" string → Timecode object */
export function parseTimecode(tc: string): Timecode {
  const parts = tc.split(':');
  if (parts.length !== 4) throw new Error(`Invalid timecode: "${tc}"`);
  const [h, m, s, ms] = parts.map(Number);
  if ([h, m, s, ms].some(isNaN)) throw new Error(`Invalid timecode: "${tc}"`);
  return { hours: h, minutes: m, seconds: s, ms };
}

/** Format Timecode object → "HH:MM:SS:MS" */
export function formatTimecode(tc: Timecode): string {
  return [
    String(tc.hours).padStart(2, '0'),
    String(tc.minutes).padStart(2, '0'),
    String(tc.seconds).padStart(2, '0'),
    String(tc.ms).padStart(3, '0'),
  ].join(':');
}

/** Convert milliseconds → "HH:MM:SS:MS" */
export function msToTimecode(totalMs: number): string {
  const ms      = Math.floor(totalMs) % 1000;
  const seconds = Math.floor(totalMs / 1000) % 60;
  const minutes = Math.floor(totalMs / 60000) % 60;
  const hours   = Math.floor(totalMs / 3600000);
  return formatTimecode({ hours, minutes, seconds, ms });
}

/** Convert "HH:MM:SS:MS" → milliseconds */
export function timecodeToMs(tc: string): number {
  const { hours, minutes, seconds, ms } = parseTimecode(tc);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
}

/** Validate a timecode string */
export function isValidTimecode(tc: string): boolean {
  try {
    const { hours, minutes, seconds, ms } = parseTimecode(tc);
    return hours >= 0 && minutes >= 0 && minutes < 60
        && seconds >= 0 && seconds < 60
        && ms >= 0 && ms < 1000;
  } catch {
    return false;
  }
}

/** Add milliseconds to a timecode string */
export function addMsToTimecode(tc: string, ms: number): string {
  return msToTimecode(timecodeToMs(tc) + ms);
}

/** Compute beat duration in ms given BPM */
export function beatDurationMs(bpm: number): number {
  return 60000 / bpm;
}

/** Snap a timestamp (ms) to the nearest beat grid */
export function snapToGrid(ms: number, bpm: number, subdivisions = 1): number {
  const beatMs = beatDurationMs(bpm) / subdivisions;
  return Math.round(ms / beatMs) * beatMs;
}

/** Convert pixel offset to milliseconds given a zoom level (px/ms) */
export function pxToMs(px: number, pxPerMs: number): number {
  return px / pxPerMs;
}

/** Convert milliseconds to pixel offset */
export function msToPx(ms: number, pxPerMs: number): number {
  return ms * pxPerMs;
}

/** Format milliseconds as human-readable duration (e.g. "3m 24s") */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Parse BWF timecode from binary data at a given byte offset.
 * The bext chunk TimeReference field is a 64-bit sample count at offset 256.
 */
export function parseBWFTimecode(buffer: ArrayBuffer, bextOffset: number, sampleRate: number): string | null {
  try {
    const view    = new DataView(buffer);
    const lo      = view.getUint32(bextOffset + 256, true);
    const hi      = view.getUint32(bextOffset + 260, true);
    const samples = lo + hi * 4294967296;
    return msToTimecode(Math.floor((samples / sampleRate) * 1000));
  } catch {
    return null;
  }
}

/** Align multiple clips to a common start point */
export function alignClipsToZero(clips: { offsetMs: number }[]): { offsetMs: number }[] {
  const minOffset = Math.min(...clips.map(c => c.offsetMs));
  return clips.map(c => ({ ...c, offsetMs: c.offsetMs - minOffset }));
}

/** Compute total timeline duration from a set of clips */
export function timelineDurationMs(clips: { offsetMs: number; durationMs: number }[]): number {
  if (!clips.length) return 0;
  return Math.max(...clips.map(c => c.offsetMs + c.durationMs));
}

/** Generate ruler tick marks for timeline rendering */
export function generateRulerTicks(
  startMs: number,
  endMs: number,
  intervalMs: number
): { ms: number; label: string; major: boolean }[] {
  const ticks: { ms: number; label: string; major: boolean }[] = [];
  const majorInterval = intervalMs * 4;
  const first = Math.ceil(startMs / intervalMs) * intervalMs;

  for (let ms = first; ms <= endMs; ms += intervalMs) {
    ticks.push({
      ms,
      label: msToTimecode(ms),
      major: ms % majorInterval === 0,
    });
  }
  return ticks;
}

/** Choose a suitable ruler interval given the visible duration and canvas width */
export function rulerInterval(visibleMs: number, widthPx: number): number {
  const msPerPx = visibleMs / widthPx;
  const candidates = [
    10, 25, 50, 100, 250, 500, 1000, 2000, 5000,
    10000, 30000, 60000, 300000, 600000
  ];
  const minSpacingPx = 80;
  return candidates.find(c => c / msPerPx >= minSpacingPx) ?? 1000;
}
