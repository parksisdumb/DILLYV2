// Renders the follow-up digest email with realistic sample data so the template
// can be eyeballed without a live send. Not part of the app — a dev preview tool.
//   npx tsx scripts/preview-digest.ts > preview.html
import { renderUserEmail } from "../src/lib/notifications/render";
import type { UserDigest } from "../src/lib/notifications/types";

const sample: UserDigest = {
  isEmpty: false,
  rep: {
    userId: "u1",
    orgId: "o1",
    email: "you@example.com",
    name: "Jordan",
    role: "manager",
    dueToday: {
      count: 4,
      items: [
        { contactId: "c1", contactName: "Marcus Webb", accountId: "a1", accountName: "Greystar — Riverside", note: "Send the TPO spec he asked about", daysSinceTouch: 6 },
        { contactId: "c2", contactName: "Elena Ruiz", accountId: "a2", accountName: "Hines — 300 Colorado", note: null, daysSinceTouch: 3 },
        { contactId: "c3", contactName: "Priya Anand", accountId: "a3", accountName: "CBRE — Domain Tower", note: "Confirm inspection window", daysSinceTouch: null },
        { contactId: "c4", contactName: "Tom Fowler", accountId: "a4", accountName: "Lincoln — Mueller", note: null, daysSinceTouch: 12 },
      ],
    },
    overdue: {
      count: 3,
      items: [
        { contactId: "c5", contactName: "Dana Kim", accountId: "a5", accountName: "JLL — Frost Bank Tower", note: "Left VM twice", daysSinceTouch: 14, daysOverdue: 11, tier: "red" },
        { contactId: "c6", contactName: "Ray Okafor", accountId: "a6", accountName: "Cushman — Colorado Center", note: null, daysSinceTouch: 9, daysOverdue: 6, tier: "orange" },
        { contactId: "c7", contactName: "Nina Alvarez", accountId: "a7", accountName: "Stream — 5th & Colorado", note: "Wants a Q3 revisit", daysSinceTouch: 5, daysOverdue: 2, tier: "amber" },
      ],
    },
    cold: {
      count: 2,
      items: [
        { accountId: "a8", accountName: "Prologis — Southeast Portfolio", priorityLabel: "P1", tier: "A", daysCold: 19, neverTouched: false },
        { accountId: "a9", accountName: "Draper & Kramer", priorityLabel: "P2", tier: "B", daysCold: 24, neverTouched: true },
      ],
    },
    awaiting: {
      active: true,
      count: 2,
      items: [
        { contactId: "c8", contactName: "Marcus Webb", subject: "Re: TPO reroof — Riverside", daysWaiting: 4 },
        { contactId: "c9", contactName: "Sam Petrov", subject: "Budget numbers for the Domain job", daysWaiting: 2 },
      ],
    },
  },
  team: {
    teamOverdueTotal: 14,
    repsNeedingBackup: 2,
    rows: [
      {
        userId: "u2",
        name: "Chris Delgado",
        dueTodayCount: 6,
        overdueCount: 9,
        overdue5Plus: [
          { name: "Dana Kim", account: "JLL — Frost Bank Tower", daysOverdue: 11 },
          { name: "Owen Pratt", account: "Transwestern", daysOverdue: 8 },
        ],
        chronicSnoozeCount: 2,
        p1ColdCount: 1,
        p1ColdNames: ["Prologis — Southeast Portfolio"],
      },
      {
        userId: "u3",
        name: "Maya Nguyen",
        dueTodayCount: 3,
        overdueCount: 5,
        overdue5Plus: [{ name: "Gail Turner", account: "Boxer Property", daysOverdue: 6 }],
        chronicSnoozeCount: 0,
        p1ColdCount: 0,
        p1ColdNames: [],
      },
    ],
  },
};

const { subject, html } = renderUserEmail(sample, "https://dillyv2.vercel.app");
process.stderr.write(`Subject: ${subject}\n`);
process.stdout.write(html);
