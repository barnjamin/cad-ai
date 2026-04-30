const OPENROUTER_API_URL =
  import.meta.env.VITE_OPENROUTER_API_URL ??
  'https://openrouter.ai/api/v1/chat/completions';

export type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: 'auto' } }
      >;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

export type OpenRouterTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type OpenRouterRequest = {
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterTool[];
  stream?: boolean;
  max_tokens?: number;
  provider?: { require_parameters?: boolean };
};

export type OpenRouterStreamChunk = {
  error?: { message?: string };
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
};

export async function streamOpenRouterChat(args: {
  apiKey: string;
  request: OpenRouterRequest;
  signal?: AbortSignal;
  onChunk: (chunk: OpenRouterStreamChunk) => Promise<void> | void;
}) {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Browser CAD AI',
    },
    body: JSON.stringify(args.request),
    signal: args.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `OpenRouter request failed: ${response.status}`);
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

        let chunk: OpenRouterStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenRouterStreamChunk;
        } catch {
          continue;
        }

        await args.onChunk(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
