import { fal } from "@fal-ai/client";

/**
 * Thin wrapper over fal.ai. All AI (vision + text) goes through the user's FAL_KEY
 * using fal's current OpenRouter router endpoints. The legacy `fal-ai/any-llm/vision`
 * endpoint is deprecated, so we use `openrouter/router/vision` (images) and
 * `openrouter/router` (text). Model is configurable via AI_MODEL.
 */

const MODEL = process.env.AI_MODEL || "google/gemini-2.5-flash";

let configured = false;
function ensure() {
  if (!process.env.FAL_KEY) return false;
  if (!configured) {
    fal.config({ credentials: process.env.FAL_KEY });
    configured = true;
  }
  return true;
}

/** Run a vision request over one or more images (URLs or base64 data URIs). */
export async function runVision(
  imageUrls: string[],
  systemPrompt: string,
  prompt: string,
): Promise<string | null> {
  if (!ensure()) return null;
  const result: any = await fal.subscribe("openrouter/router/vision", {
    input: {
      prompt,
      system_prompt: systemPrompt,
      image_urls: imageUrls,
      model: MODEL,
      temperature: 0,
    },
  });
  return result?.data?.output ?? null;
}

/** Run a text-only request. */
export async function runText(
  systemPrompt: string,
  prompt: string,
): Promise<string | null> {
  if (!ensure()) return null;
  const result: any = await fal.subscribe("openrouter/router", {
    input: {
      prompt,
      system_prompt: systemPrompt,
      model: MODEL,
      temperature: 0,
    },
  });
  return result?.data?.output ?? null;
}

/** Build a base64 data URI from raw bytes for inline image input. */
export function dataUri(base64: string, mime: string): string {
  return `data:${mime};base64,${base64}`;
}
