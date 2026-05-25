// ─────────────────────────────────────────────
// LedgerSnap — TypeScript type definitions
// Mirrors backend/app/schemas.py 1:1
// ─────────────────────────────────────────────

export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type FileStatus = "pending" | "processing" | "completed" | "failed";

export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
}

export interface ExtractedInvoice {
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

export interface FileResult {
  file_id: string;
  filename: string;
  page_count: number;
  status: FileStatus;
  error: string | null;
  extracted: ExtractedInvoice | null;
  user_corrections: ExtractedInvoice | null;
  confirmed: boolean;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: string;
  files: FileResult[];
  created_at: string;
  updated_at: string;
}

export interface JobCreateResponse {
  job_id: string;
  status: JobStatus;
  file_count: number;
  redirect_url: string;
}

export interface CorrectionPayload {
  invoice_number?: string;
  date?: string;
  vendor_name?: string;
  vendor_tax_id?: string;
  currency?: string;
  grand_total?: number;
  subtotal?: number;
  tax_amount?: number;
  confirmed: boolean;
}
