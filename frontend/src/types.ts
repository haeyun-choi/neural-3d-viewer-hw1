export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface SceneMetadata {
  id: string;
  name: string;
  description: string;
  format: string;
  point_count: number;
  asset: string;
  size_bytes: number;
  sha256: string;
  coordinates: string;
  filename?: string;
  source?: "bundled" | "local";
  face_count?: number;
  color_source?: "vertex" | "fallback";
}

export interface PointCloudData {
  positions: Float32Array;
  colors?: Float32Array;
  sha256: string;
  format: string;
  face_count: number;
  color_source: "vertex" | "fallback";
  sourceIndexCount: number;
  bounds: { min: Position; max: Position };
}

export interface LoadedScene {
  metadata: SceneMetadata;
  cloud: PointCloudData;
}

export interface AnnotationInput extends Position {
  kind?: "point" | "region";
  region?: RegionData | null;
  category: string;
  label: string;
  note: string;
}

export interface Annotation extends AnnotationInput {
  id: string;
  scene_id: string;
  created_at: string;
  updated_at: string;
}

export type ViewerStatus =
  | { state: "loading"; message: string }
  | { state: "ready"; count: number }
  | { state: "empty" | "error"; message: string };

// Renderer boundary: scene coordinates and plain data, with no storage knowledge.
export interface ViewerHandle {
  prepare: (cloud: PointCloudData) => void;
  prepareHighlights: (highlights: Highlight[]) => void;
  reset: () => void;
  focus: (position: Position) => void;
  focusRegion: (bounds: NonNullable<RegionSelection["bounds"]>) => void;
  roll: (degrees: number) => void;
  setUp: (axis: "X" | "Y" | "Z" | "invert") => void;
  captureView: (home: boolean) => ViewPreferences;
  preset: (preset: ViewPreset) => void;
  restoreImported: () => void;
}

export type Vector3Tuple = [number, number, number];
export interface CameraPose { position: Vector3Tuple; target: Vector3Tuple; up: Vector3Tuple; aspect: number; near: number; far: number }
export interface ViewPreferences { version: 1; up: Vector3Tuple; front: Vector3Tuple; home: CameraPose | null }
export type ViewPreset = "Front" | "Back" | "Left" | "Right" | "Top" | "Bottom";
export type InteractionMode = "navigate" | "point" | "rectangle" | "lasso";
export type SelectionOperationMode = "replace" | "add" | "subtract";
export interface SelectionOperation {
  mode: SelectionOperationMode;
  shape: "rectangle" | "lasso";
  polygon: [number, number][];
  matrix: number[]; // column-major original-local to clip; original buffers stay immutable
}
export interface RegionData {
  version: 1;
  semantics: "through";
  vertex_count: number;
  selected_count: number;
  operations: SelectionOperation[];
}
export interface RegionSelection {
  indices: Uint32Array;
  bounds: { min: Position; max: Position } | null;
}
export interface Highlight { key: string; color: string; indices: Uint32Array }
