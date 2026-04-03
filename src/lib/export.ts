import type { FrameRecord, SessionRecord } from "../types";

function sanitizeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

export function downloadSessionExport(
  session: SessionRecord,
  frames: FrameRecord[],
): void {
  const payload = JSON.stringify({ session, frames }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = `session_${session.themeKey}_${sanitizeTimestamp(session.startedAt)}.json`;

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}
