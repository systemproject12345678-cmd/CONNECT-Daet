import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Temporary debug logs (Open your Browser Console to check these)
console.log("LOADED SUPABASE URL:", supabaseUrl);
console.log("LOADED SUPABASE KEY:", supabaseAnonKey);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("⚠️ Supabase environment variables are missing in .env.local!");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);