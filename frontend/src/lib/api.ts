/**
 * LedgerSnap — API client for the Cloudflare Worker.
 *
 * The Worker is a thin proxy that forwards PDF page images
 * to Claude Sonnet 4 Vision and returns structured JSON.
 */

import type { ExtractedInvoice } from "@/types";

const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || "https://ledgersnap-api.alfred-vps.workers.dev";

export interface ExtractResponse {
  success: boolean;
  data?: ExtractedInvoice;
  error?: string;
}

/**
 * Send PDF page images (base64 JPEG) to the Worker for extraction.
 *
 * @param images - Array of base64 JPEG strings (without data: prefix)
 * @param apiKey - Optional Anthropic API key override
 * @returns Extracted invoice data
 */
export async function extractInvoice(
  images: string[],
  apiKey?: string
): Promise<ExtractResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  try {
    const res = await fetch(`${WORKER_URL}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ images }),
    });

    return res.json() as Promise<ExtractResponse>;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * Trigger a CSV file download in the browser.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
