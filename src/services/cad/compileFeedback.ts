import type { ArtifactCompileReport, NormalizedCompileError } from '../../core/types';

const NOISY_STDERR_PATTERNS = [
  /locale/i,
  /translation/i,
  /fontconfig/i,
  /warning: can't open config/i,
];

export function normalizeCompileError(report: ArtifactCompileReport): NormalizedCompileError | null {
  if (report.status !== 'error') return null;

  const stderrLines = (report.stdErr ?? [])
    .map((line) => line.trim())
    .filter(Boolean);

  const relevantStdErr = filterRelevantStdErr(stderrLines);
  const primaryLine =
    relevantStdErr.find((line) => /error|parser error|syntax error/i.test(line)) ??
    relevantStdErr[0] ??
    report.errorMessage?.trim() ??
    'OpenSCAD failed to compile the model.';

  const location = extractLocation([primaryLine, report.errorMessage, ...stderrLines]);
  const summary = simplifyCompileSummary(primaryLine, report.errorMessage);

  return {
    summary,
    line: location.line,
    column: location.column,
    relevantStdErr: relevantStdErr.slice(0, 6),
  };
}

export function formatCompileErrorForRepair(
  error: NormalizedCompileError,
  code: string,
) {
  const parts: string[] = [error.summary];

  if (typeof error.line === 'number') {
    parts.push(
      `Location: line ${error.line}${typeof error.column === 'number' ? `, column ${error.column}` : ''}.`,
    );
  }

  if (error.relevantStdErr.length > 0) {
    parts.push(`OpenSCAD stderr:\n${error.relevantStdErr.join('\n')}`);
  }

  const excerpt = getCodeExcerpt(code, error.line);
  if (excerpt) {
    parts.push(`Relevant code excerpt:\n${excerpt}`);
  }

  return parts.join('\n\n').trim();
}

function filterRelevantStdErr(lines: string[]) {
  const filtered = lines.filter((line) => !NOISY_STDERR_PATTERNS.some((pattern) => pattern.test(line)));
  return filtered.length > 0 ? filtered : lines;
}

function simplifyCompileSummary(primaryLine: string, fallback?: string) {
  const normalizedPrimary = primaryLine.replace(/\s+/g, ' ').trim();
  if (normalizedPrimary) return normalizedPrimary;
  return fallback?.replace(/\s+/g, ' ').trim() || 'OpenSCAD failed to compile the model.';
}

function extractLocation(lines: Array<string | undefined>) {
  for (const line of lines) {
    if (!line) continue;

    const fileMatch = line.match(/line\s+(\d+)(?:\s*,\s*column\s+(\d+))?/i);
    if (fileMatch) {
      return {
        line: Number(fileMatch[1]),
        column: fileMatch[2] ? Number(fileMatch[2]) : undefined,
      };
    }

    const fallbackMatch = line.match(/:(\d+)(?::(\d+))?/);
    if (fallbackMatch) {
      return {
        line: Number(fallbackMatch[1]),
        column: fallbackMatch[2] ? Number(fallbackMatch[2]) : undefined,
      };
    }
  }

  return { line: undefined, column: undefined };
}

function getCodeExcerpt(code: string, lineNumber?: number, radius = 2) {
  if (!lineNumber || lineNumber < 1) return '';

  const lines = code.split('\n');
  const start = Math.max(0, lineNumber - radius - 1);
  const end = Math.min(lines.length, lineNumber + radius);

  return lines
    .slice(start, end)
    .map((line, index) => {
      const currentLine = start + index + 1;
      const marker = currentLine === lineNumber ? '>' : ' ';
      return `${marker} ${String(currentLine).padStart(3, ' ')} | ${line}`;
    })
    .join('\n');
}
