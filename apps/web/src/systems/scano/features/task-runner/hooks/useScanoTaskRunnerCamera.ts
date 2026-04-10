import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_SCAN_INTERVAL_MS, describeCameraError, getCameraAvailabilityError, getCameraScanRegion } from "../lib/cameraScanner";
import type { ScannerControlsLike } from "../types";

export function useScanoTaskRunnerCamera(params: {
  isMobile: boolean;
  onBarcodeDetected: (barcode: string) => void;
}) {
  const { isMobile, onBarcodeDetected } = params;
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<ScannerControlsLike | null>(null);
  const cameraScanTimerRef = useRef<number | null>(null);
  const cameraSessionRef = useRef(0);
  const lastDecodedBarcodeRef = useRef("");

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1;

    if (cameraScanTimerRef.current != null) {
      window.clearTimeout(cameraScanTimerRef.current);
      cameraScanTimerRef.current = null;
    }

    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    lastDecodedBarcodeRef.current = "";

    const mediaStream = videoRef.current?.srcObject;
    const canStopTracks = typeof mediaStream === "object"
      && mediaStream !== null
      && "getTracks" in mediaStream
      && typeof mediaStream.getTracks === "function";
    if (canStopTracks) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraLoading(false);
    setCameraOpen(false);
  }, []);

  useEffect(() => () => {
    stopCamera();
  }, [stopCamera]);

  const toggleCamera = useCallback(async () => {
    if (cameraOpen) {
      stopCamera();
      return;
    }

    const availabilityError = getCameraAvailabilityError();
    if (availabilityError) {
      setCameraError(availabilityError);
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement) {
      setCameraError("Camera preview is still loading. Try again.");
      return;
    }

    const sessionId = cameraSessionRef.current + 1;
    cameraSessionRef.current = sessionId;

    try {
      setCameraOpen(true);
      setCameraLoading(true);
      setCameraError("");
      lastDecodedBarcodeRef.current = "";

      const [{ BrowserMultiFormatOneDReader }, mediaStream] = await Promise.all([
        import("@zxing/browser"),
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: isMobile ? 1920 : 1280 },
            height: { ideal: isMobile ? 1080 : 720 },
          },
        }),
      ]);

      if (cameraSessionRef.current !== sessionId) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      videoElement.srcObject = mediaStream;
      await videoElement.play();

      if (cameraSessionRef.current !== sessionId) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      const reader = new BrowserMultiFormatOneDReader();
      const scanCanvas = document.createElement("canvas");
      const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

      if (!scanContext) {
        throw new Error("Could not prepare the camera scanner.");
      }

      const stopScanLoop = () => {
        if (cameraScanTimerRef.current != null) {
          window.clearTimeout(cameraScanTimerRef.current);
          cameraScanTimerRef.current = null;
        }
      };

      scannerControlsRef.current = {
        stop: stopScanLoop,
      };

      const scanFrame = () => {
        if (cameraSessionRef.current !== sessionId) {
          return;
        }

        if (videoElement.readyState < 2 || videoElement.videoWidth < 1 || videoElement.videoHeight < 1) {
          cameraScanTimerRef.current = window.setTimeout(scanFrame, CAMERA_SCAN_INTERVAL_MS);
          return;
        }

        const region = getCameraScanRegion(videoElement.videoWidth, videoElement.videoHeight);
        scanCanvas.width = region.width;
        scanCanvas.height = region.height;

        scanContext.drawImage(
          videoElement,
          region.left,
          region.top,
          region.width,
          region.height,
          0,
          0,
          region.width,
          region.height,
        );

        try {
          const result = reader.decodeFromCanvas(scanCanvas);
          const barcode = result?.getText()?.trim() ?? "";
          if (!barcode || barcode === lastDecodedBarcodeRef.current) {
            cameraScanTimerRef.current = window.setTimeout(scanFrame, CAMERA_SCAN_INTERVAL_MS);
            return;
          }

          lastDecodedBarcodeRef.current = barcode;
          stopCamera();
          onBarcodeDetected(barcode);
          return;
        } catch {
          cameraScanTimerRef.current = window.setTimeout(scanFrame, CAMERA_SCAN_INTERVAL_MS);
          return;
        }
      };

      scanFrame();
    } catch (error) {
      stopCamera();
      setCameraError(describeCameraError(error));
    } finally {
      if (cameraSessionRef.current === sessionId) {
        setCameraLoading(false);
      }
    }
  }, [cameraOpen, isMobile, onBarcodeDetected, stopCamera]);

  return {
    cameraError,
    cameraLoading,
    cameraOpen,
    stopCamera,
    toggleCamera,
    videoRef,
  };
}
