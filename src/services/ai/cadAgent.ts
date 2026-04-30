import { hashText } from '../../core/hash';
import type {
  AiProviderId,
  Attachment,
  CadArtifact,
  CadParameter,
  ConversationMessage,
  MessageContent,
  ModelId,
  ToolCallState,
} from '../../core/types';
import { parseCadParameters, patchParameterValue } from '../cad/parameters';
import { CAD_AGENT_PROMPT, STRICT_OPENSCAD_PROMPT } from './prompts';
import type { ChatMessage, ChatRequest, ChatStreamChunk, ChatTool } from './chatCompletions';
import { streamChatCompletions } from './chatCompletions';
import { getAiProvider } from './providers';

const MODELS_REQUIRING_TOOL_PROVIDER_PARAMETERS = new Set<string>(['deepseek/deepseek-v4-pro']);

const CAD_AGENT_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'build_parametric_model',
      description: 'Generate or update an OpenSCAD model from the user request and current model context.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          imageIds: { type: 'array', items: { type: 'string' } },
          baseCode: { type: 'string' },
          error: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_parameter_changes',
      description: 'Apply simple named parameter changes to the active OpenSCAD artifact.',
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['name', 'value'],
            },
          },
        },
        required: ['updates'],
      },
    },
  },
];

type RunCadAgentArgs = {
  providerId: AiProviderId;
  apiKey?: string;
  modelId: ModelId;
  supportsVision: boolean;
  messages: ConversationMessage[];
  onUpdate: (content: MessageContent) => void;
  signal?: AbortSignal;
};

type BuildParametricModelArtifactArgs = {
  providerId: AiProviderId;
  apiKey?: string;
  modelId: ModelId;
  supportsVision: boolean;
  conversation: ConversationMessage[];
  promptText: string;
  baseCode?: string;
  error?: string;
  imageAttachments?: Attachment[];
  signal?: AbortSignal;
  source?: CadArtifact['source'];
};

type AccumulatedToolCall = {
  id: string;
  name: string;
  arguments: string;
  index: number;
};

export async function runCadAgent({
  providerId,
  apiKey,
  modelId,
  supportsVision,
  messages,
  onUpdate,
  signal,
}: RunCadAgentArgs) {
  let content: MessageContent = { modelId };
  const sync = (nextContent?: MessageContent) => {
    if (nextContent) {
      content = nextContent;
    }
    onUpdate(cloneMessageContent(content));
  };

  const provider = getAiProvider(providerId);
  const llmMessages = toChatMessages(messages, supportsVision);
  const plannerRequest: ChatRequest = {
    model: modelId,
    messages: [{ role: 'system', content: CAD_AGENT_PROMPT }, ...llmMessages],
    tools: CAD_AGENT_TOOLS,
    stream: true,
    max_tokens: 12000,
  };

  if (
    providerId === 'openrouter' &&
    (MODELS_REQUIRING_TOOL_PROVIDER_PARAMETERS.has(modelId) || modelId.startsWith('deepseek/'))
  ) {
    plannerRequest.provider = { require_parameters: true };
  }

  const toolCallsByIndex = new Map<number, AccumulatedToolCall>();

  try {
    await streamChatCompletions({
      providerId,
      url: provider.chatCompletionsUrl,
      apiKey,
      request: plannerRequest,
      signal,
      onChunk: async (chunk) => {
        throwIfChunkError(chunk);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          console.log('[AI IN planner text]', delta.content);
          content = {
            ...content,
            text: `${content.text ?? ''}${delta.content}`,
          };
          sync();
        }

        for (const toolDelta of delta.tool_calls ?? []) {
          const index = toolDelta.index ?? toolCallsByIndex.size;
          const current =
            toolCallsByIndex.get(index) ?? {
              id: toolDelta.id ?? `tool-${index}`,
              name: '',
              arguments: '',
              index,
            };

          if (toolDelta.id) current.id = toolDelta.id;
          if (toolDelta.function?.name) current.name += toolDelta.function.name;
          if (toolDelta.function?.arguments) current.arguments += toolDelta.function.arguments;

          toolCallsByIndex.set(index, current);
          console.log('[AI IN tool call]', current);
          content = {
            ...content,
            toolCalls: upsertPendingToolCall(content.toolCalls, {
              id: current.id,
              name: current.name || 'working',
              status: 'pending',
            }),
          };
          sync();
        }
      },
    });

    const orderedToolCalls = Array.from(toolCallsByIndex.values()).sort((a, b) => a.index - b.index);
    for (const toolCall of orderedToolCalls) {
      content = await executeToolCall({
        providerId,
        apiKey,
        modelId,
        supportsVision,
        conversation: messages,
        toolCall,
        content,
        signal,
        sync,
      });
    }
  } catch (error) {
    if (!signal?.aborted) {
      console.error(error);
      if (!content.text && !content.artifact) {
        content = {
          ...content,
          text: 'Something went wrong while generating the model.',
        };
      }
      content = markPendingToolsAsErrored(content);
      sync();
    }
    throw error;
  }

  if (!content.artifact && content.text) {
    const extractedCode = extractOpenScadCode(content.text);
    if (extractedCode) {
      content = {
        ...content,
        text: undefined,
        artifact: createArtifact(makeTitleFromPrompt(getLastUserText(messages)), extractedCode, {
          intentText: getLastUserText(messages),
          source: 'assistant-generated',
        }),
      };
      sync();
    }
  }

  if (!content.artifact && !content.text && !content.toolCalls?.length) {
    content = {
      ...content,
      text: "I couldn't generate that. Try rephrasing the request.",
    };
    sync();
  }
}

export async function buildParametricModelArtifact({
  providerId,
  apiKey,
  modelId,
  supportsVision,
  conversation,
  promptText,
  baseCode,
  error,
  imageAttachments,
  signal,
  source = error ? 'assistant-repaired' : 'assistant-generated',
}: BuildParametricModelArtifactArgs) {
  const provider = getAiProvider(providerId);
  const title = makeTitleFromPrompt(promptText);
  const repairInstruction = error
    ? `${promptText}\n\nFix this OpenSCAD model so it compiles and preserves the intended design.\n\n${error}`
    : promptText;

  const codeMessages: ChatMessage[] = [
    ...toChatMessages(conversation, supportsVision),
    ...(baseCode ? ([{ role: 'assistant', content: baseCode }] satisfies ChatMessage[]) : []),
    {
      role: 'user',
      content: buildPromptBlocks(repairInstruction, supportsVision, imageAttachments),
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
  console.log('[AI IN model code raw]', rawCode);
  console.log('[AI IN model code final]', finalCode);

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

async function executeToolCall(args: {
  providerId: AiProviderId;
  apiKey?: string;
  modelId: ModelId;
  supportsVision: boolean;
  conversation: ConversationMessage[];
  toolCall: AccumulatedToolCall;
  content: MessageContent;
  signal?: AbortSignal;
  sync: (nextContent?: MessageContent) => void;
}) {
  const { toolCall } = args;

  if (toolCall.name === 'build_parametric_model') {
    return executeBuildModelTool(args);
  }

  if (toolCall.name === 'apply_parameter_changes') {
    return executeParameterPatchTool(args);
  }

  const failedContent = markToolCallAsErrored(args.content, toolCall.id);
  args.sync(failedContent);
  return failedContent;
}

async function executeBuildModelTool(args: {
  providerId: AiProviderId;
  apiKey?: string;
  modelId: ModelId;
  supportsVision: boolean;
  conversation: ConversationMessage[];
  toolCall: AccumulatedToolCall;
  content: MessageContent;
  signal?: AbortSignal;
  sync: (nextContent?: MessageContent) => void;
}) {
  const parsedInput = safeJsonParse<{
    text?: string;
    imageIds?: string[];
    baseCode?: string;
    error?: string;
  }>(args.toolCall.arguments);

  console.log('[AI TOOL build_parametric_model in]', {
    toolCall: args.toolCall,
    parsedInput,
  });

  if (!parsedInput) {
    const failedContent = markToolCallAsErrored(args.content, args.toolCall.id);
    args.sync(failedContent);
    return failedContent;
  }

  try {
    const latestArtifact = getLatestArtifact(args.conversation, args.content);
    const artifact = await buildParametricModelArtifact({
      providerId: args.providerId,
      apiKey: args.apiKey,
      modelId: args.modelId,
      supportsVision: args.supportsVision,
      conversation: args.conversation,
      promptText: parsedInput.text || getLastUserText(args.conversation),
      baseCode: parsedInput.baseCode ?? latestArtifact?.code,
      error: parsedInput.error,
      signal: args.signal,
      source: parsedInput.error ? 'assistant-repaired' : 'assistant-generated',
    });

    const nextContent = {
      ...args.content,
      toolCalls: removeToolCall(args.content.toolCalls, args.toolCall.id),
      artifact,
      text: args.content.text,
    } satisfies MessageContent;

    args.sync(nextContent);
    return nextContent;
  } catch (error) {
    const nextContent = {
      ...markToolCallAsErrored(args.content, args.toolCall.id),
      text:
        error instanceof Error
          ? `The model response looked invalid: ${error.message}`
          : 'The model response looked invalid. Please try again.',
    } satisfies MessageContent;
    args.sync(nextContent);
    return nextContent;
  }
}

async function executeParameterPatchTool(args: {
  conversation: ConversationMessage[];
  toolCall: AccumulatedToolCall;
  content: MessageContent;
  sync: (nextContent?: MessageContent) => void;
}) {
  const parsedInput = safeJsonParse<{ updates?: Array<{ name: string; value: string }> }>(
    args.toolCall.arguments,
  );

  console.log('[AI TOOL apply_parameter_changes in]', {
    toolCall: args.toolCall,
    parsedInput,
  });

  const baseArtifact = getLatestArtifact(args.conversation, args.content);
  if (!baseArtifact?.code || !parsedInput?.updates?.length) {
    const failedContent = markToolCallAsErrored(args.content, args.toolCall.id);
    args.sync(failedContent);
    return failedContent;
  }

  let code = baseArtifact.code;
  const parameters = parseCadParameters(code);

  for (const update of parsedInput.updates) {
    const target = parameters.find((parameter) => parameter.name === update.name);
    if (!target) continue;

    code = patchParameterValue(
      code,
      target.name,
      coercePatchedValue(update.value, target),
      target.type,
    );
  }

  const nextContent: MessageContent = {
    ...args.content,
    toolCalls: removeToolCall(args.content.toolCalls, args.toolCall.id),
    artifact: createArtifact(baseArtifact.title, code, {
      id: baseArtifact.id,
      version: baseArtifact.version,
      intentText: baseArtifact.intentText,
      source: 'assistant-generated',
    }),
  };

  args.sync(nextContent);
  return nextContent;
}

function toChatMessages(messages: ConversationMessage[], supportsVision: boolean): ChatMessage[] {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content.artifact?.code || message.content.text || '',
      };
    }

    const contentBlocks: ChatMessage['content'] = [];
    if (message.content.text) {
      contentBlocks.push({ type: 'text', text: message.content.text });
    }

    for (const attachment of message.content.attachments ?? []) {
      if (supportsVision) {
        contentBlocks.push({
          type: 'image_url',
          image_url: { url: attachment.dataUrl, detail: 'auto' },
        });
      } else {
        contentBlocks.push({
          type: 'text',
          text: `[image omitted for text-only model: ${attachment.name}]`,
        });
      }
    }

    return {
      role: 'user',
      content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
    };
  });
}

function getLatestArtifact(messages: ConversationMessage[], content: MessageContent) {
  if (content.artifact) return content.artifact;

  return [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.artifact)?.content.artifact;
}

function getLastUserText(messages: ConversationMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content.text || '3D model';
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
      bestCode = candidate;
      bestScore = score;
    }
  }

  if (bestCode && bestScore >= 3) return bestCode;
  return scoreOpenScad(text) >= 5 ? text.trim() : null;
}

function scoreOpenScad(code: string) {
  if (!code || code.length < 20) return 0;

  const patterns = [
    /\b(cube|sphere|cylinder|polyhedron)\s*\(/gi,
    /\b(union|difference|intersection)\s*\(\s*\)/gi,
    /\b(translate|rotate|scale|mirror)\s*\(/gi,
    /\b(linear_extrude|rotate_extrude)\s*\(/gi,
    /\b(module|function)\s+\w+\s*\(/gi,
    /\$fn\s*=/gi,
    /;\s*$/gm,
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
    if (current === ')') parenDepth -= 1;
    if (current === '[') bracketDepth += 1;
    if (current === ']') bracketDepth -= 1;
    if (current === '{') braceDepth += 1;
    if (current === '}') braceDepth -= 1;

    if (parenDepth < 0 || bracketDepth < 0 || braceDepth < 0) {
      return false;
    }
  }

  if (inString || inLineComment || inBlockComment) return false;
  if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) return false;

  const trimmed = code.trim();
  return /[;)}\]]$/.test(trimmed);
}

function buildPromptBlocks(
  promptText: string,
  supportsVision: boolean,
  imageAttachments?: Attachment[],
): ChatMessage['content'] {
  const blocks: ChatMessage['content'] = [{ type: 'text', text: promptText }];

  if (supportsVision) {
    for (const attachment of imageAttachments ?? []) {
      blocks.push({
        type: 'image_url',
        image_url: { url: attachment.dataUrl, detail: 'auto' },
      });
    }
  }

  return blocks;
}

function throwIfChunkError(chunk: ChatStreamChunk) {
  if (chunk.error) {
    throw new Error(chunk.error.message || 'Chat provider error');
  }
}

function upsertPendingToolCall(current: ToolCallState[] | undefined, next: ToolCallState) {
  const existing = current ?? [];
  const index = existing.findIndex((call) => call.id === next.id);
  if (index === -1) return [...existing, next];

  return existing.map((call, currentIndex) => (currentIndex === index ? next : call));
}

function markToolCallAsErrored(content: MessageContent, toolId: string): MessageContent {
  return {
    ...content,
    toolCalls: (content.toolCalls ?? []).map((toolCall) =>
      toolCall.id === toolId ? { ...toolCall, status: 'error' } : toolCall,
    ),
  };
}

function markPendingToolsAsErrored(content: MessageContent): MessageContent {
  return {
    ...content,
    toolCalls: (content.toolCalls ?? []).map((toolCall) =>
      toolCall.status === 'pending' ? { ...toolCall, status: 'error' } : toolCall,
    ),
  };
}

function removeToolCall(toolCalls: ToolCallState[] | undefined, toolId: string) {
  return (toolCalls ?? []).filter((toolCall) => toolCall.id !== toolId);
}

function coercePatchedValue(rawValue: string, parameter: CadParameter) {
  switch (parameter.type) {
    case 'number':
      return Number(rawValue);
    case 'boolean':
      return rawValue === 'true';
    default:
      return rawValue;
  }
}

function cloneMessageContent(content: MessageContent): MessageContent {
  return {
    ...content,
    attachments: content.attachments ? content.attachments.map(cloneAttachment) : undefined,
    toolCalls: content.toolCalls ? content.toolCalls.map((toolCall) => ({ ...toolCall })) : undefined,
    artifact: content.artifact
      ? {
          ...content.artifact,
          parameters: content.artifact.parameters.map((parameter) => ({ ...parameter })),
        }
      : undefined,
  };
}

function cloneAttachment(attachment: Attachment): Attachment {
  return { ...attachment };
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
