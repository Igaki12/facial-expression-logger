import { useCallback, useEffect, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type FaceLandmarkerStatus = "idle" | "loading" | "ready" | "error";

const MODEL_ASSET_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

export function useFaceLandmarker() {
  const [faceLandmarker, setFaceLandmarker] = useState<FaceLandmarker | null>(null);
  const [status, setStatus] = useState<FaceLandmarkerStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const initialize = useCallback(async () => {
    if (status === "loading" || faceLandmarker) {
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      const nextFaceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_PATH,
        },
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: "VIDEO",
      });

      setFaceLandmarker(nextFaceLandmarker);
      setStatus("ready");
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "MediaPipe Face Landmarker の初期化に失敗しました。";
      setError(message);
      setStatus("error");
    }
  }, [faceLandmarker, status]);

  useEffect(() => {
    return () => {
      faceLandmarker?.close();
    };
  }, [faceLandmarker]);

  return {
    faceLandmarker,
    status,
    error,
    initialize,
  };
}
