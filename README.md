# facial-expression-logger

研究用途の会話誘導デモアプリです。  
画面の案内に沿って `趣味の話 → 仕事の話` を順番に進めると、MediaPipe Face Landmarker が顔特徴量を解析し、ブラウザ内に実験データを保存します。

## 特徴
- スマホ前提の段階型 UI
- ライブ映像を見ながら、案内に従って話すだけで実験を進められる
- 通常導線では `趣味 → 仕事` の順に進む
- 完了後に `趣味だけ` または `仕事だけ` を撮り直せる
- 映像ファイルは保存せず、顔特徴量の数値データだけを保存する

## 保存されるもの / されないもの
保存されるもの:

- 実験開始/終了時刻
- フェーズ情報
- フレームごとの顔ランドマーク
- 表情ブレンドシェイプ
- 顔変換行列
- 顔が検出されたかどうか

保存されないもの:

- 動画ファイル
- 静止画
- 外部サーバーへの送信データ

保存先はブラウザ内の `IndexedDB` です。

## 動作環境
- Node.js 25 系で確認
- npm 11 系で確認
- Web カメラ利用許可が必要
- HTTPS 環境のブラウザ、またはローカル開発サーバー

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
1. `実験を始める` を押します。
2. カメラ権限を許可し、顔の位置を整えます。
3. 画面の案内に沿って、まず趣味の話をします。
4. 次の案内に進み、仕事の話をします。
5. 完了後、研究の説明を確認します。
6. 必要なら `趣味だけ` または `仕事だけ` を撮り直します。
7. `保存済みデータ` から JSON をダウンロードします。

## JSON の内容
ダウンロードされる JSON は次の形です。

```json
{
  "experiment": {
    "id": "string",
    "startedAt": "2026-04-04T10:00:00.000Z",
    "endedAt": "2026-04-04T10:02:10.000Z",
    "status": "completed",
    "flowMode": "guided",
    "phaseOrder": ["hobby", "stress"],
    "completedPhases": ["hobby", "stress"]
  },
  "phases": [
    {
      "experimentId": "string",
      "phaseKey": "hobby",
      "label": "趣味",
      "startedAt": "2026-04-04T10:00:20.000Z",
      "endedAt": "2026-04-04T10:01:00.000Z",
      "frameCount": 120,
      "promptSetVersion": "guided-hobby-v1"
    }
  ],
  "frames": [
    {
      "experimentId": "string",
      "phaseKey": "hobby",
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

## 保存済みデータの見方
- `通常フロー`: 趣味と仕事を続けて実施した実験
- `趣味の撮り直し` / `仕事の撮り直し`: 完了後に個別で再実施した実験

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
開発者向けの詳細方針は [AGENTS.md](/Users/igaki/Documents/GitHub/facial-expression-logger/AGENTS.md) を参照してください。
