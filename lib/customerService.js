// lib/customerService.js
// ─────────────────────────────────────────────────────────────────────────────
// Tất cả business logic liên quan đến khách hàng:
//   - Lookup / upsert khách hàng theo SĐT
//   - Tạo booking mới
//   - Cộng/trừ loyalty points
//   - Format dữ liệu để inject vào System Prompt
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "./db.js";

// ─── Loyalty rewards config ───────────────────────────────────────────────────
export const LOYALTY_REWARDS = [
  { points: 100, reward: "NailArt gratis",    description: "1 kostenloses NailArt" },
  { points: 200, reward: "15€ Rabatt",        description: "15€ Gutschein" },
  { points: 300, reward: "Spa Pediküre gratis", description: "1 kostenlose Spa Pediküre" },
];

/**
 * Chuẩn hóa số điện thoại về dạng E.164 (+49...)
 * Xử lý các dạng phổ biến của khách Đức:
 *   "0176 123 456 78" → "+4917612345678"
 *   "017612345678"    → "+4917612345678"
 *   "+4917612345678"  → "+4917612345678" (giữ nguyên)
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  // Bỏ tất cả ký tự không phải số và +
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);
  if (cleaned.startsWith("0"))  return "+49" + cleaned.slice(1);
  // Nếu đã có mã quốc gia (49...)
  if (cleaned.startsWith("49")) return "+" + cleaned;
  return "+" + cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// KHÁCH HÀNG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tìm khách hàng theo SĐT.
 * @returns {Object|null} customer row hoặc null nếu không tìm thấy
 */
export async function findCustomerByPhone(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  const { data, error } = await db
    .from("customers")
    .select("*")
    .eq("phone", phone)
    .single();

  if (error?.code === "PGRST116") return null; // not found
  if (error) throw new Error(`findCustomerByPhone: ${error.message}`);
  return data;
}

/**
 * Tạo khách hàng mới hoặc cập nhật tên nếu đã tồn tại.
 * @returns {Object} customer row
 */
export async function upsertCustomer({ phone: rawPhone, name, allergies, preferredColors, preferredTechnicianId }) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Invalid phone number");

  const { data, error } = await db
    .from("customers")
    .upsert(
      {
        phone,
        name,
        ...(allergies            !== undefined && { allergies }),
        ...(preferredColors      !== undefined && { preferred_colors: preferredColors }),
        ...(preferredTechnicianId !== undefined && { preferred_technician_id: preferredTechnicianId }),
      },
      {
        onConflict: "phone",
        // Chỉ update các field được truyền vào, không xóa data cũ
        ignoreDuplicates: false,
      }
    )
    .select()
    .single();

  if (error) throw new Error(`upsertCustomer: ${error.message}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tạo booking mới + tự động cộng loyalty points (1€ = 1 điểm).
 *
 * @param {Object} params
 * @param {string} params.customerId    - UUID của khách
 * @param {string} params.technicianId  - "T01" | "T02" | "T03"
 * @param {string} params.service       - "Gel Maniküre + NailArt"
 * @param {string} params.appointmentAt - ISO string (Berlin time)
 * @param {number} params.durationMin   - phút
 * @param {number} params.priceEur      - giá €
 * @param {string} [params.gcalEventId] - Google Calendar event ID
 * @returns {Object} { booking, pointsEarned, totalPoints }
 */
export async function createBooking({
  customerId,
  technicianId,
  service,
  appointmentAt,
  durationMin,
  priceEur,
  gcalEventId,
}) {
  const pointsEarned = Math.floor(priceEur || 0); // 1€ = 1 điểm

  // Insert booking
  const { data: booking, error: bookingErr } = await db
    .from("bookings")
    .insert({
      customer_id:    customerId,
      technician_id:  technicianId,
      service,
      appointment_at: appointmentAt,
      duration_min:   durationMin,
      price_eur:      priceEur,
      gcal_event_id:  gcalEventId || null,
      points_earned:  pointsEarned,
      status:         "confirmed",
    })
    .select()
    .single();

  if (bookingErr) throw new Error(`createBooking: ${bookingErr.message}`);

  // Cộng điểm
  const { totalPoints } = await addLoyaltyPoints({
    customerId,
    bookingId: booking.id,
    delta: pointsEarned,
    reason: `${service} ${priceEur}€`,
  });

  return { booking, pointsEarned, totalPoints };
}

/**
 * Huỷ booking theo Google Calendar event info (techId + date + time).
 * Trả về { success, booking } hoặc { success: false }
 */
export async function cancelBookingByTime({ technicianId, appointmentAt }) {
  // Tìm booking khớp technician + thời gian (trong khoảng 5 phút)
  const searchFrom = new Date(appointmentAt);
  const searchTo   = new Date(searchFrom.getTime() + 5 * 60000);

  const { data: bookings, error } = await db
    .from("bookings")
    .select("*")
    .eq("technician_id", technicianId)
    .eq("status", "confirmed")
    .gte("appointment_at", searchFrom.toISOString())
    .lte("appointment_at", searchTo.toISOString())
    .limit(1);

  if (error) throw new Error(`cancelBookingByTime: ${error.message}`);
  if (!bookings || bookings.length === 0) return { success: false };

  const booking = bookings[0];

  // Đổi status → cancelled
  const { error: updateErr } = await db
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", booking.id);

  if (updateErr) throw new Error(`cancelBooking update: ${updateErr.message}`);

  // Trừ điểm đã cộng khi book (nếu có)
  if (booking.points_earned > 0) {
    await addLoyaltyPoints({
      customerId: booking.customer_id,
      bookingId:  booking.id,
      delta:      -booking.points_earned,
      reason:     `Stornierung: ${booking.service}`,
    });
  }

  return { success: true, booking };
}

/**
 * Lấy lịch sử booking của khách (10 gần nhất).
 */
export async function getBookingHistory(customerId, limit = 10) {
  const { data, error } = await db
    .from("bookings")
    .select("*")
    .eq("customer_id", customerId)
    .order("appointment_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getBookingHistory: ${error.message}`);
  return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// LOYALTY POINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cộng/trừ điểm và ghi log.
 * @returns {{ totalPoints: number }}
 */
export async function addLoyaltyPoints({ customerId, bookingId, delta, reason }) {
  // Ghi vào log
  const { error: logErr } = await db
    .from("loyalty_log")
    .insert({
      customer_id: customerId,
      booking_id:  bookingId || null,
      delta,
      reason,
    });

  if (logErr) throw new Error(`loyalty_log insert: ${logErr.message}`);

  // Cập nhật tổng điểm trên customer (atomic increment)
  const { data, error: updateErr } = await db.rpc("increment_loyalty_points", {
    p_customer_id: customerId,
    p_delta:       delta,
  });

  if (updateErr) {
    // Fallback: update thủ công nếu RPC chưa tồn tại
    const customer = await db
      .from("customers")
      .select("loyalty_points")
      .eq("id", customerId)
      .single();

    const newPoints = Math.max(0, (customer.data?.loyalty_points || 0) + delta);
    await db
      .from("customers")
      .update({ loyalty_points: newPoints })
      .eq("id", customerId);

    return { totalPoints: newPoints };
  }

  return { totalPoints: data };
}

/**
 * Kiểm tra khách có thể đổi reward nào không.
 */
export function getAvailableRewards(loyaltyPoints) {
  return LOYALTY_REWARDS.filter((r) => loyaltyPoints >= r.points);
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT cho System Prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format thông tin khách hàng thành text compact để inject vào System Prompt.
 * Claude sẽ dùng dữ liệu này để cá nhân hóa phản hồi.
 *
 * @param {Object|null} customer - row từ Supabase hoặc null (khách mới)
 * @param {Array}       recentBookings - 3 booking gần nhất
 * @returns {string}
 */
export function formatCustomerForPrompt(customer, recentBookings = []) {
  if (!customer) {
    return "AKTUELLER KUNDE: Neukunde (noch nicht registriert)";
  }

  const availableRewards = getAvailableRewards(customer.loyalty_points);
  const rewardText = availableRewards.length > 0
    ? `⚠️ EINLÖSUNG MÖGLICH: ${availableRewards.map((r) => r.reward).join(", ")}`
    : "";

  const recentText = recentBookings.length > 0
    ? recentBookings
        .slice(0, 3)
        .map((b) => {
          const date = new Date(b.appointment_at).toLocaleDateString("de-DE", {
            day: "2-digit", month: "2-digit", year: "numeric",
          });
          return `${date} ${b.service} (${b.status})`;
        })
        .join(" | ")
    : "Noch keine Buchungen";

  return [
    `AKTUELLER KUNDE (aus Datenbank):`,
    `Name: ${customer.name}`,
    `Telefon: ${customer.phone}`,
    `Treuepunkte: ${customer.loyalty_points} Pkt`,
    customer.preferred_technician_id ? `Stammdesignerin: ${customer.preferred_technician_id}` : "",
    customer.preferred_colors        ? `Lieblingsfarben: ${customer.preferred_colors}` : "",
    customer.allergies                ? `⚠️ ALLERGIE: ${customer.allergies}` : "",
    rewardText,
    `Letzte Termine: ${recentText}`,
  ]
    .filter(Boolean)
    .join("\n");
}
