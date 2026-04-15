import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DrawingUtils,
  FaceLandmarker,
  type Classifications,
} from "@mediapipe/tasks-vision";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FLUSH_BATCH_SIZE,
  PHASE_CONTENT,
  PHASE_ORDER,
  RESEARCH_DEBRIEF,
} from "./constants";
import { HistoryScreen } from "./components/HistoryScreen";
import { useFaceLandmarker } from "./hooks/useFaceLandmarker";
import { useUserMedia } from "./hooks/useUserMedia";
import { downloadAudioClip, downloadExperimentExport } from "./lib/export";
import {
  appendFrames,
  completeExperiment,
  completePhase,
  createExperiment,
  createPhase,
  deleteAudioClip,
  deleteExperiment,
  getAudioClip,
  getAudioClipsForExperiment,
  getExperimentExport,
  listExperiments,
  saveAudioClip,
  updateExperimentCompletedPhases,
} from "./lib/storage";
import type {
  AudioClipRecord,
  ExperimentExport,
  ExperimentRecord,
  FlowMode,
  FrameRecord,
  PhaseRecord,
  ThemeKey,
  TopicChangeRecord,
} from "./types";

type Screen =
  | "intro"
  | "camera_check"
  | "phase_guide"
  | "phase_recording"
  | "work_transition"
  | "completion"
  | "debrief"
  | "history";

const SCENE_ICON_URLS = {
  work_transition:
    "https://api.iconify.design/material-symbols/engineering-outline-rounded.svg?color=%23f7d8ac",
  completion:
    "https://api.iconify.design/material-symbols/check-circle-outline-rounded.svg?color=%23f7d8ac",
  debrief:
    "https://api.iconify.design/material-symbols/lightbulb-outline.svg?color=%23f7d8ac",
} as const;

const ACTION_ICON_URLS = {
  camera: "https://api.iconify.design/material-symbols/video-camera-front-outline-rounded.svg?color=%23221717",
  next: "https://api.iconify.design/material-symbols/arrow-forward-rounded.svg?color=%23221717",
  nextLight: "https://api.iconify.design/material-symbols/arrow-forward-rounded.svg?color=%23f7d8ac",
  preview: "https://api.iconify.design/material-symbols/visibility-outline-rounded.svg?color=%23f7d8ac",
  download: "https://api.iconify.design/material-symbols/download-rounded.svg?color=%23f7d8ac",
  delete: "https://api.iconify.design/material-symbols/delete-outline-rounded.svg?color=%23ffe6de",
  audio: "https://api.iconify.design/material-symbols/graphic-eq-rounded.svg?color=%23f7d8ac",
} as const;

interface FlowState {
  mode: FlowMode;
  experimentId: string | null;
  startedAt: string | null;
  phaseOrder: ThemeKey[];
  currentPhaseIndex: number;
  completedPhases: ThemeKey[];
  sourceExperimentId?: string;
  retakeOfPhase?: ThemeKey;
}

interface ActiveRecordingState {
  experimentId: string;
  frameCount: number;
  phaseKey: ThemeKey;
  promptSetVersion: string;
  promptIndex: number;
  startedAt: string;
  startedAtMs: number;
  audioMimeType: string | null;
  topicChanges: TopicChangeRecord[];
}

interface SelectedAudioState {
  audioClip: AudioClipRecord;
  audioUrl: string;
}

function classificationsToCategories(
  classifications: Classifications[] | undefined,
) {
  return classifications?.map((item) => item.categories) ?? [];
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "進行中";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function uniqThemeKeys(values: ThemeKey[]): ThemeKey[] {
  return [...new Set(values)];
}

function describeExperiment(experiment: ExperimentRecord): string {
  if (experiment.flowMode === "retake" && experiment.retakeOfPhase) {
    return `${PHASE_CONTENT[experiment.retakeOfPhase].label}の撮り直し`;
  }

  return "通常フロー";
}

function getPromptIndex(themeKey: ThemeKey, index: number): number {
  const promptCount = PHASE_CONTENT[themeKey].rotatingPrompts.length;
  if (promptCount === 0) {
    return 0;
  }
  return ((index % promptCount) + promptCount) % promptCount;
}

function getPromptText(themeKey: ThemeKey, index: number): string {
  const prompts = PHASE_CONTENT[themeKey].rotatingPrompts;
  if (prompts.length === 0) {
    return "";
  }
  return prompts[getPromptIndex(themeKey, index)] ?? "";
}

function resolvePreviewPromptText(
  phase: PhaseRecord | null,
  frame: FrameRecord | null,
): string | null {
  if (frame?.promptText) {
    return frame.promptText;
  }

  if (!phase || !frame || !phase.topicChanges?.length) {
    return null;
  }

  const sortedTopicChanges = [...phase.topicChanges].sort(
    (left, right) => left.elapsedMs - right.elapsedMs,
  );
  const currentTopics = sortedTopicChanges.filter(
    (topicChange) => topicChange.elapsedMs <= frame.elapsedMs,
  );
  const currentTopic =
    currentTopics[currentTopics.length - 1] ?? sortedTopicChanges[0];

  return currentTopic?.promptText ?? null;
}

function getSupportedAudioMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function ActionIcon({ src }: { src: string }) {
  return <img src={src} alt="" className="action-icon" aria-hidden="true" />;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const pendingFramesRef = useRef<FrameRecord[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const flushPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const flowRef = useRef<FlowState | null>(null);
  const activeRecordingRef = useRef<ActiveRecordingState | null>(null);
  const phaseStartPendingRef = useRef(false);
  const phaseStopPendingRef = useRef(false);
  const [screen, setScreen] = useState<Screen>("intro");
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [historyReturnScreen, setHistoryReturnScreen] = useState<Screen>("intro");
  const [lastCompletedExperimentId, setLastCompletedExperimentId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [faceVisible, setFaceVisible] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [previewExport, setPreviewExport] = useState<ExperimentExport | null>(null);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 });
  const [historyAudioClips, setHistoryAudioClips] = useState<Record<string, AudioClipRecord[]>>({});
  const [selectedAudio, setSelectedAudio] = useState<SelectedAudioState | null>(null);

  const { stream, status: cameraStatus, error: cameraError, startCamera } = useUserMedia();
  const {
    faceLandmarker,
    status: landmarkerStatus,
    error: landmarkerError,
    initialize,
  } = useFaceLandmarker();

  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  useEffect(() => {
    if (location.pathname === "/history") {
      if (screen !== "history") {
        setScreen("history");
      }
      return;
    }

    if (screen === "history") {
      setScreen(historyReturnScreen === "history" ? "intro" : historyReturnScreen);
    }
  }, [historyReturnScreen, location.pathname, screen]);

  const currentPhaseKey = flow ? flow.phaseOrder[flow.currentPhaseIndex] ?? null : null;
  const currentTheme = currentPhaseKey ? PHASE_CONTENT[currentPhaseKey] : null;
  const rotatingPrompt = currentPhaseKey ? getPromptText(currentPhaseKey, guideIndex) : "";

  const refreshExperiments = useCallback(async () => {
    try {
      const nextExperiments = await listExperiments();
      setExperiments(nextExperiments);
      const latestCompleted = nextExperiments.find((experiment) => experiment.status === "completed");
      setLastCompletedExperimentId(latestCompleted?.id ?? null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "保存済みデータの読み込みに失敗しました。";
      setStorageError(message);
    }
  }, []);

  useEffect(() => {
    void refreshExperiments();
  }, [refreshExperiments]);

  useEffect(() => {
    let cancelled = false;

    const loadAudioClips = async () => {
      if (experiments.length === 0) {
        setHistoryAudioClips({});
        return;
      }

      try {
        const entries = await Promise.all(
          experiments.map(async (experiment) => [
            experiment.id,
            await getAudioClipsForExperiment(experiment.id),
          ] as const),
        );

        if (!cancelled) {
          setHistoryAudioClips(Object.fromEntries(entries));
        }
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "音声データの読み込みに失敗しました。";
        if (!cancelled) {
          setStorageError(message);
        }
      }
    };

    void loadAudioClips();

    return () => {
      cancelled = true;
    };
  }, [experiments]);

  useEffect(() => {
    return () => {
      if (selectedAudio?.audioUrl) {
        URL.revokeObjectURL(selectedAudio.audioUrl);
      }
    };
  }, [selectedAudio]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      return;
    }

    video.srcObject = stream;
    void video.play().catch(() => {
      setStorageError("カメラ映像の再生開始に失敗しました。");
    });
  }, [screen, stream]);

  useEffect(() => {
    lastVideoTimeRef.current = -1;
    setFaceVisible(false);
  }, [stream]);

  useEffect(() => {
    setGuideIndex(0);
  }, [screen, currentPhaseKey]);

  useEffect(() => {
    if (!previewExport || !isPreviewPlaying) {
      return;
    }

    if (previewExport.frames.length <= 1) {
      setIsPreviewPlaying(false);
      return;
    }

    const timer = window.setInterval(() => {
      setPreviewFrameIndex((current) => {
        if (current >= previewExport.frames.length - 1) {
          setIsPreviewPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 90);

    return () => {
      window.clearInterval(timer);
    };
  }, [isPreviewPlaying, previewExport]);

  const previewPhaseRecord = useMemo(() => {
    if (!previewExport) {
      return null;
    }

    const frame = previewExport.frames[previewFrameIndex];
    if (!frame) {
      return previewExport.phases[0] ?? null;
    }

    return (
      previewExport.phases.find((phase) => phase.phaseKey === frame.phaseKey) ??
      previewExport.phases[0] ??
      null
    );
  }, [previewExport, previewFrameIndex]);

  const previewAspectRatio = useMemo(() => {
    if (!previewPhaseRecord?.sourceWidth || !previewPhaseRecord?.sourceHeight) {
      return 4 / 3;
    }

    return previewPhaseRecord.sourceWidth / previewPhaseRecord.sourceHeight;
  }, [previewPhaseRecord]);

  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage) {
      return;
    }

    const syncSize = () => {
      const rect = stage.getBoundingClientRect();
      setPreviewStageSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    syncSize();

    const observer = new ResizeObserver(() => {
      syncSize();
    });
    observer.observe(stage);

    return () => {
      observer.disconnect();
    };
  }, [previewAspectRatio, previewExport]);

  useEffect(() => {
    const stage = previewStageRef.current;
    const canvas = previewCanvasRef.current;
    if (!stage || !canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const targetWidth = previewStageSize.width || 720;
    const targetHeight = previewStageSize.height || Math.round(targetWidth / previewAspectRatio);
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(targetWidth * pixelRatio));
    const height = Math.max(1, Math.round(targetHeight * pixelRatio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#04080b";
    context.fillRect(0, 0, width, height);

    if (!previewExport) {
      context.fillStyle = "#d4c8b6";
      context.font = "16px sans-serif";
      context.fillText("プレビューを選ぶと、保存済みの顔メッシュをここで確認できます。", 24, 44);
      return;
    }

    const frame = previewExport.frames[previewFrameIndex];
    if (!frame) {
      return;
    }

    if (!frame.hasFace || frame.faceLandmarks.length === 0) {
      context.fillStyle = "#d4c8b6";
      context.font = "18px sans-serif";
      context.fillText("このフレームでは顔が検出されていません。", 24, 44);
      return;
    }

    const drawingUtils = new DrawingUtils(context);
    for (const landmarks of frame.faceLandmarks) {
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        { color: "#52efb8", lineWidth: 1 },
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
        { color: "#f4eee1", lineWidth: 1.2 },
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
        { color: "#f4eee1", lineWidth: 1.2 },
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
        { color: "#f4eee1", lineWidth: 1.2 },
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LIPS,
        { color: "#c9ffea", lineWidth: 1.2 },
      );
    }
  }, [previewAspectRatio, previewExport, previewFrameIndex, previewStageSize]);

  const flushBufferedFrames = useCallback(
    (force = false) => {
      if (pendingFramesRef.current.length === 0) {
        return flushPromiseRef.current;
      }

      if (!force && pendingFramesRef.current.length < FLUSH_BATCH_SIZE) {
        return flushPromiseRef.current;
      }

      const framesToPersist = pendingFramesRef.current.splice(
        0,
        pendingFramesRef.current.length,
      );

      flushPromiseRef.current = flushPromiseRef.current.then(async () => {
        try {
          await appendFrames(framesToPersist);
        } catch (caughtError) {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : "フレーム保存に失敗しました。";
          setStorageError(message);
        }
      });

      return flushPromiseRef.current;
    },
    [],
  );

  const startAudioRecording = useCallback(() => {
    audioChunksRef.current = [];

    if (typeof MediaRecorder === "undefined") {
      setAudioError("このブラウザでは録音を開始できません。");
      return null;
    }

    const audioTracks = stream?.getAudioTracks() ?? [];
    if (audioTracks.length === 0) {
      setAudioError("マイクが使えません。権限を確認してください。");
      return null;
    }

    try {
      const audioMimeType = getSupportedAudioMimeType();
      const audioStream = new MediaStream(audioTracks);
      const mediaRecorder = new MediaRecorder(
        audioStream,
        audioMimeType ? { mimeType: audioMimeType } : undefined,
      );

      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });
      mediaRecorder.addEventListener("error", () => {
        setAudioError("録音が途中で止まりました。");
        setIsAudioRecording(false);
      });
      mediaRecorder.addEventListener("start", () => {
        setAudioError(null);
        setIsAudioRecording(true);
      });

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      return mediaRecorder.mimeType || audioMimeType || "audio/webm";
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "録音の開始に失敗しました。";
      setAudioError(message);
      setIsAudioRecording(false);
      return null;
    }
  }, [stream]);

  const stopAudioRecording = useCallback((fallbackMimeType: string | null) => {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder) {
      setIsAudioRecording(false);
      return Promise.resolve(null);
    }

    return new Promise<{ audioBlob: Blob; mimeType: string } | null>((resolve) => {
      const finalize = () => {
        const mimeType = mediaRecorder.mimeType || fallbackMimeType || "audio/webm";
        const audioChunks = audioChunksRef.current.splice(0, audioChunksRef.current.length);
        mediaRecorderRef.current = null;
        setIsAudioRecording(false);

        if (audioChunks.length === 0) {
          resolve(null);
          return;
        }

        resolve({
          audioBlob: new Blob(audioChunks, { type: mimeType }),
          mimeType,
        });
      };

      if (mediaRecorder.state === "inactive") {
        finalize();
        return;
      }

      mediaRecorder.addEventListener("stop", finalize, { once: true });
      try {
        mediaRecorder.requestData();
        mediaRecorder.stop();
      } catch {
        finalize();
      }
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !faceLandmarker || !stream) {
      return;
    }

    let cancelled = false;

    const renderFrame = () => {
      if (cancelled) {
        return;
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          const results = faceLandmarker.detectForVideo(video, performance.now());
          const hasFace = results.faceLandmarks.length > 0;
          setFaceVisible((current) => (current === hasFace ? current : hasFace));

          const activeRecording = activeRecordingRef.current;
          if (activeRecording) {
            const timestampMs = Date.now();
            const promptText = getPromptText(activeRecording.phaseKey, activeRecording.promptIndex);
            const frameRecord: FrameRecord = {
              experimentId: activeRecording.experimentId,
              phaseKey: activeRecording.phaseKey,
              frameIndex: activeRecording.frameCount,
              timestampMs,
              elapsedMs: timestampMs - activeRecording.startedAtMs,
              hasFace,
              promptIndex: activeRecording.promptIndex,
              promptText,
              faceLandmarks: results.faceLandmarks,
              faceBlendshapes: classificationsToCategories(results.faceBlendshapes),
              facialTransformationMatrixes: results.facialTransformationMatrixes ?? [],
            };

            activeRecording.frameCount += 1;
            pendingFramesRef.current.push(frameRecord);
            void flushBufferedFrames(false);
          }

          lastVideoTimeRef.current = video.currentTime;
        }
      }

      animationFrameRef.current = window.requestAnimationFrame(renderFrame);
    };

    animationFrameRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [faceLandmarker, flushBufferedFrames, screen, stream]);

  const beginFlow = useCallback(
    (mode: FlowMode, phaseOrder: ThemeKey[], options?: { sourceExperimentId?: string; retakeOfPhase?: ThemeKey }) => {
      setStorageError(null);
      setAudioError(null);
      setDownloadError(null);
      setFlow({
        mode,
        experimentId: null,
        startedAt: null,
        phaseOrder,
        currentPhaseIndex: 0,
        completedPhases: [],
        sourceExperimentId: options?.sourceExperimentId,
        retakeOfPhase: options?.retakeOfPhase,
      });
      setScreen("camera_check");
    },
    [],
  );

  const handleStartGuidedFlow = useCallback(() => {
    beginFlow("guided", PHASE_ORDER);
  }, [beginFlow]);

  const handleStartRetakeFlow = useCallback(
    (phaseKey: ThemeKey) => {
      beginFlow("retake", [phaseKey], {
        sourceExperimentId: lastCompletedExperimentId ?? undefined,
        retakeOfPhase: phaseKey,
      });
    },
    [beginFlow, lastCompletedExperimentId],
  );

  const handlePrepareCamera = useCallback(async () => {
    setStorageError(null);
    setAudioError(null);

    try {
      await initialize();
      await startCamera();
    } catch {
      // Hook state surfaces the error text.
    }
  }, [initialize, startCamera]);

  const handleContinueFromCamera = useCallback(() => {
    if (cameraStatus !== "ready" || landmarkerStatus !== "ready") {
      setStorageError("カメラの準備が整ってから次へ進んでください。");
      return;
    }

    setScreen("phase_guide");
  }, [cameraStatus, landmarkerStatus]);

  const ensurePhaseRecordingStarted = useCallback(async () => {
    const currentFlow = flowRef.current;
    if (
      !currentFlow ||
      !currentPhaseKey ||
      !faceLandmarker ||
      !stream ||
      phaseStartPendingRef.current ||
      activeRecordingRef.current
    ) {
      return;
    }

    phaseStartPendingRef.current = true;
    setIsBusy(true);
    setStorageError(null);

    try {
      const theme = PHASE_CONTENT[currentPhaseKey];
      const initialPromptIndex = 0;
      const initialPromptText = getPromptText(currentPhaseKey, initialPromptIndex);
      let experimentId = currentFlow.experimentId;
      let startedAt = currentFlow.startedAt;

      if (!experimentId || !startedAt) {
        const experiment: ExperimentRecord = {
          id: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          endedAt: null,
          status: "recording",
          flowMode: currentFlow.mode,
          phaseOrder: currentFlow.phaseOrder,
          completedPhases: currentFlow.completedPhases,
          sourceExperimentId: currentFlow.sourceExperimentId,
          retakeOfPhase: currentFlow.retakeOfPhase,
        };
        await createExperiment(experiment);
        experimentId = experiment.id;
        startedAt = experiment.startedAt;
        setFlow((previous) =>
          previous
            ? {
                ...previous,
                experimentId,
                startedAt,
              }
            : previous,
        );
      }

      const phase: PhaseRecord = {
        experimentId,
        phaseKey: currentPhaseKey,
        label: theme.label,
        startedAt: new Date().toISOString(),
        endedAt: null,
        frameCount: 0,
        promptSetVersion: theme.promptSetVersion,
        sourceWidth: videoRef.current?.videoWidth || 720,
        sourceHeight: videoRef.current?.videoHeight || 540,
        topicChanges: [
          {
            promptIndex: initialPromptIndex,
            promptText: initialPromptText,
            elapsedMs: 0,
            timestampMs: Date.now(),
          },
        ],
      };

      await createPhase(phase);
      pendingFramesRef.current = [];
      flushPromiseRef.current = Promise.resolve();
      const audioMimeType = startAudioRecording();
      activeRecordingRef.current = {
        experimentId,
        frameCount: 0,
        phaseKey: currentPhaseKey,
        promptSetVersion: theme.promptSetVersion,
        promptIndex: initialPromptIndex,
        startedAt: phase.startedAt,
        startedAtMs: Date.now(),
        audioMimeType,
        topicChanges: phase.topicChanges ?? [],
      };
      setIsRecording(true);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "フェーズ開始に失敗しました。";
      setStorageError(message);
    } finally {
      phaseStartPendingRef.current = false;
      setIsBusy(false);
    }
  }, [currentPhaseKey, faceLandmarker, startAudioRecording, stream]);

  useEffect(() => {
    if (screen !== "phase_recording") {
      return;
    }

    void ensurePhaseRecordingStarted();
  }, [ensurePhaseRecordingStarted, screen]);

  const handleAdvancePrompt = useCallback(() => {
    if (screen !== "phase_recording" || !currentPhaseKey) {
      return;
    }

    const activeRecording = activeRecordingRef.current;
    const basePromptIndex =
      activeRecording?.phaseKey === currentPhaseKey
        ? activeRecording.promptIndex
        : guideIndex;
    const nextPromptIndex = getPromptIndex(currentPhaseKey, basePromptIndex + 1);
    const nextPromptText = getPromptText(currentPhaseKey, nextPromptIndex);

    setGuideIndex(nextPromptIndex);

    if (!activeRecording || activeRecording.phaseKey !== currentPhaseKey) {
      return;
    }

    const timestampMs = Date.now();
    activeRecording.promptIndex = nextPromptIndex;
    activeRecording.topicChanges = [
      ...activeRecording.topicChanges,
      {
        promptIndex: nextPromptIndex,
        promptText: nextPromptText,
        elapsedMs: timestampMs - activeRecording.startedAtMs,
        timestampMs,
      },
    ];
  }, [currentPhaseKey, guideIndex, screen]);

  const finishCurrentPhase = useCallback(async () => {
    const currentFlow = flowRef.current;
    const activeRecording = activeRecordingRef.current;
    if (!currentFlow || !activeRecording || phaseStopPendingRef.current) {
      return;
    }

    phaseStopPendingRef.current = true;
    setIsBusy(true);
    setStorageError(null);

    try {
      const phaseEndedAt = new Date().toISOString();
      activeRecordingRef.current = null;
      setIsRecording(false);
      const recordedAudio = await stopAudioRecording(activeRecording.audioMimeType);

      if (recordedAudio && recordedAudio.audioBlob.size > 0) {
        await saveAudioClip({
          experimentId: activeRecording.experimentId,
          phaseKey: activeRecording.phaseKey,
          label: PHASE_CONTENT[activeRecording.phaseKey].label,
          startedAt: activeRecording.startedAt,
          endedAt: phaseEndedAt,
          mimeType: recordedAudio.mimeType,
          sizeBytes: recordedAudio.audioBlob.size,
          audioBlob: recordedAudio.audioBlob,
        });
      }

      await flushBufferedFrames(true);
      await flushPromiseRef.current;
      await completePhase(
        activeRecording.experimentId,
        activeRecording.phaseKey,
        phaseEndedAt,
        activeRecording.frameCount,
        activeRecording.topicChanges,
      );

      const completedPhases = uniqThemeKeys([
        ...currentFlow.completedPhases,
        activeRecording.phaseKey,
      ]);

      await updateExperimentCompletedPhases(activeRecording.experimentId, completedPhases);

      const isLastPhase = currentFlow.currentPhaseIndex >= currentFlow.phaseOrder.length - 1;
      if (isLastPhase) {
        await completeExperiment(
          activeRecording.experimentId,
          new Date().toISOString(),
          completedPhases,
          "completed",
        );
        setFlow((previous) =>
          previous
            ? {
                ...previous,
                experimentId: activeRecording.experimentId,
                completedPhases,
              }
            : previous,
        );
        setLastCompletedExperimentId(activeRecording.experimentId);
        await refreshExperiments();
        setScreen("completion");
        return;
      }

      setFlow((previous) =>
        previous
          ? {
              ...previous,
              experimentId: activeRecording.experimentId,
              completedPhases,
              currentPhaseIndex: previous.currentPhaseIndex + 1,
            }
          : previous,
      );
      setScreen("work_transition");
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "フェーズ終了処理に失敗しました。";
      setStorageError(message);
    } finally {
      pendingFramesRef.current = [];
      phaseStopPendingRef.current = false;
      setIsBusy(false);
    }
  }, [flushBufferedFrames, refreshExperiments, stopAudioRecording]);

  const handleDownloadExperiment = useCallback(async (experimentId: string) => {
    setDownloadError(null);

    try {
      const experimentExport = await getExperimentExport(experimentId);
      downloadExperimentExport(experimentExport);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "JSON ダウンロードに失敗しました。";
      setDownloadError(message);
    }
  }, []);

  const handlePreviewAudio = useCallback(
    async (experiment: ExperimentRecord, phaseKey: ThemeKey) => {
      setPreviewError(null);

      try {
        const audioClip = await getAudioClip(experiment.id, phaseKey);
        if (!audioClip) {
          setPreviewError("この音声は見つかりませんでした。");
          return;
        }

        setSelectedAudio({
          audioClip,
          audioUrl: URL.createObjectURL(audioClip.audioBlob),
        });
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "音声の確認に失敗しました。";
        setPreviewError(message);
      }
    },
    [],
  );

  const handleDownloadAudio = useCallback(
    async (experiment: ExperimentRecord, phaseKey: ThemeKey) => {
      setDownloadError(null);

      try {
        const audioClip = await getAudioClip(experiment.id, phaseKey);
        if (!audioClip) {
          setDownloadError("この音声は見つかりませんでした。");
          return;
        }

        downloadAudioClip(audioClip, experiment.startedAt);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "音声の出力に失敗しました。";
        setDownloadError(message);
      }
    },
    [],
  );

  const handleDeleteAudio = useCallback(
    async (experimentId: string, phaseKey: ThemeKey) => {
      if (!window.confirm("この音声だけを削除しますか？")) {
        return;
      }

      setStorageError(null);
      setIsBusy(true);

      try {
        await deleteAudioClip(experimentId, phaseKey);
        setHistoryAudioClips((current) => ({
          ...current,
          [experimentId]: (current[experimentId] ?? []).filter(
            (audioClip) => audioClip.phaseKey !== phaseKey,
          ),
        }));
        setSelectedAudio((current) =>
          current?.audioClip.experimentId === experimentId &&
          current.audioClip.phaseKey === phaseKey
            ? null
            : current,
        );
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "音声の削除に失敗しました。";
        setStorageError(message);
      } finally {
        setIsBusy(false);
      }
    },
    [],
  );

  const handleDeleteExperiment = useCallback(
    async (experimentId: string) => {
      if (!window.confirm("この実験データを削除しますか？")) {
        return;
      }

      setStorageError(null);
      setIsBusy(true);

      try {
        await deleteExperiment(experimentId);
        if (previewExport?.experiment.id === experimentId) {
          setPreviewExport(null);
          setIsPreviewPlaying(false);
          setPreviewTargetId(null);
        }
        setHistoryAudioClips((current) => {
          const next = { ...current };
          delete next[experimentId];
          return next;
        });
        setSelectedAudio((current) =>
          current?.audioClip.experimentId === experimentId ? null : current,
        );
        await refreshExperiments();
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "実験データの削除に失敗しました。";
        setStorageError(message);
      } finally {
        setIsBusy(false);
      }
    },
    [previewExport, refreshExperiments],
  );

  const handlePreviewExperiment = useCallback(async (experimentId: string) => {
    setPreviewError(null);
    setDownloadError(null);
    setIsPreviewLoading(true);
    setPreviewTargetId(experimentId);

    try {
      const experimentExport = await getExperimentExport(experimentId);
      setPreviewExport(experimentExport);
      setPreviewFrameIndex(0);
      setIsPreviewPlaying(false);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "プレビューの読み込みに失敗しました。";
      setPreviewError(message);
    } finally {
      setIsPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screen !== "history" || previewExport || isPreviewLoading) {
      return;
    }

    const latestCompletedExperiment = experiments.find(
      (experiment) => experiment.status === "completed",
    );

    if (!latestCompletedExperiment) {
      return;
    }

    void handlePreviewExperiment(latestCompletedExperiment.id);
  }, [experiments, handlePreviewExperiment, isPreviewLoading, previewExport, screen]);

  const openHistory = useCallback((returnScreen: Screen) => {
    if (returnScreen !== "history") {
      setHistoryReturnScreen(returnScreen);
    }
    setSelectedAudio(null);
    setPreviewExport(null);
    setPreviewTargetId(null);
    setPreviewFrameIndex(0);
    setIsPreviewPlaying(false);
    navigate("/history");
  }, [navigate]);

  const returnFromHistory = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const progressItems = useMemo(
    () => [
      { label: "準備", active: screen === "intro" || screen === "camera_check" },
      {
        label: "1",
        active:
          currentPhaseKey === "hobby" &&
          (screen === "phase_guide" || screen === "phase_recording" || screen === "work_transition"),
      },
      {
        label: "2",
        active:
          currentPhaseKey === "stress" &&
          (screen === "phase_guide" || screen === "phase_recording" || screen === "completion" || screen === "debrief"),
      },
      { label: "完了", active: screen === "completion" || screen === "debrief" || screen === "history" },
    ],
    [currentPhaseKey, screen],
  );

  const phaseActionLabel = useMemo(() => {
    if (!flow || !currentPhaseKey) {
      return "完了";
    }

    if (flow.mode === "retake") {
      return `${PHASE_CONTENT[currentPhaseKey].label}を完了`;
    }

    if (currentPhaseKey === "hobby") {
      return "仕事の話へ";
    }

    return "完了する";
  }, [currentPhaseKey, flow]);

  const handleHeaderNavigation = useCallback(() => {
    if (screen === "history") {
      returnFromHistory();
      return;
    }

    openHistory(screen);
  }, [openHistory, returnFromHistory, screen]);

  const condensedError =
    storageError ??
    audioError ??
    cameraError ??
    landmarkerError ??
    downloadError ??
    previewError;

  const previewFrame = previewExport?.frames[previewFrameIndex] ?? null;
  const previewPhaseLabel = previewFrame
    ? PHASE_CONTENT[previewFrame.phaseKey].label
    : null;
  const previewPromptText = resolvePreviewPromptText(previewPhaseRecord, previewFrame);
  const previewPromptStepLabel =
    previewFrame?.promptIndex !== undefined && previewFrame.phaseKey
      ? `${getPromptIndex(previewFrame.phaseKey, previewFrame.promptIndex) + 1} / ${PHASE_CONTENT[previewFrame.phaseKey].rotatingPrompts.length}`
      : null;
  const previewHasFaceLabel = previewFrame
    ? (previewFrame.hasFace ? "あり" : "なし")
    : "未選択";
  const selectedAudioPhaseLabel = selectedAudio
    ? PHASE_CONTENT[selectedAudio.audioClip.phaseKey].label
    : null;
  const floatingPromptLabel = screen === "phase_recording" ? "今の話題" : "話し始めるきっかけ";
  const showFloatingPrompt =
    (screen === "phase_guide" || screen === "phase_recording") &&
    Boolean(currentTheme);

  return (
    <main className={`story-shell${showFloatingPrompt ? " has-floating-prompt" : ""}`}>
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <section className={`story-panel${screen === "history" ? " is-history" : ""}`}>
        <header className="story-header">
          <div>
            <p className="eyebrow">Guided Session</p>
            <h1>案内に沿って、短い会話を進めてください</h1>
          </div>
          <button
            type="button"
            className="header-nav-button"
            onClick={handleHeaderNavigation}
          >
            <span>{screen === "history" ? "最初のページへ" : "データ履歴"}</span>
            <ActionIcon src={ACTION_ICON_URLS.nextLight} />
          </button>
        </header>

        <div className="progress-strip" aria-label="進行状況">
          {progressItems.map((item) => (
            <span
              key={item.label}
              className={`progress-pill${item.active ? " is-active" : ""}`}
            >
              {item.label}
            </span>
          ))}
        </div>

        {condensedError ? (
          <div className="notice-banner" role="alert">
            {condensedError}
          </div>
        ) : null}

        {screen === "intro" ? (
          <section className="scene-card intro-scene">
            <p className="scene-kicker">はじめる前に</p>
            <h2>2 つの話題を、順番に話していきます。</h2>
            <p className="scene-copy">
              ヒントを見ながら、思いつくことをそのまま声にしてください。
            </p>
            <div className="intro-copy-cloud">
              <span>話しやすいことからで大丈夫</span>
              <span>うまくまとめなくて大丈夫</span>
              <span>途中で言い直しても大丈夫</span>
            </div>
            <div className="action-row">
              <button
                type="button"
                className="primary-action"
                onClick={handleStartGuidedFlow}
              >
                <ActionIcon src={ACTION_ICON_URLS.next} />
                実験を始める
              </button>
            </div>
          </section>
        ) : null}

        {screen === "camera_check" ? (
          <section className="scene-card">
            <p className="scene-kicker">準備</p>
            <h2>顔が見える位置に整えます。</h2>
            <p className="scene-copy">
              カメラとマイクを使います。声も一緒に記録します。
            </p>

            <div className="video-stage">
              <video ref={videoRef} className="camera-video" playsInline muted />
              <div className="stage-overlay">
                <p>{faceVisible ? "この位置でOKです。" : "顔が見える位置へ。"}</p>
              </div>
            </div>

            <div className="action-row stacked-on-mobile">
              <button
                type="button"
                className="primary-action"
                onClick={handlePrepareCamera}
                disabled={cameraStatus === "ready" || landmarkerStatus === "loading" || isBusy}
              >
                <ActionIcon src={ACTION_ICON_URLS.camera} />
                {cameraStatus === "ready" ? "準備OK" : "カメラとマイクを許可"}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={handleContinueFromCamera}
                disabled={cameraStatus !== "ready" || landmarkerStatus !== "ready" || isBusy}
              >
                <ActionIcon src={ACTION_ICON_URLS.nextLight} />
                次へ
              </button>
            </div>
          </section>
        ) : null}

        {screen === "phase_guide" && currentTheme ? (
          <section className="scene-card">
            <p className="scene-kicker">場面 {currentTheme.shortLabel}</p>
            <h2>{currentTheme.introTitle}</h2>
            <p className="scene-copy">{currentTheme.introLead}</p>

            <div className="video-stage">
              <video ref={videoRef} className="camera-video" playsInline muted />
              <div className="stage-overlay">
                <p>{faceVisible ? "この位置で話せます。" : "顔が入る位置へ。"}</p>
              </div>
            </div>

            <div className="action-row mobile-sticky-actions">
              <button
                type="button"
                className="primary-action"
                onClick={() => setScreen("phase_recording")}
                disabled={cameraStatus !== "ready" || landmarkerStatus !== "ready" || isBusy}
              >
                <ActionIcon src={ACTION_ICON_URLS.next} />
                話し始める
              </button>
            </div>
          </section>
        ) : null}

        {screen === "phase_recording" && currentTheme ? (
          <section className="scene-card">
            <p className="scene-kicker">進行中</p>
            <h2>{currentTheme.recordingTitle}</h2>
            <p className="scene-copy">{currentTheme.recordingLead}</p>

            <div className="video-stage large-stage">
              <video ref={videoRef} className="camera-video" playsInline muted />
              <div className="recording-badge-row video-status-row">
                <span className={`signal-badge recording-status${isRecording ? " is-live" : ""}`}>
                  {isRecording ? "録画中" : "録画準備中"}
                </span>
                <span className={`signal-badge recording-status${isAudioRecording ? " is-live" : ""}`}>
                  {isAudioRecording ? "録音中" : "録音準備中"}
                </span>
                <span className={`signal-badge${faceVisible ? " is-good" : ""}`}>
                  {faceVisible ? "顔OK" : "位置調整"}
                </span>
              </div>
              <div className="stage-overlay">
                <p>{faceVisible ? "そのまま話してください。" : "顔が見える位置へ。"}</p>
              </div>
            </div>

            <div className="action-row mobile-sticky-actions">
              <button
                type="button"
                className="primary-action"
                onClick={() => void finishCurrentPhase()}
                disabled={!isRecording || isBusy}
              >
                <ActionIcon src={ACTION_ICON_URLS.next} />
                {phaseActionLabel}
              </button>
            </div>
          </section>
        ) : null}

        {screen === "work_transition" ? (
          <section className="scene-card transition-scene">
            <p className="scene-kicker">切り替え</p>
            <div className="scene-icon" aria-hidden="true">
              <img
                src={SCENE_ICON_URLS.work_transition}
                alt=""
                className="scene-icon-image"
                loading="eager"
              />
            </div>
            <h2>ありがとうございます。つぎは仕事の話へ移ります。</h2>
            <p className="scene-copy">
              今度は、ふだんの仕事の流れや一日の過ごし方を思い浮かべながら進めてください。
            </p>
            <div className="prompt-card">
              <p className="prompt-label">次の話題の例</p>
              <strong>
                一日のスケジュール、最近よくあるやり取り、忙しい時間帯、印象に残った業務など。
              </strong>
            </div>
            <div className="action-row">
              <button
                type="button"
                className="primary-action"
                onClick={() => setScreen("phase_guide")}
              >
                次の案内へ
              </button>
            </div>
          </section>
        ) : null}

        {screen === "completion" ? (
          <section className="scene-card completion-scene">
            <p className="scene-kicker">完了</p>
            <div className="scene-icon" aria-hidden="true">
              <img
                src={SCENE_ICON_URLS.completion}
                alt=""
                className="scene-icon-image"
                loading="eager"
              />
            </div>
            <h2>ここまでで実験は完了です。ありがとうございました。</h2>
            <p className="scene-copy">
              最後に、この取り組みで何を見ていたかを短く説明します。
            </p>
            <div className="action-row stacked-on-mobile">
              <button
                type="button"
                className="primary-action"
                onClick={() => setScreen("debrief")}
              >
                最後の説明を見る
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => openHistory("completion")}
              >
                データを見る
              </button>
            </div>
          </section>
        ) : null}

        {screen === "debrief" ? (
          <section className="scene-card debrief-scene">
            <p className="scene-kicker">実験の説明</p>
            <div className="scene-icon" aria-hidden="true">
              <img
                src={SCENE_ICON_URLS.debrief}
                alt=""
                className="scene-icon-image"
                loading="eager"
              />
            </div>
            <h2>{RESEARCH_DEBRIEF.title}</h2>
            <p className="scene-copy">{RESEARCH_DEBRIEF.body}</p>
            <p className="support-copy">{RESEARCH_DEBRIEF.detail}</p>

            <div className="debrief-grid">
              <div className="debrief-item">
                <span>保存しているもの</span>
                <strong>表情の数値データ / 音声</strong>
              </div>
              <div className="debrief-item">
                <span>保存しないもの</span>
                <strong>映像ファイル / 静止画</strong>
              </div>
            </div>

            <div className="action-column">
              <button
                type="button"
                className="primary-action"
                onClick={() => openHistory("debrief")}
              >
                データを見る / ダウンロードする
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => handleStartRetakeFlow("hobby")}
              >
                趣味を撮り直す
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => handleStartRetakeFlow("stress")}
              >
                仕事を撮り直す
              </button>
              <button
                type="button"
                className="text-link align-left"
                onClick={() => setScreen("intro")}
              >
                最初の画面に戻る
              </button>
            </div>
          </section>
        ) : null}

        {screen === "history" ? (
          <HistoryScreen
            experiments={experiments}
            historyAudioClips={historyAudioClips}
            isBusy={isBusy}
            isPreviewLoading={isPreviewLoading}
            previewTargetId={previewTargetId}
            previewExport={previewExport}
            previewAspectRatio={previewAspectRatio}
            previewStageRef={previewStageRef}
            previewCanvasRef={previewCanvasRef}
            previewPhaseLabel={previewPhaseLabel}
            previewPromptText={previewPromptText}
            previewPromptStepLabel={previewPromptStepLabel}
            previewFrameIndex={previewFrameIndex}
            previewFrameCount={previewExport?.frames.length ?? 0}
            previewHasFaceLabel={previewHasFaceLabel}
            isPreviewPlaying={isPreviewPlaying}
            selectedAudio={selectedAudio}
            selectedAudioPhaseLabel={selectedAudioPhaseLabel}
            iconUrls={ACTION_ICON_URLS}
            formatDateTime={formatDateTime}
            formatBytes={formatBytes}
            describeExperiment={describeExperiment}
            onPreviewExperiment={handlePreviewExperiment}
            onDownloadExperiment={handleDownloadExperiment}
            onDeleteExperiment={handleDeleteExperiment}
            onPreviewAudio={handlePreviewAudio}
            onDownloadAudio={handleDownloadAudio}
            onDeleteAudio={handleDeleteAudio}
            onPreviewPrevious={() => {
              setIsPreviewPlaying(false);
              setPreviewFrameIndex((current) => Math.max(0, current - 1));
            }}
            onPreviewTogglePlay={() => {
              if (!previewExport?.frames.length) {
                return;
              }
              if (previewFrameIndex >= previewExport.frames.length - 1) {
                setPreviewFrameIndex(0);
              }
              setIsPreviewPlaying((current) => !current);
            }}
            onPreviewNext={() => {
              setIsPreviewPlaying(false);
              setPreviewFrameIndex((current) =>
                !previewExport?.frames.length
                  ? 0
                  : Math.min(previewExport.frames.length - 1, current + 1),
              );
            }}
            onCloseAudio={() => setSelectedAudio(null)}
          />
        ) : null}

        {showFloatingPrompt ? (
          screen === "phase_recording" ? (
            <button
              type="button"
              className="floating-prompt is-interactive"
              aria-live="polite"
              aria-atomic="true"
              onClick={handleAdvancePrompt}
            >
              <p className="prompt-label">{floatingPromptLabel}</p>
              <strong>{rotatingPrompt}</strong>
              <span className="floating-prompt-caption">タップで次へ</span>
            </button>
          ) : (
            <div className="floating-prompt is-static" aria-live="polite" aria-atomic="true">
              <p className="prompt-label">{floatingPromptLabel}</p>
              <div className="pill-row floating-prompt-pill-row">
                {currentTheme?.examplePills.map((example) => (
                  <span key={example} className="example-pill">
                    {example}
                  </span>
                ))}
              </div>
              <p className="support-copy floating-prompt-support">
                {currentTheme?.supportiveHint}
              </p>
            </div>
          )
        ) : null}
      </section>
    </main>
  );
}
