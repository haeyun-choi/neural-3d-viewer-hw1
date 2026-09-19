// Read-only browser-test observations. Installed only in the Vite development
// server when explicitly enabled; production builds remove the guarded code.
export interface ViewerSnapshot {
  camera: number[];
  target: number[];
  cameraUp: number[];
  controlsEnabled: boolean;
  highlights: { key: string; count: number; indices: number[]; color: string }[];
  colors: number[];
  fingerprint: string;
  manual: boolean;
  displayedPoints: number;
  indexCount: number;
  sourceIndexCount: number;
  faceCount: number;
  geometries: number;
  textures: number;
  programs: number;
  vertexColors: boolean;
  fallbackColor: string;
  markers: { id?: string; selected: boolean; color: string; position: number[] }[];
  projected: { x: number; y: number }[];
}

declare global {
  interface Window { __NEURAL3D__?: () => ViewerSnapshot }
}
