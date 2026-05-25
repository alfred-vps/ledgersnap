"use client";

import { useState, useCallback, useRef } from "react";
import { pdfToBase64Images, imageToBase64, compileCSV } from "@/lib/pdf-renderer";
import { extractInvoice, downloadCSV } from "@/lib/api";
import type { ExtractedInvoice, LineItem } from "@/types";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type FileStatus = "pending" | "rendering" | "extracting" | "completed" | "failed";
type FileKind = "pdf" | "image";

interface FileEntry {
  id: string;
  filename: string;
  size: number;
  kind: FileKind;
  status: FileStatus;
  pages: number;
  result: ExtractedInvoice | null;
  error: string | null;
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];

function isImage(filename: string): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function isPDF(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

function getFileKind(filename: string): FileKind | null {
  if (isPDF(filename)) return "pdf";
  if (isImage(filename)) return "image";
  return null;
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
  const [showMenu, setShowMenu] = useState(false);
  const [password, setPassword] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingProcess, setPendingProcess] = useState(false);
  const [selectedModel, setSelectedModel] = useState("openrouter/free");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (fileList: FileList) => {
    setError(null);
    const supported = Array.from(fileList).filter(
      (f) => getFileKind(f.name) !== null
    );

    if (supported.length === 0) {
      setError("No supported files. Drop PDF, JPG, JPEG, or PNG files.");
      return;
    }

    const entries: FileEntry[] = supported.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      size: f.size,
      kind: getFileKind(f.name)!,
      status: "pending",
      pages: 0,
      result: null,
      error: null,
    }));

    setFiles((prev) => [...prev, ...entries]);
  }, []);

  const processAll = useCallback(async () => {
    if (files.length === 0) return;

    // Check password — prompt if not set yet
    if (!password) {
      setPendingProcess(true);
      setShowPasswordModal(true);
      return;
    }

    setProcessing(true);
    setError(null);

    const input = fileInputRef.current;
    const rawFiles = input?.files;
    if (!rawFiles) {
      setError("Files not accessible for processing. Please re-upload.");
      setProcessing(false);
      return;
    }

    const supported = Array.from(rawFiles).filter(
      (f) => getFileKind(f.name) !== null
    );

    for (let i = 0; i < supported.length; i++) {
      const file = supported[i];
      const kind = getFileKind(file.name)!;

      setFiles((prev) =>
        prev.map((f) =>
          f.filename === file.name ? { ...f, status: "rendering" } : f
        )
      );

      try {
        // Step 1: Convert file to JPEG base64 images
        let images: string[];
        if (kind === "pdf") {
          const buffer = await file.arrayBuffer();
          images = await pdfToBase64Images(buffer);
        } else {
          images = await imageToBase64(file);
        }

        setFiles((prev) =>
          prev.map((f) =>
            f.filename === file.name
              ? { ...f, status: "extracting", pages: images.length }
              : f
          )
        );

        // Step 2: Extract via Worker
        const response = await extractInvoice(
          images,
          { password, model: selectedModel }
        );

        if (!response.success || !response.data) {
          throw new Error(response.error || "Extraction failed");
        }

        setFiles((prev) =>
          prev.map((f) =>
            f.filename === file.name
              ? { ...f, status: "completed", result: response.data! }
              : f
          )
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.filename === file.name
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
  }, [files, password, selectedModel]);

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
          <div className="flex items-center gap-3">
            {/* Model Selector */}
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
            >
              <option value="openrouter/free">🆓 Free</option>
              <option value="google/gemini-3.1-flash-lite">⚡ Gemini 3.1 Flash Lite</option>
              <option value="google/gemini-2.5-pro">⭐ Gemini 2.5 Pro</option>
              <option value="openai/gpt-4o">🤖 GPT-4o</option>
              <option value="openai/gpt-4.1-mini">💰 GPT-4.1 Mini</option>
              <option value="anthropic/claude-sonnet-4">🧠 Claude Sonnet 4</option>
              <option value="qwen/qwen3-vl-235b-a22b-instruct">🐉 Qwen3 VL</option>
            </select>
            {/* Hamburger Menu */}
            <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label="Menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={showMenu ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
                />
              </svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                  <a
                    href="https://github.com/alfred-vps/ledgersnap"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    onClick={() => setShowMenu(false)}
                  >
                    <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <span className="font-medium">GitHub</span>
                    <span className="text-xs text-gray-400 ml-auto">alfred-vps/ledgersnap</span>
                  </a>
                  <a
                    href="https://ledgersnap.pages.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100"
                    onClick={() => setShowMenu(false)}
                  >
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                    <span className="font-medium">Live App</span>
                    <span className="text-xs text-gray-400 ml-auto">ledgersnap.pages.dev</span>
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
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
            Drop invoices here
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Supports PDF, JPG, JPEG, PNG — processes entirely in your browser
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
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

      {/* Password Modal */}
      {showPasswordModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-30" onClick={() => { setShowPasswordModal(false); setPendingProcess(false); }} />
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Enter Auth Password</h3>
              <p className="text-sm text-gray-500 mb-4">
                This app is password-protected. Enter the auth key to unlock extraction.
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-green-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setShowPasswordModal(false);
                    if (pendingProcess) {
                      setPendingProcess(false);
                      // Trigger processAll via setTimeout to avoid state conflict
                      setTimeout(() => processAll(), 0);
                    }
                  }
                }}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowPasswordModal(false); setPendingProcess(false); }}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowPasswordModal(false);
                    if (pendingProcess) {
                      setPendingProcess(false);
                      setTimeout(() => processAll(), 0);
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg"
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────
// File Row Component
// ─────────────────────────────────────────────

function FileRow({ file }: { file: FileEntry }) {
  const kindBadge = file.kind === "pdf" ? (
    <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">PDF</span>
  ) : (
    <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">IMG</span>
  );

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
        return file.kind === "pdf" ? "Rendering pages..." : "Processing image...";
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
        <div className="flex items-center gap-2">
          <p className="text-sm text-gray-800 truncate">{file.filename}</p>
          {kindBadge}
        </div>
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
