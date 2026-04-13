"use client";
import { useState, useRef, useEffect, useCallback } from "react";

const GREETING = "Hallo! Willkommen bei Sakura Nails Hamburg 💅\nWie kann ich dir helfen?\n\n1️⃣ Termin buchen\n2️⃣ Termin ändern oder stornieren\n3️⃣ Services & Preise ansehen\n4️⃣ Treuepunkte checken\n5️⃣ Etwas anderes\n\nTippe einfach die Zahl 😊";

function getQR(text) {
  const r = [];
  for (const l of text.split("\n")) {
    const m = l.match(/^([1-6])️⃣\s+(.+)$/);
    if (m) r.push({ label: m[2].trim(), val: m[1] });
  }
  if (text.includes("J oder N")) r.push({ label: "Ja", val: "J" }, { label: "Nein", val: "N" });
  return r;
}

function Lines({ t }) {
  return t.split("\n").map((l, i) => {
    if (!l.trim()) return <div key={i} style={{ height: 4 }} />;
    const sm = /^[1-6]️⃣|^[💅👩📅🕐⏱💰📝📋⏰⚠🏆❌✅]|^[JN] →/.test(l);
    return <div key={i} style={{ padding:"1px 0", fontSize: sm ? 14 : 15, fontWeight: /^[JN] →/.test(l) ? 600 : 400, lineHeight: 1.5 }}>{l}</div>;
  });
}

export default function Chat() {
  // FIX A3: Mỗi message lưu timestamp chính xác lúc gửi/nhận
const now = () => new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const [msgs, setMsgs] = useState([{ role:"assistant", content: GREETING, time: now() }]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const btm = useRef(null);
  const iRef = useRef(null);

  useEffect(() => { btm.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, busy]);

  const send = useCallback(async (text) => {
    if (!text.trim() || busy) return;
    const updated = [...msgs, { role:"user", content: text.trim(), time: now() }];
    setMsgs(updated);
    setInp("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ messages: updated }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMsgs(prev => [...prev, { role:"assistant", content: data.reply, time: now() }]);
    } catch {
      setMsgs(prev => [...prev, { role:"assistant", content:"⚠️ Verbindungsproblem. Bitte nochmal versuchen.\n\n1️⃣ Nochmal versuchen\n2️⃣ Anrufen: 040-12345678", time: now() }]);
    }
    setBusy(false);
  }, [msgs, busy]);

  const last = [...msgs].reverse().find(m => m.role === "assistant");
  const qr = last && !busy ? getQR(last.content) : [];

  return (
    <div style={{ position:"fixed", inset:0, display:"flex", flexDirection:"column", fontFamily:"system-ui,-apple-system,sans-serif", background:"#f5f0ec" }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#c4727f,#d4919b)", padding:"0 16px", paddingTop:"env(safe-area-inset-top,12px)", flexShrink:0, boxShadow:"0 2px 12px rgba(196,114,127,0.25)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0" }}>
          <div style={{ width:44, height:44, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>💅</div>
          <div style={{ flex:1 }}>
            <div style={{ color:"#fff", fontSize:17, fontWeight:700 }}>Sakura Nails Hamburg</div>
            <div style={{ color:"rgba(255,255,255,0.8)", fontSize:12, marginTop:1 }}>{busy ? "tippt..." : "Eppendorfer Baum 26 · Online"}</div>
          </div>
          <a href="tel:04012345678" style={{ width:38, height:38, borderRadius:"50%", background:"rgba(255,255,255,0.18)", display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          </a>
        </div>
      </div>
      {/* Messages */}
      <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"16px 12px 8px", display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ textAlign:"center", margin:"4px 0 8px" }}><span style={{ background:"rgba(0,0,0,0.06)", padding:"4px 14px", borderRadius:20, fontSize:12, color:"#8a8580" }}>Heute</span></div>
        {msgs.map((m, i) => (
          <div key={i} style={{ display:"flex", justifyContent: m.role==="user"?"flex-end":"flex-start", paddingLeft: m.role==="user"?40:0, paddingRight: m.role==="user"?0:40 }}>
            <div style={{ padding:"10px 14px", borderRadius: m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px", background: m.role==="user"?"#c4727f":"#fff", color: m.role==="user"?"#fff":"#2d2a26", boxShadow: m.role==="user"?"0 1px 4px rgba(196,114,127,0.3)":"0 1px 3px rgba(0,0,0,0.06)", border: m.role==="user"?"none":"1px solid #ece8e4", maxWidth:"100%" }}>
              <Lines t={m.content} />
              <div style={{ fontSize:10, marginTop:4, textAlign:"right", color: m.role==="user"?"rgba(255,255,255,0.6)":"#b5b0aa" }}>{m.time ?? now()}</div>
            </div>
          </div>
        ))}
        {busy && <div style={{ display:"flex", paddingRight:40 }}><div style={{ padding:"14px 20px", borderRadius:"18px 18px 18px 4px", background:"#fff", border:"1px solid #ece8e4", display:"flex", gap:5 }}>{[0,1,2].map(d=><div key={d} style={{ width:8, height:8, borderRadius:"50%", background:"#c4727f", animation:`dot 1.2s ease ${d*.2}s infinite` }}/>)}</div></div>}
        <div ref={btm}/>
      </div>
      {/* Quick replies */}
      {qr.length > 0 && !busy && (
        <div style={{ padding:"6px 12px 2px", display:"flex", gap:8, flexWrap:"wrap" }}>
          {qr.map((q,i) => (
            <button key={i} onClick={() => send(q.val)} style={{ padding:"10px 18px", borderRadius:22, border:"2px solid #c4727f", background:"#fff", color:"#c4727f", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit", WebkitTapHighlightColor:"transparent", touchAction:"manipulation" }}>
              {q.val==="J"||q.val==="N" ? `${q.val==="J"?"✓":"✗"} ${q.label}` : `${q.val}  ${q.label}`}
            </button>
          ))}
        </div>
      )}
      {/* Input */}
      <div style={{ padding:"8px 12px", paddingBottom:"max(env(safe-area-inset-bottom,8px),10px)", background:"#fff", borderTop:"1px solid #ece8e4", display:"flex", gap:8, flexShrink:0 }}>
        <input ref={iRef} value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(inp)} placeholder="Nachricht schreiben..." disabled={busy} style={{ flex:1, padding:"12px 18px", borderRadius:24, border:"1.5px solid #ece8e4", background:"#f5f0ec", fontSize:15, fontFamily:"inherit", color:"#2d2a26", outline:"none", WebkitAppearance:"none" }} onFocus={e=>e.target.style.borderColor="#c4727f"} onBlur={e=>e.target.style.borderColor="#ece8e4"} />
        <button onClick={()=>send(inp)} disabled={busy||!inp.trim()} style={{ width:46, height:46, borderRadius:"50%", border:"none", background: busy||!inp.trim()?"#ddd":"#c4727f", cursor: busy||!inp.trim()?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, WebkitTapHighlightColor:"transparent" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <style>{`@keyframes dot{0%,80%,100%{opacity:.25;transform:scale(.7)}40%{opacity:1;transform:scale(1.1)}} *{box-sizing:border-box;margin:0;padding:0} html,body{height:100%;overflow:hidden} input::placeholder{color:#b5b0aa}`}</style>
    </div>
  );
}
