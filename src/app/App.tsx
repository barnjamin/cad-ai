import { ChatPanel } from '../features/chat/ChatPanel';
import { ArtifactWorkspace } from '../features/workspace/ArtifactWorkspace';
import { ModelPicker } from './ModelPicker';
import { useCadApp } from './useCadApp';

export default function App() {
  const app = useCadApp();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="eyebrow">Browser CAD AI</div>
          <h1>AI Assisted CAD</h1>
          <p className="header-copy">
            A standalone browser app for conversational, parametric OpenSCAD authoring and local preview.
          </p>
        </div>

        <div className="settings-grid">
          <div className="settings-field">
            <span>Provider</span>
            <select value={app.providerId} onChange={(event) => app.setProviderId(event.target.value as typeof app.providerId)}>
              {app.availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-field">
            <span>{app.providerRequiresApiKey ? `${app.providerName} API key` : `${app.providerName} endpoint`}</span>
            {app.providerRequiresApiKey ? (
              <input
                type="password"
                value={app.apiKey}
                onChange={(event) => app.setApiKey(event.target.value)}
                placeholder="sk-or-v1-..."
              />
            ) : (
              <input type="text" value={app.providerEndpoint} readOnly />
            )}
          </div>

          <div className="settings-field">
            <span>Model</span>
            <ModelPicker
              value={app.modelId}
              models={app.supportedModels}
              onChange={app.setModelId}
            />
          </div>
        </div>
      </header>

      <main className="app-grid">
        <ChatPanel
          title="Conversation"
          description={app.modelDescription}
          messages={app.messages}
          selectedMessageId={app.selectedMessageId}
          draft={app.draft}
          pendingAttachments={app.pendingAttachments}
          examplePrompts={app.examplePrompts}
          isGenerating={app.isGenerating}
          compileReport={app.selectedCompileReport}
          repairState={app.selectedRepairState}
          onDraftChange={app.setDraft}
          onSend={() => void app.sendPrompt()}
          onStop={app.stopGeneration}
          onUsePrompt={app.usePrompt}
          onAddAttachments={(files) => void app.addAttachments(files)}
          onRemoveAttachment={app.removeAttachment}
          onSelectMessage={app.selectMessage}
          onClearConversation={app.clearConversation}
        />

        <ArtifactWorkspace
          artifact={app.selectedArtifact}
          compileReport={app.selectedCompileReport}
          repairState={app.selectedRepairState}
          onCommitParameter={app.commitParameter}
          onCompileReport={app.handleCompileReport}
        />
      </main>
    </div>
  );
}
