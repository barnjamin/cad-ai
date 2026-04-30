import { useRef } from 'react';
import type {
  ArtifactCompileReport,
  Attachment,
  ConversationMessage,
  RepairAttemptState,
} from '../../core/types';

type ChatPanelProps = {
  title: string;
  description: string;
  messages: ConversationMessage[];
  selectedMessageId: string | null;
  draft: string;
  pendingAttachments: Attachment[];
  examplePrompts: string[];
  isGenerating: boolean;
  compileReport: ArtifactCompileReport | null;
  repairState: RepairAttemptState | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onUsePrompt: (value: string) => void;
  onAddAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSelectMessage: (messageId: string) => void;
  onClearConversation: () => void;
};

export function ChatPanel({
  title,
  description,
  messages,
  selectedMessageId,
  draft,
  pendingAttachments,
  examplePrompts,
  isGenerating,
  compileReport,
  repairState,
  onDraftChange,
  onSend,
  onStop,
  onUsePrompt,
  onAddAttachments,
  onRemoveAttachment,
  onSelectMessage,
  onClearConversation,
}: ChatPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="panel chat-panel">
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClearConversation} disabled={isGenerating}>
          Clear
        </button>
      </header>

      {messages.length === 0 && (
        <div className="empty-card">
          <h3>Example prompts</h3>
          <div className="prompt-list">
            {examplePrompts.map((prompt) => (
              <button key={prompt} type="button" className="prompt-button" onClick={() => onUsePrompt(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {(repairState?.statusMessage || compileReport?.errorMessage) && (
        <div
          className={[
            'feedback-loop-card',
            repairState?.status === 'repairing'
              ? 'feedback-loop-card-repairing'
              : compileReport?.status === 'error' || repairState?.status === 'failed'
                ? 'feedback-loop-card-error'
                : 'feedback-loop-card-success',
          ].join(' ')}
        >
          <strong>
            {repairState?.status === 'repairing'
              ? 'Repairing model from compile error…'
              : repairState?.status === 'failed'
                ? 'Auto-repair failed'
                : repairState?.status === 'succeeded'
                  ? 'Repair finished'
                  : compileReport?.status === 'error'
                    ? 'Compile failed'
                    : 'Preview updated'}
          </strong>
          <p>{repairState?.statusMessage ?? compileReport?.errorMessage}</p>
        </div>
      )}

      <div className="message-list">
        {messages.map((message) => (
          <div
            key={message.id}
            role="button"
            tabIndex={0}
            className={[
              'message-card',
              `message-card-${message.role}`,
              selectedMessageId === message.id ? 'message-card-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelectMessage(message.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectMessage(message.id);
              }
            }}
          >
            <div className="message-meta">
              <span>{message.role === 'user' ? 'You' : 'Assistant'}</span>
              {message.content.artifact && <span className="tag">Artifact</span>}
            </div>
            {message.content.text && <div className="message-text">{message.content.text}</div>}
            {message.content.toolCalls && message.content.toolCalls.length > 0 && (
              <div className="tool-call-list">
                {message.content.toolCalls.map((toolCall) => (
                  <div key={toolCall.id} className={`tool-call tool-call-${toolCall.status}`}>
                    {toolCall.status === 'pending' ? 'Working:' : 'Failed:'} {toolCall.name.replaceAll('_', ' ')}
                  </div>
                ))}
              </div>
            )}
            {message.content.attachments && message.content.attachments.length > 0 && (
              <div className="attachment-strip">
                {message.content.attachments.map((attachment) => (
                  <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} />
                ))}
              </div>
            )}
            {message.content.artifact?.code && <pre className="message-code">{message.content.artifact.code.slice(0, 360)}</pre>}
          </div>
        ))}
      </div>

      <div className="composer">
        {pendingAttachments.length > 0 && (
          <div className="attachment-strip">
            {pendingAttachments.map((attachment) => (
              <div key={attachment.id} className="attachment-chip">
                <img src={attachment.dataUrl} alt={attachment.name} />
                <button type="button" onClick={() => onRemoveAttachment(attachment.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={draft}
          placeholder="Describe the part you want to build..."
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />

        <div className="composer-actions">
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              onAddAttachments(event.target.files);
              event.target.value = '';
            }}
          />
          <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>
            Add images
          </button>
          <div className="composer-actions-right">
            {isGenerating ? (
              <button type="button" className="ghost-button" onClick={onStop}>
                Stop
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={onSend}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
