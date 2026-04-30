import { Parameter } from '../types';

export function calculateParameterRange(param: Parameter): {
  min: number;
  max: number;
} {
  if (param.range?.min !== undefined && param.range?.max !== undefined) {
    return { min: param.range.min, max: param.range.max };
  }

  const defaultValue = Number(param.defaultValue);
  const referenceValue = Math.abs(defaultValue);

  if (referenceValue <= 0.001) {
    return { min: 0, max: 1 };
  }

  const magnitude = Math.floor(Math.log10(referenceValue));
  const normalizedValue = referenceValue / Math.pow(10, magnitude);

  let rangeMultiplier: number;
  if (normalizedValue <= 1) rangeMultiplier = 1;
  else if (normalizedValue <= 2) rangeMultiplier = 2;
  else if (normalizedValue <= 5) rangeMultiplier = 5;
  else rangeMultiplier = 10;

  let maxValue = rangeMultiplier * Math.pow(10, magnitude);
  if (referenceValue > maxValue * 0.5) {
    if (rangeMultiplier === 1) rangeMultiplier = 2;
    else if (rangeMultiplier === 2) rangeMultiplier = 5;
    else if (rangeMultiplier === 5) rangeMultiplier = 10;
    else {
      rangeMultiplier = 10;
      maxValue = Math.pow(10, magnitude + 1);
    }
    maxValue = rangeMultiplier * Math.pow(10, magnitude);
  }

  const minValue =
    param.range?.min !== undefined ? param.range.min : defaultValue < 0 ? -maxValue : 0;

  return { min: minValue, max: maxValue };
}

export function calculateParameterStep(param: Parameter): number {
  if (param.range?.step !== undefined) {
    return param.range.step;
  }

  const { min, max } = calculateParameterRange(param);
  const range = max - min;
  if (range <= 0.001) return 0.001;

  const rawStep = range / 100;
  const magnitude = Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / Math.pow(10, magnitude);

  let stepMultiplier: number;
  if (normalizedStep <= 1) stepMultiplier = 1;
  else if (normalizedStep <= 2) stepMultiplier = 2;
  else if (normalizedStep <= 5) stepMultiplier = 5;
  else stepMultiplier = 10;

  return stepMultiplier * Math.pow(10, magnitude);
}

export function validateParameterValue(
  param: Parameter,
  value: Parameter['value'],
): Parameter['value'] {
  if (param.type === 'number' || !param.type) {
    const numValue = Number(value);
    if (Number.isNaN(numValue)) return Number(param.defaultValue);
    return numValue;
  }
  return value;
}

const cssHexCache = new Map<string, string>();
let cssHexCtx: CanvasRenderingContext2D | null = null;
let cssHexSentinelNormalized: string | null = null;

export function cssToHex(value: string): string {
  if (typeof value !== 'string' || !value) return '';
  const cached = cssHexCache.get(value);
  if (cached !== undefined) return cached;

  if (typeof document === 'undefined') return '';
  if (!cssHexCtx) {
    cssHexCtx = document.createElement('canvas').getContext('2d');
    if (cssHexCtx) {
      cssHexCtx.fillStyle = 'transparent';
      cssHexSentinelNormalized = cssHexCtx.fillStyle;
    }
  }
  if (!cssHexCtx || cssHexSentinelNormalized === null) return '';

  cssHexCtx.fillStyle = cssHexSentinelNormalized;
  cssHexCtx.fillStyle = value;
  const normalized = cssHexCtx.fillStyle;
  let result = '';
  if (normalized !== cssHexSentinelNormalized && /^#[0-9a-f]{6}$/i.test(normalized)) {
    result = normalized.toUpperCase();
  }
  cssHexCache.set(value, result);
  return result;
}

export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeReplacement(string: string) {
  return string.replace(/\$/g, '$$$$');
}

export function escapeQuotes(string: string) {
  return string.replace(/"/g, '\\"');
}

export function updateParameter(code: string, param: Parameter): string {
  const escapedName = escapeRegExp(param.name);
  const regex = new RegExp(
    `^\\s*(${escapedName}\\s*=\\s*)[^;]+;([\\t\\f\\cK ]*\\/\\/[^\\n]*)?`,
    'm',
  );

  if (!param.type) {
    return code.replace(regex, `$1${param.value};$2`);
  }

  switch (param.type) {
    case 'string':
      return code.replace(
        regex,
        `$1"${escapeReplacement(escapeQuotes(param.value as string))}";$2`,
      );
    case 'number':
    case 'boolean':
      return code.replace(regex, `$1${param.value};$2`);
    case 'string[]':
      return code.replace(
        regex,
        `$1[${(param.value as string[])
          .map((value) => escapeReplacement(escapeQuotes(value)))
          .map((value) => `"${value}"`)
          .join(',')}];$2`,
      );
    case 'number[]':
      return code.replace(regex, `$1[${(param.value as number[]).join(',')}];$2`);
    case 'boolean[]':
      return code.replace(regex, `$1[${(param.value as boolean[]).join(',')}];$2`);
    default:
      return code;
  }
}
