import { performance } from 'node:perf_hooks';

export const TIMEOUT_MS = 30_000;

const USER_AGENT = 'net-speed-cli/1.0';

export interface DownloadSample {
  ok: boolean;
  status: number;
  bytes: number;
  /** Время до получения заголовков; null — если заголовки так и не пришли (таймаут, DNS, обрыв). */
  headerMs: number | null;
  /** От отправки запроса до последнего байта тела. */
  totalMs: number;
  error: string | null;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause);
  return detail === '' ? `${error.name}: ${error.message}` : `${error.name}: ${error.message} (${detail})`;
}

/** Забирает тело ответа целиком и возвращает байты с двумя таймингами. Бросает только ошибки ввода-вывода. */
async function readBodyFully(response: Response): Promise<number> {
  const body = response.body;
  if (body === null) {
    return 0;
  }
  const reader = body.getReader();
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return bytes;
    }
    bytes += chunk.value.byteLength;
  }
}

export async function downloadOnce(url: URL): Promise<DownloadSample> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // identity просим намеренно: с gzip/br мы считали бы байты после распаковки,
      // а это не то же самое, что прилетело по проводам.
      headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'identity' },
    });
    const headerMs = performance.now() - startedAt;
    const bytes = await readBodyFully(response);
    const totalMs = performance.now() - startedAt;
    return {
      ok: response.ok,
      status: response.status,
      bytes,
      headerMs,
      totalMs,
      error: response.ok ? null : `HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      bytes: 0,
      headerMs: null,
      totalMs: performance.now() - startedAt,
      error: describeError(error),
    };
  }
}
