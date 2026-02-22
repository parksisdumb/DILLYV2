import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY) in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type DevUser = { email: string; password: string };

const DEV_USERS: DevUser[] = [
  { email: "admin@dilly.dev", password: "devpassword123!" },
  { email: "manager@dilly.dev", password: "devpassword123!" },
  { email: "rep@dilly.dev", password: "devpassword123!" },
];

async function listExistingEmails(): Promise<Set<string>> {
  const perPage = 200;
  const existing = new Set<string>();
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    for (const user of data.users) {
      if (user.email) {
        existing.add(user.email.toLowerCase());
      }
    }

    if (data.users.length < perPage) {
      break;
    }
    page++;
  }

  return existing;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main() {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  const existingEmails = await listExistingEmails();

  for (const user of DEV_USERS) {
    const emailKey = user.email.toLowerCase();

    if (existingEmails.has(emailKey)) {
      console.log(`SKIP (exists): ${user.email}`);
      skipped++;
      continue;
    }

    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      });

      if (error) {
        const message = error.message.toLowerCase();
        if (message.includes("already")) {
          console.log(`SKIP (exists): ${user.email}`);
          skipped++;
          continue;
        }
        throw error;
      }

      console.log(`CREATED: ${user.email} (id=${data.user?.id})`);
      created++;
      existingEmails.add(emailKey);
    } catch (error: unknown) {
      failed++;
      console.error(`ERROR for ${user.email}: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }

  console.log(`\nDone. Created=${created}, Skipped=${skipped}, Failed=${failed}`);
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
