import { google } from "googleapis";

// ─────────────────────────────────────────
// TIMEZONE BERLIN (DST-safe)
// ─────────────────────────────────────────
function getBerlinOffset(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "shortOffset",
  });

  const parts = formatter.formatToParts(date);
  const offsetStr = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";

  const match = offsetStr.match(/GMT([+-])(\d+)/);
  if (!match) return "+02:00";

  const sign = match[1];
  const hours = match[2].padStart(2, "0");

  return `${sign}${hours}:00`;
}

function toBerlinISOString(date, time) {
  const offset = getBerlinOffset(new Date(`${date}T${time}:00`));
  return `${date}T${time}:00${offset}`;
}

// ─────────────────────────────────────────
// TECHNICIANS
// ─────────────────────────────────────────
const TECHNICIANS = {
  T01: { name: "Lisa", calendarId: process.env.CALENDAR_LISA },
  T02: { name: "Anna", calendarId: process.env.CALENDAR_ANNA },
  T03: { name: "Mai", calendarId: process.env.CALENDAR_MAI },
};

// ─────────────────────────────────────────
// GOOGLE AUTH (CLEAN VERSION)
// ─────────────────────────────────────────
function getCalendarClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT env");
  }

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Invalid service account format");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  });

  return google.calendar({ version: "v3", auth });
}

// ─────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────
export async function POST(request) {
  const body = await request.json();

  const {
    action,
    techId,
    date,
    time,
    duration,
    customerName,
    service,
    eventId,
  } = body;

  const calendar = getCalendarClient();
  const tech = TECHNICIANS[techId];

  if (!tech || !tech.calendarId) {
    return Response.json(
      { error: `Technician ${techId} not found` },
      { status: 400 }
    );
  }

  try {
    // ─────────────────────────────
    // CHECK AVAILABILITY
    // ─────────────────────────────
    if (action === "check_availability") {
      const startOfDay = toBerlinISOString(date, "00:00");
      const endOfDay = toBerlinISOString(date, "23:59");

      const events = await calendar.events.list({
        calendarId: tech.calendarId,
        timeMin: startOfDay,
        timeMax: endOfDay,
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
        success: true,
        technician: tech.name,
        date,
        busySlots,
      });
    }

    // ─────────────────────────────
    // BOOK
    // ─────────────────────────────
    if (action === "book") {
      const start = toBerlinISOString(date, time);

      const endDate = new Date(
        new Date(start).getTime() + (duration || 60) * 60000
      );

      const end = toBerlinISOString(
        endDate.toISOString().slice(0, 10),
        endDate.toTimeString().slice(0, 5)
      );

      const event = await calendar.events.insert({
        calendarId: tech.calendarId,
        requestBody: {
          summary: `💅 ${customerName} — ${service}`,
          description: [
            `Kundin: ${customerName}`,
            `Service: ${service}`,
            `Designerin: ${tech.name}`,
            `Dauer: ${duration} Minuten`,
            "",
            "Gebucht über Sakura Nails Chatbot",
          ].join("\n"),
          start: {
            dateTime: start,
            timeZone: "Europe/Berlin",
          },
          end: {
            dateTime: end,
            timeZone: "Europe/Berlin",
          },
          colorId: "6",
        },
      });

      return Response.json({
        success: true,
        eventId: event.data.id,
      });
    }

    // ─────────────────────────────
    // CANCEL BY TIME
    // ─────────────────────────────
    if (action === "cancel_by_time") {
      const searchStart = toBerlinISOString(date, time);

      const searchEndDate = new Date(
        new Date(searchStart).getTime() + 5 * 60000
      );

      const searchEnd = searchEndDate.toISOString();

      const events = await calendar.events.list({
        calendarId: tech.calendarId,
        timeMin: searchStart,
        timeMax: searchEnd,
        singleEvents: true,
        timeZone: "Europe/Berlin",
      });

      const items = events.data.items || [];

      if (items.length === 0) {
        return Response.json({
          success: false,
          message: "No event found",
        });
      }

      await calendar.events.delete({
        calendarId: tech.calendarId,
        eventId: items[0].id,
      });

      return Response.json({
        success: true,
        message: "Event cancelled",
      });
    }

    // ─────────────────────────────
    // CANCEL BY ID
    // ─────────────────────────────
    if (action === "cancel" && eventId) {
      await calendar.events.delete({
        calendarId: tech.calendarId,
        eventId,
      });

      return Response.json({
        success: true,
      });
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error("Calendar API Error:", error);

    return Response.json(
      {
        error: "Calendar error",
        details: error.message,
      },
      { status: 500 }
    );
  }
}
