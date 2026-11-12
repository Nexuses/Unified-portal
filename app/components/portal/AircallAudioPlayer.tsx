"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type AircallAudioPlayerProps = {
  src: string;
  className?: string;
  title?: string;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function AircallAudioPlayer({
  src,
  className = "",
  title = "Call recording",
}: AircallAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setError("");
    setOpen(false);
  }, [src]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      try {
        await audio.play();
        if (!cancelled) {
          setPlaying(true);
        }
      } catch (err) {
        if (!cancelled) {
          setPlaying(false);
          setError(
            err instanceof Error ? err.message : "Could not play recording",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, src]);

  function closeModal() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    setPlaying(false);
    setOpen(false);
  }

  function openAndPlay() {
    setError("");
    setOpen(true);
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    setError("");
    try {
      if (audio.paused) {
        await audio.play();
        setPlaying(true);
      } else {
        audio.pause();
        setPlaying(false);
      }
    } catch (err) {
      setPlaying(false);
      setError(err instanceof Error ? err.message : "Could not play recording");
    }
  }

  function seekBy(delta: number) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const next = Math.min(
      audio.duration || 0,
      Math.max(0, audio.currentTime + delta),
    );
    audio.currentTime = next;
    setCurrent(next);
  }

  function seekToRatio(ratio: number) {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) {
      return;
    }
    const next = Math.min(1, Math.max(0, ratio)) * audio.duration;
    audio.currentTime = next;
    setCurrent(next);
  }

  const progress =
    duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;

  const modal =
    mounted && open
      ? createPortal(
          <div
            className="aircall-player-modal-backdrop"
            role="presentation"
            onClick={closeModal}
          >
            <div
              className="aircall-player-modal"
              role="dialog"
              aria-modal="true"
              aria-label={title}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="aircall-player-modal-head">
                <div>
                  <div className="aircall-player-modal-kicker">Aircall</div>
                  <h3>{title}</h3>
                </div>
                <button
                  type="button"
                  className="aircall-player-modal-close"
                  aria-label="Close"
                  onClick={closeModal}
                >
                  ×
                </button>
              </div>

              <audio
                ref={audioRef}
                preload="metadata"
                src={src}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onLoadedMetadata={(event) => {
                  setDuration(event.currentTarget.duration || 0);
                }}
                onTimeUpdate={(event) => {
                  setCurrent(event.currentTarget.currentTime || 0);
                  if (event.currentTarget.duration) {
                    setDuration(event.currentTarget.duration);
                  }
                }}
                onEnded={() => {
                  setPlaying(false);
                  setCurrent(0);
                }}
                onError={() => {
                  setPlaying(false);
                  setError("Recording unavailable");
                }}
              />

              <div
                className="aircall-player-modal-scrub"
                role="slider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                aria-label="Seek"
                tabIndex={0}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const ratio = (event.clientX - rect.left) / rect.width;
                  seekToRatio(ratio);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    seekBy(-5);
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    seekBy(5);
                  }
                }}
              >
                <span
                  className="aircall-player-modal-scrub-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="aircall-player-modal-times">
                <span>{formatTime(current)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              <div className="aircall-player-modal-controls">
                <button
                  type="button"
                  className="aircall-player-modal-seek"
                  onClick={() => seekBy(-10)}
                  aria-label="Back 10 seconds"
                  title="Back 10s"
                >
                  −10s
                </button>
                <button
                  type="button"
                  className={`aircall-player-btn aircall-player-btn-lg${playing ? " is-playing" : ""}`}
                  onClick={() => void togglePlay()}
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect
                        x="6"
                        y="5"
                        width="4"
                        height="14"
                        rx="1"
                        fill="currentColor"
                      />
                      <rect
                        x="14"
                        y="5"
                        width="4"
                        height="14"
                        rx="1"
                        fill="currentColor"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5.5v13l11-6.5L8 5.5Z" fill="currentColor" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="aircall-player-modal-seek"
                  onClick={() => seekBy(10)}
                  aria-label="Forward 10 seconds"
                  title="Forward 10s"
                >
                  +10s
                </button>
              </div>

              {error ? (
                <p className="aircall-player-modal-error">{error}</p>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className={`aircall-player${className ? ` ${className}` : ""}`}>
        <div className="aircall-player-track" aria-hidden="true" />
        <button
          type="button"
          className="aircall-player-btn"
          onClick={openAndPlay}
          aria-label="Open recording player"
          title="Play recording"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5L8 5.5Z" fill="currentColor" />
          </svg>
        </button>
      </div>
      {modal}
    </>
  );
}
