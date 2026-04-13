import { google } from "googleapis";

// Cấu hình Calendar ID cho mỗi thợ
const TECHNICIANS = {
  T01: {
    name: "Lisa",
    calendarId: process.env.CALENDAR_LISA,
  },
  T02: {
    name: "Anna",
    calendarId: process.env.CALENDAR_ANNA,
  },
  T03: {
    name: "Mai",
    calendarId: process.env.CALENDAR_MAI,
  },
};

// Kết nối Google Calendar API
function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

export async function POST(request) {
  const { action, techId, date, time, duration, customerName, service } =
    await request.json();

  const calendar = getCalendarClient();
  const tech = TECHNICIANS[techId];

  if (!tech || !tech.calendarId) {
    return Response.json({ error: "Technician not found" }, { status: 400 });
  }

  try {
    // ═══ CHECK: Lấy slot trống ═══
    if (action === "check_availability") {
      const startOfDay = new Date(`${date}T00:00:00+02:00`);
      const endOfDay = new Date(`${date}T23:59:59+02:00`);

      const events = await calendar.events.list({
        calendarId: tech.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        timeZone: "Europe/Berlin",
      });

      const busySlots = (events.data.items || []).map((e) => ({
        start: e.start.dateTime,
        end: e.end.dateTime,
        summary: e.summary,
      }));

      return Response.json({
        technician: tech.name,
        date,
        busySlots,
        message: `${tech.name} hat ${busySlots.length} Termine am ${date}`,
      });
    }

    // ═══ BOOK: Tạo lịch hẹn ═══
    if (action === "book") {
      const startTime = new Date(`${date}T${time}:00+02:00`);
      const endTime = new Date(startTime.getTime() + (duration || 60) * 60000);

      const event = await calendar.events.insert({
        calendarId: tech.calendarId,
        requestBody: {
          summary: `💅 ${customerName} — ${service}`,
          description: `Kundin: ${customerName}\nService: ${service}\nDauer: ${duration} Min\nGebucht über Sakura Nails Chatbot`,
          start: {
            dateTime: startTime.toISOString(),
            timeZone: "Europe/Berlin",
          },
          end: {
            dateTime: endTime.toISOString(),
            timeZone: "Europe/Berlin",
          },
          colorId: "6", // Orange für Nails-Termine
        },
      });

      return Response.json({
        success: true,
        eventId: event.data.id,
        message: `Termin gebucht: ${customerName} bei ${tech.name}, ${date} um ${time}`,
      });
    }

    // ═══ CANCEL: Lịch hẹn huỷ ═══
    if (action === "cancel") {
      const { eventId } = await request.json();

      if (eventId) {
        await calendar.events.delete({
          calendarId: tech.calendarId,
          eventId: eventId,
        });
      }

      return Response.json({
        success: true,
        message: `Termin bei ${tech.name} wurde storniert`,
      });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Calendar API Error:", error.message);
    return Response.json(
      { error: "Calendar error: " + error.message },
      { status: 500 }
    );
  }
}
