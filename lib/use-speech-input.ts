"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlternative; length: number };
type SpeechResultEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
};
type SpeechErrorEvent = { error: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function joinText(base: string, spoken: string) {
  const left = base.replace(/\s+$/, "");
  const right = spoken.trim();
  if (!right) {
    return base;
  }
  return left ? `${left} ${right}` : right;
}

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in the browser to speak.",
  "service-not-allowed": "Microphone access is blocked. Allow it in the browser to speak.",
  "audio-capture": "No microphone was found.",
  network: "Speech needs an internet connection.",
};

/** Browser speech-to-text that writes into a text field as you talk. */
export function useSpeechInput({
  value,
  onChange,
  lang = "en-US",
}: {
  value: string;
  onChange: (next: string) => void;
  lang?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    setSupported(Boolean(speechCtor()));
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) {
      setError("Speaking is not supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    recognitionRef.current?.abort();
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    baseRef.current = valueRef.current;
    finalRef.current = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalRef.current = joinText(finalRef.current, text);
        } else {
          interim = joinText(interim, text);
        }
      }
      onChangeRef.current(
        joinText(baseRef.current, joinText(finalRef.current, interim)),
      );
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setError(ERROR_TEXT[event.error] ?? "Could not hear that. Try again.");
      }
    };
    recognition.onend = () => {
      setListening(false);
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    setError("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setError("Could not start the microphone.");
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  return { supported, listening, error, start, stop, toggle };
}
