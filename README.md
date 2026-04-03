# facial-expression-logger

研究用途の表情変化・ストレス検出デモアプリです。  
Web カメラのライブ映像を表示しながら、MediaPipe Face Landmarker で顔特徴量を解析し、セッション単位でブラウザ内に保存します。

## できること
- `趣味` と `仕事ストレス` の 2 テーマでセッションを分けて記録する
- ライブ映像を見ながら計測する
- 顔ランドマーク、ブレンドシェイプ、顔変換行列などの数値データを保存する
- 保存済みセッションを JSON で再ダウンロードする
- ブラウザ内の履歴を削除する

## 保存されるもの / されないもの
保存されるもの:

- テーマ名
- 記録開始/終了時刻
- フレームごとの顔特徴量データ
- 顔が検出されたかどうか

保存されないもの:

- 動画ファイル
- 静止画
- 外部サーバーへの送信データ

保存先はブラウザ内の `IndexedDB` です。

## 動作環境
- Node.js 25 系で確認
- npm 11 系で確認
- HTTPS 環境のブラウザ、またはローカル開発サーバー
- Web カメラ利用許可が必要

## セットアップ
```bash
npm install
```

## ローカル起動
```bash
npm run dev
```

Vite の開発サーバーが起動したら、表示された URL をブラウザで開いてください。

## ビルド
```bash
npm run build
```

ビルド成果物は `docs/` に出力されます。GitHub Pages 用の設定も含まれています。

## 使い方
1. テーマを `趣味` または `仕事ストレス` から選びます。
2. `カメラ開始` を押してカメラ権限を許可します。
3. ライブ映像が表示されたら `記録開始` を押します。
4. テーマに沿って話します。
5. `記録停止` を押します。
6. `JSON ダウンロード` または履歴一覧の `JSON` ボタンからデータを書き出します。

## JSON の内容
ダウンロードされる JSON は次の形です。

```json
{
  "session": {
    "id": "string",
    "themeKey": "hobby",
    "themeLabel": "趣味",
    "startedAt": "2026-04-03T12:34:56.000Z",
    "endedAt": "2026-04-03T12:35:20.000Z",
    "frameCount": 120,
    "status": "completed"
  },
  "frames": [
    {
      "sessionId": "string",
      "frameIndex": 0,
      "timestampMs": 1710000000000,
      "elapsedMs": 0,
      "hasFace": true,
      "faceLandmarks": [],
      "faceBlendshapes": [],
      "facialTransformationMatrixes": []
    }
  ]
}
```

## トラブルシュート
- カメラが起動しない: ブラウザのカメラ権限と HTTPS 条件を確認してください。
- 顔未検出が続く: 顔がフレーム内に入っているか、明るさが十分かを確認してください。
- 保存できない: ブラウザのストレージ制限やプライベートブラウズ設定の影響を確認してください。
- GitHub Pages でモデルが読めない: `public/models/face_landmarker.task` が配置されていることを確認してください。

## 技術概要
- React
- TypeScript
- Vite
- `@mediapipe/tasks-vision`
- IndexedDB

## 開発メモ
開発者向けの詳細方針と制約は [AGENTS.md](/Users/igaki/Documents/GitHub/facial-expression-logger/AGENTS.md) を参照してください。
