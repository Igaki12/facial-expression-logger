import type { ThemeContent, ThemeKey } from "./types";

export const PHASE_ORDER: ThemeKey[] = ["hobby", "stress"];
export const FLUSH_BATCH_SIZE = 30;
export const GUIDE_ROTATION_MS = 4200;

export const PHASE_CONTENT: Record<ThemeKey, ThemeContent> = {
  hobby: {
    key: "hobby",
    label: "趣味",
    shortLabel: "1",
    introTitle: "まずは、好きなことの話から",
    introLead:
      "かしこまらず、気楽に話してください。思い出しやすいことからで十分です。",
    recordingTitle: "好きなことを、そのまま声にしてみてください",
    recordingLead:
      "うまくまとめなくて大丈夫です。思いついた順で、ひとつずつ話してみてください。",
    rotatingPrompts: [
      "最近楽しかった休日のことを、ひとつ思い出して話してみてください。",
      "ペットや好きな動物、ふだん見ていて癒やされるものがあれば教えてください。",
      "最近よく食べるもの、つい選んでしまうお店や飲み物のことでも大丈夫です。",
      "よく行く場所や、つい長居してしまう場所のことを話してみてください。",
      "最近見た動画や映画、本、ゲームなど、印象に残っているものでも構いません。",
    ],
    examplePills: [
      "ペット",
      "休日の過ごし方",
      "最近楽しかったこと",
      "好きな食べ物",
      "最近見たもの",
      "よく行く場所",
    ],
    supportiveHint: "途中で話題が変わっても問題ありません。話しやすい内容を続けてください。",
    promptSetVersion: "guided-hobby-v1",
  },
  stress: {
    key: "stress",
    label: "仕事",
    shortLabel: "2",
    introTitle: "つぎは、ふだんの仕事の話へ",
    introLead:
      "ここでは仕事の流れや過ごし方を教えてください。評価ではないので、自然に話して大丈夫です。",
    recordingTitle: "いつもの仕事の様子を思い浮かべながら話してください",
    recordingLead:
      "どんな一日なのか、どんな進み方なのか、思い出せる順番でゆっくり話してみてください。",
    rotatingPrompts: [
      "仕事の日は、朝からどんな流れで一日が進むことが多いですか。",
      "最近よくあるやり取りや、繰り返し出てくる作業があれば教えてください。",
      "忙しくなりやすい時間帯や、集中する場面があればその様子を話してみてください。",
      "仕事でよく使う道具や画面、連絡の取り方など、ふだんの進め方でも大丈夫です。",
      "最近印象に残った業務や、調整が必要だった出来事があれば教えてください。",
    ],
    examplePills: [
      "一日のスケジュール",
      "最近の仕事の流れ",
      "よくあるやり取り",
      "忙しい時間帯",
      "進め方",
      "印象に残った業務",
    ],
    supportiveHint: "答えにくい内容は避けて大丈夫です。話せる範囲で進めてください。",
    promptSetVersion: "guided-work-v1",
  },
};

export const RESEARCH_DEBRIEF = {
  title: "この実験で見ていたこと",
  body:
    "この取り組みでは、話題が切り替わるときの表情と声の変化を研究用に記録しています。保存しているのは顔ランドマーク、表情ブレンドシェイプ、顔変換行列などの数値データと音声です。映像ファイルや静止画は保存していません。",
  detail:
    "趣味の話と仕事の話を続けて行うことで、話題の違いによる変化を比較できるようにしています。必要があれば、最後の画面から片方だけ撮り直せます。",
};
