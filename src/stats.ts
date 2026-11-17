export interface Stats {
  count: number;
  min: number;
  max: number;
  avg: number;
  median: number;
  p90: number;
  p99: number;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Квантиль линейной интерполяцией между соседними порядковыми статистиками (метод R7,
 * тот же, что у Excel PERCENTILE.INC и numpy по умолчанию). Вход обязан быть отсортирован.
 */
export function quantileSorted(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  if (sorted.length === 1) {
    return sorted[0] ?? Number.NaN;
  }
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? Number.NaN;
  const upper = sorted[upperIndex] ?? Number.NaN;
  return lower + (upper - lower) * (position - lowerIndex);
}

export function describe(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: quantileSorted(sorted, 0),
    max: quantileSorted(sorted, 1),
    avg: mean(sorted),
    median: quantileSorted(sorted, 0.5),
    p90: quantileSorted(sorted, 0.9),
    p99: quantileSorted(sorted, 0.99),
  };
}

/** Байт в секунду -> Мбит/с (10^6 бит в секунду, десятичные приставки как в сетях). */
export function toMegabitsPerSecond(bytesPerSecond: number): number {
  return (bytesPerSecond * 8) / 1_000_000;
}

/** Байт в секунду -> МБ/с (10^6 байт в секунду, не Миб). */
export function toMegabytesPerSecond(bytesPerSecond: number): number {
  return bytesPerSecond / 1_000_000;
}
