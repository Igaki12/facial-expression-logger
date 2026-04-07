import type { Category, Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";

export type ThemeKey = "hobby" | "stress";

export type FlowMode = "guided" | "retake";

export interface ThemeContent {
  key: ThemeKey;
  label: string;
  shortLabel: string;
  introTitle: string;
  introLead: string;
  recordingTitle: string;
  recordingLead: string;
  rotatingPrompts: string[];
  examplePills: string[];
  supportiveHint: string;
  promptSetVersion: string;
}

export interface ExperimentRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: "recording" | "completed" | "aborted";
  flowMode: FlowMode;
  phaseOrder: ThemeKey[];
  completedPhases: ThemeKey[];
  sourceExperimentId?: string;
  retakeOfPhase?: ThemeKey;
}

export interface PhaseRecord {
  experimentId: string;
  phaseKey: ThemeKey;
  label: string;
  startedAt: string;
  endedAt: string | null;
  frameCount: number;
  promptSetVersion: string;
  sourceWidth: number;
  sourceHeight: number;
}

export interface FrameRecord {
  experimentId: string;
  phaseKey: ThemeKey;
  frameIndex: number;
  timestampMs: number;
  elapsedMs: number;
  hasFace: boolean;
  faceLandmarks: NormalizedLandmark[][];
  faceBlendshapes: Category[][];
  facialTransformationMatrixes: Matrix[];
}

export interface ExperimentExport {
  experiment: ExperimentRecord;
  phases: PhaseRecord[];
  frames: FrameRecord[];
}
