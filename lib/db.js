// lib/db.js
// ─────────────────────────────────────────────────────────────────────────────
// Supabase client — khởi tạo một lần, dùng chung toàn app (singleton pattern)
// Dùng service_role key (server-side only) để bypass RLS
// KHÔNG bao giờ import file này ở client component
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL) {
  throw new Error("Missing env: SUPABASE_URL");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
}

// Singleton: Next.js hot-reload có thể tạo nhiều instances → dùng global cache
const globalForSupabase = globalThis;

export const db =
  globalForSupabase._supabaseClient ??
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // Server-side: không cần session management
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

if (process.env.NODE_ENV !== "production") {
  globalForSupabase._supabaseClient = db;
}
