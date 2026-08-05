import type { OverdueItem, RepDigest, ManagerTeam, UserDigest } from "./types";

// Email rendering. Table-based, inline styles, max-width 600 — the lowest common
// denominator that survives Gmail/Outlook. Light theme, Dilly blue. No images.

const BLUE = "#2563eb";
const INK = "#0f172a";
const MUTE = "#64748b";
const LINE = "#e2e8f0";
const BG = "#f1f5f9";

const TIER_STYLE: Record<OverdueItem["tier"], { bg: string; fg: string; bd: string; label: string }> = {
  amber: { bg: "#fffbeb", fg: "#92400e", bd: "#fcd34d", label: "1–3d" },
  orange: { bg: "#fff7ed", fg: "#9a3412", bd: "#fdba74", label: "4–7d" },
  red: { bg: "#fef2f2", fg: "#b91c1c", bd: "#fca5a5", label: "8d+" },
};

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n === 1 ? one : many;
}

// ── Subject ────────────────────────────────────────────────────────────────
export function subjectFor(u: UserDigest): string {
  const teamActive = u.team && u.team.repsNeedingBackup > 0;
  if (teamActive) {
    const t = u.team!;
    return `Dilly — Team backup: ${t.repsNeedingBackup} ${plural(t.repsNeedingBackup, "rep")} behind (${t.teamOverdueTotal} overdue)`;
  }
  return `Dilly — ${u.rep.dueToday.count} ${plural(u.rep.dueToday.count, "follow-up")} today (${u.rep.overdue.count} overdue)`;
}

// ── HTML building blocks ─────────────────────────────────────────────────────
function sectionHeader(title: string, count: number, accent: string): string {
  return `<tr><td style="padding:22px 24px 8px 24px;">
    <span style="display:inline-block;border-left:3px solid ${accent};padding-left:10px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${INK};">${esc(title)}</span>
    <span style="margin-left:8px;font-size:13px;font-weight:600;color:${MUTE};">${count}</span>
  </td></tr>`;
}

function itemRow(inner: string): string {
  return `<tr><td style="padding:6px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;">
      <tr><td style="padding:12px 14px;">${inner}</td></tr>
    </table>
  </td></tr>`;
}

function link(href: string, text: string): string {
  return `<a href="${href}" style="color:${BLUE};text-decoration:none;font-weight:600;">${esc(text)}</a>`;
}

function metaLine(text: string): string {
  return `<div style="margin-top:3px;font-size:13px;color:${MUTE};">${text}</div>`;
}

// ── Sections ─────────────────────────────────────────────────────────────────
function dueTodaySection(rep: RepDigest, appUrl: string): string {
  if (rep.dueToday.count === 0) return "";
  const rows = rep.dueToday.items
    .map((it) => {
      const since = it.daysSinceTouch === null ? "no prior touch" : `last touch ${it.daysSinceTouch}d ago`;
      const note = it.note ? ` · ${esc(it.note)}` : "";
      return itemRow(
        `<div style="font-size:15px;color:${INK};">${link(`${appUrl}/app/contacts/${it.contactId}`, it.contactName)} <span style="color:${MUTE};">· ${esc(it.accountName)}</span></div>` +
          metaLine(`${since}${note}`),
      );
    })
    .join("");
  const more =
    rep.dueToday.count > rep.dueToday.items.length
      ? itemRow(`<div style="font-size:13px;color:${MUTE};">+ ${rep.dueToday.count - rep.dueToday.items.length} more due today</div>`)
      : "";
  return sectionHeader("Due today", rep.dueToday.count, BLUE) + rows + more;
}

function overdueSection(rep: RepDigest, appUrl: string): string {
  if (rep.overdue.count === 0) return "";
  const rows = rep.overdue.items
    .map((it) => {
      const s = TIER_STYLE[it.tier];
      const chip = `<span style="display:inline-block;background:${s.bg};color:${s.fg};border:1px solid ${s.bd};border-radius:999px;padding:1px 8px;font-size:12px;font-weight:700;">${it.daysOverdue}d overdue</span>`;
      const note = it.note ? ` · ${esc(it.note)}` : "";
      return itemRow(
        `<div style="font-size:15px;color:${INK};">${link(`${appUrl}/app/contacts/${it.contactId}`, it.contactName)} <span style="color:${MUTE};">· ${esc(it.accountName)}</span></div>` +
          `<div style="margin-top:5px;">${chip}</div>` +
          metaLine(`Due ${it.daysOverdue}d ago${note}`),
      );
    })
    .join("");
  const more =
    rep.overdue.count > rep.overdue.items.length
      ? itemRow(`<div style="font-size:13px;color:${MUTE};">+ ${rep.overdue.count - rep.overdue.items.length} more overdue</div>`)
      : "";
  return sectionHeader("Overdue", rep.overdue.count, "#dc2626") + rows + more;
}

function coldSection(rep: RepDigest, appUrl: string): string {
  if (rep.cold.count === 0) return "";
  const rows = rep.cold.items
    .map((it) => {
      const badge = `<span style="display:inline-block;background:#eff6ff;color:${BLUE};border:1px solid #bfdbfe;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:700;">${it.priorityLabel}</span>`;
      const cold = it.neverTouched ? `never touched · ${it.daysCold}d in system` : `${it.daysCold}d untouched`;
      return itemRow(
        `<div style="font-size:15px;color:${INK};">${badge} ${link(`${appUrl}/app/accounts/${it.accountId}`, it.accountName)}</div>` +
          metaLine(cold),
      );
    })
    .join("");
  return sectionHeader("Going cold", rep.cold.count, "#d97706") + rows;
}

function awaitingSection(rep: RepDigest, appUrl: string): string {
  if (!rep.awaiting.active || rep.awaiting.count === 0) return "";
  const rows = rep.awaiting.items
    .map((it) => {
      const subj = it.subject ? esc(it.subject) : "(no subject)";
      const href = it.contactId ? `${appUrl}/app/contacts/${it.contactId}` : `${appUrl}/app/today`;
      return itemRow(
        `<div style="font-size:15px;color:${INK};">${link(href, it.contactName)}</div>` +
          metaLine(`“${subj}” · ${it.daysWaiting}d waiting`),
      );
    })
    .join("");
  return sectionHeader("Awaiting reply", rep.awaiting.count, MUTE) + rows;
}

function teamSection(team: ManagerTeam, appUrl: string): string {
  if (team.repsNeedingBackup === 0) return "";
  const intro = `<tr><td style="padding:22px 24px 4px 24px;">
    <div style="border-top:1px solid ${LINE};padding-top:18px;">
      <span style="display:inline-block;border-left:3px solid ${BLUE};padding-left:10px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${INK};">Where your team needs backup today</span>
    </div>
  </td></tr>`;

  const rows = team.rows
    .map((r) => {
      const stats: string[] = [];
      if (r.overdueCount > 0) stats.push(`<b style="color:#b91c1c;">${r.overdueCount}</b> overdue`);
      if (r.dueTodayCount > 0) stats.push(`${r.dueTodayCount} due today`);
      if (r.p1ColdCount > 0) stats.push(`<b style="color:${BLUE};">${r.p1ColdCount}</b> P1 cold`);
      if (r.chronicSnoozeCount > 0) stats.push(`${r.chronicSnoozeCount} chronic ${plural(r.chronicSnoozeCount, "snooze")}`);

      const named5 = r.overdue5Plus.length
        ? `<div style="margin-top:6px;font-size:13px;color:${MUTE};">5d+ overdue: ${r.overdue5Plus
            .map((o) => `${esc(o.name)} <span style="color:#b91c1c;">(${o.daysOverdue}d)</span>`)
            .join(", ")}</div>`
        : "";
      const p1named = r.p1ColdNames.length
        ? `<div style="margin-top:4px;font-size:13px;color:${MUTE};">P1 cold: ${r.p1ColdNames.map((n) => esc(n)).join(", ")}</div>`
        : "";

      return itemRow(
        `<div style="font-size:15px;font-weight:600;color:${INK};">${esc(r.name)}</div>` +
          `<div style="margin-top:3px;font-size:13px;color:${MUTE};">${stats.join(" · ")}</div>` +
          named5 +
          p1named,
      );
    })
    .join("");

  const cta = `<tr><td style="padding:10px 24px 0 24px;">
    <div style="font-size:13px;color:${MUTE};">${link(`${appUrl}/app/manager`, "Open the team view →")}</div>
  </td></tr>`;

  return intro + rows + cta;
}

// ── Top-level HTML ───────────────────────────────────────────────────────────
export function renderUserEmail(u: UserDigest, appUrl: string): { subject: string; html: string; text: string } {
  const { rep, team } = u;
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });

  const sections =
    dueTodaySection(rep, appUrl) +
    overdueSection(rep, appUrl) +
    coldSection(rep, appUrl) +
    awaitingSection(rep, appUrl) +
    (team ? teamSection(team, appUrl) : "");

  // Caught-up state — only reachable via the admin test send (the cron skips
  // empty users), but it makes an empty test email read as success, not a bug.
  const body =
    sections ||
    `<tr><td style="padding:20px 24px;">
      <div style="border:1px solid ${LINE};border-radius:12px;padding:18px;text-align:center;color:${MUTE};font-size:15px;">
        You’re all caught up — nothing due, overdue, or going cold. 🎉
      </div>
    </td></tr>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="padding:24px 24px 4px 24px;">
        <div style="font-size:20px;font-weight:800;letter-spacing:-.01em;color:${INK};">Dilly</div>
        <div style="margin-top:10px;font-size:18px;font-weight:700;color:${INK};">Good morning, ${esc(rep.name)}</div>
        <div style="margin-top:2px;font-size:13px;color:${MUTE};">${dateLabel} · your follow-ups</div>
      </td></tr>
      ${body}
      <tr><td style="padding:24px;">
        <a href="${appUrl}/app/today" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:12px;">Open Dilly</a>
      </td></tr>
      <tr><td style="padding:8px 24px 24px 24px;border-top:1px solid ${LINE};">
        <div style="font-size:12px;color:${MUTE};line-height:1.5;">
          You’re getting this because you have open follow-ups in Dilly. You can turn off this morning digest in
          ${link(`${appUrl}/app/settings`, "Settings")}. Overdue items still escalate to your manager regardless.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject: subjectFor(u), html, text: renderText(u, appUrl) };
}

// ── Plain-text fallback ──────────────────────────────────────────────────────
function renderText(u: UserDigest, appUrl: string): string {
  const { rep, team } = u;
  const L: string[] = [];
  L.push(`Dilly — good morning, ${rep.name}`);
  L.push("");

  if (rep.dueToday.count > 0) {
    L.push(`DUE TODAY (${rep.dueToday.count})`);
    for (const it of rep.dueToday.items) {
      const since = it.daysSinceTouch === null ? "no prior touch" : `last touch ${it.daysSinceTouch}d ago`;
      L.push(`  • ${it.contactName} · ${it.accountName} — ${since}${it.note ? ` · ${it.note}` : ""}`);
      L.push(`    ${appUrl}/app/contacts/${it.contactId}`);
    }
    if (rep.dueToday.count > rep.dueToday.items.length) L.push(`  + ${rep.dueToday.count - rep.dueToday.items.length} more`);
    L.push("");
  }

  if (rep.overdue.count > 0) {
    L.push(`OVERDUE (${rep.overdue.count})`);
    for (const it of rep.overdue.items) {
      L.push(`  • ${it.contactName} · ${it.accountName} — ${it.daysOverdue}d overdue`);
      L.push(`    ${appUrl}/app/contacts/${it.contactId}`);
    }
    if (rep.overdue.count > rep.overdue.items.length) L.push(`  + ${rep.overdue.count - rep.overdue.items.length} more`);
    L.push("");
  }

  if (rep.cold.count > 0) {
    L.push(`GOING COLD (${rep.cold.count})`);
    for (const it of rep.cold.items) {
      const cold = it.neverTouched ? `never touched, ${it.daysCold}d in system` : `${it.daysCold}d untouched`;
      L.push(`  • [${it.priorityLabel}] ${it.accountName} — ${cold}`);
      L.push(`    ${appUrl}/app/accounts/${it.accountId}`);
    }
    L.push("");
  }

  if (rep.awaiting.active && rep.awaiting.count > 0) {
    L.push(`AWAITING REPLY (${rep.awaiting.count})`);
    for (const it of rep.awaiting.items) {
      L.push(`  • ${it.contactName} — "${it.subject ?? "(no subject)"}" · ${it.daysWaiting}d waiting`);
    }
    L.push("");
  }

  if (team && team.repsNeedingBackup > 0) {
    L.push(`WHERE YOUR TEAM NEEDS BACKUP TODAY`);
    for (const r of team.rows) {
      const stats = [
        r.overdueCount > 0 ? `${r.overdueCount} overdue` : "",
        r.dueTodayCount > 0 ? `${r.dueTodayCount} due today` : "",
        r.p1ColdCount > 0 ? `${r.p1ColdCount} P1 cold` : "",
        r.chronicSnoozeCount > 0 ? `${r.chronicSnoozeCount} chronic snooze` : "",
      ].filter(Boolean).join(" · ");
      L.push(`  • ${r.name}: ${stats}`);
      if (r.overdue5Plus.length) L.push(`      5d+ overdue: ${r.overdue5Plus.map((o) => `${o.name} (${o.daysOverdue}d)`).join(", ")}`);
      if (r.p1ColdNames.length) L.push(`      P1 cold: ${r.p1ColdNames.join(", ")}`);
    }
    L.push(`    ${appUrl}/app/manager`);
    L.push("");
  }

  L.push(`Open Dilly: ${appUrl}/app/today`);
  L.push(`Turn off this digest: ${appUrl}/app/settings — overdue items still escalate to your manager.`);
  return L.join("\n");
}
