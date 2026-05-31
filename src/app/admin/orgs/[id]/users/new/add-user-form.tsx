"use client";

import { useState } from "react";

export default function AddUserForm({
  action,
  orgId,
}: {
  action: (formData: FormData) => Promise<void>;
  orgId: string;
}) {
  const [sendInvite, setSendInvite] = useState(false);

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="org_id" value={orgId} />

      <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">First Name</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="first_name"
              required
              placeholder="Jane"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Last Name</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="last_name"
              required
              placeholder="Doe"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-300">Email</label>
          <input
            className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            name="email"
            type="email"
            required
            placeholder="jane@company.com"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-300">Role</label>
          <select
            name="role"
            defaultValue="rep"
            className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="rep">Rep</option>
          </select>
        </div>

        {/* Invite toggle */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-600 bg-slate-700/50 p-3">
          <input
            type="checkbox"
            name="send_invite"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-500 bg-slate-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-300">
            Send invite email
            <span className="mt-0.5 block text-xs text-slate-400">
              The user receives an email and sets their own password. Leave unchecked to set a password yourself.
            </span>
          </span>
        </label>

        {/* Password — only when NOT sending an invite */}
        {!sendInvite && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Password</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="password"
              type="text"
              required
              placeholder="Minimum 6 characters"
              minLength={6}
            />
            <p className="text-xs text-slate-400">
              You&apos;ll see this password on the next screen to copy and share with the user.
            </p>
          </div>
        )}
      </div>

      <button
        type="submit"
        className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Create User
      </button>
    </form>
  );
}
