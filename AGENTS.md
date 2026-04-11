# Project: 表情変化・会話誘導デモアプリ

## 1. 目的
本プロジェクトは研究用途の Web アプリです。被験者に、画面上の案内に沿って `趣味の話` と `仕事の話` を順番にしてもらい、その間の顔の表情変化を MediaPipe で解析して時系列保存し、あわせてフェーズごとの音声も録音します。

重要な前提:

- 画面上では実験目的を最後まで強く開示しない
- 導線は `趣味 → 仕事` の固定順を基本とする
- 保存対象は顔特徴量の数値データとフェーズごとの音声録音
- 映像ファイルや静止画は保存しない
- 解析と保存はブラウザ内で完結させる
- 録画中・録音中を UI に併記し、カメラとマイクを使うことは分かるようにする
- 完了後にのみ、研究意図と記録内容を説明する

## 2. 現在の技術スタック
- フレームワーク: React + TypeScript
- ビルドツール: Vite
- 顔解析: `@mediapipe/tasks-vision` の Face Landmarker
- 音声録音: MediaRecorder API
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
- プライマリーな CTA ボタン行は右寄せを基本にする

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

節目画面の見た目:

- `work_transition`
- `completion`
- `debrief`

上記のような節目画面では、`h2` の上に大きめのフラットアイコンを中央配置で表示してよい。
- アイコンは Cloudflare などで一般的な外部 SVG アイコン配信を使ってよい
- 文字や絵文字ではなく、明確にアイコンとして見えるものを使う
- 枠付きタイル風にはせず、素のアイコンを中央に見せる
- アニメーションは常時ループではなく、画面表示時のフェードインやスライドインのような短い導入演出に留める
- 管理画面風ではなく、進行の場面転換を感じられる演出を優先する

### 3.3 履歴画面
- `history` では保存済み experiment を一覧表示する
- 各 experiment に対して、顔特徴量データの操作として少なくとも以下を出す
  - `確認`
  - `JSON`
  - `削除`
- `確認` は JSON を直接読む代わりに、保存済みランドマークを簡易プレビューできる UI にする
- プレビューは履歴画面内で完結させ、別ページやモーダル必須にはしない
- プレビューでは、保存済み `frames` を使って顔メッシュを簡易再構成し、どのような記録が残っているかを手元で素早く確認できること
- 音声はフェーズ別に一覧表示し、少なくとも以下の操作を出す
  - `確認`
  - `出力`
  - `削除`
- 音声の `確認` は履歴画面内の `<audio controls>` による再生確認にする
- 音声の `出力` は WebM を基本にした個別ダウンロードにする
- 音声の `削除` は該当フェーズの音声だけを削除し、顔特徴量データは削除しない

### 3.4 文言方針
- 趣味フェーズでは、ペット、休日、最近楽しかったこと、好きな食べ物、最近見たもの、よく行く場所など、話しやすい具体例を多く出す
- 仕事フェーズでは、仕事の流れ、一日のスケジュール、よくあるやり取り、忙しい時間帯、進め方、印象に残った業務などを出す
- `ストレス` という言葉は被験者向け UI に直接出さない
- 何を記録しているか、何の研究かは最後の `debrief` で初めて詳しく説明する

### 3.5 固定プロンプト表示
- `phase_guide` と `phase_recording` では、回転するきっかけプロンプトを `floating-prompt` として固定表示する
- 配置は画面上部から少し下がった位置を基本にし、動画下部の overlay と被りにくくする
- 固定プロンプトは前面表示とし、`z-index` を高く保つ
- 軽い漂い、光彩、背景のゆらぎなどの穏やかな演出を付けてよい
- ただし可読性を損なう過剰な動きにはしない
- `phase_guide` / `phase_recording` 内に同じ内容のプロンプトカードを重複表示しない

### 3.6 動画上オーバーレイ
- `stage-overlay` は動画下部に重ねる
- 固定プロンプトとは役割を分け、短い状態案内だけを表示する
- 固定プロンプトと位置が競合しないようにする

### 3.7 スマートフォン向け操作性
- Canvas / Video を親要素の幅・高さへ自動追従させるレスポンシブ化は行わない
- Android 画面での Canvas と Video のずれを避けるため、ライブ映像の寸法制御は現行方式を維持する
- ライブ映像に顔メッシュ描画用 Canvas を重ねない
- 主要操作は、動画上に重ねるか画面下部に固定する形で近接配置してよい
- 固定操作エリアを使う場合は、セーフエリアと本文末尾の隠れを考慮する
- ボタンや履歴操作には Iconify などの外部 SVG アイコンを補助的に使ってよい
- アイコンは `aria-hidden="true"` とし、操作の意味はテキストまたは `aria-label` で保証する

## 4. 解析方針
- 主表示は `<video>` によるライブ映像
- 顔ランドマークのリアルタイム描画は行わない
- `requestAnimationFrame` ループ内で `faceLandmarker.detectForVideo()` を呼ぶ
- 解析結果は UI 描画には使わず、状態表示と保存に使う
- 履歴プレビューでは、保存済み `faceLandmarks` を `canvas` に再描画して簡易確認できるようにしてよい
- 履歴プレビューは確認用の簡易再構成であり、元映像の復元や保存を目的にしない
- 音声録音は MediaRecorder API を使い、各 `phase_recording` の自動開始・自動停止に合わせる
- 録音形式は追加依存なしで扱いやすい `audio/webm` を標準にする
- `audio/webm` が使えない場合は `MediaRecorder.isTypeSupported()` で利用可能な MIME type にフォールバックする
- ZIP 一括出力や WAV 変換は現時点の基本実装に含めない

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

### `AudioClipRecord`
- `experimentId`
- `phaseKey`
- `label`
- `startedAt`
- `endedAt`
- `mimeType`
- `sizeBytes`
- `audioBlob`

IndexedDB は少なくとも以下の 4 ストアを持つこと。

- `experiments`
- `phases`
- `frames`
- `audioClips`

現在の IndexedDB スキーマ前提:

- DB 名は `facial-expression-logger-db`
- 現在のスキーマバージョンは `4`
- `frames` のキーは `["experimentId", "phaseKey", "frameIndex"]`
- `phases` のキーは `["experimentId", "phaseKey"]`
- `audioClips` のキーは `["experimentId", "phaseKey"]`
- `audioClips` には `by-experiment` index を作る
- 旧 `sessions` ストアは移行時に削除する
- 旧キー構造の `frames` / `phases` が残っている場合は、upgrade 時に再作成して整合を取る

移行上の注意:

- 保存構造を変更する場合は、既存ブラウザの IndexedDB に旧ストアが残る前提で upgrade 処理を書くこと
- `put()` 時の `Evaluating the object store's key path did not yield a value` は、旧キー定義のまま新オブジェクトを書いている可能性を先に疑うこと
- ストア名を再利用する場合は、`keyPath` と index 構造の互換性を必ず確認すること

## 6. 記録制御
- 被験者向け UI には `記録開始` / `記録停止` の生ボタンを常設しない
- 各フェーズの顔特徴量記録と音声録音は、画面遷移に応じて内部で自動開始・自動停止する
- フレーム保存は React state ではなく `useRef` バッファを使って一定件数ごとに flush する
- 音声チャンクも React state に積まず、`useRef` バッファに保持してフェーズ終了時に保存する
- 完了後は顔特徴量データを `1 experiment = 1 JSON` としてエクスポートする
- 音声はフェーズ別に WebM ファイルとして個別出力する
- MIME type が `audio/mp4` にフォールバックした場合は、音声出力の拡張子を `.m4a` にする
- 履歴画面では `JSON` ダウンロードに加えて、保存済みフレームの簡易プレビュー確認機能と音声確認・出力・削除機能を維持する

録画状態の見せ方:

- `録画中` / `録音中` バッジは赤基調の目立つデザインにする
- 必要に応じて、赤いグラデーションや発光、穏やかな波打ち演出を加えてよい
- ただし録画・録音状態以外のバッジと視覚的に区別できることが重要

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
- 映像ファイルや静止画を保存対象に追加しない
- 音声録音は保存対象として維持する
- `getUserMedia` からマイク取得を外さない
- MediaRecorder によるフェーズ別録音を削除しない
- Face Landmarker の出力データは削らず、生データを保持する
- 履歴画面の `確認` 機能を削除したり、JSON ダウンロードだけに戻したりしない
- プレビュー機能は保存済みランドマークの確認に限定し、元映像の再生機能にはしない
- 履歴画面の音声 `確認` / `出力` / `削除` 機能を削除しない
- 音声の削除操作で顔特徴量データを削除しない
- experiment 全体削除では、顔特徴量データと音声データをまとめて削除する
- 固定プロンプトを通常の本文位置に戻して常設カード化しない
- `stage-overlay` と固定プロンプトの役割を混ぜない
- Canvas / Video を親要素の幅・高さへ自動追従させる変更を入れない
- ライブ映像に顔メッシュ描画 Canvas を重ねない
- 長時間記録を考慮し、フレーム配列を React state に積まない
- 長時間記録を考慮し、音声チャンク配列を React state に積まない
- GitHub Pages 配信前提を壊さない
- IndexedDB スキーマを変える場合は、upgrade 処理まで含めて実装する
- 変更後は `npm run build` を通し、`docs/` 出力が維持されることを確認する

## 9. 非機能要件
- 外部サーバー送信は行わない
- HTTPS の GitHub Pages またはローカル開発サーバーで動作すること
- モバイル幅でも操作不能にならないこと
- 点滅や過剰な描画負荷を避けること
- 被験者が「何をすればよいか」で迷わないことを優先する
