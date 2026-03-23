-- Add portfolio_summary jsonb to reit_universe for storing subsidiary hints,
-- management contacts, and other extracted metadata per REIT.

alter table reit_universe add column if not exists portfolio_summary jsonb default '{}'::jsonb;

-- Seed reit_website_properties agent (disabled — future session)
insert into agent_registry (agent_name, display_name, schedule, enabled, config) values
  ('reit_website_properties', 'REIT Website Properties', '0 5 * * 1', false,
   '{"urls": {"agree_realty": "agreerealty.com/properties", "realty_income": "realtyincome.com/properties", "nnn": "nnnreit.com/portfolio"}}'::jsonb)
on conflict (agent_name) do nothing;
