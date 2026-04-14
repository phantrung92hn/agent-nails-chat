// app/api/health/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Health check endpoint — kiểm tra nhanh tất cả env vars + connectivity
// Gọi: GET /api/health
//
// ⚠️  Endpoint này KHÔNG expose giá trị thực của env vars (bảo mật)
//     Chỉ cho biết biến nào đã set / chưa set
//     Nên xoá hoặc bảo vệ bằng auth trước khi go production
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const checks = {};

  // ── 1. Env vars status ──────────────────────────────────────────────────
  const envVars = [
    "ANTHROPIC_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_SERVICE_ACCOUNT",
    "GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "CALENDAR_LISA",
    "CALENDAR_ANNA",
    "CALENDAR_MAI",
  ];

  checks.env = {};
  for (const key of envVars) {
    const val = process.env[key];
    if (!val) {
      checks.env[key] = "❌ NOT SET";
    } else {
      // Chỉ hiện 4 ký tự đầu + chiều dài, không lộ value
      checks.env[key] = `✅ SET (${val.slice(0, 4)}... ${val.length} chars)`;
    }
  }

  // ── 2. Claude API connectivity ──────────────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const data = await res.json();

      if (res.ok) {
        checks.claude = `✅ Connected (model: claude-sonnet-4-20250514)`;
      } else {
        checks.claude = `❌ Error ${res.status}: ${data?.error?.type} — ${data?.error?.message}`;
      }
    } catch (err) {
      checks.claude = `❌ Network error: ${err.message}`;
    }
  } else {
    checks.claude = "⏭️ Skipped (no API key)";
  }

  // ── 3. Summary ──────────────────────────────────────────────────────────
  const critical = ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missingCritical = critical.filter((k) => !process.env[k]);

  checks.summary = {
    status: missingCritical.length === 0 ? "✅ All critical vars set" : "❌ Missing critical vars",
    missing: missingCritical,
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
  };

  return Response.json(checks, {
    status: missingCritical.length === 0 ? 200 : 503,
  });
}
