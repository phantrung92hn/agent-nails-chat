// lib/db.js
// ─────────────────────────────────────────────────────────────────────────────
// Supabase client — LAZY initialization (singleton pattern)
// Dùng service_role key (server-side only) để bypass RLS
// KHÔNG bao giờ import file này ở client component
//
// FIX: Chuyển từ top-level throw sang lazy init
//      Trước đây: nếu thiếu env var → throw ngay khi module load
//      → crash toàn bộ route (kể cả chat route không dùng DB)
//      Bây giờ:  chỉ throw khi thực sự gọi getDb()
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

// Singleton: Next.js hot-reload có thể tạo nhiều instances → dùng global cache
const globalForSupabase = globalThis;

/**
 * Lấy Supabase client (lazy init — chỉ tạo khi cần)
 * @returns {import("@supabase/supabase-js").SupabaseClient}
 * @throws {Error} nếu thiếu env vars
 */
export function getDb() {
  if (globalForSupabase._supabaseClient) {
    return globalForSupabase._supabaseClient;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const client = createClient(url, key, {
    auth: {
      // Server-side: không cần session management
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Cache singleton (chỉ trong dev để tránh hot-reload tạo nhiều client)
  if (process.env.NODE_ENV !== "production") {
    globalForSupabase._supabaseClient = client;
  } else {
    globalForSupabase._supabaseClient = client;
  }

  return client;
}

// Backward-compatible export — nhưng giờ là getter, không phải eager init
// Dùng Proxy để chỉ tạo client khi thực sự access property
export const db = new Proxy(
  {},
  {
    get(_target, prop) {
      return getDb()[prop];
    },
  }
);
