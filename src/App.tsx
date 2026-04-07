import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DrawingUtils,
  FaceLandmarker,
  type Classifications,
} from "@mediapipe/tasks-vision";
import {
  FLUSH_BATCH_SIZE,
  GUIDE_ROTATION_MS,
  PHASE_CONTENT,
  PHASE_ORDER,
  RESEARCH_DEBRIEF,
} from "./constants";
import { useFaceLandmarker } from "./hooks/useFaceLandmarker";
import { useUserMedia } from "./hooks/useUserMedia";
import { downloadExperimentExport } from "./lib/export";
import {
  appendFrames,
  completeExperiment,
  completePhase,
  createExperiment,
  createPhase,
  deleteExperiment,
  getExperimentExport,
  listExperiments,
  updateExperimentCompletedPhases,
} from "./lib/storage";
import type {
  ExperimentExport,
  ExperimentRecord,
  FlowMode,
  FrameRecord,
  PhaseRecord,
  ThemeKey,
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
  startedAt: string;
  startedAtMs: number;
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

function uniqThemeKeys(values: ThemeKey[]): ThemeKey[] {
  return [...new Set(values)];
}

function describeExperiment(experiment: ExperimentRecord): string {
  if (experiment.flowMode === "retake" && experiment.retakeOfPhase) {
    return `${PHASE_CONTENT[experiment.retakeOfPhase].label}の撮り直し`;
  }

  return "通常フロー";
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const pendingFramesRef = useRef<FrameRecord[]>([]);
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
  const [storageError, setStorageError] = useState<string | null>(null);
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

  const currentPhaseKey = flow ? flow.phaseOrder[flow.currentPhaseIndex] ?? null : null;
  const currentTheme = currentPhaseKey ? PHASE_CONTENT[currentPhaseKey] : null;
  const rotatingPrompt = currentTheme
    ? currentTheme.rotatingPrompts[guideIndex % currentTheme.rotatingPrompts.length]
    : "";

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
    if (
      screen !== "phase_guide" &&
      screen !== "phase_recording" &&
      screen !== "work_transition"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setGuideIndex((current) => current + 1);
    }, GUIDE_ROTATION_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [screen]);

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
            const frameRecord: FrameRecord = {
              experimentId: activeRecording.experimentId,
              phaseKey: activeRecording.phaseKey,
              frameIndex: activeRecording.frameCount,
              timestampMs,
              elapsedMs: timestampMs - activeRecording.startedAtMs,
              hasFace,
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
      };

      await createPhase(phase);
      pendingFramesRef.current = [];
      flushPromiseRef.current = Promise.resolve();
      activeRecordingRef.current = {
        experimentId,
        frameCount: 0,
        phaseKey: currentPhaseKey,
        promptSetVersion: theme.promptSetVersion,
        startedAt: phase.startedAt,
        startedAtMs: Date.now(),
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
  }, [currentPhaseKey, faceLandmarker, stream]);

  useEffect(() => {
    if (screen !== "phase_recording") {
      return;
    }

    void ensurePhaseRecordingStarted();
  }, [ensurePhaseRecordingStarted, screen]);

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

      await flushBufferedFrames(true);
      await flushPromiseRef.current;
      await completePhase(
        activeRecording.experimentId,
        activeRecording.phaseKey,
        phaseEndedAt,
        activeRecording.frameCount,
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
  }, [flushBufferedFrames, refreshExperiments]);

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

  const openHistory = useCallback((returnScreen: Screen) => {
    setHistoryReturnScreen(returnScreen);
    setScreen("history");
  }, []);

  const returnFromHistory = useCallback(() => {
    setScreen(historyReturnScreen);
  }, [historyReturnScreen]);

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
      return `${PHASE_CONTENT[currentPhaseKey].label}の撮り直しを完了`;
    }

    if (currentPhaseKey === "hobby") {
      return "つぎは仕事の案内へ";
    }

    return "この実験を完了する";
  }, [currentPhaseKey, flow]);

  const condensedError =
    storageError ??
    cameraError ??
    landmarkerError ??
    downloadError ??
    previewError;

  const previewFrame = previewExport?.frames[previewFrameIndex] ?? null;
  const previewPhaseLabel = previewFrame
    ? PHASE_CONTENT[previewFrame.phaseKey].label
    : null;

  return (
    <main className="story-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <section className="story-panel">
        <header className="story-header">
          <div>
            <p className="eyebrow">Guided Session</p>
            <h1>案内に沿って、短い会話を進めてください</h1>
          </div>
          <button
            type="button"
            className="text-link"
            onClick={() => openHistory(screen)}
          >
            保存済みデータ
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
            <h2>これから短い案内に沿って、2 つの話題を順番に話してもらいます。</h2>
            <p className="scene-copy">
              難しく考えなくて大丈夫です。各画面のヒントに合わせて、思いつくことをそのまま話してください。
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
                実験を始める
              </button>
            </div>
          </section>
        ) : null}

        {screen === "camera_check" ? (
          <section className="scene-card">
            <p className="scene-kicker">準備</p>
            <h2>まずはカメラの位置を整えましょう。</h2>
            <p className="scene-copy">
              顔が画面の中央付近に入るようにして、明るさがわかる位置で構えてください。
            </p>

            <div className="video-stage">
              <video ref={videoRef} className="camera-video" playsInline muted />
              <div className="stage-overlay">
                <p>{faceVisible ? "顔が見えています。このままで大丈夫です。" : "顔が見える位置に少しだけ調整してください。"}</p>
              </div>
            </div>

            <div className="action-row stacked-on-mobile">
              <button
                type="button"
                className="primary-action"
                onClick={handlePrepareCamera}
                disabled={cameraStatus === "ready" || landmarkerStatus === "loading" || isBusy}
              >
                {cameraStatus === "ready" ? "カメラ準備完了" : "カメラを許可する"}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={handleContinueFromCamera}
                disabled={cameraStatus !== "ready" || landmarkerStatus !== "ready" || isBusy}
              >
                このまま次へ
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
                <p>{faceVisible ? "表情が見える位置です。このまま話し始められます。" : "顔が少し見える位置に整えてから始めてください。"}</p>
              </div>
            </div>

            <div className="prompt-card">
              <p className="prompt-label">話し始めるきっかけ</p>
              <strong>{rotatingPrompt}</strong>
            </div>

            <div className="pill-row">
              {currentTheme.examplePills.map((example) => (
                <span key={example} className="example-pill">
                  {example}
                </span>
              ))}
            </div>

            <p className="support-copy">{currentTheme.supportiveHint}</p>

            <div className="action-row">
              <button
                type="button"
                className="primary-action"
                onClick={() => setScreen("phase_recording")}
                disabled={cameraStatus !== "ready" || landmarkerStatus !== "ready" || isBusy}
              >
                この案内で話し始める
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
              <div className="stage-overlay">
                <p>{faceVisible ? "そのまま自然に話してください。" : "顔が見える位置に戻すと、記録が安定しやすくなります。"}</p>
              </div>
            </div>

            <div className="prompt-card animated-card">
              <p className="prompt-label">今のヒント</p>
              <strong>{rotatingPrompt}</strong>
            </div>

            <div className="recording-badge-row">
              <span className={`signal-badge${isRecording ? " is-live" : ""}`}>
                {isRecording ? "記録中" : "準備中"}
              </span>
              <span className={`signal-badge${faceVisible ? " is-good" : ""}`}>
                {faceVisible ? "顔を確認" : "位置を調整"}
              </span>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="primary-action"
                onClick={() => void finishCurrentPhase()}
                disabled={!isRecording || isBusy}
              >
                {phaseActionLabel}
              </button>
            </div>
          </section>
        ) : null}

        {screen === "work_transition" ? (
          <section className="scene-card transition-scene">
            <p className="scene-kicker">切り替え</p>
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
            <h2>{RESEARCH_DEBRIEF.title}</h2>
            <p className="scene-copy">{RESEARCH_DEBRIEF.body}</p>
            <p className="support-copy">{RESEARCH_DEBRIEF.detail}</p>

            <div className="debrief-grid">
              <div className="debrief-item">
                <span>保存しているもの</span>
                <strong>表情の数値データ</strong>
              </div>
              <div className="debrief-item">
                <span>保存しないもの</span>
                <strong>映像ファイルそのもの</strong>
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
          <section className="scene-card history-scene">
            <div className="history-header">
              <div>
                <p className="scene-kicker">保存済みデータ</p>
                <h2>記録した実験データ</h2>
              </div>
              <button
                type="button"
                className="text-link"
                onClick={returnFromHistory}
              >
                戻る
              </button>
            </div>

            {experiments.length === 0 ? (
              <p className="scene-copy">保存済みの実験データはまだありません。</p>
            ) : (
              <>
                {previewExport ? (
                  <section className="preview-panel">
                    <div className="preview-header">
                      <div>
                        <p className="scene-kicker">簡易プレビュー</p>
                        <h3>{describeExperiment(previewExport.experiment)}</h3>
                      </div>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          setPreviewExport(null);
                          setIsPreviewPlaying(false);
                        }}
                      >
                        閉じる
                      </button>
                    </div>

                    <div
                      ref={previewStageRef}
                      className="preview-stage"
                      style={{ "--preview-aspect-ratio": String(previewAspectRatio) } as CSSProperties}
                    >
                      <canvas
                        ref={previewCanvasRef}
                        className="preview-canvas"
                      />
                    </div>

                    <div className="preview-meta">
                      <span>フェーズ: {previewPhaseLabel ?? "不明"}</span>
                      <span>
                        フレーム: {previewExport.frames.length === 0 ? 0 : previewFrameIndex + 1} /{" "}
                        {previewExport.frames.length}
                      </span>
                      <span>
                        顔検出: {previewFrame ? (previewFrame.hasFace ? "あり" : "なし") : "未選択"}
                      </span>
                    </div>

                    <div className="history-actions">
                      <button
                        type="button"
                        className="secondary-action compact-action"
                        onClick={() => {
                          setIsPreviewPlaying(false);
                          setPreviewFrameIndex((current) => Math.max(0, current - 1));
                        }}
                        disabled={previewFrameIndex === 0}
                      >
                        戻る
                      </button>
                      <button
                        type="button"
                        className="secondary-action compact-action"
                        onClick={() => {
                          if (!previewExport.frames.length) {
                            return;
                          }
                          if (previewFrameIndex >= previewExport.frames.length - 1) {
                            setPreviewFrameIndex(0);
                          }
                          setIsPreviewPlaying((current) => !current);
                        }}
                        disabled={previewExport.frames.length === 0}
                      >
                        {isPreviewPlaying ? "停止" : "再生"}
                      </button>
                      <button
                        type="button"
                        className="secondary-action compact-action"
                        onClick={() => {
                          setIsPreviewPlaying(false);
                          setPreviewFrameIndex((current) =>
                            previewExport.frames.length === 0
                              ? 0
                              : Math.min(previewExport.frames.length - 1, current + 1),
                          );
                        }}
                        disabled={
                          previewExport.frames.length === 0 ||
                          previewFrameIndex >= previewExport.frames.length - 1
                        }
                      >
                        進む
                      </button>
                    </div>
                  </section>
                ) : null}

                <div className="history-list">
                  {experiments.map((experiment) => (
                    <article key={experiment.id} className="history-item">
                      <div className="history-copy">
                        <strong>{describeExperiment(experiment)}</strong>
                        <span>開始: {formatDateTime(experiment.startedAt)}</span>
                        <span>終了: {formatDateTime(experiment.endedAt)}</span>
                        <span>完了フェーズ: {experiment.completedPhases.map((phaseKey) => PHASE_CONTENT[phaseKey].label).join(" / ") || "なし"}</span>
                      </div>
                      <div className="history-actions">
                        <button
                          type="button"
                          className="secondary-action compact-action"
                          onClick={() => void handlePreviewExperiment(experiment.id)}
                          disabled={experiment.status !== "completed" || isBusy || isPreviewLoading}
                        >
                          {isPreviewLoading && previewTargetId === experiment.id ? "読込中" : "確認"}
                        </button>
                        <button
                          type="button"
                          className="secondary-action compact-action"
                          onClick={() => void handleDownloadExperiment(experiment.id)}
                          disabled={experiment.status !== "completed" || isBusy}
                        >
                          JSON
                        </button>
                        <button
                          type="button"
                          className="danger-action compact-action"
                          onClick={() => void handleDeleteExperiment(experiment.id)}
                          disabled={isBusy}
                        >
                          削除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
