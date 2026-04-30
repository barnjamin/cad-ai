import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { ArtifactCompileReport } from '../../core/types';
import { hashText } from '../../core/hash';
import OpenScadError from '../../services/cad/OpenScadError';
import { parseColoredOff } from '../../services/cad/off';
import { useOpenScadKernel } from '../../services/cad/useOpenScadKernel';
import { SceneViewport } from './SceneViewport';

type OpenScadPreviewProps = {
  artifactId?: string | null;
  scadCode: string | null;
  fallbackColor: string;
  onExportReady?: ((exporter: (code: string) => Promise<Blob>) => void) | null;
  onCompileReport?: ((report: ArtifactCompileReport) => void) | null;
};

export function OpenScadPreview({
  artifactId,
  scadCode,
  fallbackColor,
  onExportReady,
  onCompileReport,
}: OpenScadPreviewProps) {
  const { compileScad, exportStl, isCompiling, output, offOutput, compileLog, fileType, error, isError } =
    useOpenScadKernel();
  const exportModel = useCallback((code: string) => exportStl(code), [exportStl]);
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [coloredGroup, setColoredGroup] = useState<Group | null>(null);
  const mountedGeometryRef = useRef<BufferGeometry | null>(null);
  const mountedGroupRef = useRef<Group | null>(null);
  const fallbackColorRef = useRef(fallbackColor);
  const lastReportedCompileKeyRef = useRef<string | null>(null);
  const codeHash = useMemo(() => (scadCode ? hashText(scadCode) : null), [scadCode]);

  useEffect(() => {
    fallbackColorRef.current = fallbackColor;
  }, [fallbackColor]);

  useEffect(() => {
    onExportReady?.(exportModel);
  }, [exportModel, onExportReady]);

  useEffect(() => {
    lastReportedCompileKeyRef.current = null;
    if (!scadCode) return;
    compileScad(scadCode);
  }, [compileScad, scadCode]);

  useEffect(() => {
    if (!output) {
      mountedGeometryRef.current?.dispose();
      mountedGeometryRef.current = null;
      setGeometry(null);
      return;
    }

    let cancelled = false;
    void output.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      const geometryLoader = new STLLoader();
      const parsedGeometry = geometryLoader.parse(buffer);
      parsedGeometry.center();
      parsedGeometry.computeVertexNormals();
      mountedGeometryRef.current?.dispose();
      mountedGeometryRef.current = parsedGeometry;
      setGeometry(parsedGeometry);
    });

    return () => {
      cancelled = true;
    };
  }, [output]);

  useEffect(() => {
    if (!offOutput) {
      disposeMountedGroup(mountedGroupRef.current);
      mountedGroupRef.current = null;
      setColoredGroup(null);
      return;
    }

    let cancelled = false;
    void offOutput.text().then((text) => {
      if (cancelled) return;

      const parsed = parseColoredOff(text);
      scrubDefaultOffColors(parsed.faces);
      const groupedFaces = bucketFacesByColor(parsed.faces);
      const nextGroup = new Group();

      for (const [key, faces] of groupedFaces) {
        const positions = new Float32Array(faces.length * 9);
        for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
          const [a, b, c] = faces[faceIndex].vertices;
          const va = parsed.vertices[a];
          const vb = parsed.vertices[b];
          const vc = parsed.vertices[c];
          const baseIndex = faceIndex * 9;

          positions[baseIndex + 0] = va[0];
          positions[baseIndex + 1] = va[1];
          positions[baseIndex + 2] = va[2];
          positions[baseIndex + 3] = vb[0];
          positions[baseIndex + 4] = vb[1];
          positions[baseIndex + 5] = vb[2];
          positions[baseIndex + 6] = vc[0];
          positions[baseIndex + 7] = vc[1];
          positions[baseIndex + 8] = vc[2];
        }

        const faceColor = key === '__default' ? null : faces[0].color;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();

        const material = new MeshStandardMaterial({
          color: faceColor ? rgbaToRgbInteger(faceColor) : fallbackColorRef.current,
          metalness: faceColor ? 0.05 : 0.55,
          roughness: faceColor ? 0.72 : 0.32,
          envMapIntensity: faceColor ? 0.18 : 0.28,
          transparent: Boolean(faceColor && faceColor[3] < 1),
          opacity: faceColor?.[3] ?? 1,
        });

        nextGroup.add(new Mesh(geometry, material));
      }

      if (nextGroup.children.length === 0) {
        disposeMountedGroup(mountedGroupRef.current);
        mountedGroupRef.current = null;
        setColoredGroup(null);
        return;
      }

      disposeMountedGroup(mountedGroupRef.current);
      mountedGroupRef.current = nextGroup;
      setColoredGroup(nextGroup);
    });

    return () => {
      cancelled = true;
    };
  }, [offOutput]);

  useEffect(() => {
    return () => {
      mountedGeometryRef.current?.dispose();
      disposeMountedGroup(mountedGroupRef.current);
    };
  }, []);

  useEffect(() => {
    if (!artifactId || !codeHash || !onCompileReport || isCompiling || !fileType) return;
    if (!output && !offOutput) return;

    const report: ArtifactCompileReport = {
      artifactId,
      codeHash,
      status: 'success',
      fileType,
      stdErr: compileLog?.stdErr,
      generatedAt: Date.now(),
    };

    const reportKey = `${artifactId}:${codeHash}:success:${fileType}`;
    if (lastReportedCompileKeyRef.current === reportKey) return;
    lastReportedCompileKeyRef.current = reportKey;
    onCompileReport(report);
  }, [artifactId, codeHash, compileLog?.stdErr, fileType, isCompiling, offOutput, onCompileReport, output]);

  useEffect(() => {
    if (!artifactId || !codeHash || !onCompileReport || !error) return;

    const compileError = error as OpenScadError | Error;
    const stdErr = compileError instanceof OpenScadError ? compileError.stdErr : undefined;
    const report: ArtifactCompileReport = {
      artifactId,
      codeHash,
      status: 'error',
      errorMessage: compileError.message,
      stdErr,
      generatedAt: Date.now(),
    };

    const reportKey = `${artifactId}:${codeHash}:error:${compileError.message}`;
    if (lastReportedCompileKeyRef.current === reportKey) return;
    lastReportedCompileKeyRef.current = reportKey;
    onCompileReport(report);
  }, [artifactId, codeHash, error, onCompileReport]);

  if (!scadCode) {
    return <PreviewEmptyState title="No model yet" subtitle="Send a prompt to generate OpenSCAD." />;
  }

  if (isError) {
    const compileError = error as OpenScadError | Error | undefined;
    return (
      <PreviewEmptyState
        title="Compile error"
        subtitle={compileError?.message || 'OpenSCAD failed to compile this model.'}
      />
    );
  }

  return (
    <div className="preview-shell">
      {geometry || coloredGroup ? (
        <SceneViewport geometry={geometry} coloredGroup={coloredGroup} color={fallbackColor} />
      ) : (
        <PreviewEmptyState
          title={isCompiling ? 'Compiling model…' : 'Preparing preview'}
          subtitle={isCompiling ? 'OpenSCAD is generating geometry.' : 'Preview will appear here.'}
        />
      )}
      {isCompiling && <div className="preview-badge">Compiling…</div>}
    </div>
  );
}

function PreviewEmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="preview-empty-state">
      <strong>{title}</strong>
      <p>{subtitle}</p>
    </div>
  );
}

function disposeMountedGroup(group: Group | null) {
  group?.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry?.dispose();
    const material = object.material;
    if (Array.isArray(material)) {
      material.forEach((entry: Material) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}

function scrubDefaultOffColors(
  faces: Array<{ color: [number, number, number, number] | null }>,
) {
  for (const face of faces) {
    if (!face.color) continue;
    const r = Math.round(face.color[0] * 255);
    const g = Math.round(face.color[1] * 255);
    const b = Math.round(face.color[2] * 255);
    const isOpenScadDefault = r === 249 && g === 215 && b === 44;
    const isManifoldDefault = r === 157 && g === 203 && b === 81;
    if (isOpenScadDefault || isManifoldDefault) {
      face.color = null;
    }
  }
}

function bucketFacesByColor(
  faces: Array<{ vertices: [number, number, number]; color: [number, number, number, number] | null }>,
) {
  const buckets = new Map<string, typeof faces>();
  for (const face of faces) {
    const key = face.color ? face.color.join(',') : '__default';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(face);
    else buckets.set(key, [face]);
  }
  return buckets;
}

function rgbaToRgbInteger(color: [number, number, number, number]) {
  return (
    (Math.round(color[0] * 255) << 16) |
    (Math.round(color[1] * 255) << 8) |
    Math.round(color[2] * 255)
  );
}
