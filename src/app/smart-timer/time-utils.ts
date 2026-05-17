const MAX_TIMER_SECONDS = 99 * 60 * 60 + 59 * 60 + 59;

export function clampDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.max(0, Math.min(MAX_TIMER_SECONDS, Math.floor(seconds)));
}

export function formatDuration(totalSeconds: number): string {
  const safeTotal = clampDuration(totalSeconds);
  const hours = Math.floor(safeTotal / 3600);
  const minutes = Math.floor((safeTotal % 3600) / 60);
  const seconds = safeTotal % 60;

  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':');
}

export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':');

  if (parts.length > 3 || parts.some((part) => !/^\d{1,2}$/.test(part))) {
    return null;
  }

  const numeric = parts.map(Number);
  const [hours, minutes, seconds] =
    numeric.length === 3 ? numeric : numeric.length === 2 ? [0, numeric[0], numeric[1]] : [0, 0, numeric[0]];

  if (minutes > 59 || seconds > 59) {
    return null;
  }

  const total = hours * 3600 + minutes * 60 + seconds;

  return total > 0 ? clampDuration(total) : null;
}
