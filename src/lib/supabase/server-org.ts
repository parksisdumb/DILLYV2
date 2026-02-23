import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyOrgId } from "@/lib/supabase/get-my-org-id";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type ServerAuthOrgState = {
  supabase: ServerSupabaseClient;
  userId: string | null;
  orgId: string | null;
};

export async function getServerAuthOrgState(): Promise<ServerAuthOrgState> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? null;

  if (!userId) {
    return { supabase, userId: null, orgId: null };
  }

  let orgId: string | null;
  try {
    orgId = await getMyOrgId(supabase, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    // This shows up after local resets when browser holds an old JWT.
    if (
      lower.includes("jwt issued at future") ||
      lower.includes("invalid jwt") ||
      lower.includes("jwt") ||
      lower.includes("unauthorized")
    ) {
      return { supabase, userId: null, orgId: null };
    }

    throw error;
  }

  return {
    supabase,
    userId,
    orgId,
  };
}

export type RequiredServerOrgContext = {
  supabase: ServerSupabaseClient;
  userId: string;
  orgId: string;
};

export async function requireServerOrgContext(): Promise<RequiredServerOrgContext> {
  const state = await getServerAuthOrgState();

  if (!state.userId) redirect("/login");
  if (!state.orgId) redirect("/app/setup");

  return {
    supabase: state.supabase,
    userId: state.userId,
    orgId: state.orgId,
  };
}

export function withOrgAndCreator<T extends Record<string, unknown>>(
  context: Pick<RequiredServerOrgContext, "orgId" | "userId">,
  values: T,
): T & { org_id: string; created_by: string } {
  return {
    ...values,
    org_id: context.orgId,
    created_by: context.userId,
  };
}
