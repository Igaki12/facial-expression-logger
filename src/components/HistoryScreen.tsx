import { type CSSProperties, type RefObject } from "react";
import { PHASE_CONTENT } from "../constants";
import type {
  AudioClipRecord,
  ExperimentExport,
  ExperimentRecord,
  ThemeKey,
} from "../types";

interface SelectedAudioState {
  audioClip: AudioClipRecord;
  audioUrl: string;
}

interface ActionIconUrls {
  preview: string;
  download: string;
  delete: string;
  audio: string;
}

interface HistoryScreenProps {
  experiments: ExperimentRecord[];
  historyAudioClips: Record<string, AudioClipRecord[]>;
  isBusy: boolean;
  isPreviewLoading: boolean;
  previewTargetId: string | null;
  previewExport: ExperimentExport | null;
  previewAspectRatio: number;
  previewStageRef: RefObject<HTMLDivElement | null>;
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
  previewPhaseLabel: string | null;
  previewFrameIndex: number;
  previewFrameCount: number;
  previewHasFaceLabel: string;
  isPreviewPlaying: boolean;
  selectedAudio: SelectedAudioState | null;
  selectedAudioPhaseLabel: string | null;
  iconUrls: ActionIconUrls;
  formatDateTime: (value: string | null) => string;
  formatBytes: (value: number) => string;
  describeExperiment: (experiment: ExperimentRecord) => string;
  onReturn: () => void;
  onPreviewExperiment: (experimentId: string) => Promise<void>;
  onDownloadExperiment: (experimentId: string) => Promise<void>;
  onDeleteExperiment: (experimentId: string) => Promise<void>;
  onPreviewAudio: (experiment: ExperimentRecord, phaseKey: ThemeKey) => Promise<void>;
  onDownloadAudio: (experiment: ExperimentRecord, phaseKey: ThemeKey) => Promise<void>;
  onDeleteAudio: (experimentId: string, phaseKey: ThemeKey) => Promise<void>;
  onPreviewPrevious: () => void;
  onPreviewTogglePlay: () => void;
  onPreviewNext: () => void;
  onCloseAudio: () => void;
}

function ActionIcon({ src }: { src: string }) {
  return <img src={src} alt="" className="action-icon" aria-hidden="true" />;
}

export function HistoryScreen({
  experiments,
  historyAudioClips,
  isBusy,
  isPreviewLoading,
  previewTargetId,
  previewExport,
  previewAspectRatio,
  previewStageRef,
  previewCanvasRef,
  previewPhaseLabel,
  previewFrameIndex,
  previewFrameCount,
  previewHasFaceLabel,
  isPreviewPlaying,
  selectedAudio,
  selectedAudioPhaseLabel,
  iconUrls,
  formatDateTime,
  formatBytes,
  describeExperiment,
  onReturn,
  onPreviewExperiment,
  onDownloadExperiment,
  onDeleteExperiment,
  onPreviewAudio,
  onDownloadAudio,
  onDeleteAudio,
  onPreviewPrevious,
  onPreviewTogglePlay,
  onPreviewNext,
  onCloseAudio,
}: HistoryScreenProps) {
  return (
    <section className="scene-card history-scene">
      <div className="history-header">
        <div>
          <p className="scene-kicker">保存済みデータ</p>
          <h2>記録した実験データ</h2>
        </div>
        <button
          type="button"
          className="text-link"
          onClick={onReturn}
        >
          戻る
        </button>
      </div>

      {experiments.length === 0 ? (
        <p className="scene-copy">保存済みの実験データはまだありません。</p>
      ) : (
        <div className="history-layout">
          <div className="history-list">
            {experiments.map((experiment) => {
              const audioClips = historyAudioClips[experiment.id] ?? [];
              const audioPhaseKeys = experiment.completedPhases.length > 0
                ? experiment.completedPhases
                : experiment.phaseOrder;

              return (
                <article key={experiment.id} className="history-item">
                  <div className="history-copy">
                    <strong>{describeExperiment(experiment)}</strong>
                    <span>開始: {formatDateTime(experiment.startedAt)}</span>
                    <span>終了: {formatDateTime(experiment.endedAt)}</span>
                    <span>
                      完了フェーズ: {experiment.completedPhases.map((phaseKey) => PHASE_CONTENT[phaseKey].label).join(" / ") || "なし"}
                    </span>
                  </div>
                  <div className="history-actions">
                    <button
                      type="button"
                      className="secondary-action compact-action"
                      onClick={() => void onPreviewExperiment(experiment.id)}
                      disabled={experiment.status !== "completed" || isBusy || isPreviewLoading}
                    >
                      <ActionIcon src={iconUrls.preview} />
                      {isPreviewLoading && previewTargetId === experiment.id ? "読込中" : "確認"}
                    </button>
                    <button
                      type="button"
                      className="secondary-action compact-action"
                      onClick={() => void onDownloadExperiment(experiment.id)}
                      disabled={experiment.status !== "completed" || isBusy}
                    >
                      <ActionIcon src={iconUrls.download} />
                      JSON
                    </button>
                    <button
                      type="button"
                      className="danger-action compact-action"
                      onClick={() => void onDeleteExperiment(experiment.id)}
                      disabled={isBusy}
                    >
                      <ActionIcon src={iconUrls.delete} />
                      削除
                    </button>
                  </div>

                  <div className="audio-history-list" aria-label="音声データ">
                    <strong className="audio-history-title">
                      <ActionIcon src={iconUrls.audio} />
                      音声
                    </strong>
                    {audioPhaseKeys.map((phaseKey) => {
                      const audioClip = audioClips.find((clip) => clip.phaseKey === phaseKey);

                      return (
                        <div key={phaseKey} className="audio-history-row">
                          <span>
                            {PHASE_CONTENT[phaseKey].label}
                            {audioClip ? ` / ${formatBytes(audioClip.sizeBytes)}` : " / なし"}
                          </span>
                          <div className="history-actions">
                            <button
                              type="button"
                              className="secondary-action compact-action"
                              onClick={() => void onPreviewAudio(experiment, phaseKey)}
                              disabled={!audioClip || isBusy}
                            >
                              <ActionIcon src={iconUrls.preview} />
                              確認
                            </button>
                            <button
                              type="button"
                              className="secondary-action compact-action"
                              onClick={() => void onDownloadAudio(experiment, phaseKey)}
                              disabled={!audioClip || isBusy}
                            >
                              <ActionIcon src={iconUrls.download} />
                              出力
                            </button>
                            <button
                              type="button"
                              className="danger-action compact-action"
                              onClick={() => void onDeleteAudio(experiment.id, phaseKey)}
                              disabled={!audioClip || isBusy}
                            >
                              <ActionIcon src={iconUrls.delete} />
                              削除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="history-detail">
            {previewExport ? (
              <section className="preview-panel">
                <div className="preview-header">
                  <div>
                    <p className="scene-kicker">簡易プレビュー</p>
                    <h3>{describeExperiment(previewExport.experiment)}</h3>
                  </div>
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
                  <span>フレーム: {previewFrameCount === 0 ? 0 : previewFrameIndex + 1} / {previewFrameCount}</span>
                  <span>顔検出: {previewHasFaceLabel}</span>
                </div>

                <div className="history-actions">
                  <button
                    type="button"
                    className="secondary-action compact-action"
                    onClick={onPreviewPrevious}
                    disabled={previewFrameIndex === 0}
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    className="secondary-action compact-action"
                    onClick={onPreviewTogglePlay}
                    disabled={previewFrameCount === 0}
                  >
                    {isPreviewPlaying ? "停止" : "再生"}
                  </button>
                  <button
                    type="button"
                    className="secondary-action compact-action"
                    onClick={onPreviewNext}
                    disabled={previewFrameCount === 0 || previewFrameIndex >= previewFrameCount - 1}
                  >
                    進む
                  </button>
                </div>
              </section>
            ) : null}

            {selectedAudio ? (
              <section className="audio-preview-panel">
                <div className="preview-header">
                  <div>
                    <p className="scene-kicker">音声確認</p>
                    <h3>{selectedAudioPhaseLabel}の音声</h3>
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={onCloseAudio}
                  >
                    閉じる
                  </button>
                </div>
                <audio
                  className="audio-player"
                  controls
                  src={selectedAudio.audioUrl}
                />
                <div className="preview-meta">
                  <span>{selectedAudio.audioClip.mimeType}</span>
                  <span>{formatBytes(selectedAudio.audioClip.sizeBytes)}</span>
                  <span>開始: {formatDateTime(selectedAudio.audioClip.startedAt)}</span>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
