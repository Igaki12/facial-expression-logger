import { useCallback, useEffect, useState } from "react";

type CameraStatus = "idle" | "requesting" | "ready" | "error";

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
        audio: false,
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
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "カメラへのアクセスに失敗しました。";
      setError(message);
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
