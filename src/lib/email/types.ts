// Provider-agnostic email types. Gmail is the only implementation in phase 1;
// Outlook slots in behind the same interface later (see outlook-provider.ts).

export type EmailProviderKind = "gmail" | "outlook";

export type TokenSet = {
  accessToken: string;
  /** Only returned on the first consent (access_type=offline, prompt=consent). */
  refreshToken: string | null;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
  scope?: string;
};

/** Normalized message metadata — NO body (phase 1 uses gmail.metadata scope). */
export type EmailMessageMeta = {
  messageId: string;
  threadId: string;
  direction: "inbound" | "outbound";
  from: string | null;
  to: string[];
  subject: string | null;
  /** ISO timestamp. */
  date: string;
};

export interface MailProvider {
  readonly provider: EmailProviderKind;

  /** Build the consent-screen URL to redirect the user to. */
  getAuthUrl(opts: { redirectUri: string; state: string }): string;

  /** Exchange an authorization code for tokens. */
  exchangeCode(opts: { code: string; redirectUri: string }): Promise<TokenSet>;

  /** Refresh an access token using a stored refresh token. */
  refresh(refreshToken: string): Promise<TokenSet>;

  /** Mailbox address + current incremental cursor. */
  getProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string | null }>;

  /** Incremental: message ids added since the given cursor, plus the new cursor. */
  listSince(opts: {
    accessToken: string;
    historyId: string;
  }): Promise<{ messageIds: string[]; newHistoryId: string | null }>;

  /** First-run backfill: recent SENT+INBOX message ids (newest first, capped). */
  backfill(opts: { accessToken: string; maxPerLabel: number }): Promise<string[]>;

  /** Fetch one message's metadata. Returns null if it can't be read. */
  getMessage(opts: { accessToken: string; messageId: string }): Promise<EmailMessageMeta | null>;

  /** Revoke a token on disconnect. */
  revoke(token: string): Promise<void>;
}
