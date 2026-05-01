import { getAppOrigin, getEnvValue } from '../../core/env.ts';
import { hashText } from '../../core/hash.ts';
import type { AiProviderId, Attachment, CadArtifact, ConversationMessage, ModelId } from '../../core/types.ts';
import { parseCadParameters } from '../../services/cad/parameters.ts';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: 'auto' } }
      >;
};

type ChatStreamChunk = {
  error?: { message?: string };
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
};

const STRICT_OPENSCAD_PROMPT = `You generate high-quality OpenSCAD code.
Return ONLY raw OpenSCAD code with no markdown fences, prose, or explanations.
The first line must be valid OpenSCAD code or a comment.
Use explicit numeric dimensions whenever practical.
Prefer simple, printable, manifold geometry.
Do not include imports, external dependencies, or libraries unless the user explicitly asks for them.
Use valid OpenSCAD loop syntax only.
Do not output placeholders like TODO.
If repairing code, preserve the original design intent while fixing syntax or structural issues.
If the request is unrelated to OpenSCAD or 3D CAD, return exactly 404.`;

type BuildHeadlessArtifactArgs = {
  providerId: AiProviderId;
  apiKey?: string;
  modelId: ModelId;
  supportsVision: boolean;
  conversation: ConversationMessage[];
  promptText: string;
  baseCode?: string;
  error?: string;
  imageAttachments?: Attachment[];
  docsContext?: string;
  signal?: AbortSignal;
  source?: CadArtifact['source'];
};

export async function buildHeadlessParametricModelArtifact({
  providerId,
  apiKey,
  modelId,
  supportsVision,
  conversation,
  promptText,
  baseCode,
  error,
  imageAttachments,
  docsContext,
  signal,
  source = error ? 'assistant-repaired' : 'assistant-generated',
}: BuildHeadlessArtifactArgs) {
  const provider = getHeadlessProvider(providerId);
  const title = makeTitleFromPrompt(promptText);
  const repairInstruction = error
    ? `${promptText}\n\nFix this OpenSCAD model so it compiles and preserves the intended design.\n\n${error}`
    : promptText;
  const promptWithDocs = docsContext
    ? `${repairInstruction}\n\nRelevant OpenSCAD reference excerpts:\n${docsContext}\n\nFollow the reference excerpts exactly when they apply.`
    : repairInstruction;

  const codeMessages: ChatMessage[] = [
    ...toChatMessages(conversation, supportsVision),
    ...(baseCode ? ([{ role: 'assistant', content: baseCode }] satisfies ChatMessage[]) : []),
    {
      role: 'user',
      content: buildPromptBlocks(promptWithDocs, supportsVision, imageAttachments),
    },
  ];

  let rawCode = '';

  await streamChatCompletions({
    providerId,
    url: provider.chatCompletionsUrl,
    apiKey,
    signal,
    request: {
      model: modelId,
      messages: [{ role: 'system', content: STRICT_OPENSCAD_PROMPT }, ...codeMessages],
      stream: true,
      max_tokens: 24000,
    },
    onChunk: (chunk) => {
      throwIfChunkError(chunk);
      const deltaText = chunk.choices?.[0]?.delta?.content;
      if (typeof deltaText !== 'string' || !deltaText) return;
      rawCode += deltaText;
    },
  });

  const finalCode = normalizeGeneratedOpenScad(rawCode);
  if (!finalCode || finalCode === '404') {
    throw new Error('The model response did not include valid OpenSCAD code.');
  }

  const validation = validateGeneratedOpenScad(finalCode);
  if (!validation.ok) {
    throw new Error(validation.issues[0] || 'The generated OpenSCAD failed validation.');
  }

  return createArtifact(title, finalCode, {
    intentText: promptText,
    source,
  });
}

function toChatMessages(messages: ConversationMessage[], supportsVision: boolean): ChatMessage[] {
  return messages.map((message) => {
    if (message.content.attachments?.length) {
      return {
        role: message.role,
        content: buildPromptBlocks(message.content.text || '', supportsVision, message.content.attachments),
      } satisfies ChatMessage;
    }

    return {
      role: message.role,
      content: message.content.text || '',
    } satisfies ChatMessage;
  });
}

function buildPromptBlocks(text: string, supportsVision: boolean, attachments?: Attachment[]) {
  const contentBlocks: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' } }> = [];

  if (text) {
    contentBlocks.push({ type: 'text', text });
  }

  for (const attachment of attachments ?? []) {
    if (attachment.mediaType.startsWith('image/') && supportsVision) {
      contentBlocks.push({
        type: 'image_url',
        image_url: { url: attachment.dataUrl, detail: 'auto' },
      });
    }
  }

  return contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }];
}

function getHeadlessProvider(providerId: AiProviderId) {
  const openrouterBaseUrl = getEnvValue('VITE_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1/');
  const llamaCppBaseUrl = getEnvValue('VITE_LLAMACPP_BASE_URL', 'http://192.168.4.220:8080/');

  if (providerId === 'llama-cpp') {
    return {
      id: 'llama-cpp' as const,
      chatCompletionsUrl: joinUrl(llamaCppBaseUrl, 'v1/chat/completions'),
    };
  }

  return {
    id: 'openrouter' as const,
    chatCompletionsUrl: joinUrl(openrouterBaseUrl, 'chat/completions'),
  };
}

async function streamChatCompletions(args: {
  providerId: AiProviderId;
  url: string;
  apiKey?: string;
  request: {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
    max_tokens?: number;
  };
  signal?: AbortSignal;
  onChunk: (chunk: ChatStreamChunk) => Promise<void> | void;
}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (args.apiKey) {
    headers.Authorization = `Bearer ${args.apiKey}`;
  }

  if (args.providerId === 'openrouter') {
    headers['HTTP-Referer'] = getAppOrigin();
    headers['X-Title'] = 'Browser CAD AI';
  }

  const response = await fetch(args.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(args.request),
    signal: args.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Chat request failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Missing response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          await args.onChunk(JSON.parse(payload) as ChatStreamChunk);
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function createArtifact(
  title: string,
  code: string,
  options: {
    id?: string;
    version?: string;
    intentText?: string;
    source?: CadArtifact['source'];
    parameters?: CadArtifact['parameters'];
  } = {},
): CadArtifact {
  return {
    id: options.id ?? crypto.randomUUID(),
    title,
    version: options.version ?? 'v1',
    code,
    codeHash: hashText(code),
    parameters: options.parameters ?? parseCadParameters(code),
    source: options.source ?? 'assistant-generated',
    intentText: options.intentText,
    updatedAt: Date.now(),
  };
}

function makeTitleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ');

  return cleaned
    ? cleaned.replace(/\b\w/g, (character) => character.toUpperCase())
    : 'Model';
}

function throwIfChunkError(chunk: ChatStreamChunk) {
  const errorMessage = chunk.error?.message;
  if (errorMessage) {
    throw new Error(errorMessage);
  }
}

function extractOpenScadCode(text: string) {
  if (!text) return null;

  const codeBlockPattern = /```(?:openscad)?\s*\n?([\s\S]*?)\n?```/gi;
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
  const patterns = [
    /\bcube\b/gi,
    /\bcylinder\b/gi,
    /\bsphere\b/gi,
    /\bdifference\b/gi,
    /\bunion\b/gi,
    /\bmodule\b/gi,
    /;/g,
  ];

  return patterns.reduce((score, pattern) => score + (code.match(pattern)?.length ?? 0), 0);
}

function stripCodeFences(value: string) {
  return value.replace(/^```(?:openscad)?\s*\n?/, '').replace(/\n?```\s*$/, '');
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
  return /^(include|use|module|function|color|translate|rotate|scale|mirror|linear_extrude|rotate_extrude|difference|union|intersection|cube|cylinder|sphere|polygon|polyhedron|circle|square|text|import|surface|projection|render|offset|hull|minkowski|multmatrix|resize|assign|echo|if|for|let|[a-z_$][a-z0-9_$]*)\b/i.test(
    trimmed,
  );
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
