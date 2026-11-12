"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function joinText(base: string, spoken: string) {
  const left = base.replace(/\s+$/, "");
  const right = spoken.trim();
  if (!right) {
    return base;
  }
  return left ? `${left} ${right}` : right;
}

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function extensionForMime(mime: string) {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Push-to-talk speech-to-text via OpenAI Whisper (server).
 * Click mic to start recording; click again to stop and transcribe.
 */
export function useSpeechInput({
  value,
  onChange,
  lang = "en-US",
  prompt = "",
}: {
  value: string;
  onChange: (next: string) => void;
  lang?: string;
  /** Optional hint for Whisper (product terms, names, etc.). */
  prompt?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const promptRef = useRef(prompt);
  const langRef = useRef(lang);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startingRef = useRef(false);
  const cancelledRef = useRef(false);

  valueRef.current = value;
  onChangeRef.current = onChange;
  promptRef.current = prompt;
  langRef.current = lang;

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined";
    setSupported(ok);
    return () => {
      cancelledRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const releaseMic = useCallback(() => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      /* ignore */
    }
    recorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    chunksRef.current = [];
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob) => {
    if (blob.size < 800) {
      setError("Didn't catch that. Hold the mic a moment longer and speak clearly.");
      return;
    }

    setTranscribing(true);
    setError("");
    try {
      const mime = blob.type || "audio/webm";
      const file = new File([blob], `speech.${extensionForMime(mime)}`, {
        type: mime,
      });
      const body = new FormData();
      body.append("audio", file);
      body.append("language", langRef.current || "en-US");
      if (promptRef.current.trim()) {
        body.append("prompt", promptRef.current.trim());
      }

      const response = await fetch("/api/speech/transcribe", {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => null)) as {
        text?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error || "Could not transcribe speech.");
      }

      const spoken = String(data?.text || "").trim();
      if (!spoken) {
        setError("Could not hear that. Try again.");
        return;
      }

      onChangeRef.current(joinText(valueRef.current, spoken));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not transcribe speech.";
      if (/Not authenticated|401/i.test(message)) {
        setError("Sign in again to use the microphone.");
      } else if (/not configured|OPENAI/i.test(message)) {
        setError("Speech transcription is not configured on the server.");
      } else {
        setError(message);
      }
    } finally {
      setTranscribing(false);
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      releaseMic();
      setRecording(false);
      return;
    }

    recorder.onstop = () => {
      const mime = recorder.mimeType || pickRecorderMimeType() || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      if (!cancelledRef.current) {
        void transcribeBlob(blob);
      }
    };

    try {
      recorder.stop();
    } catch {
      releaseMic();
      setRecording(false);
    }
  }, [releaseMic, transcribeBlob]);

  const start = useCallback(async () => {
    if (startingRef.current || recording || transcribing) {
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Speaking needs a modern browser with microphone access.");
      return;
    }

    startingRef.current = true;
    setError("");
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      const mime = pickRecorderMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setError("Microphone recording failed. Try again.");
        releaseMic();
        setRecording(false);
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
    } catch (err) {
      releaseMic();
      setRecording(false);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Microphone access is blocked. Allow it in the browser to speak.");
      } else if (name === "NotFoundError") {
        setError("No microphone was found.");
      } else {
        setError("Could not start the microphone.");
      }
    } finally {
      startingRef.current = false;
    }
  }, [recording, releaseMic, transcribing]);

  const toggle = useCallback(() => {
    if (transcribing) {
      return;
    }
    if (recording || recorderRef.current) {
      stop();
    } else {
      void start();
    }
  }, [recording, start, stop, transcribing]);

  return {
    supported,
    /** True while recording or waiting on Whisper (keeps existing mic pulse UIs working). */
    listening: recording || transcribing,
    recording,
    transcribing,
    error,
    start,
    stop,
    toggle,
  };
}
