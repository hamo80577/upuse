import { describeApiError } from "../../../../../shared/api/httpClient";

const CAMERA_SCAN_FRAME = {
  widthRatio: 0.84,
  heightRatio: 0.28,
};

export const CAMERA_SCAN_INTERVAL_MS = 150;

export function getCameraScanRegion(frameWidth: number, frameHeight: number) {
  const width = Math.max(1, Math.round(frameWidth * CAMERA_SCAN_FRAME.widthRatio));
  const height = Math.max(1, Math.round(frameHeight * CAMERA_SCAN_FRAME.heightRatio));
  return {
    width,
    height,
    left: Math.max(0, Math.round((frameWidth - width) / 2)),
    top: Math.max(0, Math.round((frameHeight - height) / 2)),
  };
}

export function getCameraAvailabilityError() {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "Camera access requires HTTPS or localhost on mobile browsers.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Camera scanning is not supported on this device.";
  }
  return "";
}

export function describeCameraError(error: unknown) {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "Camera access requires HTTPS or localhost on mobile browsers.";
  }

  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was denied. Allow camera permission and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is busy in another app. Close it there and try again.";
    case "AbortError":
      return "Camera startup was interrupted. Try opening it again.";
    default:
      return describeApiError(error, "Failed to open the camera.");
  }
}
