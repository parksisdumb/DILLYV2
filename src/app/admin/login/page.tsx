export const runtime = "nodejs";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function AdminLoginPage({ searchParams }: Props) {
  const params = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-tight text-blue-400">Dilly</div>
          <div className="mt-1 text-sm text-slate-500">Internal Admin Portal</div>
        </div>

        <form
          method="POST"
          action="/admin/login/submit"
          className="w-full rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-sm space-y-5"
        >
          <h1 className="text-lg font-semibold text-white">Admin Access</h1>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Secret Key</label>
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-700 px-3 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              name="password"
              type="password"
              autoComplete="off"
              placeholder="Enter admin secret key"
              required
            />
          </div>

          {params.error && (
            <p className="rounded-xl border border-red-800 bg-red-900/50 px-3 py-2 text-sm text-red-300">
              Invalid secret key
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
