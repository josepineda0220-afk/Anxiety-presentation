import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { BrainModel } from './BrainModel'

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.05} />
      <directionalLight position={[-3.5, 4.5, 5]} intensity={1.9} color="#fff1e6" />
      <directionalLight position={[5, 1.5, -3]} intensity={1.5} color="#a8c8ff" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={1.5} color="#fff3ea" position={[-4, 5, 6]} scale={[9, 6, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#9fc2ff" position={[7, 1, -2]} rotation-y={-Math.PI / 2} scale={[8, 7, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#ffc9ae" position={[0, -6, 3]} rotation-x={Math.PI / 2} scale={[9, 5, 1]} />
      </Environment>
    </>
  )
}

export function BrainStage() {
  return (
    <Canvas
      className="stage-canvas"
      dpr={[1, 2]}
      camera={{ fov: 26, position: [0, 0, 11], near: 0.5, far: 60 }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
    >
      <color attach="background" args={['#06070a']} />
      <Lighting />
      <Suspense fallback={null}>
        <BrainModel />
      </Suspense>
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.75} luminanceThreshold={0.95} luminanceSmoothing={0.3} radius={0.72} />
        <Vignette offset={0.32} darkness={0.66} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Noise premultiply opacity={0.12} blendFunction={BlendFunction.SOFT_LIGHT} />
      </EffectComposer>
    </Canvas>
  )
}
