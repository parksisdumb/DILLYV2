import "server-only";

import type { EmailMessageMeta, MailProvider, TokenSet } from "./types";

// Phase 1 scope: metadata only (from/to/subject/date/threadId), NO bodies.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function clientCreds() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

function toTokenSet(json: Record<string, unknown>, fallbackRefresh?: string | null): TokenSet {
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    accessToken: String(json.access_token),
    refreshToken: (json.refresh_token as string | undefined) ?? fallbackRefresh ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: json.scope as string | undefined,
  };
}

/** Extract lowercased email addresses from a raw header value. */
function extractEmails(headerValue: string | null | undefined): string[] {
  if (!headerValue) return [];
  const matches = headerValue.match(/[^\s<>,;"]+@[^\s<>,;"]+/g);
  if (!matches) return [];
  return matches.map((e) => e.toLowerCase().replace(/[.,;]+$/, ""));
}

async function gapi(accessToken: string, path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export class GmailProvider implements MailProvider {
  readonly provider = "gmail" as const;

  getAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    const { clientId } = clientCreds();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPE,
      access_type: "offline",
      prompt: "consent", // force a refresh_token every time
      include_granted_scopes: "true",
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<TokenSet> {
    const { clientId, clientSecret } = clientCreds();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Gmail token exchange failed: ${JSON.stringify(json)}`);
    return toTokenSet(json);
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const { clientId, clientSecret } = clientCreds();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Gmail token refresh failed: ${JSON.stringify(json)}`);
    // Refresh responses don't include a new refresh_token — keep the old one.
    return toTokenSet(json, refreshToken);
  }

  async getProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string | null }> {
    const res = await gapi(accessToken, "/profile");
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Gmail profile failed: ${JSON.stringify(json)}`);
    return {
      emailAddress: String(json.emailAddress),
      historyId: (json.historyId as string | undefined) ?? null,
    };
  }

  async listSince({
    accessToken,
    historyId,
  }: {
    accessToken: string;
    historyId: string;
  }): Promise<{ messageIds: string[]; newHistoryId: string | null }> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let newHistoryId: string | null = historyId;

    do {
      const params = new URLSearchParams({
        startHistoryId: historyId,
        historyTypes: "messageAdded",
        maxResults: "500",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await gapi(accessToken, `/history?${params.toString()}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        // 404 = historyId too old / expired → signal a full re-backfill by returning null cursor.
        if (res.status === 404) return { messageIds: [], newHistoryId: null };
        throw new Error(`Gmail history failed: ${JSON.stringify(json)}`);
      }
      const history = (json.history as Array<Record<string, unknown>> | undefined) ?? [];
      for (const h of history) {
        const added = (h.messagesAdded as Array<{ message?: { id?: string } }> | undefined) ?? [];
        for (const a of added) {
          if (a.message?.id) ids.add(a.message.id);
        }
      }
      if (json.historyId) newHistoryId = String(json.historyId);
      pageToken = json.nextPageToken as string | undefined;
    } while (pageToken);

    return { messageIds: [...ids], newHistoryId };
  }

  async backfill({
    accessToken,
    maxPerLabel,
  }: {
    accessToken: string;
    maxPerLabel: number;
  }): Promise<string[]> {
    const ids: string[] = [];
    for (const labelId of ["SENT", "INBOX"]) {
      let pageToken: string | undefined;
      let fetched = 0;
      do {
        const remaining = maxPerLabel - fetched;
        if (remaining <= 0) break;
        const params = new URLSearchParams({
          labelIds: labelId,
          maxResults: String(Math.min(100, remaining)),
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await gapi(accessToken, `/messages?${params.toString()}`);
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) throw new Error(`Gmail list failed: ${JSON.stringify(json)}`);
        const messages = (json.messages as Array<{ id?: string }> | undefined) ?? [];
        for (const m of messages) {
          if (m.id) {
            ids.push(m.id);
            fetched++;
          }
        }
        pageToken = json.nextPageToken as string | undefined;
      } while (pageToken && fetched < maxPerLabel);
    }
    return [...new Set(ids)];
  }

  async getMessage({
    accessToken,
    messageId,
  }: {
    accessToken: string;
    messageId: string;
  }): Promise<EmailMessageMeta | null> {
    const params = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "To", "Subject", "Date"]) params.append("metadataHeaders", h);
    const res = await gapi(accessToken, `/messages/${messageId}?${params.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;

    const labelIds = (json.labelIds as string[] | undefined) ?? [];
    const payload = (json.payload as Record<string, unknown> | undefined) ?? {};
    const headers = (payload.headers as Array<{ name: string; value: string }> | undefined) ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

    const internalDate = json.internalDate ? Number(json.internalDate) : Date.now();

    return {
      messageId: String(json.id ?? messageId),
      threadId: String(json.threadId ?? messageId),
      direction: labelIds.includes("SENT") ? "outbound" : "inbound",
      from: extractEmails(header("From"))[0] ?? null,
      to: extractEmails(header("To")),
      subject: header("Subject"),
      date: new Date(internalDate).toISOString(),
    };
  }

  async revoke(token: string): Promise<void> {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }
}
