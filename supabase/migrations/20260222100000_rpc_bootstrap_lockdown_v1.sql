-- Lock down tenant bootstrap to prevent automatic org creation by any signed-in user.
-- Bootstrap should be an admin/service workflow, not a default authenticated action.

revoke all on function public.rpc_bootstrap_org(text) from public;
revoke execute on function public.rpc_bootstrap_org(text) from authenticated;
grant execute on function public.rpc_bootstrap_org(text) to service_role;
