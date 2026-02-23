import { redirect } from "next/navigation";
import { getServerAuthOrgState } from "@/lib/supabase/server-org";

type AcceptInvitePageProps = {
  params: Promise<{ token: string }>;
};

export default async function AcceptInvitePage({ params }: AcceptInvitePageProps) {
  const { token } = await params;
  const { supabase, userId } = await getServerAuthOrgState();

  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/invite/accept/${token}`)}`);
  }

  const { data: orgId, error } = await supabase.rpc("rpc_accept_invite", {
    p_token: token,
  });

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border p-6 space-y-3">
          <h1 className="text-xl font-semibold">Invite Error</h1>
          <p className="text-sm text-red-700">{error.message}</p>
          <a className="text-sm underline" href="/app">
            Go to app
          </a>
        </div>
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border p-6 space-y-3">
          <h1 className="text-xl font-semibold">Invite Error</h1>
          <p className="text-sm text-red-700">Invite was accepted but org assignment was missing.</p>
          <a className="text-sm underline" href="/app/setup">
            Go to setup
          </a>
        </div>
      </div>
    );
  }

  redirect("/app");
}

