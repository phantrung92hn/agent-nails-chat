import { google } from "googleapis";

const TECHNICIANS = {
  T01: { name: "Lisa", calendarId: process.env.CALENDAR_LISA },
  T02: { name: "Anna", calendarId: process.env.CALENDAR_ANNA },
  T03: { name: "Mai", calendarId: process.env.CALENDAR_MAI },
};

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
  const body = await request.json();
  const { action, techId, date, time, duration, customerName, service } = body;

  const calendar = getCalendarClient();
  const tech = TECHNICIANS[techId];

  if (!tech || !tech.calendarId) {
    return Response.json(
      { error: `Designerin ${techId} nicht gefunden` },
      { status: 400 }
    );
  }

  try {
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
        success: true,
        technician: tech.name,
        date,
        busySlots,
      });
    }

    if (action === "book") {
      const startTime = new Date(`${date}T${time}:00+02:00`);
      const endTime = new Date(startTime.getTime() + (duration || 60) * 60000);

      const event = await calendar.events.insert({
        calendarId: tech.calendarId,
        requestBody: {
          summary: `💅 ${customerName} — ${service}`,
          description: [
            `Kundin: ${customerName}`,
            `Service: ${service}`,
            `Designerin: ${tech.name}`,
            `Dauer: ${duration} Minuten`,
            ``,
            `Gebucht über Sakura Nails Chatbot`,
          ].join("\n"),
          start: {
            dateTime: startTime.toISOString(),
            timeZone: "Europe/Berlin",
          },
          end: {
            dateTime: endTime.toISOString(),
            timeZone: "Europe/Berlin",
          },
          colorId: "6",
          reminders: {
            useDefault: false,
            overrides: [
              { method: "popup", minutes: 120 },
              { method: "popup", minutes: 15 },
            ],
          },
        },
      });

      return Response.json({
        success: true,
        eventId: event.data.id,
        message: `Termin gebucht: ${customerName} bei ${tech.name}, ${date} um ${time}`,
      });
    }

    if (action === "cancel_by_time") {
      const searchStart = new Date(`${date}T${time}:00+02:00`);
      const searchEnd = new Date(searchStart.getTime() + 5 * 60000);

      const events = await calendar.events.list({
        calendarId: tech.calendarId,
        timeMin: searchStart.toISOString(),
        timeMax: searchEnd.toISOString(),
        singleEvents: true,
        timeZone: "Europe/Berlin",
      });

      const items = events.data.items || [];
      if (items.length === 0) {
        return Response.json({
          success: false,
          message: `Kein Termin gefunden`,
        });
      }

      await calendar.events.delete({
        calendarId: tech.calendarId,
        eventId: items[0].id,
      });

      return Response.json({
        success: true,
        message: `Termin bei ${tech.name} am ${date} um ${time} storniert`,
      });
    }

    if (action === "cancel" && body.eventId) {
      await calendar.events.delete({
        calendarId: tech.calendarId,
        eventId: body.eventId,
      });

      return Response.json({
        success: true,
        message: `Termin storniert`,
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
