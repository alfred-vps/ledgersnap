/**
 * LedgerSnap — API client for the Cloudflare Worker.
 *
 * Sends base64 JPEG images + auth password + optional model override
 * to the Worker, which proxies to OpenRouter.
 */

import type { ExtractedInvoice } from "@/types";

const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || "https://ledgersnap-api.pre-genesis.workers.dev";

export interface ExtractResponse {
  success: boolean;
  data?: ExtractedInvoice;
  error?: string;
}

/**
 * Send PDF page images (base64 JPEG) to the Worker for extraction.
 *
 * @param images - Array of base64 JPEG strings (without data: prefix)
 * @param options - Optional: auth password and model override
 * @returns Extracted invoice data
 */
export async function extractInvoice(
  images: string[],
  options?: { password?: string; model?: string }
): Promise<ExtractResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.password) {
    headers["x-auth-password"] = options.password;
  }

  const body: Record<string, unknown> = { images };
  if (options?.model) {
    body.model = options.model;
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
