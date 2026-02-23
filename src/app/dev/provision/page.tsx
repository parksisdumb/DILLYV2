import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

type ProvisionSearchParams = {
  status?: string;
  message?: string;
  orgId?: string;
};

type ProvisionPageProps = {
  searchParams: Promise<ProvisionSearchParams>;
};

function isDevProvisioningEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_PROVISIONING === "true"
  );
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    const match = data.users.find(
      (u) => (u.email || "").toLowerCase() === email.toLowerCase(),
    );
    if (match?.id) return match.id;

    if (data.users.length < perPage) break;
    page++;
  }

  return null;
}

async function provisionOrgOwnerAction(formData: FormData) {
  "use server";

  if (!isDevProvisioningEnabled()) notFound();

  const orgName = String(formData.get("org_name") ?? "").trim();
  const ownerEmail = String(formData.get("owner_email") ?? "").trim().toLowerCase();
  const ownerPassword = String(formData.get("owner_password") ?? "").trim();

  if (!orgName) {
    redirect("/dev/provision?status=error&message=Organization%20name%20is%20required");
  }
  if (!ownerEmail) {
    redirect("/dev/provision?status=error&message=Owner%20email%20is%20required");
  }

  const admin = createAdminClient();

  let ownerUserId = await findUserIdByEmail(ownerEmail);

  if (!ownerUserId) {
    if (!ownerPassword) {
      redirect(
        "/dev/provision?status=error&message=Provide%20owner%20password%20to%20create%20a%20new%20user",
      );
    }

    const { data: created, error: createUserError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });

    if (createUserError || !created.user?.id) {
      const message = createUserError?.message || "Failed to create owner user";
      redirect(`/dev/provision?status=error&message=${encodeURIComponent(message)}`);
    }

    ownerUserId = created.user.id;
  }

  const { data: orgId, error: provisionError } = await admin.rpc(
    "rpc_provision_org_owner",
    {
      p_org_name: orgName,
      p_owner_user_id: ownerUserId,
    },
  );

  if (provisionError || !orgId) {
    const message = provisionError?.message || "Provisioning failed";
    redirect(`/dev/provision?status=error&message=${encodeURIComponent(message)}`);
  }

  redirect(`/dev/provision?status=success&orgId=${orgId}`);
}

export default async function DevProvisionPage({ searchParams }: ProvisionPageProps) {
  if (!isDevProvisioningEnabled()) notFound();

  const params = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border p-6 space-y-4">
        <h1 className="text-xl font-semibold">Dev Org Provisioning</h1>
        <p className="text-sm text-gray-700">
          Service-role provisioning for initial org owner setup. This page is dev-only.
        </p>

        {params.status === "success" && (
          <p className="text-sm text-green-700">
            Provisioned successfully. Org ID: {params.orgId}
          </p>
        )}

        {params.status === "error" && (
          <p className="text-sm text-red-700">{params.message || "Provisioning failed."}</p>
        )}

        <form action={provisionOrgOwnerAction} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm">Organization name</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              name="org_name"
              defaultValue="Dilly Dev Org"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">Owner email</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              name="owner_email"
              defaultValue="admin@dilly.dev"
              type="email"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">
              Owner password (only used if user does not exist)
            </label>
            <input
              className="w-full rounded-md border px-3 py-2"
              name="owner_password"
              placeholder="devpassword123!"
              type="password"
            />
          </div>

          <button className="rounded-md border px-3 py-2">Provision org owner</button>
        </form>

        <a href="/app" className="text-sm underline">
          Back to app
        </a>
      </div>
    </div>
  );
}

