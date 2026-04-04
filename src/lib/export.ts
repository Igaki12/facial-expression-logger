import type { ExperimentExport } from "../types";

function sanitizeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

export function downloadExperimentExport(experimentExport: ExperimentExport): void {
  const payload = JSON.stringify(experimentExport, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const { experiment } = experimentExport;
  const filename = `experiment_${sanitizeTimestamp(experiment.startedAt)}.json`;

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}
