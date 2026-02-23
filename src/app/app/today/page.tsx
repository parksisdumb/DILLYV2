import { requireServerOrgContext } from "@/lib/supabase/server-org";

export default async function TodayPage() {
  const { supabase, userId } = await requireServerOrgContext();

  const { data: nextActions, error } = await supabase
    .from("next_actions")
    .select("id, due_at, status, notes, property_id")
    .eq("assigned_user_id", userId)
    .eq("status", "open")
    .order("due_at", { ascending: true })
    .limit(50);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Today</h1>
        <a href="/app/admin/team" className="text-sm underline">
          Team
        </a>
      </div>

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
