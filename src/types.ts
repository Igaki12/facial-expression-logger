import type { Category, Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";

export type ThemeKey = "hobby" | "stress";

export interface ThemeOption {
  key: ThemeKey;
  label: string;
  prompt: string;
  description: string;
}

export interface SessionRecord {
  id: string;
  themeKey: ThemeKey;
  themeLabel: string;
  startedAt: string;
  endedAt: string | null;
  frameCount: number;
  status: "recording" | "completed";
}

export interface FrameRecord {
  sessionId: string;
  frameIndex: number;
  timestampMs: number;
  elapsedMs: number;
  hasFace: boolean;
  faceLandmarks: NormalizedLandmark[][];
  faceBlendshapes: Category[][];
  facialTransformationMatrixes: Matrix[];
}

export interface SessionExport {
  session: SessionRecord;
  frames: FrameRecord[];
}
