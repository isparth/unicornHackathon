import { appConfig } from "@/config/app-config";
import { verifyIntakeToken } from "@/server/services/intake-token-service";
import { getCallSessionByToken } from "@/server/services/call-session-service";
import { IntakeForm, SuccessState } from "./intake-form";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function IntakePage({ params }: Props) {
  const { token } = await params;

  const verification = verifyIntakeToken(token, appConfig.intakeToken.secret);

  if (!verification.valid) {
    return (
      <PageShell>
        <StatusCard
          tone="error"
          icon={<AlertIcon />}
          heading={verification.reason === "expired" ? "Link expired" : "Link not recognised"}
          body={
            verification.reason === "expired"
              ? "This form link has expired. Ask the agent to resend it and they'll have a fresh one with you in seconds."
              : "This link doesn't look right. Ask the agent to resend it and check the message again."
          }
        />
      </PageShell>
    );
  }

  const session = await getCallSessionByToken(token);
  if (session?.intakeFormCompletedAt) {
    return (
      <PageShell>
        <SuccessState alreadyDone />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <IntakeForm token={token} />
    </PageShell>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh", background: "#080c14", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px 48px", fontFamily: "'Inter', system-ui, sans-serif", color: "#f0f4ff" }}>
      {/* Ambient glows */}
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 65%)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", bottom: "-10%", right: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 65%)", filter: "blur(80px)" }} />
      </div>

      {/* Logo */}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 480, marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>QuickFix</span>
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 480 }}>{children}</div>
    </main>
  );
}

// ─── Status card ──────────────────────────────────────────────────────────────

function StatusCard({ tone, icon, heading, body }: { tone: "error" | "success"; icon: React.ReactNode; heading: string; body: string }) {
  const color = tone === "error" ? "#ef4444" : "#22c55e";
  const bg = tone === "error" ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)";
  const border = tone === "error" ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)";

  return (
    <div style={{ borderRadius: 20, background: "#0f1623", border: "1px solid rgba(255,255,255,0.08)", padding: "40px 28px", textAlign: "center" }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color }}>
        {icon}
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 10px", color: "#f0f4ff" }}>{heading}</h1>
      <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0 }}>{body}</p>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
