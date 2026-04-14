// app/api/chat/route.js
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN BẢN DEBUG — loại bỏ TẤT CẢ import từ lib/
// Mục đích: xác định lỗi 405 do import chain hay do config
// Sau khi chat hoạt động → thêm lại từng feature
// ─────────────────────────────────────────────────────────────────────────────

const GREETING =
  "Hallo! Willkommen bei Sakura Nails Hamburg 💅\nWie kann ich dir helfen?\n\n1️⃣ Termin buchen\n2️⃣ Termin ändern oder stornieren\n3️⃣ Services & Preise ansehen\n4️⃣ Treuepunkte checken\n5️⃣ Etwas anderes\n\nTippe einfach die Zahl 😊";

const SYSTEM_PROMPT = `Du bist der KI-Assistent für "Sakura Nails Hamburg" (Eppendorfer Baum 26, 20249 Hamburg).

REGELN:
- Deutsch antworten (Vietnamesisch/Englisch wenn Kunde so schreibt)
- Freundlich, professionell, gelegentlich Emojis
- Bei JEDER Entscheidung: nummerierte Optionen (1️⃣ 2️⃣ 3️⃣), max 5-6
- Preise+Dauer immer anzeigen
- KEINE Infos erfinden

STUDIO: Mo-Fr 09-19, Sa 09-17, So geschlossen | Eppendorfer Baum 26, 20249 Hamburg
Tel: 040-12345678 | U Kellinghusenstrasse (U1/U3)

SERVICES:
Manikuere: Klassisch 25EUR/30min | Gel 35EUR/45min | Shellac(CND) 38EUR/45min | GelVerlaengerung 55EUR/90min | GelAuffuellung 40EUR/60min | AcrylVerl 60EUR/90min | AcrylAuff 42EUR/60min | Entfernung 15EUR/30min(gratis bei Neuservice)
Pedikuere: Klassisch 30EUR/45min | Gel 40EUR/60min | Spa 55EUR/75min
Extras: NailArt einfach +8EUR | aufwendig +15EUR | French +10EUR | Strasssteine +3EUR/Nagel
Combos: Mani+Pedi Gel 65EUR(spart10EUR) | FullPamper 85EUR(spart16EUR) | GelVerl+Pedi 75EUR(spart10EUR)

TEAM:
Lisa(T01): Gel,Shellac,NailArt,Babyboomer|4.9|Deutsch+Vietn.|Mo,Di,Do,Fr,Sa
Anna(T02): Gel,Acryl,Verlaengerung|4.7|Deutsch+Engl.|Mo-Do,Fr bis 15
Mai(T03): Pedikuere,Spa,Klassisch,Gel|4.8|Deutsch+Vietn.+Engl.|Mo-Fr 10-18,Sa

Begruessing immer mit Optionen: 1 Termin buchen 2 Aendern/stornieren 3 Services 4 Treuepunkte 5 Anderes`;

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Invalid messages format" }, { status: 400 });
  }

  try {
    const apiMessages = messages
      .filter(function(m) { return m.role === "user" || m.role === "assistant"; })
      .filter(function(m) { return typeof m.content === "string" && m.content.trim() !== ""; });

    const firstUserIdx = apiMessages.findIndex(function(m) { return m.role === "user"; });
    const cleanMessages = firstUserIdx >= 0 ? apiMessages.slice(firstUserIdx) : apiMessages;

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
        system: SYSTEM_PROMPT,
        messages: cleanMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: data?.error?.message || "API error " + response.status },
        { status: 500 }
      );
    }

    const reply = (data.content || [])
      .filter(function(b) { return b.type === "text"; })
      .map(function(b) { return b.text; })
      .join("\n") || "Entschuldigung, es gab ein Problem.";

    return Response.json({ reply: reply });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
