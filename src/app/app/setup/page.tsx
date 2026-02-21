"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

export default function SetupOrgPage() {
  const supabase = createClient();
  const router = useRouter();

  const [orgName, setOrgName] = useState("Dilly Dev Org");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createOrg() {
    setLoading(true);
    setError(null);

    const { error } = await supabase.rpc("rpc_bootstrap_org", {
      p_org_name: orgName,
    });

    setLoading(false);

    if (error) return setError(error.message);

    // data is org_id (uuid)
    router.push("/app/today");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4">
        <h1 className="text-xl font-semibold">Create your org</h1>
        <p className="text-sm text-gray-600">
          This sets up roles and your membership.
        </p>

        <div className="space-y-2">
          <label className="text-sm">Org name</label>
          <input
            className="w-full rounded-md border px-3 py-2"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          className="w-full rounded-md border px-3 py-2"
          onClick={createOrg}
          disabled={loading}
        >
          {loading ? "..." : "Create org"}
        </button>
      </div>
    </div>
  );
}
