import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DEFAULT_MODEL_ID, EXAMPLE_PROMPTS } from '../core/models';
import { STORAGE_KEYS } from '../core/storage';
import type {
  AiProviderId,
  Attachment,
  CadArtifact,
  CadParameter,
  ConversationMessage,
  MessageContent,
  ModelId,
  ParameterValue,
} from '../core/types';
import { usePersistentState } from '../hooks/usePersistentState';
import { runCadAgent } from '../services/ai/cadAgent';
import { filesToAttachments } from '../services/ai/attachments';
import { fetchProviderModels, getInitialModelsForProvider } from '../services/ai/modelCatalog';
import { AI_PROVIDERS, DEFAULT_PROVIDER_ID, getAiProvider } from '../services/ai/providers';
import {
  applyParameterValue,
  parseCadParameters,
  validateParameterValue,
} from '../services/cad/parameters';

type AppState = {
  messages: ConversationMessage[];
  draft: string;
  pendingAttachments: Attachment[];
  isGenerating: boolean;
  selectedMessageId: string | null;
};

type AppAction =
  | { type: 'setDraft'; value: string }
  | { type: 'setPendingAttachments'; attachments: Attachment[] }
  | { type: 'removePendingAttachment'; attachmentId: string }
  | {
      type: 'appendExchange';
      userMessage: ConversationMessage;
      assistantMessage: ConversationMessage;
    }
  | { type: 'updateMessageContent'; messageId: string; content: MessageContent }
  | { type: 'selectMessage'; messageId: string | null }
  | { type: 'setGenerating'; value: boolean }
  | { type: 'replaceArtifact'; messageId: string; artifact: CadArtifact }
  | { type: 'clearConversation' };

const initialState: AppState = {
  messages: [],
  draft: '',
  pendingAttachments: [],
  isGenerating: false,
  selectedMessageId: null,
};

export function useCadApp() {
  const [apiKey, setApiKey] = usePersistentState(
    STORAGE_KEYS.apiKey,
    import.meta.env.VITE_OPENROUTER_API_KEY || '',
  );
  const [providerId, setProviderId] = usePersistentState<AiProviderId>(
    STORAGE_KEYS.providerId,
    DEFAULT_PROVIDER_ID,
  );
  const [modelId, setModelId] = usePersistentState<ModelId>(STORAGE_KEYS.modelId, DEFAULT_MODEL_ID);
  const [supportedModels, setSupportedModels] = useState(() => getInitialModelsForProvider(providerId));
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    setSupportedModels(getInitialModelsForProvider(providerId));

    void fetchProviderModels(providerId, abortController.signal)
      .then((models) => {
        setSupportedModels(models);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error(`Failed to load ${getAiProvider(providerId).name} model list.`, error);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [providerId]);

  useEffect(() => {
    if (supportedModels.length === 0) return;
    if (!supportedModels.some((model) => model.id === modelId)) {
      setModelId(supportedModels[0].id);
    }
  }, [modelId, setModelId, supportedModels]);

  const selectedMessage = useMemo(() => {
    const explicitlySelected = state.selectedMessageId
      ? state.messages.find((message) => message.id === state.selectedMessageId)
      : null;

    if (explicitlySelected?.content.artifact && !hasPendingToolCalls(explicitlySelected.content)) {
      return explicitlySelected;
    }

    return (
      [...state.messages]
        .reverse()
        .find(
          (message) =>
            message.role === 'assistant' &&
            message.content.artifact &&
            !hasPendingToolCalls(message.content),
        ) ?? null
    );
  }, [state.messages, state.selectedMessageId]);

  const selectedArtifact = selectedMessage?.content.artifact ?? null;
  const selectedProvider = getAiProvider(providerId);
  const selectedModel = supportedModels.find((model) => model.id === modelId) ?? supportedModels[0] ?? null;
  const activeModelId = selectedModel?.id ?? '';

  const sendPrompt = useCallback(async () => {
    if (selectedProvider.requiresApiKey && !apiKey.trim()) {
      window.alert(`Add a ${selectedProvider.name} API key first.`);
      return;
    }

    if (!selectedModel || !activeModelId) {
      window.alert(`No ${selectedProvider.name} models are available yet.`);
      return;
    }

    if ((!state.draft.trim() && state.pendingAttachments.length === 0) || state.isGenerating) {
      return;
    }

    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      createdAt: Date.now(),
      content: {
        text: state.draft.trim() || undefined,
        attachments: state.pendingAttachments.length > 0 ? state.pendingAttachments : undefined,
        modelId: activeModelId,
      },
    };

    const assistantMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      createdAt: Date.now() + 1,
      content: { modelId: activeModelId },
    };

    const history = [...state.messages, userMessage];

    dispatch({ type: 'appendExchange', userMessage, assistantMessage });
    dispatch({ type: 'setGenerating', value: true });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await runCadAgent({
        providerId,
        apiKey: selectedProvider.requiresApiKey ? apiKey.trim() : undefined,
        modelId: activeModelId,
        supportsVision: selectedModel.supportsVision,
        messages: history,
        signal: abortController.signal,
        onUpdate: (content) => {
          dispatch({ type: 'updateMessageContent', messageId: assistantMessage.id, content });
        },
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error(error);
      }
    } finally {
      dispatch({ type: 'setGenerating', value: false });
      abortControllerRef.current = null;
    }
  }, [
    activeModelId,
    apiKey,
    providerId,
    selectedModel,
    selectedProvider,
    state.draft,
    state.isGenerating,
    state.messages,
    state.pendingAttachments,
  ]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    dispatch({ type: 'setGenerating', value: false });
  }, []);

  const addAttachments = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const attachments = await filesToAttachments(files);
    dispatch({
      type: 'setPendingAttachments',
      attachments: [...state.pendingAttachments, ...attachments],
    });
  }, [state.pendingAttachments]);

  const removeAttachment = useCallback((attachmentId: string) => {
    dispatch({ type: 'removePendingAttachment', attachmentId });
  }, []);

  const selectMessage = useCallback((messageId: string) => {
    dispatch({ type: 'selectMessage', messageId });
  }, []);

  const clearConversation = useCallback(() => {
    if (state.isGenerating) return;
    dispatch({ type: 'clearConversation' });
  }, [state.isGenerating]);

  const usePrompt = useCallback((value: string) => {
    dispatch({ type: 'setDraft', value });
  }, []);

  const commitParameter = useCallback(
    (parameter: CadParameter, value: ParameterValue) => {
      if (!selectedMessage?.content.artifact) return;

      const validatedValue = validateParameterValue(parameter, value);
      const nextParameters = selectedMessage.content.artifact.parameters.map((entry) =>
        entry.name === parameter.name ? { ...entry, value: validatedValue } : entry,
      );

      let nextCode = selectedMessage.content.artifact.code;
      for (const nextParameter of nextParameters) {
        nextCode = applyParameterValue(nextCode, nextParameter);
      }

      const reparsedParameters = parseCadParameters(nextCode).map((parsed) => {
        const currentValue = nextParameters.find((entry) => entry.name === parsed.name);
        return currentValue ? { ...parsed, value: currentValue.value } : parsed;
      });

      dispatch({
        type: 'replaceArtifact',
        messageId: selectedMessage.id,
        artifact: {
          ...selectedMessage.content.artifact,
          code: nextCode,
          parameters: reparsedParameters,
        },
      });
    },
    [selectedMessage],
  );

  return {
    apiKey,
    setApiKey,
    providerId,
    setProviderId,
    providerName: selectedProvider.name,
    providerRequiresApiKey: selectedProvider.requiresApiKey,
    providerEndpoint: selectedProvider.endpointDisplay,
    availableProviders: AI_PROVIDERS,
    modelId: activeModelId,
    setModelId,
    modelDescription: selectedModel?.description ?? '',
    examplePrompts: EXAMPLE_PROMPTS,
    messages: state.messages,
    draft: state.draft,
    setDraft: (value: string) => dispatch({ type: 'setDraft', value }),
    pendingAttachments: state.pendingAttachments,
    selectedMessageId: selectedMessage?.id ?? null,
    selectedArtifact,
    isGenerating: state.isGenerating,
    sendPrompt,
    stopGeneration,
    addAttachments,
    removeAttachment,
    selectMessage,
    clearConversation,
    usePrompt,
    commitParameter,
    supportedModels,
  };
}

function hasPendingToolCalls(content: MessageContent) {
  return (content.toolCalls ?? []).some((toolCall) => toolCall.status === 'pending');
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'setDraft':
      return { ...state, draft: action.value };
    case 'setPendingAttachments':
      return { ...state, pendingAttachments: action.attachments };
    case 'removePendingAttachment':
      return {
        ...state,
        pendingAttachments: state.pendingAttachments.filter((item) => item.id !== action.attachmentId),
      };
    case 'appendExchange':
      return {
        ...state,
        messages: [...state.messages, action.userMessage, action.assistantMessage],
        draft: '',
        pendingAttachments: [],
      };
    case 'updateMessageContent':
      return {
        ...state,
        selectedMessageId:
          action.content.artifact && !hasPendingToolCalls(action.content)
            ? action.messageId
            : state.selectedMessageId,
        messages: state.messages.map((message) =>
          message.id === action.messageId ? { ...message, content: action.content } : message,
        ),
      };
    case 'selectMessage':
      return { ...state, selectedMessageId: action.messageId };
    case 'setGenerating':
      return { ...state, isGenerating: action.value };
    case 'replaceArtifact':
      return {
        ...state,
        selectedMessageId: action.messageId,
        messages: state.messages.map((message) =>
          message.id === action.messageId
            ? {
                ...message,
                content: {
                  ...message.content,
                  artifact: action.artifact,
                },
              }
            : message,
        ),
      };
    case 'clearConversation':
      return initialState;
    default:
      return state;
  }
}
