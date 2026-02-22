import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMyOrgId } from "@/lib/supabase/get-my-org-id";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;

  if (!user) redirect("/login");

  const orgId = await getMyOrgId(supabase, user.id);

  if (!orgId) redirect("/app/setup");

  const { data: nextActions, error } = await supabase
    .from("next_actions")
    .select("id, due_at, status, notes, property_id")
    .eq("assigned_user_id", user.id)
    .eq("status", "open")
    .order("due_at", { ascending: true })
    .limit(50);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Today</h1>

      <div className="rounded-2xl border p-4">
        <h2 className="text-lg font-semibold">Advance</h2>
        <p className="text-sm text-gray-600">Follow-ups due</p>

        {error && <p className="text-sm text-red-600">{error.message}</p>}

        {!nextActions?.length ? (
          <p className="text-sm mt-3">No follow-ups due.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {nextActions.map((a) => (
              <li key={a.id} className="rounded-lg border p-3">
                <div className="text-sm font-medium">
                  Due: {new Date(a.due_at).toLocaleString()}
                </div>
                <div className="text-sm text-gray-700">{a.notes}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
