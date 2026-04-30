import type {
  CadParameter,
  ParameterOption,
  ParameterRange,
  ParameterType,
  ParameterValue,
} from '../../core/types';

export function parseCadParameters(script: string): CadParameter[] {
  const firstDefinitionIndex = script.search(/^(module|function)\s+/m);
  const parameterRegion = firstDefinitionIndex >= 0 ? script.slice(0, firstDefinitionIndex) : script;

  const sections = splitIntoParameterSections(parameterRegion);
  const parameters = new Map<string, CadParameter>();

  for (const section of sections) {
    const parameterRegex = /^([a-zA-Z_$][\w$]*)\s*=\s*([^;]+);[\t\f\v ]*(\/\/[^\n]*)?/gm;
    let match: RegExpExecArray | null;

    while ((match = parameterRegex.exec(section.code)) !== null) {
      const name = match[1];
      const rawValue = match[2].trim();

      if (
        rawValue !== 'true' &&
        rawValue !== 'false' &&
        (rawValue.match(/^[a-zA-Z_]/) || rawValue.includes('\n'))
      ) {
        continue;
      }

      let parsedValue: { value: ParameterValue; type: ParameterType };
      try {
        parsedValue = parseParameterValue(rawValue);
      } catch {
        continue;
      }

      const metadata = parseInlineComment(match[3], parsedValue.type);
      const description = findDescriptionAbove(parameterRegion, match[0]);
      const displayName =
        name === '$fn'
          ? 'Resolution'
          : name
              .replace(/_/g, ' ')
              .split(' ')
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');

      parameters.set(name, {
        name,
        displayName,
        description,
        group: section.group,
        defaultValue: parsedValue.value,
        value: parsedValue.value,
        type: parsedValue.type,
        range: metadata.range,
        options: metadata.options,
      });
    }
  }

  return Array.from(parameters.values());
}

export function applyParameterValue(code: string, parameter: CadParameter) {
  return patchParameterValue(code, parameter.name, parameter.value, parameter.type);
}

export function patchParameterValue(
  code: string,
  name: string,
  value: ParameterValue,
  type: ParameterType,
) {
  const pattern = new RegExp(
    `^\\s*(${escapeRegExp(name)}\\s*=\\s*)[^;]+;([\\t\\f\\v ]*\\/\\/[^\\n]*)?`,
    'm',
  );

  return code.replace(pattern, (_match, prefix: string, comment: string | undefined) => {
    const suffix = comment ?? '';
    return `${prefix}${serializeParameterValue(value, type)};${suffix}`;
  });
}

export function serializeParameterValue(value: ParameterValue, type: ParameterType) {
  switch (type) {
    case 'string':
      return `"${escapeQuotes(String(value))}"`;
    case 'number':
    case 'boolean':
      return String(value);
    case 'string[]':
      return `[${(value as string[]).map((item) => `"${escapeQuotes(item)}"`).join(', ')}]`;
    case 'number[]':
      return `[${(value as number[]).join(', ')}]`;
    case 'boolean[]':
      return `[${(value as boolean[]).join(', ')}]`;
    default:
      return String(value);
  }
}

export function calculateParameterRange(parameter: CadParameter) {
  if (
    parameter.range?.min !== undefined &&
    parameter.range?.max !== undefined
  ) {
    return { min: parameter.range.min, max: parameter.range.max };
  }

  const defaultValue = Number(parameter.defaultValue);
  const reference = Math.abs(defaultValue);

  if (reference <= 0.001) {
    return { min: 0, max: 1 };
  }

  const magnitude = Math.floor(Math.log10(reference));
  const normalized = reference / 10 ** magnitude;

  let multiplier = 10;
  if (normalized <= 1) multiplier = 1;
  else if (normalized <= 2) multiplier = 2;
  else if (normalized <= 5) multiplier = 5;

  let max = multiplier * 10 ** magnitude;
  if (reference > max * 0.5) {
    if (multiplier === 1) multiplier = 2;
    else if (multiplier === 2) multiplier = 5;
    else if (multiplier === 5) multiplier = 10;
    else max = 10 ** (magnitude + 1);
    max = multiplier * 10 ** magnitude;
  }

  const min = parameter.range?.min ?? (defaultValue < 0 ? -max : 0);
  return { min, max };
}

export function calculateParameterStep(parameter: CadParameter) {
  if (parameter.range?.step !== undefined) {
    return parameter.range.step;
  }

  const { min, max } = calculateParameterRange(parameter);
  const range = max - min;
  if (range <= 0.001) return 0.001;

  const rawStep = range / 100;
  const magnitude = Math.floor(Math.log10(rawStep));
  const normalized = rawStep / 10 ** magnitude;

  let multiplier = 10;
  if (normalized <= 1) multiplier = 1;
  else if (normalized <= 2) multiplier = 2;
  else if (normalized <= 5) multiplier = 5;

  return multiplier * 10 ** magnitude;
}

export function validateParameterValue(
  parameter: CadParameter,
  value: ParameterValue,
): ParameterValue {
  switch (parameter.type) {
    case 'number': {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : Number(parameter.defaultValue);
    }
    case 'boolean':
      return Boolean(value);
    case 'string':
      return String(value);
    default:
      return value;
  }
}

const cssHexCache = new Map<string, string>();
let cssHexContext: CanvasRenderingContext2D | null = null;
let cssHexSentinel: string | null = null;

export function cssColorToHex(value: string) {
  if (!value || typeof document === 'undefined') return '';
  const cached = cssHexCache.get(value);
  if (cached !== undefined) return cached;

  if (!cssHexContext) {
    cssHexContext = document.createElement('canvas').getContext('2d');
    if (cssHexContext) {
      cssHexContext.fillStyle = 'transparent';
      cssHexSentinel = cssHexContext.fillStyle;
    }
  }

  if (!cssHexContext || cssHexSentinel === null) return '';

  cssHexContext.fillStyle = cssHexSentinel;
  cssHexContext.fillStyle = value;
  const normalized = cssHexContext.fillStyle;
  const hex =
    normalized !== cssHexSentinel && /^#[0-9a-f]{6}$/i.test(normalized)
      ? normalized.toUpperCase()
      : '';

  cssHexCache.set(value, hex);
  return hex;
}

export function parseEditorValue(text: string, type: ParameterType): ParameterValue {
  switch (type) {
    case 'string':
      return text;
    case 'number': {
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case 'boolean':
      return text === 'true';
    case 'string[]': {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
      break;
    }
    case 'number[]': {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'number')) return parsed;
      break;
    }
    case 'boolean[]': {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'boolean')) return parsed;
      break;
    }
  }

  throw new Error(`Invalid value for ${type}`);
}

function splitIntoParameterSections(script: string) {
  const groupRegex = /^\/\*\s*\[([^\]]+)\]\s*\*\//gm;
  const sections: Array<{ group: string; code: string; index: number }> = [{
    group: '',
    code: '',
    index: 0,
  }];

  let match: RegExpExecArray | null;
  while ((match = groupRegex.exec(script)) !== null) {
    sections.push({ group: match[1].trim(), code: '', index: match.index });
  }

  for (let index = 0; index < sections.length; index += 1) {
    const start = sections[index].index;
    const end = sections[index + 1]?.index ?? script.length;
    sections[index].code = script.slice(start, end);
  }

  return sections;
}

function parseInlineComment(comment: string | undefined, type: ParameterType) {
  const metadata: { range?: ParameterRange; options?: ParameterOption[] } = {};
  if (!comment) return metadata;

  const rawComment = comment.replace(/^\/\/\s*/, '').trim();
  const cleaned = rawComment.replace(/^\[+|\]+$/g, '');

  if (!Number.isNaN(Number(rawComment))) {
    if (type === 'string') {
      metadata.range = { max: Number(cleaned) };
    } else {
      metadata.range = { step: Number(cleaned) };
    }
    return metadata;
  }

  if (rawComment.startsWith('[') && cleaned.includes(',')) {
    metadata.options = cleaned.split(',').map((option) => {
      const [rawValue, rawLabel] = option.trim().split(':');
      return {
        value: type === 'number' ? Number(rawValue) : rawValue,
        label: rawLabel ?? rawValue,
      };
    });
    return metadata;
  }

  if (/^[-\d.]+(?::[-\d.]+){1,2}$/.test(cleaned)) {
    const [min, middle, max] = cleaned.split(':').map(Number);
    metadata.range = {
      min,
      max: max ?? middle,
      step: max !== undefined ? middle : undefined,
    };
  }

  return metadata;
}

function findDescriptionAbove(script: string, matchedDefinition: string) {
  const [before] = script.split(new RegExp(`^${escapeRegExp(matchedDefinition)}`, 'm'));
  const lines = before.trimEnd().split('\n').reverse();
  const lastLine = lines[0]?.trim();
  if (!lastLine?.startsWith('//')) return undefined;

  const description = lastLine.replace(/^\/\/\s*/, '').trim();
  return description || undefined;
}

function parseParameterValue(rawValue: string): {
  value: ParameterValue;
  type: ParameterType;
} {
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return { value: Number(rawValue), type: 'number' };
  }

  if (rawValue === 'true' || rawValue === 'false') {
    return { value: rawValue === 'true', type: 'boolean' };
  }

  if (/^".*"$/.test(rawValue)) {
    return { value: rawValue.slice(1, -1), type: 'string' };
  }

  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    const values = rawValue
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    if (values.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
      return { value: values.map(Number), type: 'number[]' };
    }

    if (values.every((value) => /^".*"$/.test(value))) {
      return { value: values.map((value) => value.slice(1, -1)), type: 'string[]' };
    }

    if (values.every((value) => value === 'true' || value === 'false')) {
      return { value: values.map((value) => value === 'true'), type: 'boolean[]' };
    }
  }

  throw new Error(`Unsupported parameter value: ${rawValue}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeQuotes(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
