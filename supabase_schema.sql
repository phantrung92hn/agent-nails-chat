-- ═══════════════════════════════════════════════════════════════════════════
-- Sakura Nails Hamburg — Supabase Schema
-- Chạy toàn bộ file này trong: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. BẢNG KHÁCH HÀNG (customers)
--    Nhận diện bằng số điện thoại
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT UNIQUE NOT NULL,          -- "+4917612345678" (chuẩn E.164)
  name          TEXT NOT NULL,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,                          -- ghi chú tự do của salon

  -- Preferences & Allergies
  preferred_technician_id TEXT,               -- "T01" | "T02" | "T03" | NULL
  preferred_colors        TEXT,               -- "Nude, Pastel"
  allergies               TEXT,               -- "Acetone-Allergie"

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 2. BẢNG LỊCH ĐẶT HẸN (bookings)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Thông tin lịch hẹn
  technician_id   TEXT NOT NULL CHECK (technician_id IN ('T01','T02','T03')),
  service         TEXT NOT NULL,              -- "Gel Maniküre + NailArt"
  appointment_at  TIMESTAMPTZ NOT NULL,       -- thời gian hẹn (Berlin tz)
  duration_min    INTEGER NOT NULL DEFAULT 60,
  price_eur       NUMERIC(6,2),              -- 43.00

  -- Trạng thái
  status          TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed','cancelled','completed','no_show')),

  -- Tham chiếu Google Calendar
  gcal_event_id   TEXT,                      -- để cancel đúng event

  -- Điểm tích lũy cho booking này
  points_earned   INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 3. BẢNG LỊCH SỬ ĐIỂM (loyalty_log)
--    Ghi lại từng lần cộng/trừ điểm
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
  delta       INTEGER NOT NULL,              -- +43 (cộng) hoặc -100 (đổi thưởng)
  reason      TEXT NOT NULL,                -- "Gel Maniküre 43€" | "NailArt Einlösung"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 4. AUTO-UPDATE updated_at khi row thay đổi
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- 5. INDEXES — tối ưu query thường dùng
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_appointment_at ON bookings(appointment_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_loyalty_log_customer_id ON loyalty_log(customer_id);

-- ─────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY (RLS)
--    Chỉ server-side (service_role) mới được đọc/ghi
--    Client-side KHÔNG có quyền truy cập trực tiếp
-- ─────────────────────────────────────────────
ALTER TABLE customers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_log ENABLE ROW LEVEL SECURITY;

-- Service role bypass RLS — dùng cho server API
-- (Supabase service_role key tự động bypass, không cần policy thêm)

-- ─────────────────────────────────────────────
-- 7. DỮ LIỆU MẪU — migrate từ hardcode trong code
-- ─────────────────────────────────────────────
INSERT INTO customers (phone, name, loyalty_points, preferred_technician_id, preferred_colors, allergies)
VALUES
  ('+4917612345678', 'Sarah Müller',  120, 'T01', 'Nude, Pastel', 'Acetone-Allergie'),
  ('+4915798765432', 'Julia Schmidt',  50, 'T03', 'Dunkelrot',    NULL),
  ('+4917699887766', 'Thomas Weber',   30, NULL,  NULL,           NULL)
ON CONFLICT (phone) DO NOTHING;

-- ─────────────────────────────────────────────
-- 8. RPC FUNCTION — atomic loyalty point update
--    Tránh race condition khi nhiều request đồng thời
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_loyalty_points(
  p_customer_id UUID,
  p_delta       INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  new_points INTEGER;
BEGIN
  UPDATE customers
  SET loyalty_points = GREATEST(0, loyalty_points + p_delta)
  WHERE id = p_customer_id
  RETURNING loyalty_points INTO new_points;
  RETURN new_points;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
