// Shared utilities for intel/agent operations

import Anthropic from "@anthropic-ai/sdk";

/**
 * Safely parse a JSON array from Claude's text response.
 * Handles markdown code blocks, partial JSON, and malformed output.
 */
export function safeParseJsonArray(
  text: string
): Record<string, unknown>[] {
  // Try to find JSON array in the text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];
  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Normalize a URL to its bare domain (e.g., "www.example.com" → "example.com").
 */
export function normalizeDomain(
  url: string | undefined | null
): string | null {
  if (!url) return null;
  try {
    let u = url.trim();
    if (!u.startsWith("http")) u = "https://" + u;
    const hostname = new URL(u).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Call Claude with retry logic for 529 (overloaded) errors.
 * Returns the text content from the response.
 */
export async function callClaude(
  anthropic: Anthropic,
  system: string,
  userMessage: string,
  maxTokens: number = 4096,
  tools?: Anthropic.Messages.Tool[]
): Promise<string> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const params: Anthropic.Messages.MessageCreateParams = {
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      };
      if (tools && tools.length > 0) {
        params.tools = tools;
      }

      const response = await anthropic.messages.create(params);

      // Extract text blocks
      const textBlocks = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text);

      return textBlocks.join("\n");
    } catch (err: unknown) {
      const status =
        err instanceof Anthropic.APIError ? err.status : undefined;
      if (status === 529 && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        console.log(
          `[callClaude] 529 overloaded, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  return "";
}

/**
 * Parse address components from a formatted address string.
 * Best-effort extraction — not perfect but good enough for scoring/dedup.
 */
export function parseAddress(
  formatted: string
): {
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
} {
  if (!formatted) {
    return { address_line1: null, city: null, state: null, postal_code: null };
  }

  const parts = formatted.split(",").map((p) => p.trim());
  if (parts.length < 2) {
    return {
      address_line1: formatted,
      city: null,
      state: null,
      postal_code: null,
    };
  }

  const address_line1 = parts[0] || null;
  const city = parts.length >= 3 ? parts[1] : null;

  // Last part often has "STATE ZIP" or "STATE ZIP COUNTRY"
  const lastPart = parts[parts.length - 1] || "";
  const secondLastPart = parts.length >= 3 ? parts[parts.length - 2] || "" : "";

  // Try to extract state and zip from secondLastPart (e.g., "TN 38103")
  const stateZip = secondLastPart.match(
    /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/
  );
  if (stateZip) {
    return {
      address_line1,
      city,
      state: stateZip[1],
      postal_code: stateZip[2],
    };
  }

  // Try lastPart
  const stateZip2 = lastPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (stateZip2) {
    return {
      address_line1,
      city: parts.length >= 3 ? parts[1] : null,
      state: stateZip2[1],
      postal_code: stateZip2[2],
    };
  }

  return {
    address_line1,
    city,
    state: lastPart.length === 2 ? lastPart : null,
    postal_code: null,
  };
}

/**
 * Delay helper for rate limiting.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
