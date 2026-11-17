#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

import { downloadOnce, TIMEOUT_MS, type DownloadSample } from './measure.js';
import { describe, toMegabitsPerSecond, toMegabytesPerSecond } from './stats.js';

const REQUEST_COUNT = 10;
const MEGABYTE = 1_000_000;

const USAGE = `Замер скорости скачивания: ${REQUEST_COUNT} последовательных запросов к одному адресу.

Использование:
  node dist/index.js <http(s)-адрес>

Пример:
  node dist/index.js "https://speed.cloudflare.com/__down?bytes=5000000"

Скорость печатается в Мбит/с и МБ/с (приставки десятичные: 1 МБ = 10^6 байт).
Подробнее о методике — README.md.`;

const int0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseTarget(raw: string | undefined): URL | string {
  if (raw === undefined) {
    return 'Не передан адрес.';
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `Не разобрал адрес: ${raw}`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `Умею качать только по http/https, получено: ${url.protocol}`;
  }
  return url;
}

function bytesPerSecond(bytes: number, ms: number): number {
  return bytes / (ms / 1000);
}

const COLUMNS = [3, 6, 12, 10, 18, 9] as const;

function printRow(cells: readonly string[]): void {
  console.log(cells.map((cell, index) => cell.padStart(COLUMNS[index] ?? cell.length)).join(' '));
}

function statusOf(sample: DownloadSample): string {
  return sample.ok ? String(sample.status) : 'ошибка';
}

function rateOf(sample: DownloadSample): number {
  return sample.ok && sample.bytes > 0 ? toMegabitsPerSecond(bytesPerSecond(sample.bytes, sample.totalMs)) : Number.NaN;
}

function printSampleLine(index: number, sample: DownloadSample): void {
  const mbps = rateOf(sample);
  printRow([
    String(index),
    statusOf(sample),
    int0.format(sample.bytes),
    sample.headerMs === null ? '—' : num1.format(sample.headerMs),
    num1.format(sample.totalMs),
    Number.isNaN(mbps) ? '—' : num2.format(mbps),
  ]);
}

function printSummary(samples: readonly DownloadSample[], wallMs: number): void {
  const succeeded = samples.filter((sample) => sample.ok);
  const failed = samples.filter((sample) => !sample.ok);

  const totalBytes = succeeded.reduce((sum, sample) => sum + sample.bytes, 0);
  const transferMs = succeeded.reduce((sum, sample) => sum + sample.totalMs, 0);
  const durations = describe(succeeded.map((sample) => sample.totalMs));
  const ttfb = describe(
    succeeded.map((sample) => sample.headerMs).filter((value): value is number => value !== null),
  );
  const perRequest = describe(succeeded.map(rateOf).filter((value) => !Number.isNaN(value)));
  const aggregateMbps = totalBytes > 0 && transferMs > 0 ? toMegabitsPerSecond(bytesPerSecond(totalBytes, transferMs)) : Number.NaN;
  const aggregateMBps = totalBytes > 0 && transferMs > 0 ? toMegabytesPerSecond(bytesPerSecond(totalBytes, transferMs)) : Number.NaN;

  console.log();
  console.log('Итог');
  console.log(`  Запросов успешных:    ${succeeded.length} из ${samples.length}`);
  console.log(`  Всего скачано:         ${num2.format(totalBytes / MEGABYTE)} МБ (${int0.format(totalBytes)} байт)`);
  console.log(`  Время запроса:         среднее ${num1.format(durations.avg)} мс · медиана ${num1.format(durations.median)} мс · мин ${num1.format(durations.min)} мс · макс ${num1.format(durations.max)} мс`);
  console.log(`                         p90 ${num1.format(durations.p90)} мс · p99 ${num1.format(durations.p99)} мс`);
  console.log(`  Время до заголовков:   среднее ${num1.format(ttfb.avg)} мс · медиана ${num1.format(ttfb.median)} мс · p90 ${num1.format(ttfb.p90)} мс`);
  console.log(`  Скорость скачивания:   ${num2.format(aggregateMbps)} Мбит/с (${num2.format(aggregateMBps)} МБ/с)`);
  console.log(`                         ${int0.format(totalBytes)} байт / ${num1.format(transferMs)} мс суммарно по успешным запросам`);
  console.log(`  Скорость по запросам:  медиана ${num2.format(perRequest.median)} · p90 ${num2.format(perRequest.p90)} · макс ${num2.format(perRequest.max)} Мбит/с`);
  console.log(`  Реальное время работы: ${num1.format(wallMs / 1000)} с — ${REQUEST_COUNT} запросов последовательно`);

  if (failed.length > 0) {
    console.log();
    console.log('Ошибки (в статистику не вошли):');
    for (const sample of failed) {
      console.log(`  ${sample.error}`);
    }
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    console.log(USAGE);
    return;
  }

  const target = parseTarget(arg);
  if (typeof target === 'string') {
    console.error(`${target}\n`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  console.log(`Адрес:  ${target.toString()}`);
  console.log(`Режим:  ${REQUEST_COUNT} запросов последовательно, каждый дожидается полного тела ответа`);
  console.log('        gzip выключен (accept-encoding: identity), HTTP-кэша у fetch в Node нет');
  console.log(`        таймаут ${TIMEOUT_MS / 1000} с на запрос`);
  console.log();

  printRow(['#', 'статус', 'байт', 'TTFB, мс', 'полный ответ, мс', 'Мбит/с']);
  printRow(COLUMNS.map((width) => '-'.repeat(width)));

  const startedAt = performance.now();
  const samples: DownloadSample[] = [];
  for (let index = 1; index <= REQUEST_COUNT; index += 1) {
    const sample = await downloadOnce(target);
    samples.push(sample);
    printSampleLine(index, sample);
  }

  printSummary(samples, performance.now() - startedAt);

  if (!samples.some((sample) => sample.ok)) {
    console.error('\nНи один запрос не завершился, замерять нечего.');
    process.exitCode = 1;
  }
}

await main();
