-- Force PostgREST to reload its schema cache.
-- Recent column adds (website, building_type) sometimes don't get picked up
-- by the API layer until the cache is explicitly nudged.
notify pgrst, 'reload schema';
