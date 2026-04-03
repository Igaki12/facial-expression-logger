import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Classifications } from "@mediapipe/tasks-vision";
import { THEMES, FLUSH_BATCH_SIZE } from "./constants";
import { useFaceLandmarker } from "./hooks/useFaceLandmarker";
import { useUserMedia } from "./hooks/useUserMedia";
import { downloadSessionExport } from "./lib/export";
import {
  appendFrames,
  completeSession,
  createSession,
  deleteSession,
  getFramesForSession,
  getSession,
  listSessions,
} from "./lib/storage";
import type { FrameRecord, SessionRecord, ThemeKey } from "./types";

interface ActiveSessionState {
  frameCount: number;
  id: string;
  startedAt: string;
  startedAtMs: number;
  themeKey: ThemeKey;
  themeLabel: string;
}

function classificationsToCategories(
  classifications: Classifications[] | undefined,
) {
  return classifications?.map((item) => item.categories) ?? [];
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "未完了";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const activeSessionRef = useRef<ActiveSessionState | null>(null);
  const pendingFramesRef = useRef<FrameRecord[]>([]);
  const flushPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const [selectedThemeKey, setSelectedThemeKey] = useState<ThemeKey>("hobby");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [latestCompletedId, setLatestCompletedId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [faceVisible, setFaceVisible] = useState(false);

  const { stream, status: cameraStatus, error: cameraError, startCamera } = useUserMedia();
  const {
    faceLandmarker,
    status: landmarkerStatus,
    error: landmarkerError,
    initialize,
  } = useFaceLandmarker();

  const selectedTheme = useMemo(
    () => THEMES.find((theme) => theme.key === selectedThemeKey) ?? THEMES[0],
    [selectedThemeKey],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const nextSessions = await listSessions();
      setSessions(nextSessions);
      const latestCompleted = nextSessions.find((session) => session.status === "completed");
      setLatestCompletedId(latestCompleted?.id ?? null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "保存済みセッションの読み込みに失敗しました。";
      setStorageError(message);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      return;
    }

    video.srcObject = stream;
    void video.play().catch(() => {
      setStorageError("カメラ映像の再生開始に失敗しました。");
    });
  }, [stream]);

  useEffect(() => {
    lastVideoTimeRef.current = -1;
    setFaceVisible(false);
  }, [stream]);

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
              : "IndexedDB へのフレーム保存に失敗しました。";
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

          const activeSession = activeSessionRef.current;
          if (activeSession) {
            const timestampMs = Date.now();
            const frameRecord: FrameRecord = {
              sessionId: activeSession.id,
              frameIndex: activeSession.frameCount,
              timestampMs,
              elapsedMs: timestampMs - activeSession.startedAtMs,
              hasFace,
              faceLandmarks: results.faceLandmarks,
              faceBlendshapes: classificationsToCategories(results.faceBlendshapes),
              facialTransformationMatrixes: results.facialTransformationMatrixes ?? [],
            };

            activeSession.frameCount += 1;
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
  }, [faceLandmarker, flushBufferedFrames, stream]);

  const handleStartCamera = useCallback(async () => {
    setStorageError(null);

    try {
      await initialize();
      await startCamera();
    } catch {
      // Errors are surfaced through hook state.
    }
  }, [initialize, startCamera]);

  const handleStartRecording = useCallback(async () => {
    if (!faceLandmarker || !stream) {
      setStorageError("先にカメラを開始し、MediaPipe の準備を完了してください。");
      return;
    }

    setIsBusy(true);
    setStorageError(null);

    try {
      const startedAt = new Date().toISOString();
      const nextSession: SessionRecord = {
        id: crypto.randomUUID(),
        themeKey: selectedTheme.key,
        themeLabel: selectedTheme.label,
        startedAt,
        endedAt: null,
        frameCount: 0,
        status: "recording",
      };

      await createSession(nextSession);
      activeSessionRef.current = {
        frameCount: 0,
        id: nextSession.id,
        startedAt,
        startedAtMs: Date.now(),
        themeKey: nextSession.themeKey,
        themeLabel: nextSession.themeLabel,
      };
      pendingFramesRef.current = [];
      flushPromiseRef.current = Promise.resolve();
      setIsRecording(true);
      await refreshSessions();
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "セッション開始の保存に失敗しました。";
      setStorageError(message);
    } finally {
      setIsBusy(false);
    }
  }, [faceLandmarker, refreshSessions, selectedTheme, stream]);

  const handleStopRecording = useCallback(async () => {
    const activeSession = activeSessionRef.current;
    if (!activeSession) {
      return;
    }

    setIsBusy(true);
    setStorageError(null);

    try {
      activeSessionRef.current = null;
      setIsRecording(false);
      await flushBufferedFrames(true);
      await flushPromiseRef.current;
      await completeSession(
        activeSession.id,
        new Date().toISOString(),
        activeSession.frameCount,
      );
      await refreshSessions();
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "セッション終了処理に失敗しました。";
      setStorageError(message);
    } finally {
      pendingFramesRef.current = [];
      setIsBusy(false);
    }
  }, [flushBufferedFrames, refreshSessions]);

  const handleDownloadSession = useCallback(async (sessionId: string) => {
    setDownloadError(null);

    try {
      const session = await getSession(sessionId);
      if (!session) {
        throw new Error("ダウンロード対象のセッションが見つかりません。");
      }

      const frames = await getFramesForSession(sessionId);
      downloadSessionExport(session, frames);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "JSON ダウンロードに失敗しました。";
      setDownloadError(message);
    }
  }, []);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!window.confirm("このセッション履歴を削除しますか？")) {
        return;
      }

      setStorageError(null);
      setIsBusy(true);

      try {
        await deleteSession(sessionId);
        await refreshSessions();
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "セッション削除に失敗しました。";
        setStorageError(message);
      } finally {
        setIsBusy(false);
      }
    },
    [refreshSessions],
  );

  const canStartRecording =
    cameraStatus === "ready" &&
    landmarkerStatus === "ready" &&
    !isRecording &&
    !isBusy;

  const canStopRecording = isRecording && !isBusy;

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Research Demo</p>
          <h1>表情変化・ストレス検出デモ</h1>
          <p className="lead">
            画面にはライブ映像を表示しつつ、裏側で MediaPipe の顔特徴量だけを解析・記録します。
          </p>
        </div>

        <div className="topic-picker" role="radiogroup" aria-label="計測テーマ">
          {THEMES.map((theme) => {
            const isActive = selectedThemeKey === theme.key;
            return (
              <button
                key={theme.key}
                type="button"
                className={`topic-card${isActive ? " is-active" : ""}`}
                onClick={() => setSelectedThemeKey(theme.key)}
                disabled={isRecording}
              >
                <span className="topic-label">{theme.label}</span>
                <strong>{theme.prompt}</strong>
                <span>{theme.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="workspace-grid">
        <div className="viewer-panel">
          <div className="viewer-header">
            <div>
              <p className="section-kicker">現在のテーマ</p>
              <h2>{selectedTheme.prompt}</h2>
            </div>
            <span className={`status-pill${faceVisible ? " ok" : " warn"}`}>
              {faceVisible ? "顔を検出中" : "顔が未検出"}
            </span>
          </div>

          <div className="video-frame">
            <video ref={videoRef} className="camera-video" playsInline muted />
            <div className="video-overlay">
              <p>{selectedTheme.description}</p>
              <p>映像ファイルは保存せず、ランドマークやブレンドシェイプなどの数値データだけを保持します。</p>
            </div>
          </div>

          <div className="control-panel">
            <button
              type="button"
              className="primary-button"
              onClick={handleStartCamera}
              disabled={cameraStatus === "ready" || landmarkerStatus === "loading" || isBusy}
            >
              {cameraStatus === "ready" ? "カメラ準備完了" : "カメラ開始"}
            </button>
            <button
              type="button"
              className="primary-button secondary"
              onClick={handleStartRecording}
              disabled={!canStartRecording}
            >
              記録開始
            </button>
            <button
              type="button"
              className="primary-button danger"
              onClick={handleStopRecording}
              disabled={!canStopRecording}
            >
              記録停止
            </button>
            <button
              type="button"
              className="primary-button ghost"
              onClick={() => latestCompletedId && void handleDownloadSession(latestCompletedId)}
              disabled={!latestCompletedId || isBusy}
            >
              JSON ダウンロード
            </button>
          </div>
        </div>

        <aside className="side-panel">
          <div className="status-card">
            <h3>システム状態</h3>
            <dl className="status-list">
              <div>
                <dt>カメラ</dt>
                <dd>{cameraStatus}</dd>
              </div>
              <div>
                <dt>MediaPipe</dt>
                <dd>{landmarkerStatus}</dd>
              </div>
              <div>
                <dt>記録中</dt>
                <dd>{isRecording ? "はい" : "いいえ"}</dd>
              </div>
            </dl>
          </div>

          <div className="status-card">
            <h3>通知</h3>
            <ul className="message-list">
              <li>{cameraError ? `カメラ権限拒否: ${cameraError}` : "カメラ権限は未エラーです。"}</li>
              <li>
                {landmarkerError
                  ? `MediaPipe モデル初期化失敗: ${landmarkerError}`
                  : "MediaPipe 初期化エラーはありません。"}
              </li>
              <li>
                {faceVisible
                  ? "顔を検出しています。ライブ映像は表示のみで保存しません。"
                  : "顔未検出です。画角と明るさを調整してください。"}
              </li>
              <li>
                {storageError
                  ? `IndexedDB 保存失敗: ${storageError}`
                  : "IndexedDB 保存エラーはありません。"}
              </li>
              {downloadError ? <li>ダウンロード失敗: {downloadError}</li> : null}
            </ul>
          </div>

          <div className="history-card">
            <div className="history-header">
              <h3>履歴一覧</h3>
              <span>{sessions.length}件</span>
            </div>
            <div className="history-list">
              {sessions.length === 0 ? (
                <p className="empty-history">保存済みセッションはまだありません。</p>
              ) : (
                sessions.map((session) => (
                  <article key={session.id} className="history-item">
                    <div className="history-item-body">
                      <strong>{session.themeLabel}</strong>
                      <span>開始: {formatDateTime(session.startedAt)}</span>
                      <span>終了: {formatDateTime(session.endedAt)}</span>
                      <span>フレーム数: {session.frameCount}</span>
                      <span>状態: {session.status}</span>
                    </div>
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="history-button"
                        onClick={() => void handleDownloadSession(session.id)}
                        disabled={session.status !== "completed" || isBusy}
                      >
                        JSON
                      </button>
                      <button
                        type="button"
                        className="history-button danger"
                        onClick={() => void handleDeleteSession(session.id)}
                        disabled={isBusy}
                      >
                        削除
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
