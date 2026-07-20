import "server-only";

import type { EmailMessageMeta, MailProvider, TokenSet } from "./types";

/**
 * Outlook / Microsoft Graph provider — STUB ONLY (phase 1 does not build Outlook).
 *
 * It exists so the rest of the system is written against the provider interface
 * rather than Gmail specifics. When Outlook is built, implement these against
 * Microsoft Graph (OAuth + /me/messages + delta queries) and register it in the
 * factory. Every method throws until then; it is never wired into the UI/sync.
 */
export class OutlookProvider implements MailProvider {
  readonly provider = "outlook" as const;

  private notImplemented(): never {
    throw new Error("Outlook email integration is not implemented yet (phase 1 is Gmail-only)");
  }

  getAuthUrl(): string {
    return this.notImplemented();
  }
  exchangeCode(): Promise<TokenSet> {
    return this.notImplemented();
  }
  refresh(): Promise<TokenSet> {
    return this.notImplemented();
  }
  getProfile(): Promise<{ emailAddress: string; historyId: string | null }> {
    return this.notImplemented();
  }
  listSince(): Promise<{ messageIds: string[]; newHistoryId: string | null }> {
    return this.notImplemented();
  }
  backfill(): Promise<string[]> {
    return this.notImplemented();
  }
  getMessage(): Promise<EmailMessageMeta | null> {
    return this.notImplemented();
  }
  revoke(): Promise<void> {
    return this.notImplemented();
  }
}
