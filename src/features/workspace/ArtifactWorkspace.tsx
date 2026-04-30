import { useCallback, useMemo, useState } from 'react';
import type {
  ArtifactCompileReport,
  CadArtifact,
  CadParameter,
  ParameterValue,
  RepairAttemptState,
} from '../../core/types';
import { copyTextToClipboard, downloadBlob, slugify } from '../../core/utils';
import { OpenScadPreview } from '../preview/OpenScadPreview';
import { ParameterField } from '../parameters/ParameterField';

type ArtifactWorkspaceProps = {
  artifact: CadArtifact | null;
  compileReport: ArtifactCompileReport | null;
  repairState: RepairAttemptState | null;
  onCommitParameter: (parameter: CadParameter, value: ParameterValue) => void;
  onCompileReport: (report: ArtifactCompileReport) => void;
};

export function ArtifactWorkspace({
  artifact,
  compileReport,
  repairState,
  onCommitParameter,
  onCompileReport,
}: ArtifactWorkspaceProps) {
  const [exporter, setExporter] = useState<((code: string) => Promise<Blob>) | null>(null);
  const artifactFilename = useMemo(() => slugify(artifact?.title || 'model') || 'model', [artifact?.title]);
  const handleExportReady = useCallback(
    (nextExporter: (code: string) => Promise<Blob>) => {
      setExporter(() => nextExporter);
    },
    [],
  );

  const downloadStl = async () => {
    if (!artifact || !exporter) return;
    const blob = await exporter(artifact.code);
    downloadBlob(blob, `${artifactFilename}.stl`);
  };

  const downloadScad = () => {
    if (!artifact) return;
    const blob = new Blob([artifact.code], { type: 'text/plain' });
    downloadBlob(blob, `${artifactFilename}.scad`);
  };

  return (
    <section className="workspace-grid">
      <section className="panel preview-panel">
        <header className="panel-header">
          <div>
            <h2>Preview</h2>
            <p>{artifact ? artifact.title : 'Generate a model to preview it.'}</p>
          </div>
          <div className="toolbar">
            {artifact && (
              <div
                className={[
                  'status-pill',
                  repairState?.status === 'repairing'
                    ? 'status-pill-repairing'
                    : compileReport?.status === 'error' || repairState?.status === 'failed'
                      ? 'status-pill-error'
                      : 'status-pill-success',
                ].join(' ')}
              >
                {repairState?.status === 'repairing'
                  ? 'Repairing…'
                  : compileReport?.status === 'error' || repairState?.status === 'failed'
                    ? 'Compile error'
                    : 'Preview ready'}
              </div>
            )}
            <button type="button" className="ghost-button" onClick={() => void downloadStl()} disabled={!artifact || !exporter}>
              STL
            </button>
            <button type="button" className="ghost-button" onClick={downloadScad} disabled={!artifact}>
              SCAD
            </button>
          </div>
        </header>
        {artifact && (repairState?.statusMessage || compileReport?.errorMessage) && (
          <div className="feedback-banner">
            <strong>
              {repairState?.status === 'repairing'
                ? 'Feedback loop active'
                : repairState?.status === 'failed'
                  ? 'Auto-repair stopped'
                  : repairState?.status === 'succeeded'
                    ? 'Repair complete'
                    : compileReport?.status === 'error'
                      ? 'Compile failed'
                      : 'Preview status'}
            </strong>
            <p>{repairState?.statusMessage ?? compileReport?.errorMessage}</p>
          </div>
        )}
        <OpenScadPreview
          artifactId={artifact?.id ?? null}
          scadCode={artifact?.code ?? null}
          fallbackColor="#6db7ff"
          onExportReady={handleExportReady}
          onCompileReport={onCompileReport}
        />
      </section>

      <section className="workspace-lower-grid">
        <section className="panel parameter-panel">
          <header className="panel-header">
            <div>
              <h2>Parameters</h2>
              <p>Editable values parsed from the current OpenSCAD file.</p>
            </div>
          </header>
          <div className="parameter-list">
            {!artifact && <div className="empty-card">Generate a model to expose parameters.</div>}
            {artifact?.parameters.map((parameter) => (
              <ParameterField
                key={parameter.name}
                parameter={parameter}
                onCommit={(value) => onCommitParameter(parameter, value)}
              />
            ))}
          </div>
        </section>

        <section className="panel code-panel">
          <header className="panel-header">
            <div>
              <h2>OpenSCAD</h2>
              <p>The exact code currently driving the local preview.</p>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void copyTextToClipboard(artifact?.code ?? '')}
              disabled={!artifact?.code}
            >
              Copy
            </button>
          </header>
          <pre className="code-block">{artifact?.code ?? '// No OpenSCAD yet'}</pre>
        </section>
      </section>
    </section>
  );
}
