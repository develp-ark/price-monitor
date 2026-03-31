const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    return { error: 'Missing SUPABASE_URL or SUPABASE_KEY' };
  }
  return { client: createClient(url, key) };
}

module.exports = { getSupabase };
