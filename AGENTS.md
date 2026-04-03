# Project: 表情変化・ストレス検出デモアプリ

## 1. 目的
本プロジェクトは研究用途の Web アプリです。被験者に「趣味の話」と「仕事のストレスの話」をしてもらい、その際の顔の表情変化を MediaPipe で解析して時系列保存します。

重要な前提は以下です。

- 画面上には通常の Web カメラ映像を表示する
- 映像ファイルや静止画は保存しない
- 保存対象は MediaPipe が返す顔特徴量データのみ
- 解析と保存はブラウザ内で完結させる

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

## 3. 実装方針

### 3.1 表示
- 主表示は `<video>` によるライブ映像
- 顔ランドマークのリアルタイム描画は行わない
- 動画上には必要最低限のオーバーレイのみ表示する
- UI は 1 画面完結型にする

### 3.2 解析
- `getUserMedia()` で取得したカメラ映像を `video` に流す
- `requestAnimationFrame` ループの中で `faceLandmarker.detectForVideo()` を呼ぶ
- 解析結果は UI 描画には使わず、状態表示と保存にだけ使う

Face Landmarker の設定:

- `runningMode: "VIDEO"`
- `numFaces: 1`
- `outputFaceBlendshapes: true`
- `outputFacialTransformationMatrixes: true`

### 3.3 保存
- セッションはテーマ単位で分ける
- 保存先は `localStorage` ではなく `IndexedDB`
- フレーム単位の生データは React state ではなく `useRef` に一時保持し、一定件数ごとに IndexedDB に flush する
- 停止時に残りのバッファを flush してセッションを完了状態にする

## 4. 記録対象データ
各フレームで、取得できる情報は間引かず保存すること。

- `timestampMs`
- `elapsedMs`
- `hasFace`
- `faceLandmarks`
- `faceBlendshapes`
- `facialTransformationMatrixes`

セッション情報には少なくとも以下を含めること。

- `id`
- `themeKey`
- `themeLabel`
- `startedAt`
- `endedAt`
- `frameCount`
- `status`

## 5. テーマと UI 要件
テーマは現状 2 つ固定です。

- `hobby`: あなたの趣味について教えてください
- `stress`: 現在の仕事の課題やストレスについて教えてください

画面上の公開機能:

- テーマ選択
- カメラ開始
- 記録開始
- 記録停止
- JSON ダウンロード
- 履歴一覧
- 履歴削除

通知として最低限出すもの:

- カメラ権限エラー
- MediaPipe 初期化失敗
- 顔未検出
- IndexedDB 保存失敗

## 6. データ構造
IndexedDB は少なくとも以下の 2 ストアを持つこと。

### `sessions`
- `id`
- `themeKey`
- `themeLabel`
- `startedAt`
- `endedAt`
- `frameCount`
- `status`

### `frames`
- `sessionId`
- `frameIndex`
- `timestampMs`
- `elapsedMs`
- `hasFace`
- `faceLandmarks`
- `faceBlendshapes`
- `facialTransformationMatrixes`

## 7. エクスポート要件
- エクスポート形式は現状 JSON のみ
- 1 セッション 1 ファイル
- ファイル名は `session_<themeKey>_<startedAt>.json`
- JSON のトップレベルは `{ session, frames }`

## 8. AI 開発エージェントへの指示
このリポジトリを変更する AI 開発エージェントは以下を守ること。

- ライブ映像表示を勝手にメッシュ描画へ戻さない
- 映像ファイルや画像を保存対象に追加しない
- Face Landmarker の出力データは削らず、研究用途として生データを保持する
- 長時間記録を考慮し、フレーム配列を React state に積まない
- 既存の GitHub Pages 配信前提を壊さない
- 変更後は `npm run build` を通し、`docs/` 出力が維持されることを確認する

## 9. 非機能要件
- 外部サーバー送信は行わない
- HTTPS の GitHub Pages またはローカル開発サーバーで動作すること
- 体験を損ねる点滅や過剰な描画負荷を避けること
- モバイル幅でも操作不能にならないこと
