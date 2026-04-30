import parseParameters from './parseParameters';
import { escapeRegExp } from './parameterUtils';
import type {
  Attachment,
  Message,
  MessageContent,
  Model,
  ParametricArtifact,
  ToolCall,
} from '../types';

const OPENROUTER_API_URL =
  import.meta.env.VITE_OPENROUTER_API_URL ||
  'https://openrouter.ai/api/v1/chat/completions';

const REQUIRES_TOOL_CAPABLE_PROVIDER = new Set<string>([
  'deepseek/deepseek-v4-pro',
]);
const TEXT_ONLY_MODELS = new Set<string>(['deepseek/deepseek-v4-pro']);

const PARAMETRIC_AGENT_PROMPT = `You are Adam, an AI CAD editor that creates and modifies OpenSCAD models.
Speak briefly, then use tools to make changes.
Prefer using tools instead of directly returning code.
Do not mention tools or system internals.

Guidelines:
- For a new model or a structural change, call build_parametric_model.
- For simple named parameter tweaks like “height to 80”, call apply_parameter_changes.
- Keep your response concise.
- Pass the user's request through faithfully.`;

const STRICT_CODE_PROMPT = `You generate only high quality OpenSCAD code.
Return ONLY raw OpenSCAD code. Do not use markdown fences.
Always expose editable parameters near the top of the file.
Use descriptive snake_case variable names.
When helpful, wrap distinct parts in color() and expose those colors as string parameters.
Produce connected, printable solids.
If the prompt is unrelated to OpenSCAD, return 404.`;

const tools = [
  {
    type: 'function',
    function: {
      name: 'build_parametric_model',
      description: 'Generate or update an OpenSCAD model from user intent and context.',
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
      description: 'Apply simple parameter changes to the current artifact.',
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

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' } }>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

type OpenRouterRequest = {
  model: string;
  messages: OpenAIMessage[];
  tools?: unknown[];
  stream?: boolean;
  max_tokens?: number;
  provider?: { require_parameters?: boolean };
};

type AgentArgs = {
  apiKey: string;
  model: Model;
  messages: Message[];
  onUpdate: (content: MessageContent) => void;
  signal?: AbortSignal;
};

export async function runAgent({
  apiKey,
  model,
  messages,
  onUpdate,
  signal,
}: AgentArgs) {
  let content: MessageContent = { model };
  const sync = () => onUpdate(cloneContent(content));

  const llmMessages = toOpenAIMessages(messages, model);
  const agentRequest: OpenRouterRequest = {
    model,
    messages: [{ role: 'system', content: PARAMETRIC_AGENT_PROMPT }, ...llmMessages],
    tools,
    stream: true,
    max_tokens: 12000,
  };

  if (REQUIRES_TOOL_CAPABLE_PROVIDER.has(model)) {
    agentRequest.provider = { require_parameters: true };
  }

  let currentToolCall: { id: string; name: string; arguments: string } | null = null;

  try {
    await streamOpenRouter({
      apiKey,
      body: agentRequest,
      signal,
      onChunk: async (chunk) => {
        if (chunk.error) {
          throw new Error(chunk.error.message || 'OpenRouter error');
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content = {
            ...content,
            text: (content.text || '') + delta.content,
          };
          sync();
        }

        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            if (toolCall.id) {
              currentToolCall = {
                id: toolCall.id,
                name: toolCall.function?.name || '',
                arguments: '',
              };
              content = {
                ...content,
                toolCalls: [
                  ...(content.toolCalls || []),
                  { id: toolCall.id, name: currentToolCall.name, status: 'pending' },
                ],
              };
              sync();
            }

            if (toolCall.function?.arguments && currentToolCall) {
              currentToolCall.arguments += toolCall.function.arguments;
            }
          }
        }

        if (chunk.choices?.[0]?.finish_reason === 'tool_calls' && currentToolCall) {
          await handleToolCall(currentToolCall);
          currentToolCall = null;
        }
      },
    });

    if (currentToolCall) {
      await handleToolCall(currentToolCall);
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
      content = markPendingToolsAsError(content);
      sync();
    }
    throw error;
  }

  if (!content.artifact && content.text) {
    const extractedCode = extractOpenSCADCodeFromText(content.text);
    if (extractedCode) {
      content = {
        ...content,
        text: undefined,
        artifact: {
          title: makeTitleFromText(lastUserText(messages)),
          version: 'v1',
          code: extractedCode,
          parameters: parseParameters(extractedCode),
        },
      };
      sync();
    }
  }

  if (!content.artifact && !content.text && !(content.toolCalls?.length)) {
    content = {
      ...content,
      text: "I couldn't generate that. Try rephrasing the request.",
    };
    sync();
  }

  async function handleToolCall(toolCall: {
    id: string;
    name: string;
    arguments: string;
  }) {
    if (toolCall.name === 'build_parametric_model') {
      let resolved = false;
      try {
        const input = safeParseJson<{
          text?: string;
          imageIds?: string[];
          baseCode?: string;
          error?: string;
        }>(toolCall.arguments);
        if (!input) {
          content = markToolAsError(content, toolCall.id);
          sync();
          resolved = true;
          return;
        }

        const rawTitle = input.text || lastUserText(messages);
        const title = makeTitleFromText(rawTitle);
        let rawCode = '';

        const baseContext: OpenAIMessage[] = input.baseCode
          ? [{ role: 'assistant', content: input.baseCode }]
          : [];

        const supplementalUserPrompt = input.error
          ? `${input.text || lastUserText(messages)}\n\nFix this OpenSCAD issue: ${input.error}`
          : input.text && input.text !== lastUserText(messages)
            ? input.text
            : null;

        const codeMessages: OpenAIMessage[] = [
          ...llmMessages,
          ...baseContext,
          ...(supplementalUserPrompt
            ? ([{ role: 'user', content: supplementalUserPrompt }] satisfies OpenAIMessage[])
            : []),
        ];

        await streamOpenRouter({
          apiKey,
          signal,
          body: {
            model,
            messages: [{ role: 'system', content: STRICT_CODE_PROMPT }, ...codeMessages],
            stream: true,
            max_tokens: 24000,
          },
          onChunk: async (chunk) => {
            if (chunk.error) {
              throw new Error(chunk.error.message || 'OpenRouter error');
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              rawCode += delta;
              content = {
                ...content,
                artifact: {
                  title,
                  version: 'v1',
                  code: stripCodeFences(rawCode),
                  parameters: content.artifact?.parameters || [],
                },
              };
              sync();
            }
          },
        });

        const finalCode = stripCodeFences(rawCode).trim();
        if (!finalCode) {
          content = markToolAsError(content, toolCall.id);
          sync();
          resolved = true;
          return;
        }

        const artifact: ParametricArtifact = {
          title,
          version: 'v1',
          code: finalCode,
          parameters: parseParameters(finalCode),
        };

        content = {
          ...content,
          toolCalls: (content.toolCalls || []).filter((call) => call.id !== toolCall.id),
          artifact,
        };
        sync();
        resolved = true;
      } finally {
        if (!resolved) {
          content = markToolAsError(content, toolCall.id);
          sync();
        }
      }
      return;
    }

    if (toolCall.name === 'apply_parameter_changes') {
      const input = safeParseJson<{ updates?: Array<{ name: string; value: string }> }>(toolCall.arguments);
      const baseCode =
        content.artifact?.code ||
        [...messages]
          .reverse()
          .find((message) => message.role === 'assistant' && message.content.artifact?.code)?.content.artifact?.code;

      if (!baseCode || !input?.updates?.length) {
        content = markToolAsError(content, toolCall.id);
        sync();
        return;
      }

      let patchedCode = baseCode;
      const currentParams = parseParameters(baseCode);
      for (const update of input.updates) {
        const target = currentParams.find((param) => param.name === update.name);
        if (!target) continue;
        patchedCode = patchParameter(patchedCode, target.name, update.value, target.type || 'number');
      }

      content = {
        ...content,
        toolCalls: (content.toolCalls || []).filter((call) => call.id !== toolCall.id),
        artifact: {
          title: content.artifact?.title || makeTitleFromText(lastUserText(messages)),
          version: 'v1',
          code: patchedCode,
          parameters: parseParameters(patchedCode),
        },
      };
      sync();
    }
  }
}

function toOpenAIMessages(messages: Message[], model: Model): OpenAIMessage[] {
  const supportsVision = !TEXT_ONLY_MODELS.has(model);

  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content.artifact?.code || message.content.text || '',
      };
    }

    const blocks: OpenAIMessage['content'] = [];
    if (message.content.text) {
      blocks.push({ type: 'text', text: message.content.text });
    }

    for (const attachment of message.content.attachments || []) {
      if (supportsVision) {
        blocks.push({
          type: 'image_url',
          image_url: { url: attachment.dataUrl, detail: 'auto' },
        });
      } else {
        blocks.push({
          type: 'text',
          text: `[image omitted: ${attachment.name}]`,
        });
      }
    }

    return {
      role: 'user',
      content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
    };
  });
}

async function streamOpenRouter({
  apiKey,
  body,
  onChunk,
  signal,
}: {
  apiKey: string;
  body: OpenRouterRequest;
  onChunk: (chunk: StreamChunk) => Promise<void> | void;
  signal?: AbortSignal;
}) {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Minimal CADAM',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `OpenRouter request failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (!data || data === '[DONE]') continue;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        await onChunk(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type StreamChunk = {
  error?: { message?: string };
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
};

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function markToolAsError(content: MessageContent, toolId: string): MessageContent {
  return {
    ...content,
    toolCalls: (content.toolCalls || []).map((call: ToolCall) =>
      call.id === toolId ? { ...call, status: 'error' } : call,
    ),
  };
}

function markPendingToolsAsError(content: MessageContent): MessageContent {
  return {
    ...content,
    toolCalls: (content.toolCalls || []).map((call) =>
      call.status === 'pending' ? { ...call, status: 'error' } : call,
    ),
  };
}

function stripCodeFences(value: string) {
  return value
    .replace(/^```(?:openscad)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
}

function extractOpenSCADCodeFromText(text: string): string | null {
  if (!text) return null;
  const codeBlockRegex = /```(?:openscad)?\s*\n?([\s\S]*?)\n?```/g;
  let match: RegExpExecArray | null;
  let bestCode: string | null = null;
  let bestScore = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const code = match[1].trim();
    const score = scoreOpenSCADCode(code);
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
    }
  }

  if (bestCode && bestScore >= 3) return bestCode;
  const rawScore = scoreOpenSCADCode(text);
  if (rawScore >= 5) return text.trim();
  return null;
}

function scoreOpenSCADCode(code: string): number {
  if (!code || code.length < 20) return 0;
  let score = 0;
  const patterns = [
    /\b(cube|sphere|cylinder|polyhedron)\s*\(/gi,
    /\b(union|difference|intersection)\s*\(\s*\)/gi,
    /\b(translate|rotate|scale|mirror)\s*\(/gi,
    /\b(linear_extrude|rotate_extrude)\s*\(/gi,
    /\b(module|function)\s+\w+\s*\(/gi,
    /\$fn\s*=/gi,
    /;\s*$/gm,
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) score += matches.length;
  }
  return score;
}

function makeTitleFromText(text: string) {
  const cleaned = text
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ');
  return cleaned ? capitalizeWords(cleaned) : 'Model';
}

function capitalizeWords(text: string) {
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function lastUserText(messages: Message[]) {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  return lastUser?.content.text || '3D model';
}

function patchParameter(
  code: string,
  name: string,
  rawValue: string,
  type: string,
) {
  let coerced: string | number | boolean = rawValue;
  if (type === 'number') coerced = Number(rawValue);
  if (type === 'boolean') coerced = String(rawValue) === 'true';

  return code.replace(
    new RegExp(
      `^\\s*(${escapeRegExp(name)}\\s*=\\s*)[^;]+;([\\t\\f\\cK ]*\\/\\/[^\\n]*)?`,
      'm',
    ),
    (_match, prefix: string, comment: string) => {
      if (type === 'string') {
        return `${prefix}"${String(rawValue).replace(/"/g, '\\"')}";${comment || ''}`;
      }
      return `${prefix}${coerced};${comment || ''}`;
    },
  );
}

function cloneContent(content: MessageContent): MessageContent {
  return {
    ...content,
    attachments: content.attachments ? [...content.attachments] : undefined,
    toolCalls: content.toolCalls ? content.toolCalls.map((call) => ({ ...call })) : undefined,
    artifact: content.artifact
      ? {
          ...content.artifact,
          parameters: content.artifact.parameters.map((parameter) => ({ ...parameter })),
        }
      : undefined,
  };
}

export async function fileListToAttachments(fileList: FileList | File[]): Promise<Attachment[]> {
  const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
  const attachments = await Promise.all(
    files.map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      mediaType: file.type,
      dataUrl: await readFileAsDataUrl(file),
    })),
  );
  return attachments;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
