import { getAppOrigin } from '../../core/env';
import type { AiProviderId } from '../../core/types';

export type ChatMessage = {
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

export type ChatTool = {
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

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  stream?: boolean;
  max_tokens?: number;
  provider?: { require_parameters?: boolean };
};

export type ChatStreamChunk = {
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

export async function streamChatCompletions(args: {
  providerId: AiProviderId;
  url: string;
  apiKey?: string;
  request: ChatRequest;
  signal?: AbortSignal;
  onChunk: (chunk: ChatStreamChunk) => Promise<void> | void;
}) {
  const requestLabel = `[AI ${args.request.model}]`;
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

  console.log(`${requestLabel} out`, {
    provider: args.providerId,
    url: args.url,
    model: args.request.model,
    messages: args.request.messages,
    tools: args.request.tools,
  });

  const response = await fetch(args.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(args.request),
    signal: args.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    console.log(`${requestLabel} error response`, {
      status: response.status,
      statusText: response.statusText,
      body: text,
    });
    throw new Error(text || `Chat request failed: ${response.status}`);
  }

  console.log(`${requestLabel} response started`, {
    status: response.status,
    statusText: response.statusText,
  });

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

        let chunk: ChatStreamChunk;
        try {
          chunk = JSON.parse(payload) as ChatStreamChunk;
        } catch {
          console.log(`${requestLabel} could not parse SSE payload`, payload);
          continue;
        }

        await args.onChunk(chunk);
      }
    }
  } finally {
    console.log(`${requestLabel} stream finished`);
    reader.releaseLock();
  }
}
