import { google } from "googleapis";

// ─────────────────────────────────────────────────────────────────────────────
// /api/availability — Đọc lịch thực từ Google Calendar
//
// Logic:
//   1. Lấy tất cả events đã book của 3 technician trong 7 ngày tới
//   2. Tính các slot còn trống dựa trên giờ làm việc - events đã có
//   3. Trả về dạng text compact để inject vào System Prompt Claude
// ─────────────────────────────────────────────────────────────────────────────

const TECHNICIANS = {
  T01: { name: "Lisa",  calendarId: process.env.CALENDAR_LISA,  workDays: [1,2,4,5,6], workStart: "09:00", workEnd: "19:00" },
  T02: { name: "Anna",  calendarId: process.env.CALENDAR_ANNA,  workDays: [1,2,3,4],   workStart: "09:00", workEnd: "15:00", noteDay5: "Fr bis 15:00" },
  T03: { name: "Mai",   calendarId: process.env.CALENDAR_MAI,   workDays: [1,2,3,4,5,6], workStart: "10:00", workEnd: "18:00" },
  // workDays: 0=So, 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa
};

// Slot duration mặc định (phút) — Claude sẽ tự tính từ service, đây chỉ dùng để tạo lưới slot
const SLOT_INTERVAL_MIN = 30;

// Ngày trong tuần viết tắt tiếng Đức
const DE_DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/**
 * Trả về offset Berlin dưới dạng "+HH:MM" — CET hoặc CEST tùy DST
 */
function getBerlinOffset(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(date);
  const offsetStr = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const match = offsetStr.match(/GMT([+-])(\d+)/);
  if (!match) return "+02:00";
  return `${match[1]}${match[2].padStart(2, "0")}:00`;
}

/**
 * Lấy danh sách slot còn trống của một technician trong một ngày.
 *
 * @param {string} dateStr     - "YYYY-MM-DD"
 * @param {string} workStart   - "HH:MM"
 * @param {string} workEnd     - "HH:MM"
 * @param {Array}  busySlots   - [{ start: ISO, end: ISO }, ...]
 * @returns {string[]}          - ["09:00", "09:30", ...]
 */
function getFreeSlots(dateStr, workStart, workEnd, busySlots) {
  const offset = getBerlinOffset(new Date(`${dateStr}T${workStart}:00`));

  // Chuyển giờ làm việc thành ms
  const dayStart = new Date(`${dateStr}T${workStart}:00${offset}`).getTime();
  const dayEnd   = new Date(`${dateStr}T${workEnd}:00${offset}`).getTime();

  // Tạo lưới slot cách nhau SLOT_INTERVAL_MIN
  const allSlots = [];
  for (let t = dayStart; t < dayEnd; t += SLOT_INTERVAL_MIN * 60000) {
    allSlots.push(t);
  }

  // Chuyển busySlots thành mảng khoảng [startMs, endMs]
  const busyRanges = busySlots
    .map((b) => ({
      start: new Date(b.start).getTime(),
      end:   new Date(b.end).getTime(),
    }))
    .filter((b) => !isNaN(b.start) && !isNaN(b.end));

  // Lọc bỏ slot bị busy (slot bị overlap với bất kỳ event nào)
  const freeSlots = allSlots.filter((slotMs) => {
    return !busyRanges.some(
      (b) => slotMs < b.end && slotMs + SLOT_INTERVAL_MIN * 60000 > b.start
    );
  });

  // Chuyển ms → "HH:MM"
  return freeSlots.map((ms) => {
    const d = new Date(ms);
    // Lấy giờ theo Berlin
    const berlinTime = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return berlinTime; // "09:00"
  });
}

/**
 * Lấy ngày làm việc tiếp theo của technician (tính từ hôm nay, tối đa 7 ngày tới)
 */
function getUpcomingWorkDays(workDays, maxDays = 7) {
  const today = new Date();
  // Lấy ngày hôm nay theo Berlin
  const todayBerlin = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(today); // "YYYY-MM-DD"

  const result = [];
  const cursor = new Date(`${todayBerlin}T00:00:00`);

  for (let i = 0; i < maxDays; i++) {
    const dayOfWeek = cursor.getDay(); // 0=Sun, 1=Mon...
    if (workDays.includes(dayOfWeek)) {
      result.push(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Berlin",
      }).format(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/**
 * Lấy events đã book từ Google Calendar cho một technician trong khoảng thời gian.
 */
async function getBookedEvents(calendar, calendarId, dateFrom, dateTo) {
  if (!calendarId) return [];

  const offset = getBerlinOffset(new Date(dateFrom));
  const timeMin = new Date(`${dateFrom}T00:00:00${offset}`).toISOString();
  const timeMax = new Date(`${dateTo}T23:59:59${offset}`).toISOString();

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      timeZone: "Europe/Berlin",
    });
    return (res.data.items || [])
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        start:   e.start.dateTime,
        end:     e.end.dateTime,
        summary: e.summary || "",
      }));
  } catch (err) {
    console.error(`Calendar fetch error for ${calendarId}:`, err.message);
    return [];
  }
}

/**
 * Format ngày "YYYY-MM-DD" → "Mo14" (viết tắt tiếng Đức + ngày)
 */
function formatDateShort(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = DE_DAYS[d.getDay()];
  const date = d.getDate();
  return `${day}${date}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/availability
// Trả về lịch trống dạng text compact để inject vào System Prompt
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    // Khởi tạo Google Calendar client
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: "v3", auth });

    // Tính khoảng ngày cần fetch (hôm nay đến 7 ngày tới)
    const todayBerlin = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
    }).format(new Date());

    const endDate = new Date(`${todayBerlin}T00:00:00`);
    endDate.setDate(endDate.getDate() + 7);
    const endDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
    }).format(endDate);

    // Fetch events song song cho cả 3 technician
    const results = await Promise.all(
      Object.entries(TECHNICIANS).map(async ([techId, tech]) => {
        const workDays = getUpcomingWorkDays(tech.workDays, 7);

        // Fetch tất cả events trong khoảng thời gian
        const bookedEvents = await getBookedEvents(
          calendar,
          tech.calendarId,
          todayBerlin,
          endDateStr
        );

        // Tính slot trống cho từng ngày làm việc
        const availabilityByDay = workDays.map((dateStr) => {
          // Lọc events của ngày này
          const dayEvents = bookedEvents.filter((e) =>
            e.start.startsWith(dateStr)
          );

          const freeSlots = getFreeSlots(
            dateStr,
            tech.workStart,
            tech.workEnd,
            dayEvents
          );

          return { dateStr, freeSlots };
        });

        return { techId, name: tech.name, availabilityByDay };
      })
    );

    // ─── Format thành text compact cho System Prompt ──────────────────────────
    // Ví dụ output:
    // FREIE TERMINE (Live von Google Calendar, Stand: 13.04.2026 14:32):
    // Lisa: Mo14 09:00,09:30,10:00|Di15 09:00,11:00
    // Anna: Mo14 09:00,11:00|Mi16 10:00,12:00
    // Mai: Mo14 10:00,12:00,14:30|Di15 10:00
    const nowBerlin = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      day:    "2-digit",
      month:  "2-digit",
      year:   "numeric",
      hour:   "2-digit",
      minute: "2-digit",
    }).format(new Date());

    const lines = results.map(({ name, availabilityByDay }) => {
      const dayParts = availabilityByDay
        .filter((d) => d.freeSlots.length > 0)
        .map((d) => `${formatDateShort(d.dateStr)} ${d.freeSlots.join(",")}`)
        .join("|");

      return dayParts
        ? `${name}: ${dayParts}`
        : `${name}: (keine freien Termine in den nächsten 7 Tagen)`;
    });

    const availabilityText =
      `FREIE TERMINE (Live von Google Calendar, Stand: ${nowBerlin}):\n` +
      lines.join("\n");

    return Response.json({
      success: true,
      availabilityText,
      // Cũng trả về dạng structured cho debug
      structured: results,
      fetchedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Availability fetch error:", error.message);

    // Graceful fallback — trả về thông báo thay vì crash
    return Response.json({
      success: false,
      availabilityText: "FREIE TERMINE: (Kalender nicht verfügbar – bitte Salon anrufen: 040-12345678)",
      error: error.message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: khởi tạo Google Auth (tái sử dụng logic từ calendar/route.js)
// ─────────────────────────────────────────────────────────────────────────────
function getGoogleAuth() {
  let serviceAccount;

  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    try {
      const trimmed = process.env.GOOGLE_SERVICE_ACCOUNT.trim();
      const decoded = trimmed.startsWith("{")
        ? trimmed
        : Buffer.from(trimmed, "base64").toString("utf-8");
      serviceAccount = JSON.parse(decoded);
    } catch (e) {
      console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT:", e.message);
    }
  }

  if (!serviceAccount) {
    const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
    const private_key  = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    if (client_email && private_key) {
      serviceAccount = { client_email, private_key };
    }
  }

  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error(
      "Google service account not configured. Set GOOGLE_SERVICE_ACCOUNT or both CLIENT_EMAIL + PRIVATE_KEY env vars."
    );
  }

  const normalizedKey = serviceAccount.private_key.startsWith("-----BEGIN PRIVATE KEY-----")
    ? serviceAccount.private_key.replace(/\\n/g, "\n")
    : `-----BEGIN PRIVATE KEY-----\n${serviceAccount.private_key.replace(/\\n/g, "\n")}\n-----END PRIVATE KEY-----\n`;

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceAccount.client_email,
      private_key:  normalizedKey,
    },
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
}
