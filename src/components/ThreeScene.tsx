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
import { useMemo, useState } from 'react';

type Props = {
  geometry: THREE.BufferGeometry | null;
  color: string;
  coloredGroup?: THREE.Group | null;
  backgroundColor?: string;
};

export function ThreeScene({
  geometry,
  color,
  coloredGroup,
  backgroundColor = '#15181d',
}: Props) {
  const [isOrthographic, setIsOrthographic] = useState(true);

  const groupCenterOffset = useMemo(() => {
    if (!coloredGroup) return null;
    const box = new THREE.Box3().setFromObject(coloredGroup);
    if (box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3()).negate();
  }, [coloredGroup]);

  return (
    <div className="preview-scene">
      <Canvas>
        <color attach="background" args={[backgroundColor]} />
        {isOrthographic ? (
          <OrthographicCamera makeDefault position={[-100, 100, 100]} zoom={40} />
        ) : (
          <PerspectiveCamera makeDefault position={[-100, 100, 100]} fov={45} />
        )}
        <Stage environment={null} intensity={0.6} position={[0, 0, 0]}>
          <Environment files={`${import.meta.env.BASE_URL}city.hdr`} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
          <directionalLight position={[-5, -5, -5]} intensity={0.6} />
          {coloredGroup && groupCenterOffset ? (
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <primitive object={coloredGroup} position={groupCenterOffset.toArray()} />
            </group>
          ) : geometry ? (
            <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
              <meshStandardMaterial color={color} metalness={0.55} roughness={0.3} />
            </mesh>
          ) : null}
        </Stage>
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewcube />
        </GizmoHelper>
      </Canvas>

      <button
        className="camera-toggle"
        type="button"
        onClick={() => setIsOrthographic((value) => !value)}
      >
        {isOrthographic ? 'Perspective' : 'Orthographic'}
      </button>
    </div>
  );
}
