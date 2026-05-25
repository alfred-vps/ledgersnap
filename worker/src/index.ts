/**
 * LedgerSnap — Cloudflare Worker (OpenRouter + Gemini 3.1 Flash Lite)
 *
 * Thin proxy: receives base64 JPEG images from the browser,
 * forwards them to OpenRouter (Gemini 3.1 Flash Lite), returns structured JSON.
 *
 * API format: OpenAI-compatible chat completions
 * Model: google/gemini-3.1-flash-lite
 * Cost: ~$0.00001 per request — insanely cheap for invoice extraction
 */

interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
}

interface ExtractedInvoice {
  invoice_number: string | null;
  date: string | null;
  vendor_name: string | null;
  vendor_tax_id: string | null;
  currency: "IDR" | "USD" | "unknown";
  subtotal: number | null;
  tax_amount: number | null;
  grand_total: number | null;
  line_items: LineItem[];
  raw_text_fields: Record<string, string>;
}

interface ExtractRequest {
  /** Base64-encoded JPEG images, one per PDF page */
  images: string[];
  /** Optional override for the user prompt */
  prompt?: string;
}

interface ExtractResponse {
  success: boolean;
  data?: ExtractedInvoice;
  error?: string;
}

// ─────────────────────────────────────────────
// Prompt — adapted for Gemini (shorter, more direct)
// ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert invoice data extraction assistant. Extract structured data from scanned invoice PDFs regardless of layout.

Extract ALL of these fields:
1. invoice_number: Any invoice identifier (INV-123, Faktur No. 001, etc.)
2. date: Invoice date. Convert to YYYY-MM-DD. Handle "15 Maret 2024" → "2024-03-15"
3. vendor_name: Company issuing the invoice
4. vendor_tax_id: Tax registration ID / NPWP (XX.XXX.XXX.X-XXX.XXX)
5. currency: IDR or USD (default IDR for Indonesian invoices)
6. subtotal: Amount before tax
7. tax_amount: Tax amount (PPN/VAT)
8. grand_total: FINAL total after all taxes (most important field)
9. line_items: EVERY row from the product table

For line items, extract: description, quantity, unit_price, total for each row.
Merge multi-page tables into one array.

CRITICAL RULES:
- NULL vs GUESS: If a field is missing, set to null. Do NOT fabricate.
- Return ONLY valid JSON. No markdown, no explanations.
- Handle Indonesian (1.500.000,00) and US (1,500,000.00) number formats.
- Handle mixed Bahasa Indonesia and English text.

Return this exact JSON structure:
{
  "invoice_number": "string or null",
  "date": "YYYY-MM-DD or null",
  "vendor_name": "string or null",
  "vendor_tax_id": "string or null",
  "currency": "IDR or USD or unknown",
  "subtotal": "number or null",
  "tax_amount": "number or null",
  "grand_total": "number or null",
  "line_items": [
    { "description": "string", "quantity": "number or null", "unit_price": "number or null", "total": "number or null" }
  ],
  "raw_text_fields": {}
}`;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Env {
  OPENROUTER_API_KEY?: string;
  LOG_LEVEL?: string;
}

// ─────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    };

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return Response.json(
        { success: false, error: "Only POST allowed" } satisfies ExtractResponse,
        { status: 405, headers: corsHeaders }
      );
    }

    // API key: check header override, then env secret
    const apiKey =
      (request.headers.get("x-api-key") || "") ||
      env.OPENROUTER_API_KEY ||
      "";

    if (!apiKey) {
      return Response.json(
        { success: false, error: "OPENROUTER_API_KEY not configured" } satisfies ExtractResponse,
        { status: 500, headers: corsHeaders }
      );
    }

    // Parse request body
    let body: ExtractRequest;
    try {
      body = (await request.json()) as ExtractRequest;
    } catch {
      return Response.json(
        { success: false, error: "Invalid JSON body" } satisfies ExtractResponse,
        { status: 400, headers: corsHeaders }
      );
    }

    if (!body.images || !Array.isArray(body.images) || body.images.length === 0) {
      return Response.json(
        { success: false, error: "At least one image required" } satisfies ExtractResponse,
        { status: 400, headers: corsHeaders }
      );
    }

    try {
      // ── Build OpenAI-compatible messages ──────
      // System prompt as a system message
      // User message: text + images as image_url content blocks

      const userContent: Array<Record<string, unknown>> = [
        {
          type: "text",
          text:
            body.prompt ||
            `Extract invoice data from ${body.images.length} page image(s). ` +
              "Combine info across ALL pages. Return ONLY valid JSON matching the schema.",
        },
      ];

      for (const b64 of body.images) {
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${b64}`,
            detail: "auto",
          },
        });
      }

      // ── Call OpenRouter API ────────────────────
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://ledgersnap.pages.dev",
            "X-Title": "LedgerSnap",
          },
          body: JSON.stringify({
            model: "google/gemini-3.1-flash-lite",
            max_tokens: 4096,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return Response.json(
          {
            success: false,
            error: `OpenRouter API ${response.status}: ${errorBody.slice(0, 500)}`,
          } satisfies ExtractResponse,
          { status: 502, headers: corsHeaders }
        );
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string | null };
        }>;
      };

      const rawText = data.choices?.[0]?.message?.content || "";

      if (!rawText) {
        return Response.json(
          { success: false, error: "Empty response from model" } satisfies ExtractResponse,
          { status: 502, headers: corsHeaders }
        );
      }

      // Parse JSON from response
      const extracted = parseJsonResponse(rawText);

      return Response.json(
        { success: true, data: extracted } satisfies ExtractResponse,
        { headers: corsHeaders }
      );
    } catch (err) {
      return Response.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        } satisfies ExtractResponse,
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

// ─────────────────────────────────────────────
// JSON parser (handles markdown wrapping)
// ─────────────────────────────────────────────

function parseJsonResponse(raw: string): ExtractedInvoice {
  raw = raw.trim();

  // Try direct parse
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw) as ExtractedInvoice;
    } catch {
      // fall through
    }
  }

  // Try extracting from ```json ... ``` block
  const jsonMatch = raw.match(/```(?:json)?\s*\n?(\{.*?\})\s*\n?```/s);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as ExtractedInvoice;
    } catch {
      // fall through
    }
  }

  // Try brace counting for top-level object
  let depth = 0;
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1)) as ExtractedInvoice;
        } catch {
          start = -1;
          continue;
        }
      }
    }
  }

  throw new Error(`Could not parse JSON from model response. Raw: ${raw.slice(0, 300)}`);
}
