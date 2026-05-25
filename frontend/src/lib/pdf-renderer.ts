/**
 * LedgerSnap — Client-side file renderer
 *
 * Converts PDF pages or image files to JPEG base64 strings in the browser.
 * No server-side processing needed — this is the Cloudflare-native approach.
 */

import * as pdfjs from "pdfjs-dist";

// Set the worker source for pdf.js
// Using the CDN version to avoid bundling issues
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

/**
 * Maximum dimensions for rendered page images.
 * Larger = more detail but more expensive API calls.
 * 1600px keeps file size reasonable (~200-400 KB per page as JPEG).
 */
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.8;

/**
 * Render a PDF file (ArrayBuffer) into an array of base64 JPEG strings,
 * one per page.
 *
 * @param pdfBuffer - The raw PDF file as an ArrayBuffer
 * @param maxPages - Maximum pages to render (cap for API cost control)
 * @returns Array of base64 JPEG data URLs (without the data: prefix)
 */
export async function pdfToBase64Images(
  pdfBuffer: ArrayBuffer,
  maxPages: number = 20
): Promise<string[]> {
  const pdf = await pdfjs.getDocument({ data: pdfBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const images: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });

    // Calculate scale to keep width within MAX_WIDTH
    const scale = Math.min(MAX_WIDTH / viewport.width, 2);
    const scaledViewport = page.getViewport({ scale });

    // Create a canvas for this page
    const canvas = new OffscreenCanvas(scaledViewport.width, scaledViewport.height);
    const ctx = canvas.getContext("2d")!;

    // White background (PDFs may have transparent areas)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render the page
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: scaledViewport,
    }).promise;

    // Convert to JPEG blob
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: JPEG_QUALITY,
    });

    // Convert blob to base64 string
    const b64 = await blobToBase64(blob);
    images.push(b64);

    // Clean up
    page.cleanup();
  }

  return images;
}

/**
 * Convert an image file (JPEG/PNG) to an array with one base64 JPEG string.
 * Images are single-page, so result is always a single-element array.
 */
export async function imageToBase64(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(MAX_WIDTH / img.width, 2);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d")!;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY })
        .then(async (blob) => {
          const b64 = await blobToBase64(blob);
          URL.revokeObjectURL(img.src);
          resolve([b64]);
        })
        .catch(reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Convert a Blob to a base64 string (without the data: prefix).
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Compile extraction results into a CSV string (client-side).
 */
export function compileCSV(
  results: Array<{
    filename: string;
    data: {
      invoice_number: string | null;
      date: string | null;
      vendor_name: string | null;
      vendor_tax_id: string | null;
      currency: string;
      subtotal: number | null;
      tax_amount: number | null;
      grand_total: number | null;
      line_items: Array<{
        description: string;
        quantity: number | null;
        unit_price: number | null;
        total: number | null;
      }>;
    } | null;
    error?: string | null;
  }>
): string {
  const headers = [
    "filename",
    "invoice_number",
    "date",
    "vendor_name",
    "vendor_tax_id",
    "currency",
    "subtotal",
    "tax_amount",
    "grand_total",
    "line_items",
    "status",
  ];

  const rows = [headers.join(",")];

  for (const r of results) {
    const d = r.data;
    if (!d) {
      rows.push([
        escapeCSV(r.filename),
        "", "", "", "", "", "", "", "",
        "",
        r.error ? "failed" : "no_data",
      ].join(","));
      continue;
    }

    rows.push([
      escapeCSV(r.filename),
      escapeCSV(d.invoice_number || ""),
      escapeCSV(d.date || ""),
      escapeCSV(d.vendor_name || ""),
      escapeCSV(d.vendor_tax_id || ""),
      escapeCSV(d.currency),
      d.subtotal?.toString() || "",
      d.tax_amount?.toString() || "",
      d.grand_total?.toString() || "",
      escapeCSV(JSON.stringify(d.line_items)),
      "completed",
    ].join(","));
  }

  return rows.join("\n");
}

function escapeCSV(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
