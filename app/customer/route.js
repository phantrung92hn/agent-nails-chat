// app/api/customer/route.js
// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/customer?phone=017612345678  → lookup khách hàng + lịch sử booking
// POST /api/customer                     → upsert khách hàng mới hoặc cập nhật
// ─────────────────────────────────────────────────────────────────────────────
import {
  findCustomerByPhone,
  upsertCustomer,
  getBookingHistory,
  formatCustomerForPrompt,
} from "../../../lib/customerService.js";

// ─── GET — Tìm khách hàng theo SĐT ───────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawPhone = searchParams.get("phone");

  if (!rawPhone) {
    return Response.json({ error: "Missing phone parameter" }, { status: 400 });
  }

  try {
    const customer = await findCustomerByPhone(rawPhone);

    if (!customer) {
      return Response.json({
        found: false,
        promptText: "AKTUELLER KUNDE: Neukunde (noch nicht registriert)",
      });
    }

    // Lấy 3 booking gần nhất để inject vào prompt
    const recentBookings = await getBookingHistory(customer.id, 3);
    const promptText = formatCustomerForPrompt(customer, recentBookings);

    return Response.json({
      found: true,
      customer: {
        id:                    customer.id,
        name:                  customer.name,
        phone:                 customer.phone,
        loyaltyPoints:         customer.loyalty_points,
        preferredTechnicianId: customer.preferred_technician_id,
        preferredColors:       customer.preferred_colors,
        allergies:             customer.allergies,
      },
      recentBookings,
      promptText, // Text sẵn sàng để inject vào System Prompt
    });

  } catch (error) {
    console.error("GET /api/customer error:", error.message);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}

// ─── POST — Tạo hoặc cập nhật khách hàng ─────────────────────────────────────
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { phone, name, allergies, preferredColors, preferredTechnicianId } = body;

  if (!phone || !name) {
    return Response.json(
      { error: "phone and name are required" },
      { status: 400 }
    );
  }

  try {
    const customer = await upsertCustomer({
      phone,
      name,
      allergies,
      preferredColors,
      preferredTechnicianId,
    });

    return Response.json({ success: true, customer });

  } catch (error) {
    console.error("POST /api/customer error:", error.message);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}
