# Project: 表情変化・会話誘導デモアプリ

## 1. 目的
本プロジェクトは研究用途の Web アプリです。被験者に、画面上の案内に沿って `趣味の話` と `仕事の話` を順番にしてもらい、その間の顔の表情変化を MediaPipe で解析して時系列保存します。

重要な前提:

- 画面上では実験目的を最後まで強く開示しない
- 導線は `趣味 → 仕事` の固定順を基本とする
- 保存対象は顔特徴量の数値データのみ
- 映像ファイルや静止画は保存しない
- 解析と保存はブラウザ内で完結させる
- 完了後にのみ、研究意図と記録内容を説明する

## 2. 現在の技術スタック
- フレームワーク: React + TypeScript
- ビルドツール: Vite
- 顔解析: `@mediapipe/tasks-vision` の Face Landmarker
- 保存: IndexedDB
- 配布先: GitHub Pages

GitHub Pages 向けの前提:

- `vite.config.ts` で `base: "/facial-expression-logger/"` を使う
- ビルド出力先は `docs/`
- Face Landmarker モデルは `public/models/face_landmarker.task` に置く

## 3. UI / UX 方針

### 3.1 全体構成
- ダッシュボード型ではなく、段階型の実験フローにする
- 1 画面で大量の情報を見せず、「今やること」だけを出す
- スマホでの利用を最優先にした 1 カラム構成にする
- 見た目は管理画面ではなく、進行演出のある案内型にする

### 3.2 基本フロー
- `intro`
- `camera_check`
- `hobby_guide`
- `hobby_recording`
- `work_transition`
- `work_guide`
- `work_recording`
- `completion`
- `debrief`
- `history`

通常導線ではテーマ選択を見せないこと。  
被験者には、案内に従って自然に進める体験を優先する。

### 3.3 文言方針
- 趣味フェーズでは、ペット、休日、最近楽しかったこと、好きな食べ物、最近見たもの、よく行く場所など、話しやすい具体例を多く出す
- 仕事フェーズでは、仕事の流れ、一日のスケジュール、よくあるやり取り、忙しい時間帯、進め方、印象に残った業務などを出す
- `ストレス` という言葉は被験者向け UI に直接出さない
- 何を記録しているか、何の研究かは最後の `debrief` で初めて詳しく説明する

## 4. 解析方針
- 主表示は `<video>` によるライブ映像
- 顔ランドマークのリアルタイム描画は行わない
- `requestAnimationFrame` ループ内で `faceLandmarker.detectForVideo()` を呼ぶ
- 解析結果は UI 描画には使わず、状態表示と保存に使う

Face Landmarker の設定:

- `runningMode: "VIDEO"`
- `numFaces: 1`
- `outputFaceBlendshapes: true`
- `outputFacialTransformationMatrixes: true`

## 5. 保存モデル
保存単位は `session` ではなく `experiment + phase` にする。

### `ExperimentRecord`
- `id`
- `startedAt`
- `endedAt`
- `status`
- `flowMode`
- `phaseOrder`
- `completedPhases`
- `sourceExperimentId?`
- `retakeOfPhase?`

### `PhaseRecord`
- `experimentId`
- `phaseKey`
- `label`
- `startedAt`
- `endedAt`
- `frameCount`
- `promptSetVersion`

### `FrameRecord`
- `experimentId`
- `phaseKey`
- `frameIndex`
- `timestampMs`
- `elapsedMs`
- `hasFace`
- `faceLandmarks`
- `faceBlendshapes`
- `facialTransformationMatrixes`

IndexedDB は少なくとも以下の 3 ストアを持つこと。

- `experiments`
- `phases`
- `frames`

## 6. 記録制御
- 被験者向け UI には `記録開始` / `記録停止` の生ボタンを常設しない
- 各フェーズの記録は、画面遷移に応じて内部で自動開始・自動停止する
- フレーム保存は React state ではなく `useRef` バッファを使って一定件数ごとに flush する
- 完了後は `1 experiment = 1 JSON` としてエクスポートする

## 7. 再実施の扱い
- 通常フローは `趣味 → 仕事` の固定順
- 完了後のみ `趣味だけ撮り直す` / `仕事だけ撮り直す` を許可する
- 撮り直しは元データを上書きせず、新しい experiment として保存する
- 追跡のため `sourceExperimentId` と `retakeOfPhase` を保持する

## 8. AI 開発エージェントへの指示
このリポジトリを変更する AI 開発エージェントは以下を守ること。

- 被験者向け導線をダッシュボード型へ戻さない
- 通常導線でテーマ選択を前面に出さない
- `ストレス` という語を被験者向け仕事フェーズ文言に直接出さない
- 研究説明や記録内容の詳細を冒頭画面に戻さない
- 映像ファイルや画像を保存対象に追加しない
- Face Landmarker の出力データは削らず、生データを保持する
- 長時間記録を考慮し、フレーム配列を React state に積まない
- GitHub Pages 配信前提を壊さない
- 変更後は `npm run build` を通し、`docs/` 出力が維持されることを確認する

## 9. 非機能要件
- 外部サーバー送信は行わない
- HTTPS の GitHub Pages またはローカル開発サーバーで動作すること
- モバイル幅でも操作不能にならないこと
- 点滅や過剰な描画負荷を避けること
- 被験者が「何をすればよいか」で迷わないことを優先する
