import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  Environment,
  GizmoHelper,
  GizmoViewcube,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  Stage,
} from '@react-three/drei';
import * as THREE from 'three';

type SceneViewportProps = {
  geometry: THREE.BufferGeometry | null;
  coloredGroup?: THREE.Group | null;
  color: string;
  backgroundColor?: string;
};

export function SceneViewport({
  geometry,
  coloredGroup,
  color,
  backgroundColor = '#0e1217',
}: SceneViewportProps) {
  const [orthographic, setOrthographic] = useState(true);

  const groupCenterOffset = useMemo(() => {
    if (!coloredGroup) return null;
    const bounds = new THREE.Box3().setFromObject(coloredGroup);
    if (bounds.isEmpty()) return new THREE.Vector3();
    return bounds.getCenter(new THREE.Vector3()).negate();
  }, [coloredGroup]);

  return (
    <div className="preview-stage">
      <Canvas>
        <color attach="background" args={[backgroundColor]} />
        {orthographic ? (
          <OrthographicCamera makeDefault position={[-100, 100, 100]} zoom={40} />
        ) : (
          <PerspectiveCamera makeDefault position={[-100, 100, 100]} fov={45} />
        )}
        <Stage environment={null} intensity={0.7} position={[0, 0, 0]}>
          <Environment files={`${import.meta.env.BASE_URL}city.hdr`} />
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 5, 5]} intensity={1.2} />
          <directionalLight position={[-5, -5, -5]} intensity={0.55} />
          {coloredGroup && groupCenterOffset ? (
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <primitive object={coloredGroup} position={groupCenterOffset.toArray()} />
            </group>
          ) : geometry ? (
            <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
              <meshStandardMaterial color={color} metalness={0.45} roughness={0.35} />
            </mesh>
          ) : null}
        </Stage>
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewcube />
        </GizmoHelper>
      </Canvas>

      <button type="button" className="camera-button" onClick={() => setOrthographic((value) => !value)}>
        {orthographic ? 'Perspective' : 'Orthographic'}
      </button>
    </div>
  );
}
