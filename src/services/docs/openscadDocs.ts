import openScadReferenceMarkdown from '../../../openscad.md?raw';

type DocSection = {
  title: string;
  body: string;
  searchText: string;
};

type OpenScadDocsLookup = {
  context: string;
  responseText: string;
};

const MAX_CONTEXT_CHARS = 2400;
const sections = parseMarkdownSections(openScadReferenceMarkdown);

export function lookupOpenScadDocs(query: string, maxResults = 3): OpenScadDocsLookup {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      context: '',
      responseText: 'OpenSCAD docs lookup failed: no query was provided.',
    };
  }

  const normalizedMaxResults = clamp(Math.round(maxResults) || 3, 1, 5);
  const tokens = tokenize(trimmedQuery);
  const rankedSections = sections
    .map((section) => ({
      section,
      score: scoreSection(section, trimmedQuery, tokens),
      snippet: extractSnippet(section.body, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, normalizedMaxResults);

  if (rankedSections.length === 0) {
    const responseText = `OpenSCAD docs lookup for "${trimmedQuery}" found no strong matches in the bundled reference.`;
    return {
      context: responseText,
      responseText,
    };
  }

  const formattedEntries = rankedSections.map(({ section, snippet }, index) => {
    const safeSnippet = snippet || section.body.split('\n').map((line) => line.trim()).find(Boolean) || 'No preview snippet available.';
    return `${index + 1}. ${section.title}\n${safeSnippet}`;
  });

  const joinedContext = [`OpenSCAD docs lookup for "${trimmedQuery}":`, ...formattedEntries].join('\n\n');
  const context = joinedContext.length > MAX_CONTEXT_CHARS
    ? `${joinedContext.slice(0, MAX_CONTEXT_CHARS).trimEnd()}…`
    : joinedContext;

  return {
    context,
    responseText: context,
  };
}

function parseMarkdownSections(markdown: string): DocSection[] {
  const lines = markdown.split(/\r?\n/);
  const parsedSections: DocSection[] = [];
  let currentTitle = 'Introduction';
  let currentBody: string[] = [];

  const pushCurrentSection = () => {
    const body = currentBody.join('\n').trim();
    if (!body) return;

    parsedSections.push({
      title: currentTitle,
      body,
      searchText: `${currentTitle}\n${body}`.toLowerCase(),
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      pushCurrentSection();
      currentTitle = headingMatch[1].trim();
      currentBody = [];
      continue;
    }

    currentBody.push(line);
  }

  pushCurrentSection();
  return parsedSections;
}

function scoreSection(section: DocSection, query: string, tokens: string[]) {
  const title = section.title.toLowerCase();
  const text = section.searchText;
  const normalizedQuery = query.toLowerCase();
  let score = 0;

  if (title.includes(normalizedQuery)) score += 25;
  if (text.includes(normalizedQuery)) score += 12;

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (title.includes(token)) score += 8;
    if (text.includes(token)) score += 3;
  }

  return score;
}

function extractSnippet(body: string, tokens: string[]) {
  const cleanedLines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);

  const matchingLine = cleanedLines.find((line) =>
    tokens.some((token) => token.length >= 2 && line.toLowerCase().includes(token)),
  );

  const snippetSource = matchingLine ?? cleanedLines[0] ?? '';
  if (!snippetSource) return '';

  return snippetSource.length > 280 ? `${snippetSource.slice(0, 280).trimEnd()}…` : snippetSource;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
