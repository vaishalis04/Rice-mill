import { useEffect, useRef, useState } from "react";
import "./CameraCapture.css";

/**
 * <CameraCapture onCapture={(dataUrl) => ...} onClose={() => ...} />
 *
 * Opens the device's actual camera (via navigator.mediaDevices.getUserMedia)
 * in a live preview and lets the person snap a still frame — this is a real
 * camera capture, not a file-picker dialog. getUserMedia only works in a
 * "secure context" (https, or http://localhost during dev), and needs the
 * person to grant camera permission when the browser prompts.
 *
 * If the camera can't be reached for any reason (no camera, permission
 * denied, insecure context, unsupported browser), this falls back to a
 * plain file input so a photo can still be picked from disk/gallery.
 */
export default function CameraCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera access isn't available in this browser/context (needs https, or http://localhost during dev)."
      );
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err.name === "NotAllowedError"
            ? "Camera permission was denied — allow camera access, or upload a photo instead."
            : err.name === "NotFoundError"
            ? "No camera was found on this device — upload a photo instead."
            : "Couldn't open the camera — upload a photo instead."
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.85));
  };

  const handleFileFallback = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That's not an image file — try again.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onCapture(reader.result);
    reader.onerror = () => setError("Couldn't read that photo — try again.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="cc-overlay" onClick={onClose}>
      <div className="cc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cc-header">
          <span>Take Driver Photo</span>
          <button type="button" className="cc-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error ? (
          <div className="cc-fallback">
            <p className="cc-error">{error}</p>
            <label className="dt-btn" style={{ cursor: "pointer" }}>
              📁 Upload a photo instead
              <input
                type="file"
                accept="image/*"
                onChange={handleFileFallback}
                style={{ display: "none" }}
              />
            </label>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="cc-video" autoPlay playsInline muted />
            <div className="cc-actions">
              <button type="button" className="sf-submit" onClick={handleSnap} disabled={!ready}>
                {ready ? "📸 Capture" : "Starting camera…"}
              </button>
              <button type="button" className="sf-cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}