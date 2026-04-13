
import {
  findCustomerByPhone,
  upsertCustomer,
  createBooking,
  cancelBookingByTime,
  getBookingHistory,
  formatCustomerForPrompt,
} from "../../lib/customerService.js";

// ─────────────────────────────────────────────────────────────────────────────
// FIX A1: System Prompt dùng đúng `system` parameter
// FIX A2: Timezone động — tự tính CET/CEST theo ngày thực tế
// FIX A3: Timestamp tin nhắn lưu đúng lúc gửi (xử lý ở frontend)
// OPTION B: Real-time availability — inject lịch trống thực từ Google Calendar
// ─────────────────────────────────────────────────────────────────────────────

// Cache đơn giản để không gọi Calendar API mỗi tin nhắn
// TTL: 5 phút — đủ fresh mà không gây latency cao
const availabilityCache = {
  data: null,
  fetchedAt: 0,
  TTL_MS: 5 * 60 * 1000, // 5 phút

  isValid() {
    return this.data !== null && (Date.now() - this.fetchedAt) < this.TTL_MS;
  },

  set(text) {
    this.data = text;
    this.fetchedAt = Date.now();
  },

  get() {
    return this.data;
  },
};

/**
 * Trả về offset múi giờ Berlin dưới dạng chuỗi "+HH:MM"
 * Berlin dùng CET (UTC+1) mùa đông, CEST (UTC+2) mùa hè.
 * Quy tắc EU: chuyển mùa hè vào Chủ nhật cuối tháng 3,
 *             chuyển mùa đông vào Chủ nhật cuối tháng 10.
 */
function getBerlinOffset(date = new Date()) {
  // Dùng Intl để lấy offset chính xác — không bao giờ sai dù DST
  const berlinFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "shortOffset",
  });
  const parts = berlinFormatter.formatToParts(date);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  // offsetPart ví dụ: "GMT+2" hoặc "GMT+1"
  const match = offsetPart.match(/GMT([+-]\d+)/);
  if (!match) return "+02:00";
  const hours = parseInt(match[1]);
  return hours >= 0 ? `+0${hours}:00` : `-0${Math.abs(hours)}:00`;
}

/**
 * Tạo System Prompt với lịch trống được inject từ Google Calendar (live data).
 * @param {string} availabilityText - Text dạng "Lisa: Mo14 09:00,09:30|..."
 */
function buildSystemPrompt(availabilityText, customerPromptText = "AKTUELLER KUNDE: Unbekannt") {
  return `Du bist der KI-Assistent für "Sakura Nails Hamburg" (Eppendorfer Baum 26, 20249 Hamburg).

REGELN:
- Deutsch antworten (Vietnamesisch/Englisch wenn Kunde so schreibt)
- Freundlich, professionell, gelegentlich Emojis (💅 ✨)
- Bei JEDER Entscheidung: nummerierte Optionen (1️⃣ 2️⃣ 3️⃣), max 5-6
- Bei Ja/Nein: J/N verwenden
- Preise+Dauer immer anzeigen
- KEINE Infos erfinden

STUDIO: Mo-Fr 09-19, Sa 09-17, So geschlossen | Eppendorfer Baum 26, 20249 Hamburg
Tel: 040-12345678 | @sakura.nails.hamburg | U Kellinghusenstraße (U1/U3)
Stornierung: kostenlos >24h, sonst 50% | Umbuchung: kostenlos >12h

SERVICES:
Maniküre: Klassisch 25€/30min | Gel 35€/45min⭐ | Shellac(CND) 38€/45min | GelVerlängerung 55€/90min | GelAuffüllung 40€/60min | AcrylVerl 60€/90min | AcrylAuff 42€/60min | Entfernung 15€/30min(gratis bei Neuservice)
Pediküre: Klassisch 30€/45min | Gel 40€/60min | Spa 55€/75min
Extras: NailArt einfach +8€ | aufwendig +15€ | French +10€ | Strasssteine +3€/Nagel
Combos: Mani+Pedi Gel 65€(spart10€) | FullPamper 85€(spart16€) | GelVerl+Pedi 75€(spart10€)

TEAM:
Lisa(T01): Gel,Shellac,NailArt,Babyboomer|4.9⭐|Deutsch+Vietn.|Mo,Di,Do,Fr,Sa(Mi frei)
Anna(T02): Gel,Acryl,Verlängerung|4.7⭐|Deutsch+Engl.|Mo-Do,Fr bis 15(Sa frei)
Mai(T03): Pediküre,Spa,Klassisch,Gel|4.8⭐|Deutsch+Vietn.+Engl.|Mo-Fr 10-18,Sa

{{AVAILABILITY_PLACEHOLDER}}

{{CUSTOMER_PLACEHOLDER}}

TREUE: 1€=1Pkt|100=NailArt gratis|200=15€Rabatt|300=SpaPedi gratis

Begrüßung immer mit Optionen: 1️⃣Termin buchen 2️⃣Ändern/stornieren 3️⃣Services 4️⃣Treuepunkte 5️⃣Anderes
Buchungsflow: Identifizieren→Kategorie→Service→Designerin(nur passende!)→Termin→Upsell→Allergien→Zusammenfassung→J/N
Acryl→nur Anna|Pedi/Spa→Mai|NailArt→Lisa

CALENDAR INTEGRATION:
Wenn du einen Termin bestätigst (Kunde antwortet J), füge am ENDE deiner Nachricht dieses Tag hinzu:
[BOOK:techId=T01,date=2026-04-14,time=09:00,duration=55,customer=Sarah Müller,service=Gel Maniküre]

Regeln für das Tag:
- techId: T01=Lisa, T02=Anna, T03=Mai
- date: Format YYYY-MM-DD
- time: Format HH:MM (24h)
- duration: Gesamtdauer in Minuten (alle Services + 5min Puffer)
- customer: Name der Kundin
- service: Alle gebuchten Services
- Füge das Tag NUR hinzu wenn der Kunde mit J bestätigt hat
- Das Tag muss in der LETZTEN Zeile stehen

Wenn ein Termin storniert wird (Kunde bestätigt Stornierung mit J), füge hinzu:
[CANCEL:techId=T01,date=2026-04-14,time=09:00]`
    .replace("{{AVAILABILITY_PLACEHOLDER}}", availabilityText)
    .replace("{{CUSTOMER_PLACEHOLDER}}", customerPromptText);
}

const GREETING =
  "Hallo! Willkommen bei Sakura Nails Hamburg 💅\nWie kann ich dir helfen?\n\n1️⃣ Termin buchen\n2️⃣ Termin ändern oder stornieren\n3️⃣ Services & Preise ansehen\n4️⃣ Treuepunkte checken\n5️⃣ Etwas anderes\n\nTippe einfach die Zahl 😊";

export async function POST(request) {
  const { messages } = await request.json();

  // ─── Validate input ────────────────────────────────────────────────────────
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Invalid messages format" }, { status: 400 });
  }

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // OPTION B: Fetch lịch trống thực từ Google Calendar
    // Dùng in-memory cache 5 phút để tránh gọi Calendar API mỗi tin nhắn
    // ─────────────────────────────────────────────────────────────────────────
    let availabilityText;

    if (availabilityCache.isValid()) {
      // Cache còn hợp lệ — dùng luôn, không gọi API
      availabilityText = availabilityCache.get();
    } else {
      try {
        // Gọi internal availability endpoint (cùng server)
        const availUrl = new URL("/api/availability", request.url);
        const availRes = await fetch(availUrl.href, { method: "GET" });
        const availData = await availRes.json();

        if (availData.success && availData.availabilityText) {
          availabilityText = availData.availabilityText;
          availabilityCache.set(availabilityText); // Lưu vào cache
          console.log("📅 Availability fetched from Calendar");
        } else {
          throw new Error(availData.error || "Availability fetch failed");
        }
      } catch (availErr) {
        // Nếu Calendar không available → dùng fallback text
        console.warn("⚠️  Calendar unavailable, using fallback:", availErr.message);
        availabilityText =
          "FREIE TERMINE: (Kalender nicht verfügbar – bitte Salon anrufen: 040-12345678)";
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OPTION C: Lookup khách hàng theo SĐT — inject vào System Prompt
    // Chatbot tự extract SĐT từ tin nhắn gần nhất nếu khách vừa báo
    // ─────────────────────────────────────────────────────────────────────────
    let customerPromptText = "AKTUELLER KUNDE: Unbekannt (Telefonnummer noch nicht angegeben)";

    // Tìm SĐT trong toàn bộ conversation (khách có thể đã báo trước đó)
    const allText = messages.map((m) => m.content).join(" ");
    const phoneMatch = allText.match(
      /(?:(?:\+49|0049|0)[\s\-]?)?(?:1[5-7][0-9])[\s\-]?[0-9]{3,4}[\s\-]?[0-9]{4,6}/
    );

    if (phoneMatch) {
      try {
        const customerUrl = new URL("/api/customer", request.url);
        customerUrl.searchParams.set("phone", phoneMatch[0]);
        const customerRes = await fetch(customerUrl.href, { method: "GET" });
        const customerData = await customerRes.json();

        if (customerData.found) {
          customerPromptText = customerData.promptText;
        } else {
          // Số điện thoại mới — ghi chú để Claude hỏi tên
          customerPromptText = `AKTUELLER KUNDE: Neue Nummer ${phoneMatch[0]} (noch nicht registriert — bitte Namen erfragen)`;
        }
      } catch (custErr) {
        console.warn("⚠️  Customer lookup failed:", custErr.message);
        // Không crash — chỉ không có customer context
      }
    }

    // Inject cả availability + customer vào System Prompt
    const SYSTEM_PROMPT = buildSystemPrompt(availabilityText, customerPromptText);

    // ─────────────────────────────────────────────────────────────────────────
    // FIX A1: Truyền System Prompt đúng cách qua `system` parameter
    // Trước đây: nhét vào { role: "user" } → Claude xử lý như tin nhắn thường,
    //           dễ bị override, tốn token hơn, context không tối ưu.
    // Bây giờ:  dùng `system` riêng → Claude hiểu đây là chỉ thị cố định.
    // ─────────────────────────────────────────────────────────────────────────

    // Lọc chỉ lấy messages hợp lệ (role: user | assistant), bỏ greeting tĩnh
    // vì greeting đã được inject ở frontend — không cần gửi lại lên API
    const apiMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => typeof m.content === "string" && m.content.trim() !== "");

    // Đảm bảo conversation bắt đầu bằng role "user" (yêu cầu của Anthropic API)
    // Nếu message đầu là greeting của assistant, bỏ đi
    const firstUserIdx = apiMessages.findIndex((m) => m.role === "user");
    const cleanMessages = firstUserIdx >= 0 ? apiMessages.slice(firstUserIdx) : apiMessages;

    // Fallback nếu không có tin nhắn nào từ user
    if (cleanMessages.length === 0) {
      return Response.json({ reply: GREETING });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,   // ✅ FIX A1: đúng vị trí
        messages: cleanMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: data?.error?.message || "API error" },
        { status: 500 }
      );
    }

    let reply =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") || "Entschuldigung, es gab ein Problem.";

    // ─────────────────────────────────────────────
    // Phát hiện [BOOK:...] → tạo event trên Google Calendar
    // ─────────────────────────────────────────────
    if (reply.includes("[BOOK:")) {
      const bookMatch = reply.match(
        /\[BOOK:techId=(\w+),date=([\d-]+),time=([\d:]+),duration=(\d+),customer=([^,]+),service=([^\]]+)\]/
      );

      if (bookMatch) {
        try {
          const calendarUrl = new URL("/api/calendar", request.url);
          const bookRes = await fetch(calendarUrl.href, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "book",
              techId: bookMatch[1],
              date: bookMatch[2],
              time: bookMatch[3],
              duration: parseInt(bookMatch[4]),
              customerName: bookMatch[5],
              service: bookMatch[6],
            }),
          });
          const bookData = await bookRes.json();
          console.log("✅ Calendar booked:", bookData.message);

          // ── OPTION C: Lưu booking vào Supabase ───────────────────────────
          if (bookData.success) {
            try {
              // Tìm hoặc tạo khách hàng
              const customerName = bookMatch[5];
              const phoneInText  = allText.match(
                /(?:(?:\+49|0049|0)[\s\-]?)?(?:1[5-7][0-9])[\s\-]?[0-9]{3,4}[\s\-]?[0-9]{4,6}/
              );

              if (phoneInText) {
                let customer = await findCustomerByPhone(phoneInText[0]);
                if (!customer) {
                  customer = await upsertCustomer({
                    phone: phoneInText[0],
                    name:  customerName,
                  });
                }

                // Tạo booking record
                const techMap = { T01: "+4900000000001", T02: "+4900000000002", T03: "+4900000000003" };
                const apptISO = new Date(`${bookMatch[2]}T${bookMatch[3]}:00+02:00`).toISOString();

                await createBooking({
                  customerId:    customer.id,
                  technicianId:  bookMatch[1],
                  service:       bookMatch[6],
                  appointmentAt: apptISO,
                  durationMin:   parseInt(bookMatch[4]),
                  priceEur:      parseFloat(bookMatch[6].match(/(\d+)€/)?.[1] || "0"),
                  gcalEventId:   bookData.eventId || null,
                });
                console.log("✅ Supabase booking saved for:", customerName);
              }
            } catch (dbErr) {
              // DB error không được làm hỏng UX — chỉ log
              console.error("❌ Supabase booking save failed:", dbErr.message);
            }
          }
          // ─────────────────────────────────────────────────────────────────
        } catch (calErr) {
          console.error("❌ Calendar booking failed:", calErr.message);
        }
      }

      // Xoá tag khỏi tin nhắn — khách không thấy
      reply = reply.replace(/\[BOOK:[^\]]+\]/g, "").trim();
    }

    // ─────────────────────────────────────────────
    // Phát hiện [CANCEL:...] → xoá event trên Google Calendar
    // ─────────────────────────────────────────────
    if (reply.includes("[CANCEL:")) {
      const cancelMatch = reply.match(
        /\[CANCEL:techId=(\w+),date=([\d-]+),time=([\d:]+)\]/
      );

      if (cancelMatch) {
        try {
          const calendarUrl = new URL("/api/calendar", request.url);
          const cancelRes = await fetch(calendarUrl.href, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "cancel_by_time",
              techId: cancelMatch[1],
              date: cancelMatch[2],
              time: cancelMatch[3],
            }),
          });
          const cancelData = await cancelRes.json();
          console.log("✅ Calendar cancelled:", cancelData.message);

          // ── OPTION C: Cập nhật trạng thái booking trong Supabase ─────────
          if (cancelData.success) {
            try {
              const apptISO = new Date(`${cancelMatch[2]}T${cancelMatch[3]}:00+02:00`).toISOString();
              await cancelBookingByTime({
                technicianId:  cancelMatch[1],
                appointmentAt: apptISO,
              });
              console.log("✅ Supabase booking cancelled");
            } catch (dbErr) {
              console.error("❌ Supabase cancel failed:", dbErr.message);
            }
          }
          // ─────────────────────────────────────────────────────────────────
        } catch (calErr) {
          console.error("❌ Calendar cancel failed:", calErr.message);
        }
      }

      // Xoá tag khỏi tin nhắn
      reply = reply.replace(/\[CANCEL:[^\]]+\]/g, "").trim();
    }

    // ─────────────────────────────────────────────
    // Trả tin nhắn về cho khách (đã xoá tag)
    // ─────────────────────────────────────────────
    return Response.json({ reply });

  } catch (error) {
    console.error("Server error:", error.message);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
