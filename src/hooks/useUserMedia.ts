import { useCallback, useEffect, useState } from "react";

type CameraStatus = "idle" | "requesting" | "ready" | "error";

function formatUserMediaError(caughtError: unknown): string {
  if (caughtError instanceof Error) {
    const isPermissionError =
      caughtError.name === "NotAllowedError" ||
      caughtError.name === "PermissionDeniedError" ||
      /permission denied/i.test(caughtError.message);

    if (isPermissionError) {
      return "カメラやマイクの権限が得られませんでした。ChromeやSafariなどデフォルトのブラウザを使用してください。";
    }

    return caughtError.message;
  }

  return "カメラとマイクへのアクセスに失敗しました。";
}

export function useUserMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    setStream((currentStream) => {
      currentStream?.getTracks().forEach((track) => track.stop());
      return null;
    });
    setStatus("idle");
  }, []);

  const startCamera = useCallback(async () => {
    if (stream) {
      return stream;
    }

    setStatus("requesting");
    setError(null);

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      setStream(nextStream);
      setStatus("ready");
      return nextStream;
    } catch (caughtError) {
      setError(formatUserMediaError(caughtError));
      setStatus("error");
      throw caughtError;
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  return {
    stream,
    status,
    error,
    startCamera,
    stopCamera,
  };
}
