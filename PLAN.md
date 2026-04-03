# 表情変化・ストレス検出デモアプリ 実装プラン

## Summary
React + Vite で単一画面の研究用デモを構築し、MediaPipe Face Landmarker で 1 人分の顔をリアルタイム解析します。UI には固定テーマ 2 種類のみを出し分け、カメラ映像は非表示、`canvas` 上には黒背景の顔メッシュだけを描画します。保存は `localStorage` ではなく `IndexedDB` を使い、セッション履歴の一覧・再ダウンロード・削除まで v1 に含めます。

## Implementation Changes
- プロジェクト構成は `React + Vite + TypeScript` を採用し、スタイルは Tailwind を入れず素の CSS で実装する。
- Vite は GitHub Pages 前提で `base: "/facial-expression-logger/"`、`build.outDir: "docs"` を設定する。
- MediaPipe は `@mediapipe/tasks-vision` を使い、`FilesetResolver.forVisionTasks()` で WASM を読み込み、`FaceLandmarker.createFromOptions()` で初期化する。
- Face Landmarker 設定は `runningMode: "VIDEO"`, `numFaces: 1`, `outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true` を固定にする。
- モデルは GH Pages 配信を安定させるため `public/models/face_landmarker.task` に置き、参照パスは `import.meta.env.BASE_URL` 基準にする。
- カメラ処理は `getUserMedia()` で `video` に流しつつ、`video` 自体は非表示にする。`requestAnimationFrame` ループで `detectForVideo()` を回し、`canvas` に `DrawingUtils` でメッシュのみを描画する。
- 描画は顔全体メッシュを主表示にし、輪郭・目・眉・口を少し強調する。背景は黒、線は緑/白系で固定する。
- UI は 1 画面で完結させる。上部にテーマ説明、中央にメッシュ表示、下部に `カメラ開始 / 記録開始 / 記録停止 / JSON ダウンロード` を置く。
- テーマは `趣味について話してください` と `現在の仕事の課題やストレスについて話してください` の 2 つだけを選択可能にし、各テーマを独立セッションとして保存する。
- 録画中は React state にフレーム配列を積まず、`useRef` バッファに保持して一定件数ごとに IndexedDB へ追記する。停止時に残バッファを flush してメタデータを確定する。
- IndexedDB は少なくとも 2 ストアに分ける。
  - `sessions`: `id`, `themeKey`, `themeLabel`, `startedAt`, `endedAt`, `frameCount`, `status`
  - `frames`: `sessionId`, `frameIndex`, `timestampMs`, `elapsedMs`, `faceLandmarks`, `faceBlendshapes`, `facialTransformationMatrixes`, `hasFace`
- 履歴一覧では `sessions` のみを読み、選択時だけ `frames` を復元して JSON エクスポートする。
- JSON 出力は 1 セッション 1 ファイルに固定し、ファイル名は `session_<themeKey>_<startedAt>.json` 形式にする。
- JSON のトップレベル構造は `{ session, frames }` に固定する。`session` にはテーマ・時刻・件数、`frames` には各フレームの生データをそのまま入れる。
- エラー表示は少なくとも次を明示する。
  - カメラ権限拒否
  - MediaPipe モデル初期化失敗
  - 顔未検出
  - IndexedDB 保存失敗
- 研究用途なので外部送信は一切行わず、解析・保存・ダウンロードはすべてブラウザ内で完結させる。

## Public Interfaces / Types
- `ThemeKey = "hobby" | "stress"`
- `SessionRecord`:
  - `id: string`
  - `themeKey: ThemeKey`
  - `themeLabel: string`
  - `startedAt: string`
  - `endedAt: string | null`
  - `frameCount: number`
  - `status: "recording" | "completed"`
- `FrameRecord`:
  - `sessionId: string`
  - `frameIndex: number`
  - `timestampMs: number`
  - `elapsedMs: number`
  - `hasFace: boolean`
  - `faceLandmarks: NormalizedLandmark[][]`
  - `faceBlendshapes: Category[][]`
  - `facialTransformationMatrixes: Matrix[]`
- 画面上の公開機能は `テーマ選択`, `カメラ開始`, `記録開始`, `記録停止`, `履歴一覧`, `JSON ダウンロード`, `履歴削除` に固定する。

## Test Plan
- `npm run build` が成功し、成果物が `docs/` に出ることを確認する。
- ブラウザで初回起動し、カメラ許可後に顔メッシュだけが表示され、元映像が表示されないことを確認する。
- `趣味` と `仕事ストレス` をそれぞれ別セッションで記録し、履歴一覧に 2 件出ることを確認する。
- 記録停止後の JSON に `session` と `frames` があり、`faceLandmarks`, `faceBlendshapes`, `facialTransformationMatrixes` が入ることを確認する。
- ページ再読み込み後も履歴一覧が残り、再ダウンロードできることを確認する。
- 履歴削除後に IndexedDB と UI の双方から消えることを確認する。
- 顔が映っていない状態でもアプリが落ちず、`hasFace: false` のフレームかスキップ方針のどちらかに統一されていることを確認する。
- カメラ拒否・モデル読み込み失敗時に、操作不能で固まらずエラーメッセージが出ることを確認する。

## Assumptions
- 保存先は `localStorage` ではなく、ブラウザ内ローカル永続保存としての `IndexedDB` を使う。
- セッションは 2 テーマ固定で、1 回の記録につき 1 テーマだけを扱う。
- v1 のエクスポート形式は JSON のみとし、CSV は後続対応に回す。
- 対象は単一人物の正面顔で、複数人同時解析は行わない。
- 実行環境は HTTPS の GitHub Pages またはローカル開発サーバーを前提とする。
