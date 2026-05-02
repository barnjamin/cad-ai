const DEFAULT_BASE_URL = process.env.VITE_LLAMACPP_BASE_URL ?? 'http://192.168.4.220:8080/';

export type LlamaCppModel = {
  id: string;
  object?: string;
  owned_by?: string;
  status?: {
    value?: string;
  };
};

export const STRICT_OPENSCAD_PROMPT = `You generate high-quality OpenSCAD code.
Return ONLY raw OpenSCAD code with no markdown fences, prose, or explanations.
The first line must be valid OpenSCAD code or a comment.
Use explicit numeric dimensions whenever practical.
Prefer simple, printable, manifold geometry.
Do not include imports, external dependencies, or libraries unless the user explicitly asks for them.
Use valid OpenSCAD loop syntax only.
Do not output placeholders like TODO.
If repairing code, preserve the original design intent while fixing syntax or structural issues.
If the request is unrelated to OpenSCAD or 3D CAD, return exactly 404.`;

export async function listLlamaCppModels(baseUrl = DEFAULT_BASE_URL) {
  const response = await fetch(joinUrl(baseUrl, 'v1/models'));
  if (!response.ok) {
    throw new Error(`Failed to load llama.cpp models: ${response.status}`);
  }

  const payload = (await response.json()) as { data?: LlamaCppModel[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function generateOpenScadWithLlamaCpp(args: {
  prompt: string;
  model: string;
  baseUrl?: string;
  baseCode?: string;
  maxTokens?: number;
}) {
  const response = await fetch(joinUrl(args.baseUrl ?? DEFAULT_BASE_URL, 'v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      stream: false,
      max_tokens: args.maxTokens ?? 1024,
      messages: [
        { role: 'system', content: STRICT_OPENSCAD_PROMPT },
        ...(args.baseCode ? [{ role: 'assistant', content: args.baseCode }] : []),
        { role: 'user', content: args.prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `llama.cpp request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        reasoning_content?: string;
      };
    }>;
  };

  const raw = payload.choices?.[0]?.message?.content ?? '';
  const reasoning = payload.choices?.[0]?.message?.reasoning_content ?? '';
  const code = normalizeGeneratedOpenScad(raw);
  const validation = validateGeneratedOpenScad(code);

  return {
    raw,
    reasoning,
    code,
    validation,
  };
}

export function pickDefaultModel(models: LlamaCppModel[]) {
  return models.find((model) => model.status?.value === 'loaded')?.id ?? models[0]?.id ?? null;
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function extractOpenScadCode(text: string) {
  if (!text) return null;

  const codeBlockPattern = /```(?:openscad|scad)?\s*\n?([\s\S]*?)\n?```/gi;
  let bestCode: string | null = null;
  let bestScore = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(text)) !== null) {
    const candidate = match[1].trim();
    const score = scoreOpenScad(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCode = candidate;
    }
  }

  return bestCode;
}

function scoreOpenScad(code: string) {
  const patterns = [/\bcube\b/gi, /\bcylinder\b/gi, /\bsphere\b/gi, /\bdifference\b/gi, /\bunion\b/gi, /\bmodule\b/gi, /;/g];
  return patterns.reduce((score, pattern) => score + (code.match(pattern)?.length ?? 0), 0);
}

function stripCodeFences(value: string) {
  return value.replace(/^```(?:openscad|scad)?\s*\n?/, '').replace(/\n?```\s*$/, '');
}

function normalizeGeneratedOpenScad(value: string) {
  const extractedCode = extractOpenScadCode(value);
  const stripped = (extractedCode ?? stripCodeFences(value)).trim();
  const lines = stripped.split('\n').map((line) => line.trimEnd());
  const firstCodeIndex = lines.findIndex((line) => isLikelyCodeLine(line));
  const slicedLines = firstCodeIndex > 0 ? lines.slice(firstCodeIndex) : lines;

  return slicedLines
    .filter((line, index) => !(index === 0 && /^here(?:'s| is)\b/i.test(line.trim())))
    .join('\n')
    .trim();
}

function validateGeneratedOpenScad(code: string) {
  const issues: string[] = [];
  const firstMeaningfulLine =
    code
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '';

  if (firstMeaningfulLine && !isLikelyCodeLine(firstMeaningfulLine)) {
    issues.push('The first line does not look like valid OpenSCAD.');
  }

  if (/\bfor\s*\([^)]*\bin\b[^)]*\)/i.test(code)) {
    issues.push('The code uses a suspicious for (... in ...) loop syntax.');
  }

  if (/\bcylinder\s*\([^)]*\bradius\s*=/i.test(code)) {
    issues.push('Use cylinder(r=...) or cylinder(d=...), not cylinder(radius=...).');
  }

  if (/^(?!\s*(?:\/\/|\/\*|\*|$))[A-Z][^.\n]*$/m.test(firstMeaningfulLine)) {
    issues.push('The response appears to start with prose instead of code.');
  }

  if (!isLikelyCompleteOpenScad(code)) {
    issues.push('The generated OpenSCAD looks incomplete or has unmatched delimiters.');
  }

  return { ok: issues.length === 0, issues };
}

function isLikelyCodeLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(\/\/|\/\*|\*)/.test(trimmed)) return true;
  if (/[;={}()[\]]/.test(trimmed)) return true;
  return /^(include|use|module|function|color|translate|rotate|scale|mirror|linear_extrude|rotate_extrude|difference|union|intersection|cube|cylinder|sphere|polygon|polyhedron|circle|square|text|import|surface|projection|render|offset|hull|minkowski|multmatrix|resize|assign|echo|if|for|let|[a-z_$][a-z0-9_$]*)\b/i.test(trimmed);
}

function isLikelyCompleteOpenScad(code: string) {
  if (!code || code.length < 20) return false;

  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < code.length; index += 1) {
    const current = code[index];
    const next = code[index + 1];

    if (inLineComment) {
      if (current === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === '\\') {
        escaped = true;
        continue;
      }
      if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === '"') {
      inString = true;
      continue;
    }

    if (current === '(') parenDepth += 1;
    else if (current === ')') parenDepth -= 1;
    else if (current === '[') bracketDepth += 1;
    else if (current === ']') bracketDepth -= 1;
    else if (current === '{') braceDepth += 1;
    else if (current === '}') braceDepth -= 1;

    if (parenDepth < 0 || bracketDepth < 0 || braceDepth < 0) {
      return false;
    }
  }

  return !inString && !inBlockComment && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0;
}
