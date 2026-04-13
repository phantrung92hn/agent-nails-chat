

export async function POST(request) {
  const { messages } = await request.json();
  const SYSTEM_PROMPT = `Du bist der KI-Assistent für "Sakura Nails Hamburg" (Eppendorfer Baum 26, 20249 Hamburg).

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

TERMINE(April 2026):
Lisa: Mo14 09:00,10:30,13:00,15:00|Di15 09:00,11:00,14:00|Do17 09:00,10:00,13:30|Sa19 09:00,11:00,14:00
Anna: Mo14 09:00,11:00,14:00|Di15 09:00,13:00,15:00|Mi16 10:00,12:00,14:30|Do17 09:00,11:30,14:00
Mai: Mo14 10:00,12:00,14:30|Di15 10:00,13:00|Mi16 10:00,12:30,14:00|Do17 10:00,11:30,14:00|Sa19 09:00,11:30

BUCHUNGEN:
NK001 Sarah Müller 017612345678 Lisa GelMani+NailArt Mo14 09:00 43€(Stammkundin,Nude,Acetone-Allergie,120Punkte)
NK002 Julia Schmidt 015798765432 Mai SpaPedi Di15 10:00 55€(Dunkelrot,50Punkte)

STAMMKUNDEN:
Sarah 017612345678: Lisa,Nude/Pastel,Acetone-Allergie,120Pkt|Julia 015798765432: Mai,Dunkelrot,50Pkt|Thomas 017699887766: keine Präf,30Pkt

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
[CANCEL:techId=T01,date=2026-04-14,time=09:00]`;

  const GREETING = "Hallo! Willkommen bei Sakura Nails Hamburg 💅\nWie kann ich dir helfen?\n\n1️⃣ Termin buchen\n2️⃣ Termin ändern oder stornieren\n3️⃣ Services & Preise ansehen\n4️⃣ Treuepunkte checken\n5️⃣ Etwas anderes\n\nTippe einfach die Zahl 😊";

  try {
    // ─────────────────────────────────────────────
    // Gọi Claude API
    // ─────────────────────────────────────────────
    const apiMessages = [
      { role: "user", content: SYSTEM_PROMPT },
      { role: "assistant", content: GREETING },
      ...messages.slice(1),
    ];

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
        messages: apiMessages,
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
