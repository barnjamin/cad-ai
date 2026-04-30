import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DEFAULT_MODEL_ID, EXAMPLE_PROMPTS } from '../core/models';
import { STORAGE_KEYS } from '../core/storage';
import { hashText } from '../core/hash';
import type {
  AiProviderId,
  ArtifactCompileReport,
  Attachment,
  CadArtifact,
  CadParameter,
  ConversationMessage,
  MessageContent,
  ModelId,
  ParameterValue,
  RepairAttemptState,
} from '../core/types';
import { usePersistentState } from '../hooks/usePersistentState';
import { buildParametricModelArtifact, runCadAgent } from '../services/ai/cadAgent';
import { filesToAttachments } from '../services/ai/attachments';
import { fetchProviderModels, getInitialModelsForProvider } from '../services/ai/modelCatalog';
import { AI_PROVIDERS, DEFAULT_PROVIDER_ID, getAiProvider } from '../services/ai/providers';
import {
  applyParameterValue,
  parseCadParameters,
  validateParameterValue,
} from '../services/cad/parameters';
import {
  formatCompileErrorForRepair,
  normalizeCompileError,
} from '../services/cad/compileFeedback';

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

const AUTO_REPAIR_LIMIT = 1;

type ActiveRepair = {
  artifactId: string;
  codeHash: string;
  messageId: string;
  controller: AbortController;
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
  const [compileReports, setCompileReports] = useState<Record<string, ArtifactCompileReport>>({});
  const [repairStates, setRepairStates] = useState<Record<string, RepairAttemptState>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRepairRef = useRef<ActiveRepair | null>(null);

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

  const selectedCompileReport = useMemo(() => {
    if (!selectedArtifact) return null;
    return compileReports[makeCompileReportKey(selectedArtifact.id, selectedArtifact.codeHash)] ?? null;
  }, [compileReports, selectedArtifact]);

  const selectedRepairState = useMemo(() => {
    if (!selectedArtifact) return null;
    const repairState = repairStates[selectedArtifact.id] ?? null;
    if (!repairState) return null;
    if (repairState.codeHash !== selectedArtifact.codeHash && repairState.status !== 'repairing') {
      return null;
    }
    return repairState;
  }, [repairStates, selectedArtifact]);

  const cancelActiveRepair = useCallback((statusMessage?: string) => {
    const activeRepair = activeRepairRef.current;
    if (!activeRepair) return;

    activeRepair.controller.abort();
    activeRepairRef.current = null;

    if (!statusMessage) return;

    setRepairStates((current) => {
      const existing = current[activeRepair.artifactId];
      if (!existing || existing.status !== 'repairing') return current;

      return {
        ...current,
        [activeRepair.artifactId]: {
          ...existing,
          status: 'idle',
          statusMessage,
          completedAt: Date.now(),
        },
      };
    });
  }, []);

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

    cancelActiveRepair();

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
    cancelActiveRepair,
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

  const selectMessage = useCallback(
    (messageId: string) => {
      if (activeRepairRef.current && activeRepairRef.current.messageId !== messageId) {
        cancelActiveRepair('Repair cancelled after switching artifacts.');
      }
      dispatch({ type: 'selectMessage', messageId });
    },
    [cancelActiveRepair],
  );

  const clearConversation = useCallback(() => {
    if (state.isGenerating) return;
    cancelActiveRepair();
    setCompileReports({});
    setRepairStates({});
    dispatch({ type: 'clearConversation' });
  }, [cancelActiveRepair, state.isGenerating]);

  const usePrompt = useCallback((value: string) => {
    dispatch({ type: 'setDraft', value });
  }, []);

  const commitParameter = useCallback(
    (parameter: CadParameter, value: ParameterValue) => {
      if (!selectedMessage?.content.artifact) return;

      cancelActiveRepair('Repair cancelled after a local edit.');

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
          version: bumpArtifactVersion(selectedMessage.content.artifact.version),
          code: nextCode,
          codeHash: hashText(nextCode),
          parameters: reparsedParameters,
          source: 'user-edited',
          updatedAt: Date.now(),
        },
      });
    },
    [cancelActiveRepair, selectedMessage],
  );

  const handleCompileReport = useCallback((report: ArtifactCompileReport) => {
    setCompileReports((current) => ({
      ...current,
      [makeCompileReportKey(report.artifactId, report.codeHash)]: report,
    }));

    setRepairStates((current) => {
      const existing = current[report.artifactId];
      if (!existing || existing.status !== 'repairing' || existing.codeHash !== report.codeHash) {
        return current;
      }

      if (report.status === 'success') {
        return {
          ...current,
          [report.artifactId]: {
            ...existing,
            status: 'succeeded',
            statusMessage: 'Repair complete. Preview compiled successfully.',
            completedAt: Date.now(),
          },
        };
      }

      const normalized = normalizeCompileError(report);
      const failureMessage = normalized?.summary ?? report.errorMessage ?? 'OpenSCAD failed to compile the repaired model.';
      return {
        ...current,
        [report.artifactId]: {
          ...existing,
          status: 'failed',
          statusMessage: `Retry failed: ${failureMessage}`,
          lastError: failureMessage,
          completedAt: Date.now(),
        },
      };
    });
  }, []);

  const startAutoRepair = useCallback(
    async (artifact: CadArtifact, messageId: string, report: ArtifactCompileReport) => {
      if (activeRepairRef.current) return;

      const normalizedError = normalizeCompileError(report);
      if (!normalizedError) return;

      const attempts = (repairStates[artifact.id]?.attempts ?? 0) + 1;
      const repairPrompt = formatCompileErrorForRepair(normalizedError, artifact.code);
      const controller = new AbortController();

      activeRepairRef.current = {
        artifactId: artifact.id,
        codeHash: artifact.codeHash,
        messageId,
        controller,
      };

      setRepairStates((current) => ({
        ...current,
        [artifact.id]: {
          artifactId: artifact.id,
          codeHash: artifact.codeHash,
          attempts,
          status: 'repairing',
          statusMessage: `Repairing model from compile error… ${normalizedError.summary}`,
          lastError: normalizedError.summary,
          startedAt: Date.now(),
        },
      }));

      try {
        const repairedArtifact = await buildParametricModelArtifact({
          providerId,
          apiKey: selectedProvider.requiresApiKey ? apiKey.trim() : undefined,
          modelId: activeModelId,
          supportsVision: selectedModel?.supportsVision ?? false,
          conversation: state.messages,
          promptText: artifact.intentText ?? getPromptFromMessageHistory(state.messages, messageId),
          baseCode: artifact.code,
          error: repairPrompt,
          signal: controller.signal,
          source: 'assistant-repaired',
        });

        if (controller.signal.aborted) return;
        if (!repairedArtifact) {
          throw new Error('The repair attempt did not return any OpenSCAD code.');
        }
        if (repairedArtifact.codeHash === artifact.codeHash || repairedArtifact.code.trim() === artifact.code.trim()) {
          throw new Error('The repair attempt produced unchanged code.');
        }

        dispatch({
          type: 'replaceArtifact',
          messageId,
          artifact: {
            ...repairedArtifact,
            id: artifact.id,
            version: bumpArtifactVersion(artifact.version),
            intentText: artifact.intentText ?? repairedArtifact.intentText,
            updatedAt: Date.now(),
          },
        });

        setRepairStates((current) => ({
          ...current,
          [artifact.id]: {
            ...(current[artifact.id] ?? {
              artifactId: artifact.id,
              attempts,
            }),
            artifactId: artifact.id,
            codeHash: repairedArtifact.codeHash,
            attempts,
            status: 'repairing',
            statusMessage: 'Retrying repaired model in preview…',
            startedAt: current[artifact.id]?.startedAt ?? Date.now(),
          },
        }));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          const failureMessage =
            error instanceof Error ? error.message : 'Something went wrong while repairing the model.';
          setRepairStates((current) => ({
            ...current,
            [artifact.id]: {
              ...(current[artifact.id] ?? {
                artifactId: artifact.id,
                codeHash: artifact.codeHash,
                attempts,
              }),
              artifactId: artifact.id,
              codeHash: artifact.codeHash,
              attempts,
              status: 'failed',
              statusMessage: `Retry failed: ${failureMessage}`,
              lastError: failureMessage,
              completedAt: Date.now(),
            },
          }));
        }
      } finally {
        if (activeRepairRef.current?.artifactId === artifact.id && activeRepairRef.current.controller === controller) {
          activeRepairRef.current = null;
        }
      }
    },
    [
      activeModelId,
      apiKey,
      providerId,
      repairStates,
      selectedModel?.supportsVision,
      selectedProvider.requiresApiKey,
      state.messages,
    ],
  );

  useEffect(() => {
    if (!selectedArtifact || !selectedMessage || !selectedCompileReport) return;
    if (selectedCompileReport.status !== 'error') return;
    if (selectedCompileReport.artifactId !== selectedArtifact.id) return;
    if (selectedCompileReport.codeHash !== selectedArtifact.codeHash) return;
    if (state.isGenerating) return;
    if (!isAutoRepairableArtifact(selectedArtifact)) return;
    if (selectedProvider.requiresApiKey && !apiKey.trim()) return;

    const attempts = repairStates[selectedArtifact.id]?.attempts ?? 0;
    const status = repairStates[selectedArtifact.id]?.status;
    if (attempts >= AUTO_REPAIR_LIMIT || status === 'repairing') return;

    void startAutoRepair(selectedArtifact, selectedMessage.id, selectedCompileReport);
  }, [
    apiKey,
    repairStates,
    selectedArtifact,
    selectedCompileReport,
    selectedMessage,
    selectedProvider.requiresApiKey,
    startAutoRepair,
    state.isGenerating,
  ]);

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
    selectedCompileReport,
    selectedRepairState,
    isGenerating: state.isGenerating,
    sendPrompt,
    stopGeneration,
    addAttachments,
    removeAttachment,
    selectMessage,
    clearConversation,
    usePrompt,
    commitParameter,
    handleCompileReport,
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

function makeCompileReportKey(artifactId: string, codeHash: string) {
  return `${artifactId}:${codeHash}`;
}

function isAutoRepairableArtifact(artifact: CadArtifact) {
  return artifact.source === 'assistant-generated' || artifact.source === 'assistant-repaired';
}

function bumpArtifactVersion(version: string) {
  const match = version.match(/^(.*?)(\d+)$/);
  if (!match) return `${version}.1`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function getPromptFromMessageHistory(messages: ConversationMessage[], assistantMessageId: string) {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  if (assistantIndex === -1) return 'Fix this OpenSCAD model so it compiles and preserves the intended design.';

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.content.text?.trim()) {
      return message.content.text.trim();
    }
  }

  return 'Fix this OpenSCAD model so it compiles and preserves the intended design.';
}
