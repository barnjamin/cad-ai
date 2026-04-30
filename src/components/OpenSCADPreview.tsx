import { useEffect, useRef, useState } from 'react';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { useOpenSCAD } from '../hooks/useOpenSCAD';
import { parseColoredOff } from '../lib/offParser';
import { ThreeScene } from './ThreeScene';
import OpenSCADError from '../lib/OpenSCADError';

function disposeGroup(group: Group) {
  group.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.geometry?.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach((m: Material) => m.dispose());
    else mat?.dispose();
  });
}

type Props = {
  scadCode: string | null;
  color: string;
  onOutputChange?: (output: Blob | undefined) => void;
  onExporterReady?: ((exporter: (code: string) => Promise<Blob>) => void) | null;
};

export function OpenSCADPreview({
  scadCode,
  color,
  onOutputChange,
  onExporterReady,
}: Props) {
  const { compileScad, exportStl, isCompiling, output, offOutput, isError, error } =
    useOpenSCAD();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [coloredGroup, setColoredGroup] = useState<Group | null>(null);
  const mountedGroupRef = useRef<Group | null>(null);
  const mountedGeometryRef = useRef<BufferGeometry | null>(null);
  const fallbackColorRef = useRef(color);

  useEffect(() => {
    fallbackColorRef.current = color;
  }, [color]);

  useEffect(() => {
    if (!scadCode) return;
    compileScad(scadCode);
  }, [scadCode, compileScad]);

  useEffect(() => {
    onOutputChange?.(output);
    onExporterReady?.((code: string) => exportStl(code));
  }, [output, onOutputChange, exportStl, onExporterReady]);

  useEffect(() => {
    const clearGeometry = () => {
      if (mountedGeometryRef.current) {
        mountedGeometryRef.current.dispose();
        mountedGeometryRef.current = null;
      }
      setGeometry(null);
    };

    if (output && output instanceof Blob) {
      let cancelled = false;
      output
        .arrayBuffer()
        .then((buffer) => {
          if (cancelled) return;
          const loader = new STLLoader();
          const geom = loader.parse(buffer);
          geom.center();
          geom.computeVertexNormals();
          if (mountedGeometryRef.current) mountedGeometryRef.current.dispose();
          mountedGeometryRef.current = geom;
          setGeometry(geom);
        })
        .catch(() => {
          if (!cancelled) clearGeometry();
        });
      return () => {
        cancelled = true;
      };
    }

    clearGeometry();
  }, [output]);

  useEffect(() => {
    let cancelled = false;

    const clearColoredGroup = () => {
      if (mountedGroupRef.current) {
        disposeGroup(mountedGroupRef.current);
        mountedGroupRef.current = null;
      }
      setColoredGroup(null);
    };

    if (!(offOutput instanceof Blob)) {
      clearColoredGroup();
      return;
    }

    offOutput
      .text()
      .then((text) => {
        if (cancelled) return;
        const parsed = parseColoredOff(text);

        for (const face of parsed.faces) {
          if (!face.color) continue;
          const r = Math.round(face.color[0] * 255);
          const g = Math.round(face.color[1] * 255);
          const b = Math.round(face.color[2] * 255);
          const isOpenscadDefault = r === 249 && g === 215 && b === 44;
          const isManifoldCutDefault = r === 157 && g === 203 && b === 81;
          if (isOpenscadDefault || isManifoldCutDefault) face.color = null;
        }

        const buckets = new Map<string, typeof parsed.faces>();
        for (const face of parsed.faces) {
          const key = face.color ? face.color.join(',') : '__default';
          const bucket = buckets.get(key);
          if (bucket) bucket.push(face);
          else buckets.set(key, [face]);
        }

        const group = new Group();
        for (const [key, faces] of buckets) {
          const positions = new Float32Array(faces.length * 9);
          for (let f = 0; f < faces.length; f++) {
            const [a, b, c] = faces[f].vertices;
            const va = parsed.vertices[a];
            const vb = parsed.vertices[b];
            const vc = parsed.vertices[c];
            const base = f * 9;
            positions[base + 0] = va[0];
            positions[base + 1] = va[1];
            positions[base + 2] = va[2];
            positions[base + 3] = vb[0];
            positions[base + 4] = vb[1];
            positions[base + 5] = vb[2];
            positions[base + 6] = vc[0];
            positions[base + 7] = vc[1];
            positions[base + 8] = vc[2];
          }
          const geom = new BufferGeometry();
          geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
          geom.computeVertexNormals();

          const firstFace = faces[0];
          const faceColor = key === '__default' ? null : firstFace.color;
          const mat = new MeshStandardMaterial({
            color: faceColor
              ? (Math.round(faceColor[0] * 255) << 16) |
                (Math.round(faceColor[1] * 255) << 8) |
                Math.round(faceColor[2] * 255)
              : fallbackColorRef.current,
            metalness: faceColor ? 0.05 : 0.6,
            roughness: faceColor ? 0.7 : 0.3,
            envMapIntensity: faceColor ? 0.15 : 0.3,
            transparent: faceColor ? faceColor[3] < 1 : false,
            opacity: faceColor ? faceColor[3] : 1,
          });

          group.add(new Mesh(geom, mat));
        }

        if (group.children.length === 0) {
          if (!cancelled) clearColoredGroup();
          return;
        }

        if (mountedGroupRef.current) disposeGroup(mountedGroupRef.current);
        mountedGroupRef.current = group;
        setColoredGroup(group);
      })
      .catch(() => {
        if (!cancelled) clearColoredGroup();
      });

    return () => {
      cancelled = true;
    };
  }, [offOutput]);

  useEffect(() => {
    return () => {
      if (mountedGroupRef.current) disposeGroup(mountedGroupRef.current);
      if (mountedGeometryRef.current) mountedGeometryRef.current.dispose();
    };
  }, []);

  if (!scadCode) {
    return <EmptyState title="No model yet" subtitle="Send a prompt to generate OpenSCAD." />;
  }

  if (isError) {
    const scadError = error as OpenSCADError | Error | undefined;
    return (
      <EmptyState
        title="Compile error"
        subtitle={scadError?.message || 'OpenSCAD failed to compile this model.'}
      />
    );
  }

  return (
    <div className="preview-shell">
      {geometry || coloredGroup ? (
        <ThreeScene geometry={geometry} coloredGroup={coloredGroup} color={color} />
      ) : (
        <EmptyState
          title={isCompiling ? 'Compiling model…' : 'Preparing preview'}
          subtitle={isCompiling ? 'OpenSCAD is generating geometry.' : 'Preview will appear here.'}
        />
      )}
      {isCompiling && <div className="preview-badge">Compiling…</div>}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="preview-empty">
      <div className="preview-empty-title">{title}</div>
      <div className="preview-empty-subtitle">{subtitle}</div>
    </div>
  );
}
