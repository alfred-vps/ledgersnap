# Competitive Landscape — PDF-to-CSV Extraction Tools

Last updated: 2026-05-25

## Overview

There are ~15-20 tools in the "PDF data extraction" space. Most target enterprise with high prices and template-based setup. Few serve Indonesian SMEs with mixed-language PDFs.

## Direct Competitors

### 1. Rossum.ai
- **Pricing:** Enterprise-only (custom quote, estimated $500+/month)
- **Approach:** AI-powered, template-less extraction for invoices
- **Strengths:** Best-in-class accuracy, handles complex layouts, pre-built invoice schema
- **Weaknesses:** Enterprise pricing out of reach for SMEs, complex onboarding, no Bahasa-specific training
- **Gap:** 10-50x too expensive for a local distributor in Depok

### 2. Docuclipper
- **Pricing:** ~$49-199/month, pay per document
- **Approach:** Template-based + AI fallback
- **Strengths:** Good for logistics, handles PODs and delivery receipts
- **Weaknesses:** Per-vendor template setup required for best accuracy, UI is dated
- **Gap:** Template overhead doesn't solve the "dozens of vendors" problem

### 3. Nanonets
- **Pricing:** ~$499/month (Business plan), lower plans available
- **Approach:** AI OCR with zero-shot learning
- **Strengths:** Pre-trained invoice model, API-first, reasonable accuracy
- **Weaknesses:** Still $200+/month for decent volume, complex setup, not mobile-friendly
- **Gap:** Still expensive for micro-businesses, no Bahasa-specific model

### 4. Parsio.io
- **Pricing:** ~$30-100/month depending on volume
- **Approach:** Template-based + GPT extraction
- **Strengths:** Affordable, email parsing (auto-extract from email attachments), Google Sheets integration
- **Weaknesses:** Template-based for best accuracy; GPT extraction option is newer and less refined
- **Gap:** Getting closer — affordable, Sheets integration. But still needs templates for reliable extraction.

### 5. Zapier PDF Extractor (by Document Parse)
- **Pricing:** ~$20-100/month via Zapier subscription
- **Approach:** AI extraction via Zapier integration
- **Strengths:** Simple, no-code integration with thousands of apps
- **Weaknesses:** Single-document processing (no batch), limited fields, high per-document cost in Zapier's pricing model
- **Gap:** Good for automated workflows but terrible for batch processing a folder of PDFs

### 6. Hypatos.ai
- **Pricing:** Enterprise ($10k+/year)
- **Approach:** Deep learning document processing
- **Strengths:** Handles invoices, receipts, credit notes in one pipeline
- **Weaknesses:** Way overpriced for SMEs, long implementation
- **Gap:** Not a viable competitor for our target market

### 7. Affinda
- **Pricing:** ~$99-499/month
- **Approach:** AI document parsing (resumes, invoices, receipts)
- **Strengths:** Good API, pre-trained invoice model
- **Weaknesses:** Limited customization for Indonesian-specific document formats
- **Gap:** Mid-range pricing, but no Bahasa support

### 8. Open Source Options

| Tool | Approach | Pros | Cons |
|------|----------|------|------|
| **Invoice2data** | Template-based (YAML regex) | Free, offline | Per-vendor template creation — exactly the problem we're solving |
| **Docling (IBM)** | Deep learning PDF-to-structured | Handles tables well | Research-grade, not production-ready for invoices |
| **Unstructured.io** | Multi-modal (vision + OCR) | Flexible, good table detection | Heavy dependencies, complex setup |
| **Marker-pdf** | Vision-based PDF conversion | Good text extraction | Designed for text conversion, not field extraction |

## Summary: The Gap

| Factor | Existing Tools | Our Opportunity |
|--------|---------------|----------------|
| **Template-free** | Rossum does it, but expensive | LLM Vision is layout-agnostic and cheap |
| **SME pricing** | $30-499/mo is too high for micro-businesses | Pay-per-document ($0.01-0.05 per invoice) |
| **Bahasa Indonesia** | None have BI-specific models | LLM Vision handles mixed BI/EN naturally |
| **Batch folder upload** | Most are API-first, not folder-drop | Drop a zip of 50 PDFs, get one CSV |
| **Google Sheets push** | Parsio does it, but template-gated | Direct Sheets API push, no templates needed |
| **Mobile-friendly review** | None (all desktop-only) | Responsive review/correction UI |

## Key Insight

**The biggest gap is in the intersection:** tools that are (a) genuinely template-free, (b) affordable for a $50-200/month micro-business, (c) work with Indonesian documents, and (d) offer simple batch-folder upload. No existing tool hits all four.
