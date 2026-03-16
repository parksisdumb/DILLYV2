"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { PROSPECT_CSV_COLUMNS, MAPPABLE_DB_FIELDS } from "@/lib/constants/prospect-fields";

// ── Types ───────────────────────────────────────────────────────────────────

type TerritoryOption = { id: string; name: string };
type IcpOption = { id: string; name: string };
type BatchRow = {
  id: string;
  filename: string;
  row_count: number;
  duplicates_skipped: number;
  territory_name: string | null;
  created_at: string;
};

type Step = "upload" | "map" | "assign" | "confirm";

type Props = {
  territories: TerritoryOption[];
  icpProfiles: IcpOption[];
  batches: BatchRow[];
  importAction: (formData: FormData) => Promise<void>;
};

// ── CSV Parser ──────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  // Strip BOM
  const clean = text.replace(/^\uFEFF/, "");
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      if (current.trim() || lines.length > 0) lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length === 0) return { headers: [], rows: [] };

  function splitRow(line: string): string[] {
    const fields: string[] = [];
    let field = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { field += '"'; i++; }
        else q = !q;
      } else if (ch === "," && !q) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  }

  const headers = splitRow(lines[0]);
  const rows = lines.slice(1).map(splitRow).filter((r) => r.some((c) => c));
  return { headers, rows };
}

// ── Auto-map headers to DB fields ───────────────────────────────────────────

function autoMapHeaders(headers: string[]): (string | null)[] {
  const knownMappings: Record<string, string> = {};
  for (const col of PROSPECT_CSV_COLUMNS) {
    if (col.dbField) {
      // map both the csvHeader and common variations
      knownMappings[col.csvHeader.toLowerCase()] = col.dbField;
      knownMappings[col.label.toLowerCase()] = col.dbField;
    }
  }
  // Additional common aliases from Apollo, ZoomInfo, etc.
  const aliases: Record<string, string> = {
    "company": "company_name",
    "organization name": "company_name",
    "organization": "company_name",
    "name": "company_name",
    "url": "website",
    "company url": "website",
    "website url": "website",
    "domain": "website",
    "company domain": "website",
    "email": "email",
    "email address": "email",
    "person email": "email",
    "contact email": "email",
    "work email": "email",
    "phone": "phone",
    "phone number": "phone",
    "direct phone": "phone",
    "mobile phone": "phone",
    "contact phone": "phone",
    "linkedin": "linkedin_url",
    "linkedin url": "linkedin_url",
    "person linkedin url": "linkedin_url",
    "linkedin profile": "linkedin_url",
    "street": "address_line1",
    "street address": "address_line1",
    "address": "address_line1",
    "address line 1": "address_line1",
    "company address": "address_line1",
    "city": "city",
    "company city": "city",
    "state": "state",
    "state/region": "state",
    "company state": "state",
    "zip": "postal_code",
    "zip code": "postal_code",
    "zipcode": "postal_code",
    "postal code": "postal_code",
    "company zip": "postal_code",
    "type": "account_type",
    "account type": "account_type",
    "industry": "vertical",
    "vertical": "vertical",
    "sub industry": "vertical",
    "notes": "notes",
    "description": "notes",
    "comments": "notes",
  };

  const all = { ...knownMappings, ...aliases };

  return headers.map((h) => {
    const key = h.toLowerCase().replace(/[_\-]/g, " ").trim();
    return all[key] ?? null;
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const input =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ImportWizardClient({
  territories,
  icpProfiles,
  batches,
  importAction,
}: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<(string | null)[]>([]);
  const [territoryId, setTerritoryId] = useState("");
  const [icpProfileId, setIcpProfileId] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // ── Download template ──
  function downloadTemplate() {
    const headerRow = PROSPECT_CSV_COLUMNS.map((c) => c.csvHeader).join(",");
    const blob = new Blob([headerRow + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dilly_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── File upload handler ──
  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }
    setError(null);
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.headers.length === 0) {
        setError("Could not parse CSV. The file appears empty.");
        return;
      }
      if (parsed.rows.length === 0) {
        setError("CSV has headers but no data rows.");
        return;
      }
      if (parsed.rows.length > 5000) {
        setError(`CSV has ${parsed.rows.length} rows. Maximum is 5,000 per import.`);
        return;
      }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setColumnMap(autoMapHeaders(parsed.headers));
      setStep("map");
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ── Mapping helpers ──
  function setMapping(colIndex: number, dbField: string | null) {
    setColumnMap((prev) => {
      const next = [...prev];
      next[colIndex] = dbField;
      return next;
    });
  }

  function hasCompanyNameMapped(): boolean {
    return columnMap.includes("company_name");
  }

  // ── Build mapped rows for import ──
  function buildMappedRows(): Record<string, string>[] {
    return rows.map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < columnMap.length; i++) {
        const field = columnMap[i];
        if (field && row[i]) {
          obj[field] = row[i];
        }
      }
      return obj;
    }).filter((r) => r.company_name);
  }

  // ── Submit import ──
  function handleConfirm() {
    if (!formRef.current) return;
    setImporting(true);
    const mapped = buildMappedRows();
    const form = formRef.current;
    const rowsInput = form.querySelector<HTMLInputElement>('input[name="rows_json"]');
    const terrInput = form.querySelector<HTMLInputElement>('input[name="territory_id"]');
    const icpInput = form.querySelector<HTMLInputElement>('input[name="icp_profile_id"]');
    const fnInput = form.querySelector<HTMLInputElement>('input[name="filename"]');
    if (rowsInput) rowsInput.value = JSON.stringify(mapped);
    if (terrInput) terrInput.value = territoryId;
    if (icpInput) icpInput.value = icpProfileId;
    if (fnInput) fnInput.value = filename;
    form.requestSubmit();
  }

  const mappedCount = buildMappedRows().length;
  const previewRows = rows.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/app/manager/prospects"
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            &larr; Back to Prospects
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Import Prospects
          </h1>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Step indicator ── */}
      <div className="flex gap-1">
        {(["upload", "map", "assign", "confirm"] as Step[]).map((s, i) => (
          <div
            key={s}
            className={[
              "h-1.5 flex-1 rounded-full",
              (["upload", "map", "assign", "confirm"] as Step[]).indexOf(step) >= i
                ? "bg-blue-600"
                : "bg-slate-200",
            ].join(" ")}
          />
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 1: Upload                                                     */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === "upload" && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={downloadTemplate}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download Template
            </button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-12 transition-colors hover:border-blue-400 hover:bg-blue-50/30"
          >
            <svg className="h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm font-medium text-slate-600">
              Drop a CSV file here or click to browse
            </p>
            <p className="text-xs text-slate-400">Maximum 5,000 rows per import</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 2: Map Columns                                                */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === "map" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Map your columns — {rows.length} rows detected in {filename}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left">
                        <div className="mb-1 text-xs font-medium text-slate-500 truncate max-w-[160px]">
                          {h}
                        </div>
                        <select
                          className="h-8 w-full min-w-[140px] rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
                          value={columnMap[i] ?? ""}
                          onChange={(e) => setMapping(i, e.target.value || null)}
                        >
                          <option value="">Skip</option>
                          {MAPPABLE_DB_FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-t border-slate-100">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-2 text-xs text-slate-600 truncate max-w-[160px]"
                          title={cell}
                        >
                          {cell || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!hasCompanyNameMapped() && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              &quot;Company Name&quot; must be mapped to continue.
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("upload")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!hasCompanyNameMapped()}
              onClick={() => setStep("assign")}
              className={[
                "rounded-xl px-4 py-2 text-sm font-semibold",
                hasCompanyNameMapped()
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-slate-100 text-slate-400",
              ].join(" ")}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 3: Assign Territory + ICP                                     */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === "assign" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assignment (optional)
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Territory
                </label>
                <select
                  className={input}
                  value={territoryId}
                  onChange={(e) => setTerritoryId(e.target.value)}
                >
                  <option value="">None</option>
                  {territories.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  ICP Profile
                </label>
                <select
                  className={input}
                  value={icpProfileId}
                  onChange={(e) => setIcpProfileId(e.target.value)}
                >
                  <option value="">None</option>
                  {icpProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("map")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Review & Import
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 4: Confirm                                                    */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <div className="text-lg font-semibold text-slate-900">Ready to import</div>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                <span><strong>{mappedCount}</strong> prospect{mappedCount !== 1 ? "s" : ""} will be imported</span>
              </div>
              {rows.length - mappedCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                  <span><strong>{rows.length - mappedCount}</strong> row{rows.length - mappedCount !== 1 ? "s" : ""} skipped (missing company name)</span>
                </div>
              )}
              <div className="text-xs text-slate-400 mt-2">
                Duplicates (matching domain or address) will be skipped automatically.
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-500 border-t border-slate-100 pt-3">
              <span>File: {filename}</span>
              {territoryId && (
                <span>
                  · Territory: {territories.find((t) => t.id === territoryId)?.name}
                </span>
              )}
              {icpProfileId && (
                <span>
                  · ICP: {icpProfiles.find((p) => p.id === icpProfileId)?.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("assign")}
              disabled={importing}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              disabled={importing || mappedCount === 0}
              onClick={handleConfirm}
              className={[
                "rounded-xl px-6 py-2 text-sm font-semibold",
                importing
                  ? "bg-slate-100 text-slate-400"
                  : "bg-blue-600 text-white hover:bg-blue-700",
              ].join(" ")}
            >
              {importing ? "Importing..." : "Confirm Import"}
            </button>
          </div>
        </div>
      )}

      {/* hidden form for server action */}
      <form ref={formRef} action={importAction} className="hidden">
        <input type="hidden" name="rows_json" value="[]" />
        <input type="hidden" name="territory_id" value="" />
        <input type="hidden" name="icp_profile_id" value="" />
        <input type="hidden" name="filename" value="" />
      </form>

      {/* ── Import History ── */}
      {batches.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Import History
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Imported</th>
                  <th className="px-4 py-3 font-medium">Skipped</th>
                  <th className="px-4 py-3 font-medium">Territory</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{b.filename}</td>
                    <td className="px-4 py-3 text-slate-600">{b.row_count}</td>
                    <td className="px-4 py-3 text-slate-600">{b.duplicates_skipped}</td>
                    <td className="px-4 py-3 text-slate-600">{b.territory_name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
