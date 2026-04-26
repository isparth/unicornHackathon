import Link from "next/link";

export default function HomePage() {
  return (
    <div style={{ background: "#080c14", minHeight: "100vh", color: "#f0f4ff", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Background glows */}
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-10%", left: "30%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", bottom: "0%", right: "20%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)", filter: "blur(80px)" }} />
      </div>

      {/* Nav */}
      <nav style={{ position: "relative", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 40px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em" }}>QuickFix</span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/dashboard" style={{ padding: "8px 18px", borderRadius: 8, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", fontSize: 14, fontWeight: 500 }}>
            Dashboard
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "100px 24px 80px" }}>
        {/* Badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 100, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", marginBottom: 32 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#6366f1", boxShadow: "0 0 8px #6366f1" }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "#a5b4fc", letterSpacing: "0.02em" }}>AI-Powered Voice Booking</span>
        </div>

        {/* Headline */}
        <h1 style={{ fontSize: "clamp(40px, 6vw, 72px)", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.04em", margin: 0, maxWidth: 800 }}>
          Book a tradesperson
          <br />
          <span style={{ background: "linear-gradient(135deg, #6366f1 0%, #a78bfa 50%, #c4b5fd 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            in under 3 minutes
          </span>
        </h1>

        <p style={{ marginTop: 24, fontSize: 18, lineHeight: 1.7, color: "#94a3b8", maxWidth: 560 }}>
          Just call our number. Our AI agent takes your details, sends you a quick form, and locks in a slot — no hold music, no back and forth.
        </p>

        {/* CTAs */}
        <div style={{ marginTop: 40, display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
          <a
            href="tel:+441392321255"
            style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "14px 28px", borderRadius: 12, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontWeight: 600, fontSize: 16, boxShadow: "0 8px 32px rgba(99,102,241,0.35)", letterSpacing: "-0.01em" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/></svg>
            Call +44 1392 321 255
          </a>
          <Link
            href="/dashboard"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 28px", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#cbd5e1", fontWeight: 500, fontSize: 16 }}
          >
            View Dashboard
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </Link>
        </div>

        {/* Trust bar */}
        <div style={{ marginTop: 56, display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { icon: "🔧", text: "Plumbing" },
            { icon: "🔥", text: "Heating & Boilers" },
            { icon: "⚡", text: "Electrical" },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 14 }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </main>

      {/* How it works */}
      <section style={{ position: "relative", zIndex: 1, padding: "80px 24px", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.1em", color: "#6366f1", textTransform: "uppercase", marginBottom: 12 }}>How it works</p>
          <h2 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>Three steps to booked</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          {[
            { step: "01", title: "Call our number", desc: "Our AI agent answers instantly — no waiting, no menus. Just talk about what's broken.", color: "#6366f1" },
            { step: "02", title: "Fill the quick form", desc: "We send you a WhatsApp link. Add your address, a photo of the issue — takes 60 seconds.", color: "#8b5cf6" },
            { step: "03", title: "Pick your slot & pay", desc: "The agent offers available times. Choose one, pay the call-out fee, and you're confirmed.", color: "#a78bfa" },
          ].map(({ step, title, desc, color }) => (
            <div key={step} style={{ padding: "28px 24px", borderRadius: 16, background: "rgba(15,22,35,0.8)", border: "1px solid rgba(255,255,255,0.07)", backdropFilter: "blur(10px)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: "0.08em", marginBottom: 12 }}>{step}</div>
              <h3 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 10px" }}>{title}</h3>
              <p style={{ color: "#94a3b8", fontSize: 15, lineHeight: 1.6, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ position: "relative", zIndex: 1, borderTop: "1px solid rgba(255,255,255,0.06)", padding: "28px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>QuickFix</span>
        <span style={{ color: "#475569", fontSize: 13 }}>AI-powered trades booking · UK service area</span>
      </footer>
    </div>
  );
}
