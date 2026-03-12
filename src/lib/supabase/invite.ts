import "server-only";

import { createAdminClient } from "./admin";

/**
 * Send a Supabase invite email to a new user.
 * Creates the auth user and sends an invite email via Supabase built-in SMTP.
 * Returns the created user data or an error.
 */
export async function sendInviteEmail(
  email: string,
  opts: {
    firstName?: string;
    lastName?: string;
    redirectPath?: string;
  } = {},
) {
  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent(
    opts.redirectPath || "/auth/set-password",
  )}`;

  const fullName = [opts.firstName, opts.lastName].filter(Boolean).join(" ");

  return admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      ...(opts.firstName && { first_name: opts.firstName }),
      ...(opts.lastName && { last_name: opts.lastName }),
      ...(fullName && { full_name: fullName }),
    },
  });
}
