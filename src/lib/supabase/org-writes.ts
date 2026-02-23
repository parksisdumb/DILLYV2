import "server-only";

import {
  type RequiredServerOrgContext,
  withOrgAndCreator,
} from "@/lib/supabase/server-org";

type OrgScopedTable =
  | "accounts"
  | "contacts"
  | "properties"
  | "opportunities";

type SoftDeleteTable =
  | "accounts"
  | "contacts"
  | "properties"
  | "opportunities";

async function insertOrgScopedRow<T extends Record<string, unknown>>(
  context: RequiredServerOrgContext,
  table: OrgScopedTable,
  values: T,
) {
  const payload = withOrgAndCreator(context, values);

  const { data, error } = await context.supabase
    .from(table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createAccount(
  context: RequiredServerOrgContext,
  values: Record<string, unknown>,
) {
  return insertOrgScopedRow(context, "accounts", values);
}

export async function createContact(
  context: RequiredServerOrgContext,
  values: Record<string, unknown>,
) {
  const firstName = (values.first_name as string | undefined)?.trim();
  const lastName = (values.last_name as string | undefined)?.trim();
  const fullName = (values.full_name as string | undefined)?.trim();

  const derivedFullName =
    fullName ||
    [firstName, lastName]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .trim();

  return insertOrgScopedRow(context, "contacts", {
    ...values,
    full_name: derivedFullName || fullName || "Unknown Contact",
  });
}

export async function createProperty(
  context: RequiredServerOrgContext,
  values: Record<string, unknown>,
) {
  return insertOrgScopedRow(context, "properties", values);
}

export async function createOpportunity(
  context: RequiredServerOrgContext,
  values: Record<string, unknown>,
) {
  return insertOrgScopedRow(context, "opportunities", values);
}

export async function softDeleteById(
  context: RequiredServerOrgContext,
  table: SoftDeleteTable,
  id: string,
) {
  const { error } = await context.supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", context.orgId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }
}

type IsNullFilterQuery<T> = {
  is: (column: string, value: null) => T;
};

export function applyNotDeletedFilter<T>(query: IsNullFilterQuery<T>): T {
  return query.is("deleted_at", null);
}
