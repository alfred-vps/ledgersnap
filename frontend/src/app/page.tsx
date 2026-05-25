"use client";

import { useState, useCallback, useRef } from "react";
import { pdfToBase64Images, compileCSV } from "@/lib/pdf-renderer";
import { extractInvoice, downloadCSV } from "@/lib/api";
import type { ExtractedInvoice, LineItem } from "@/types";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type FileStatus = "pending" | "rendering" | "extracting" | "completed" | "failed";

interface FileEntry {
  id: string;
  filename: string;
  size: number;
  status: FileStatus;
  pages: number;
  result: ExtractedInvoice | null;
  error: string | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtCurrency(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function Home() {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (fileList: FileList) => {
    setError(null);
    const pdfs = Array.from(fileList).filter(
      (f) => f.name.toLowerCase().endsWith(".pdf")
    );

    if (pdfs.length === 0) {
      setError("No PDF files found. Select .pdf files only.");
      return;
    }

    const entries: FileEntry[] = pdfs.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      size: f.size,
      status: "pending",
      pages: 0,
      result: null,
      error: null,
    }));

    setFiles((prev) => [...prev, ...entries]);
  }, []);

  const processAll = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);

    // Get the files from the input
    const input = fileInputRef.current;
    const rawFiles = input?.files;
    if (!rawFiles) {
      setError("Files not accessible for processing. Please re-upload.");
      setProcessing(false);
      return;
    }

    const pdfs = Array.from(rawFiles).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );

    for (let i = 0; i < pdfs.length; i++) {
      const pdfFile = pdfs[i];

      // Update status to rendering
      setFiles((prev) =>
        prev.map((f) =>
          f.filename === pdfFile.name ? { ...f, status: "rendering" } : f
        )
      );

      try {
        // Step 1: Render PDF to images
        const buffer = await pdfFile.arrayBuffer();
        const images = await pdfToBase64Images(buffer);

        setFiles((prev) =>
          prev.map((f) =>
            f.filename === pdfFile.name
              ? { ...f, status: "extracting", pages: images.length }
              : f
          )
        );

        // Step 2: Extract via Worker
        const response = await extractInvoice(
          images,
          apiKey || undefined
        );

        if (!response.success || !response.data) {
          throw new Error(response.error || "Extraction failed");
        }

        setFiles((prev) =>
          prev.map((f) =>
            f.filename === pdfFile.name
              ? { ...f, status: "completed", result: response.data! }
              : f
          )
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.filename === pdfFile.name
              ? {
                  ...f,
                  status: "failed",
                  error: err instanceof Error ? err.message : "Unknown error",
                }
              : f
          )
        );
      }
    }

    setProcessing(false);
  }, [files, apiKey]);

  const handleDownload = useCallback(() => {
    const results = files
      .filter((f) => f.status === "completed" || f.status === "failed")
      .map((f) => ({
        filename: f.filename,
        data: f.result,
        error: f.error,
      }));

    if (results.length === 0) return;

    const csv = compileCSV(results);
    const filename = `ledgersnap_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV(csv, filename);
  }, [files]);

  const clearAll = useCallback(() => {
    setFiles([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Stats
  const completed = files.filter((f) => f.status === "completed").length;
  const failed = files.filter((f) => f.status === "failed").length;
  const totalGrandTotal = files
    .filter((f) => f.result?.grand_total)
    .reduce((sum, f) => sum + (f.result!.grand_total || 0), 0);

  // ── Render ──────────────────────────────────

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            <span className="text-green-600">Ledger</span>Snap
          </h1>
          <button
            onClick={() => setShowKeyInput(!showKeyInput)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {showKeyInput ? "Hide API Key" : "Set API Key"}
          </button>
        </div>
        {showKeyInput && (
          <div className="max-w-5xl mx-auto px-6 pb-4">
            <label className="block text-sm text-gray-500 mb-1">
              Anthropic API Key (optional — uses Worker&apos;s default if empty)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        )}
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Upload Zone */}
        <section
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer ${
            dragging
              ? "border-green-500 bg-green-50"
              : "border-gray-300 bg-white hover:border-green-400"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            className="w-16 h-16 mx-auto text-gray-400 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 48 48"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M24 32V16m0 0l-6 6m6-6l6 6m-20 16v4a4 4 0 004 4h20a4 4 0 004-4v-4"
            />
          </svg>
          <p className="text-lg font-medium text-gray-700">
            Drop PDF invoices here
          </p>
          <p className="text-sm text-gray-500 mt-1">
            or click to browse — processes entirely in your browser
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
            }}
          />
        </section>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* File List */}
        {files.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">
                Files ({files.length})
              </h2>
              <div className="flex gap-2">
                {!processing && (
                  <>
                    <button
                      onClick={clearAll}
                      className="px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 border border-gray-200 rounded-lg"
                    >
                      Clear
                    </button>
                    {completed + failed < files.length && (
                      <button
                        onClick={processAll}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg"
                      >
                        Extract All
                      </button>
                    )}
                  </>
                )}
                {completed > 0 && !processing && (
                  <button
                    onClick={handleDownload}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    Download CSV
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {files.map((f) => (
                <FileRow key={f.id} file={f} />
              ))}
            </div>
          </section>
        )}

        {/* Summary */}
        {completed > 0 && !processing && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-800 mb-3">Summary</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-green-600">{completed}</div>
                <div className="text-sm text-gray-500">Extracted</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-500">{failed}</div>
                <div className="text-sm text-gray-500">Failed</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">
                  {fmtCurrency(totalGrandTotal)}
                </div>
                <div className="text-sm text-gray-500">Total Value</div>
              </div>
            </div>
          </section>
        )}

        {/* Results Table */}
        {completed > 0 && (
          <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Extracted Results</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">File</th>
                    <th className="px-4 py-3 font-medium">Invoice #</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Vendor</th>
                    <th className="px-4 py-3 font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {files
                    .filter((f) => f.status === "completed" && f.result)
                    .map((f) => (
                      <tr key={f.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800 max-w-[200px] truncate">
                          {f.filename}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {f.result?.invoice_number || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {f.result?.date || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">
                          {f.result?.vendor_name || "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-800">
                          {fmtCurrency(f.result?.grand_total ?? null)}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {f.result?.line_items?.length || 0}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────
// File Row Component
// ─────────────────────────────────────────────

function FileRow({ file }: { file: FileEntry }) {
  const statusIcon = () => {
    switch (file.status) {
      case "pending":
        return <span className="text-gray-400">◻</span>;
      case "rendering":
        return <span className="text-blue-500 animate-pulse">◌</span>;
      case "extracting":
        return <span className="text-blue-500 animate-pulse">◆</span>;
      case "completed":
        return <span className="text-green-500">✓</span>;
      case "failed":
        return <span className="text-red-500">✗</span>;
    }
  };

  const statusLabel = () => {
    switch (file.status) {
      case "pending":
        return "Waiting";
      case "rendering":
        return "Rendering pages...";
      case "extracting":
        return `Extracting (${file.pages} page${file.pages > 1 ? "s" : ""})...`;
      case "completed":
        return `Done — ${file.result?.line_items?.length || 0} items`;
      case "failed":
        return file.error?.slice(0, 80) || "Failed";
    }
  };

  return (
    <div className="px-6 py-3 flex items-center gap-4">
      <div className="text-lg">{statusIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{file.filename}</p>
        <p className="text-xs text-gray-400">
          {formatBytes(file.size)} &middot; {statusLabel()}
        </p>
      </div>
      {file.status === "completed" && file.result?.grand_total !== null && (
        <div className="text-sm font-mono text-gray-700">
          {fmtCurrency(file.result?.grand_total ?? null)}
        </div>
      )}
    </div>
  );
}
