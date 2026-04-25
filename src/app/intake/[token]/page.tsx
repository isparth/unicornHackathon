import { appConfig } from "@/config/app-config";
import { verifyIntakeToken } from "@/server/services/intake-token-service";
import { getCallSessionByToken } from "@/server/services/call-session-service";
import { IntakeForm, SuccessState } from "./intake-form";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function IntakePage({ params }: Props) {
  const { token } = await params;

  // Server-side token verification before rendering anything
  const verification = verifyIntakeToken(token, appConfig.intakeToken.secret);

  if (!verification.valid) {
    return (
      <PageShell>
        <StatusCard
          tone="error"
          icon={<AlertIcon />}
          heading={
            verification.reason === "expired"
              ? "This link has expired"
              : "Link not recognised"
          }
          body={
            verification.reason === "expired"
              ? "This form link has expired. Ask the agent to resend it and they'll have a fresh one with you in seconds."
              : "This link doesn't look right. Ask the agent to resend it and check the message again."
          }
        />
      </PageShell>
    );
  }

  // Check if already completed
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

// ─── Shell ─────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Load DM Sans from Google Fonts */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
      <main
        className="flex min-h-dvh flex-col items-center justify-start px-4 py-8"
        style={{ background: "#060b18" }}
      >
        {/* Ambient background glow */}
        <div
          className="pointer-events-none fixed inset-0 overflow-hidden"
          aria-hidden="true"
        >
          <div
            className="absolute -left-32 top-0 h-[400px] w-[400px] rounded-full opacity-10"
            style={{ background: "radial-gradient(circle, #f97316, transparent 65%)", filter: "blur(60px)" }}
          />
          <div
            className="absolute -right-32 bottom-0 h-[400px] w-[400px] rounded-full opacity-10"
            style={{ background: "radial-gradient(circle, #3b82f6, transparent 65%)", filter: "blur(60px)" }}
          />
        </div>

        <div className="relative w-full max-w-md">{children}</div>
      </main>
    </>
  );
}

// ─── Status cards ───────────────────────────────────────────────────────────

function StatusCard({
  tone,
  icon,
  heading,
  body,
}: {
  tone: "error" | "success";
  icon: React.ReactNode;
  heading: string;
  body: string;
}) {
  const accentColor = tone === "error" ? "#ef4444" : "#22c55e";
  const bgColor = tone === "error" ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)";
  const borderColor = tone === "error" ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)";

  return (
    <div
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#0f172a" }}
      className="overflow-hidden rounded-3xl shadow-2xl"
    >
      <div
        style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}
        className="px-6 py-10 text-center"
      >
        <div
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: bgColor, border: `1.5px solid ${borderColor}` }}
        >
          <span style={{ color: accentColor }}>{icon}</span>
        </div>
        <h1
          className="text-2xl font-bold"
          style={{ color: "#f1f5f9", fontFamily: "'DM Sans', system-ui, sans-serif" }}
        >
          {heading}
        </h1>
        <p className="mt-2 text-sm" style={{ color: "#94a3b8" }}>
          {body}
        </p>
      </div>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
