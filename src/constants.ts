import type { ThemeOption } from "./types";

export const THEMES: ThemeOption[] = [
  {
    key: "hobby",
    label: "趣味",
    prompt: "あなたの趣味について教えてください",
    description: "リラックスした状態で、好きなことを自由に話してください。",
  },
  {
    key: "stress",
    label: "仕事ストレス",
    prompt: "現在の仕事の課題やストレスについて教えてください",
    description: "最近負荷を感じた仕事上の状況や悩みを話してください。",
  },
];

export const FLUSH_BATCH_SIZE = 30;
