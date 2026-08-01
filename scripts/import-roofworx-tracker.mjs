#!/usr/bin/env node
/**
 * One-time guided import: RoofWorx outreach tracker → RoofWorx org (prod).
 *
 * PROVENANCE RECORD of the import executed on 2026-07-31. Committed for
 * auditability and safe re-runs. It is NOT part of the app runtime.
 *
 * Pipeline (idempotent, safe to re-run):
 *   parse 16 xlsx sheets → dedupe (name+company) → map to accounts / contacts /
 *   properties / touchpoints / next-actions → write to prod via service-role REST
 *   + the visibility-only rpc_log_synced_email_touchpoint (NO points/streaks/KPI).
 *
 * Fixed target (this was a one-off for a specific org/rep):
 *   ORG      = c28da562-2ad2-4ed4-927a-012b09dd0642  (RoofWorx)
 *   assignee = 5defb2a3-ed15-4f76-9e91-94756b427ffd  (Matthew Cacciamani, rep)
 *
 * Key rules (full decision log in the conversation / commit history):
 *   - Dedupe accounts by normalized company; contacts by account + normalized name.
 *   - account_type from Category; job-title categories fall back to the sheet type
 *     (HOA/Office→CPM; Self Storage/Industrial/Hotels/Casinos/Entertainment/Mobile
 *     Home→owner; Trade Assoc→other; GC/PM/Apartment/Developer as named).
 *   - "Parent - <building>" pattern → one parent account + a property per building
 *     (rejects " - " inside parens and descriptor phrases like "Common Area…").
 *   - Generic-inbox rows (labelled name, name==company, or shared local-part) → no
 *     contact; the email is stored at the account level.
 *   - Touchpoints VISIBILITY-ONLY, backdated from Date Sent (outbound) / Date
 *     Responded (inbound). "Date Responded" column is ~96% formula junk — only
 *     valid 2020-2031 serials count. Contact-anchored (general-inbox rows skipped).
 *   - Next actions: hot/"today" ones due today; past-due cold follow-ups staggered
 *     ~30/business-day starting DAY 2, Top Priority first, annotated with the
 *     original computed due date.
 *
 * Idempotency: accounts tagged source='tracker_import'; touchpoints keyed on a
 * deterministic gmail_message_id; next_actions tagged with MARK. Re-running writes
 * nothing new. A rollback manifest is written to import/manifest.json.
 *
 * Safety: prints a DRY summary by default. Pass --execute to write to prod.
 * Requires the (gitignored) xlsx at import/RoofWorx_Outreach_Tracker.xlsx.xlsx and
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.production.local.
 *
 *   node scripts/import-roofworx-tracker.mjs            # dry summary (default)
 *   node scripts/import-roofworx-tracker.mjs --execute  # write to prod
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const XLSX = path.join(ROOT, "import", "RoofWorx_Outreach_Tracker.xlsx.xlsx");
const EXECUTE = process.argv.includes("--execute");

const ORG = "c28da562-2ad2-4ed4-927a-012b09dd0642";
const MATTHEW = "5defb2a3-ed15-4f76-9e91-94756b427ffd";
const MATTHEW_EMAIL = "matthew.cacciamani@myroofworx.com";
const TODAY = "2026-07-31"; // the original run date — fixed so re-runs stay idempotent
const MARK = "[import:roofworx-tracker]";

function envv(k) {
  for (const f of ["/.env.production.local", "/.env.local"]) {
    try {
      const l = fs.readFileSync(ROOT + f, "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
      if (l) return l.slice(k.length + 1).replace(/^"|"$/g, "").trim();
    } catch {}
  }
  return null;
}
const URL = envv("NEXT_PUBLIC_SUPABASE_URL");
const SRK = envv("SUPABASE_SERVICE_ROLE_KEY");
const H = { Authorization: `Bearer ${SRK}`, apikey: SRK, "Content-Type": "application/json" };
const rest = (p, opt = {}) => fetch(`${URL}/rest/v1/${p}`, { headers: H, ...opt });
const rpc = (fn, body) => fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) });

// ── 1. Parse the xlsx (dependency-free: unzip + XML) ─────────────────────────
function parseWorkbook() {
  if (!fs.existsSync(XLSX)) throw new Error(`Missing tracker file: ${XLSX} (it is gitignored — provide it locally to run).`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwx-xlsx-"));
  execSync(`unzip -o -q "${XLSX}" -d "${dir}"`);
  const decode = (s) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  const shared = [];
  for (const m of fs.readFileSync(`${dir}/xl/sharedStrings.xml`, "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = "";
    for (const x of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += x[1];
    shared.push(decode(t));
  }
  const wb = fs.readFileSync(`${dir}/xl/workbook.xml`, "utf8");
  const rels = fs.readFileSync(`${dir}/xl/_rels/workbook.xml.rels`, "utf8");
  const rid = {};
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) rid[m[1]] = m[2];
  const sheets = [];
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"\/>/g))
    sheets.push({ name: decode(m[1]), file: rid[m[2]].replace(/^\/?xl\//, "").replace(/^worksheets\//, "") });
  const colOf = (r) => r.replace(/[0-9]+/g, "");
  const rawRows = (file) => {
    const xml = fs.readFileSync(`${dir}/xl/worksheets/${file}`, "utf8");
    const rows = {};
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      for (const cm of rm[2].matchAll(/<c[^>]*r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cm[2], body = cm[3];
        const t = (attrs.match(/t="([^"]+)"/) || [, "n"])[1];
        let val = null;
        if (t === "s") { const v = body.match(/<v>([\s\S]*?)<\/v>/); if (v) val = shared[+v[1]]; }
        else if (t === "inlineStr") { let x = ""; for (const z of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) x += z[1]; val = decode(x); }
        else { const v = body.match(/<v>([\s\S]*?)<\/v>/); if (v) val = t === "str" ? decode(v[1]) : v[1]; }
        cells[colOf(cm[1])] = val;
      }
      rows[+rm[1]] = cells;
    }
    return rows;
  };
  const clean = (v) => (v == null ? null : String(v).trim().replace(/\s+/g, " ") || null);
  const all = [];
  for (const s of sheets) {
    const rows = rawRows(s.file);
    const rn = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const hdr = rn.find((r) => (rows[r].A || "").trim() === "Name"); // banner + description rows precede it
    if (hdr == null) continue;
    for (const r of rn) {
      if (r <= hdr) continue;
      const c = rows[r];
      const rec = { sheet: s.name, _row: r, name: clean(c.A), company: clean(c.B), category: clean(c.C), email: clean(c.D), dateSentRaw: c.E, status: clean(c.F), dateRespRaw: c.G, notes: clean(c.H) };
      if (!rec.name && !rec.company && !rec.email) continue;
      all.push(rec);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return all;
}

const all = parseWorkbook();

// ── 2. Transform ─────────────────────────────────────────────────────────────
const serialToDate = (n) => { const s = Number(n); if (!Number.isFinite(s) || s < 44000 || s >= 48000) return null; return new Date(Math.round((s - 25569) * 86400000)).toISOString().slice(0, 10); };
const addDays = (iso, d) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const norm = (s) => (s || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
const bdays = (start, c) => { const o = []; const d = new Date(start + "T00:00:00Z"); while (o.length < c) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) o.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return o; };

const CAT = { pm: "commercial_property_management", gc: "general_contractor", apartment: "commercial_property_management", hoa: "commercial_property_management", "self storage": "owner", industrial: "owner", developer: "developer", "trade association": "other" };
const SHEET_TYPE = { "General Contractors": "general_contractor", "Property Management": "commercial_property_management", "Apartment & Multifamily": "commercial_property_management", "Industrial & Warehouse": "owner", "HOA Management": "commercial_property_management", "Trade Associations": "other", Developers: "developer", "Mobile Home Communities": "owner", "Self Storage": "owner", Hotels: "owner", Casinos: "owner", "Entertainment Venues": "owner", "Office Buildings": "commercial_property_management" };
const KNOWN = new Set(Object.keys(CAT));
const resolveType = (r) => { const c = norm(r.category); if (KNOWN.has(c)) return { type: CAT[c], title: null }; return { type: SHEET_TYPE[r.sheet] ?? null, title: r.category || null }; };
const splitBuilding = (co) => { if (!co || /[()]/.test(co)) return null; const m = co.match(/^(.*?)\s+-\s+(.+)$/); if (!m) return null; const b = m[2].trim(); if (/^(common area|maintenance|leasing|management|office|general)/i.test(b)) return null; return { parent: m[1].trim(), building: b, isAddress: /^\d/.test(b) }; };
const GEN_NAME = /\((general|inbox|office|estimating|estimate|sales|hr|bidding|scheduling|security|facilities|precon|bid|procurement|marketing)[^)]*\)|general inbox/i;
const GEN_LOCAL = /^(info|bids?|estimating|estimate|preconstruction|precon|information|office|sales|contact|admin|hello|help|propertymanagement|pm|marketing|connect|hr|cgoffice|berganrealty)$/i;
const isPerson = (n) => /^[A-Z][a-z]+(?:\.?\s+[A-Z][a-z.'-]+)+$/.test((n || "").trim());
function contactDecision(r) { const name = r.name || ""; const local = (r.email || "").split("@")[0] || ""; if (!name) return { contacts: [] }; if (name.includes("/")) { const p = name.split("/").map((s) => s.trim()); if (p.length === 2 && p.every(isPerson)) return { contacts: p }; return { contacts: [] }; } if (GEN_NAME.test(name)) return { contacts: [] }; if (r.company && norm(name) === norm(r.company)) return { contacts: [] }; if (GEN_LOCAL.test(local)) return { contacts: [name], sharedInbox: true }; return { contacts: [name] }; }
const ONB = { initial_touch: 0, paperwork_started: 1, paperwork_received: 2, compliant: 3 };
function onboardingFor(s) { s = (s || "").toLowerCase(); if (/approved|itb|invitation to bid|buildingconnected.*active|on .*itb/.test(s)) return "compliant"; if (/\bw-?9\b|netvendor|net vendor|registration/.test(s)) return "paperwork_received"; if (/paperwork/.test(s)) return "paperwork_started"; return "initial_touch"; }
function nextActionFor(r, sent) { const s = (r.status || "").toLowerCase().trim(); if (!s) return sent ? { note: "Follow up if no response", kind: "followup", computed: addDays(sent, 4) } : { note: "Send intro email", kind: "today", computed: TODAY }; if (/^not yet sent/.test(s)) return { note: "Send intro email", kind: "today", computed: TODAY }; if (/^sent|^email sent|^called and got an email/.test(s)) return { note: "Follow up if no response", kind: "followup", computed: sent ? addDays(sent, 4) : TODAY }; if (/^follow/.test(s)) return { note: "Follow-up needed", kind: "today", computed: TODAY }; if (/^responded|^spoke|^talked|^called and started/.test(s)) return { note: (r.notes || r.status).slice(0, 200), kind: "today", computed: TODAY }; if (/^approved/.test(s)) return { note: "Approved — advance onboarding / request first bid", kind: "today", computed: TODAY }; if (/^declined/.test(s)) return { note: null, kind: null }; return { note: "Follow up", kind: "today", computed: TODAY }; }
const score = (r) => (r.notes ? 5 + Math.min(r.notes.length, 300) / 50 : 0) + (r.sheet === "Top Priority" ? 3 : 0) + (/responded|approved|follow|spoke/i.test(r.status || "") ? 2 : 0) + (r.status ? 1 : 0);

const byKey = new Map();
for (const r of all) { const k = norm(r.name) + "||" + norm(r.company); const cur = byKey.get(k); const tp = (cur?.fromTP || false) || r.sheet === "Top Priority"; if (!cur || score(r) > score(cur.rec)) byKey.set(k, { rec: r, fromTP: tp }); else cur.fromTP = tp; }
const deduped = [...byKey.values()];

const accPlan = new Map();
const recs = [];
for (const { rec, fromTP } of deduped) {
  if (!rec.company) continue;
  const split = splitBuilding(rec.company); const accountName = split ? split.parent : rec.company; const akey = norm(accountName);
  const { type, title } = resolveType(rec);
  if (!accPlan.has(akey)) accPlan.set(akey, { name: accountName, type, onboarding: "initial_touch", emails: new Set() });
  const acc = accPlan.get(akey); if (!acc.type && type) acc.type = type;
  const onb = onboardingFor(rec.status); if (ONB[onb] > ONB[acc.onboarding]) acc.onboarding = onb;
  const cd = contactDecision(rec); const contacts = [];
  if (cd.contacts.length === 0) { if (rec.email) acc.emails.add(rec.email); }
  else { for (const cn of cd.contacts) contacts.push({ name: cn, title, email: cd.sharedInbox ? null : rec.email }); if (cd.sharedInbox && rec.email) acc.emails.add(rec.email); }
  const sent = serialToDate(rec.dateSentRaw), resp = serialToDate(rec.dateRespRaw);
  const na = contacts.length ? nextActionFor(rec, sent) : { note: null, kind: null };
  recs.push({ akey, accountName, split, contacts, sent, resp, notes: rec.notes, na, fromTP, email: rec.email });
}
const stagger = [], todayA = [], futureA = [];
for (const r of recs) { if (!r.contacts.length || !r.na.note) continue; if (r.na.kind === "today") (r.due = TODAY, todayA.push(r)); else if (r.na.computed >= TODAY) (r.due = r.na.computed, futureA.push(r)); else stagger.push(r); }
stagger.sort((a, b) => (b.fromTP - a.fromTP) || ((a.sent || "").localeCompare(b.sent || "")));
const CAP = 30, days = bdays(addDays(TODAY, 1), Math.max(15, Math.ceil(stagger.length / CAP))); // DAY-2 START
stagger.forEach((r, i) => { r.due = days[Math.min(Math.floor(i / CAP), days.length - 1)]; r.staggered = true; r.origComputed = r.na.computed; });

const log = (...a) => console.log(...a);
if (!EXECUTE) {
  log(`DRY RUN (pass --execute to write to prod).`);
  log(`  raw rows=${all.length}  deduped=${deduped.length}  accounts=${accPlan.size}`);
  log(`  next-actions: today=${todayA.length} future=${futureA.length} staggered=${stagger.length}`);
  process.exit(0);
}
if (!URL || !SRK) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.production.local");

// ── 3. Write (idempotent) ────────────────────────────────────────────────────
const manifest = { accounts: [], contacts: [], properties: [], touchpoints: [], nextActions: [], propertyContacts: [] };
const skips = { touchpointsNoContact: 0, other: [] };
const loadExisting = (table, sel) => rest(`${table}?org_id=eq.${ORG}&select=${sel}&limit=5000`).then((r) => r.json());

const accIdByKey = new Map();
{ // ACCOUNTS — dedupe by normalized name; tag source for rollback
  const existing = await loadExisting("accounts", "id,name,deleted_at");
  const exByNorm = new Map(existing.filter((a) => !a.deleted_at).map((a) => [norm(a.name), a.id]));
  const toInsert = [];
  for (const [k, a] of accPlan) { if (exByNorm.has(k)) { accIdByKey.set(k, exByNorm.get(k)); continue; } const notes = a.emails.size ? `Shared inboxes: ${[...a.emails].join(", ")} ${MARK}` : MARK; toInsert.push({ key: k, row: { org_id: ORG, name: a.name, account_type: a.type, onboarding_status: a.onboarding, status: "active", source: "tracker_import", notes, created_by: MATTHEW } }); }
  for (let i = 0; i < toInsert.length; i += 100) { const chunk = toInsert.slice(i, i + 100); const data = await rest("accounts", { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(chunk.map((c) => c.row)) }).then((r) => r.json()); if (!Array.isArray(data)) { log("ACCT ERR", data); process.exit(1); } data.forEach((row, j) => { accIdByKey.set(chunk[j].key, row.id); manifest.accounts.push(row.id); }); }
  log(`accounts: ${accPlan.size} planned, ${manifest.accounts.length} inserted, ${accPlan.size - manifest.accounts.length} reused`);
}
{ // CONTACTS — dedupe by account + normalized name
  const existing = await loadExisting("contacts", "id,account_id,full_name,first_name,last_name,deleted_at");
  const exKey = new Map(existing.filter((c) => !c.deleted_at).map((c) => [`${c.account_id}|${norm(c.full_name || ((c.first_name || "") + " " + (c.last_name || "")))}`, c.id]));
  const toInsert = [];
  recs.forEach((rec, ri) => { const aid = accIdByKey.get(rec.akey); rec.aid = aid; rec.cids = []; for (const c of rec.contacts) { const parts = c.name.trim().split(/\s+/); const key = `${aid}|${norm(c.name)}`; if (exKey.has(key)) { rec.cids.push(exKey.get(key)); continue; } toInsert.push({ ri, key, row: { org_id: ORG, account_id: aid, first_name: parts[0] || c.name, last_name: parts.slice(1).join(" ") || "", full_name: c.name, title: c.title || null, email: c.email || null, is_active: true, created_by: MATTHEW } }); } });
  for (let i = 0; i < toInsert.length; i += 100) { const chunk = toInsert.slice(i, i + 100); const data = await rest("contacts", { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(chunk.map((c) => c.row)) }).then((r) => r.json()); if (!Array.isArray(data)) { log("CONTACT ERR", data); process.exit(1); } data.forEach((row, j) => { const t = chunk[j]; recs[t.ri].cids.push(row.id); exKey.set(t.key, row.id); manifest.contacts.push(row.id); }); }
  log(`contacts: ${recs.reduce((s, r) => s + r.contacts.length, 0)} planned, ${manifest.contacts.length} inserted, rest reused`);
}
const propIdByKey = new Map();
{ // PROPERTIES (Hines split) + contact links. city/state/postal are NOT NULL:
  // address_line1="" for named-no-address buildings so the completeness gap flags
  // them (Decision 5); state="CO" (all Colorado); city/postal blank for reps to fill.
  const existing = await loadExisting("properties", "id,name,deleted_at");
  const exByNorm = new Map(existing.filter((p) => !p.deleted_at).map((p) => [norm(p.name), p.id]));
  const planProps = new Map();
  for (const rec of recs) { if (!rec.split) continue; const pk = norm(rec.split.building); if (!planProps.has(pk)) planProps.set(pk, { name: rec.split.building, address_line1: rec.split.isAddress ? rec.split.building : null, akey: rec.akey }); }
  for (const [pk, p] of planProps) { if (exByNorm.has(pk)) { propIdByKey.set(pk, exByNorm.get(pk)); continue; } const data = await rest("properties", { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify([{ org_id: ORG, name: p.name, address_line1: p.address_line1 ?? "", city: "", state: "CO", postal_code: "", country: "US", primary_account_id: accIdByKey.get(p.akey), created_by: MATTHEW }]) }).then((r) => r.json()); if (!Array.isArray(data)) { log("PROP ERR", data); process.exit(1); } propIdByKey.set(pk, data[0].id); manifest.properties.push(data[0].id); }
  log(`properties: ${planProps.size} planned, ${manifest.properties.length} inserted, rest reused`);
  const linkRows = [];
  for (const rec of recs) { if (!rec.split || !rec.cids.length) continue; const pid = propIdByKey.get(norm(rec.split.building)); for (const cid of rec.cids) if (pid && cid) linkRows.push({ property_id: pid, contact_id: cid, org_id: ORG, role_category: "other", active: true, created_by: MATTHEW }); }
  if (linkRows.length) { const d = await rest("property_contacts", { method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(linkRows) }).then((r) => r.json()); if (Array.isArray(d)) d.forEach((row) => manifest.propertyContacts.push([row.property_id, row.contact_id])); }
  log(`property_contacts links: ${linkRows.length} planned`);
}
{ // TOUCHPOINTS — visibility-only RPC, contact-anchored, deterministic id (idempotent)
  const jobs = [];
  for (const rec of recs) { const cid = rec.cids[0]; if (!cid) { if (rec.sent) skips.touchpointsNoContact++; continue; }
    if (rec.sent) jobs.push({ cid, dir: "outbound", date: rec.sent, subj: "Outreach email (imported from tracker)", gid: `tracker:${cid}:out:${rec.sent}`, from: MATTHEW_EMAIL, to: [rec.email || MATTHEW_EMAIL] });
    if (rec.resp) jobs.push({ cid, dir: "inbound", date: rec.resp, subj: (rec.notes || "Reply").slice(0, 200), gid: `tracker:${cid}:in:${rec.resp}`, from: rec.email || "", to: [MATTHEW_EMAIL] });
  }
  let made = 0;
  const worker = async (q) => { for (const j of q) { const t = await rpc("rpc_log_synced_email_touchpoint", { p_org_id: ORG, p_user_id: MATTHEW, p_contact_id: j.cid, p_direction: j.dir, p_happened_at: `${j.date}T18:00:00Z`, p_subject: j.subj, p_gmail_message_id: j.gid, p_thread_id: null, p_from_email: j.from, p_to_emails: j.to }).then((r) => r.json()); if (typeof t === "string") { made++; manifest.touchpoints.push(t); } else if (t && t.code) skips.other.push(`tp ${j.gid}: ${t.message}`); } };
  const pool = 8;
  await Promise.all(Array.from({ length: pool }, (_, i) => worker(jobs.filter((_, k) => k % pool === i))));
  log(`touchpoints: ${jobs.length} attempted, ${made} created (rest idempotent), skipped-no-contact=${skips.touchpointsNoContact}`);
}
{ // NEXT ACTIONS — staggered day-2; idempotent via MARK
  const existing = await rest(`next_actions?org_id=eq.${ORG}&select=id,contact_id,notes&limit=5000`).then((r) => r.json());
  const already = new Set(existing.filter((n) => (n.notes || "").includes(MARK)).map((n) => n.contact_id));
  const rows = [];
  for (const rec of recs) { if (!rec.na || !rec.na.note || !rec.cids.length || !rec.due) continue; const cid = rec.cids[0]; if (already.has(cid)) continue; let notes = rec.na.note; if (rec.staggered) notes += ` — Imported from tracker — originally due ${rec.origComputed}`; notes += ` ${MARK}`; rows.push({ org_id: ORG, assigned_user_id: MATTHEW, contact_id: cid, account_id: rec.aid, property_id: null, status: "open", due_at: `${rec.due}T14:00:00Z`, notes, created_by: MATTHEW }); }
  for (let i = 0; i < rows.length; i += 100) { const chunk = rows.slice(i, i + 100); const data = await rest("next_actions", { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(chunk) }).then((r) => r.json()); if (!Array.isArray(data)) { log("NA ERR", data); process.exit(1); } data.forEach((row) => manifest.nextActions.push(row.id)); }
  log(`next_actions: ${rows.length} to insert`);
}

// ── 4. Rollback manifest (rebuilt from tags — robust across re-runs) ─────────
const batchIds = async (table, col, ids) => { const out = []; for (let i = 0; i < ids.length; i += 40) { const d = await rest(`${table}?org_id=eq.${ORG}&${col}=in.(${ids.slice(i, i + 40).join(",")})&select=id&limit=5000`).then((r) => r.json()); if (Array.isArray(d)) out.push(...d.map((x) => x.id)); } return out; };
{
  const accts = await rest(`accounts?org_id=eq.${ORG}&source=eq.tracker_import&select=id&limit=5000`).then((r) => r.json());
  manifest.accounts = accts.map((a) => a.id);
  if (manifest.accounts.length) { manifest.contacts = await batchIds("contacts", "account_id", manifest.accounts); manifest.properties = await batchIds("properties", "primary_account_id", manifest.accounts); }
  const na = await rest(`next_actions?org_id=eq.${ORG}&select=id,notes&limit=5000`).then((r) => r.json());
  manifest.nextActions = na.filter((n) => (n.notes || "").includes(MARK)).map((n) => n.id);
  const se = await rest(`synced_emails?org_id=eq.${ORG}&gmail_message_id=like.tracker:*&select=touchpoint_id&limit=5000`).then((r) => r.json());
  if (Array.isArray(se)) manifest.touchpoints = se.map((s) => s.touchpoint_id).filter(Boolean);
}
fs.writeFileSync(path.join(ROOT, "import", "manifest.json"), JSON.stringify(manifest, null, 2));
log(`\nMANIFEST: accounts=${manifest.accounts.length} contacts=${manifest.contacts.length} properties=${manifest.properties.length} touchpoints=${manifest.touchpoints.length} nextActions=${manifest.nextActions.length}`);
if (skips.other.length) log(`OTHER SKIPS (${skips.other.length}):`, skips.other.slice(0, 10));
