import { NextRequest, NextResponse } from "next/server";
import {
  isSessionError,
  requirePortalSession,
} from "@/lib/require-portal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MODEL = "gpt-4o-mini-transcribe";
const FALLBACK_MODEL = "whisper-1";

function languageCode(raw: string) {
  const value = raw.trim().toLowerCase();
  if (!value) return "en";
  return value.split("-")[0] || "en";
}

async function transcribeWithModel(input: {
  apiKey: string;
  file: File;
  model: string;
  language: string;
  prompt: string;
}) {
  const form = new FormData();
  form.append("file", input.file, input.file.name || "speech.webm");
  form.append("model", input.model);
  form.append("response_format", "json");
  if (input.language) {
    form.append("language", input.language);
  }
  if (input.prompt) {
    form.append("prompt", input.prompt.slice(0, 800));
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: form,
  });
  const data = (await response.json().catch(() => null)) as {
    text?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Transcription failed (${response.status})`,
    );
  }

  return String(data?.text || "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePortalSession();
    if (isSessionError(session)) {
      return session;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim().replace(/[>\s]+$/g, "");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Speech transcription is not configured (OPENAI_API_KEY)." },
        { status: 503 },
      );
    }

    const form = await request.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json(
        { error: "Record some audio first." },
        { status: 400 },
      );
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Recording is too long. Try a shorter clip." },
        { status: 400 },
      );
    }

    const language = languageCode(String(form?.get("language") || "en"));
    const prompt = String(form?.get("prompt") || "").trim();

    let text = "";
    let model = MODEL;
    try {
      text = await transcribeWithModel({
        apiKey,
        file: audio,
        model,
        language,
        prompt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Older accounts / regional availability: fall back to classic Whisper.
      if (/model|not found|invalid/i.test(message)) {
        model = FALLBACK_MODEL;
        text = await transcribeWithModel({
          apiKey,
          file: audio,
          model,
          language,
          prompt,
        });
      } else {
        throw error;
      }
    }

    if (!text) {
      return NextResponse.json(
        { error: "Could not hear that. Try speaking again." },
        { status: 422 },
      );
    }

    return NextResponse.json({ text, model });
  } catch (error) {
    console.error("Speech transcribe failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not transcribe speech",
      },
      { status: 500 },
    );
  }
}
