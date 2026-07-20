import "server-only";

import { GmailProvider } from "./gmail-provider";
import { OutlookProvider } from "./outlook-provider";
import type { EmailProviderKind, MailProvider } from "./types";

const gmail = new GmailProvider();
const outlook = new OutlookProvider();

export function getProvider(kind: EmailProviderKind): MailProvider {
  return kind === "gmail" ? gmail : outlook;
}

/** The redirect URI must exactly match one registered in Google Cloud Console. */
export function gmailRedirectUri(origin: string): string {
  return `${origin}/api/google/gmail/callback`;
}

export type { EmailMessageMeta, MailProvider, TokenSet } from "./types";
