/**
 * Notification waves — PURE TypeScript. PRD §5.4: wave sizes S-08, intervals
 * S-09 by urgency, wave count S-10. The next wave shrinks by the number of
 * donors who opened but have not answered (they are still deciding).
 */
export type WavesSettings = {
  waveSizes: number[];
  waveIntervalMin: { now: number; today: number; later: number };
  waveCount: number;
};

export type Urgency = "now" | "today" | "later";

/** Size of wave `waveNumber` (1-based). */
export function nextWaveSize(
  waveNumber: number,
  openedUnanswered: number,
  settings: WavesSettings,
): number {
  if (waveNumber < 1 || waveNumber > settings.waveCount) return 0;
  const base = settings.waveSizes[waveNumber - 1] ?? settings.waveSizes[settings.waveSizes.length - 1] ?? 0;
  if (waveNumber === 1) return base;
  return Math.max(0, base - openedUnanswered);
}

/** When the next wave should fire for a request with this urgency. */
export function nextWaveAt(
  request: { urgency: Urgency },
  settings: WavesSettings,
  now: number = Date.now(),
): number {
  return now + settings.waveIntervalMin[request.urgency] * 60_000;
}
