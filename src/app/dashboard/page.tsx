import Link from "next/link";
import { appConfig } from "@/config/app-config";
import { demoBusiness, demoJobs, demoWorkers } from "@/domain/demo-data";
import { canTransitionJob } from "@/domain/job-state-machine";
import type { JobStatus } from "@/domain/types";

const nextStatusByJobStatus: Partial<Record<JobStatus, JobStatus>> = {
  intake: "qualified",
  qualified: "priced",
  priced: "slot_held",
  slot_held: "awaiting_payment",
  awaiting_payment: "confirmed",
  confirmed: "completed",
};

function formatMoney(pence: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
}

const S = {
  // Layout
  page: { background: "#080c14", minHeight: "100vh", color: "#f0f4ff", fontFamily: "'Inter', system-ui, sans-serif" } as React.CSSProperties,
  container: { maxWidth: 1200, margin: "0 auto", padding: "0 24px" } as React.CSSProperties,

  // Nav
  nav: { borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 24px" } as React.CSSProperties,
  navInner: { maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
  logo: { display: "flex", alignItems: "center", gap: 10 } as React.CSSProperties,
  logoIcon: { width: 30, height: 30, borderRadius: 7, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties,
  logoText: { fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" } as React.CSSProperties,
  navBack: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#64748b", padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" } as React.CSSProperties,

  // Header
  header: { padding: "40px 0 32px" } as React.CSSProperties,
  headerTop: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 20 } as React.CSSProperties,
  eyebrow: { fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", color: "#6366f1", textTransform: "uppercase" as const, marginBottom: 8 } as React.CSSProperties,
  businessName: { fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, letterSpacing: "-0.03em", margin: 0, lineHeight: 1.1 } as React.CSSProperties,
  metricRow: { display: "flex", gap: 12 } as React.CSSProperties,

  // Section grid
  grid: { display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, paddingBottom: 48, alignItems: "start" } as React.CSSProperties,

  // Cards
  card: { borderRadius: 16, background: "#0f1623", border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" } as React.CSSProperties,
  cardHeader: { padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
  cardTitle: { fontWeight: 600, fontSize: 15, color: "#e2e8f0" } as React.CSSProperties,
  cardCount: { fontSize: 12, color: "#475569", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 20 } as React.CSSProperties,

  // Job rows
  jobRow: { padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" } as React.CSSProperties,
  jobSummary: { fontWeight: 600, fontSize: 15, marginBottom: 6, lineHeight: 1.4 } as React.CSSProperties,
  jobPrice: { fontSize: 13, color: "#64748b", marginTop: 4 } as React.CSSProperties,
  transitionBox: { background: "#161e2e", borderRadius: 10, padding: "12px 14px", minWidth: 200, border: "1px solid rgba(255,255,255,0.05)" } as React.CSSProperties,
  transitionLabel: { fontSize: 11, fontWeight: 600, color: "#475569", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 6 } as React.CSSProperties,
  transitionFlow: { fontSize: 13, color: "#94a3b8", marginBottom: 4 } as React.CSSProperties,

  // Worker rows
  workerRow: { padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } as React.CSSProperties,
  workerAvatar: { width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 } as React.CSSProperties,
  workerName: { fontWeight: 600, fontSize: 14 } as React.CSSProperties,
  workerArea: { fontSize: 12, color: "#64748b", marginTop: 1 } as React.CSSProperties,

  // Info card
  infoCard: { borderRadius: 16, background: "#0f1623", border: "1px solid rgba(255,255,255,0.07)", padding: "20px" } as React.CSSProperties,
  infoTitle: { fontWeight: 600, fontSize: 15, marginBottom: 14, color: "#e2e8f0" } as React.CSSProperties,
  infoItem: { display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, fontSize: 13, color: "#64748b", lineHeight: 1.5 } as React.CSSProperties,
  infoDot: { width: 6, height: 6, borderRadius: "50%", background: "#6366f1", marginTop: 6, flexShrink: 0 } as React.CSSProperties,
};

export default function DashboardPage() {
  const activeJobs = demoJobs.filter((j) => !["expired", "completed"].includes(j.status));
  const confirmedJobs = demoJobs.filter((j) => j.status === "confirmed");

  return (
    <div style={S.page}>
      {/* Background glow */}
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", top: -100, right: "10%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)", filter: "blur(80px)" }} />
      </div>

      {/* Nav */}
      <nav style={S.nav}>
        <div style={S.navInner}>
          <div style={S.logo}>
            <div style={S.logoIcon}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            </div>
            <span style={S.logoText}>QuickFix</span>
          </div>
          <Link href="/" style={S.navBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            Back to home
          </Link>
        </div>
      </nav>

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={S.container}>
          {/* Header */}
          <header style={S.header}>
            <div style={S.headerTop}>
              <div>
                <p style={S.eyebrow}>{demoBusiness.serviceArea}</p>
                <h1 style={S.businessName}>{demoBusiness.name}</h1>
              </div>
              <div style={S.metricRow}>
                <Metric label="Active jobs" value={activeJobs.length} color="#6366f1" />
                <Metric label="Workers" value={demoWorkers.length} color="#22c55e" />
                <Metric label="Hold window" value={`${appConfig.reservationHoldMinutes}m`} color="#f59e0b" />
              </div>
            </div>
          </header>

          {/* Main grid */}
          <div style={S.grid}>
            {/* Jobs panel */}
            <div style={S.card}>
              <div style={S.cardHeader}>
                <span style={S.cardTitle}>Job Pipeline</span>
                <span style={S.cardCount}>{demoJobs.length} jobs</span>
              </div>
              <div>
                {demoJobs.map((job) => {
                  const nextStatus = nextStatusByJobStatus[job.status];
                  const transition = nextStatus ? canTransitionJob(job, nextStatus) : null;

                  return (
                    <article key={job.id} style={S.jobRow}>
                      <div>
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 8 }}>
                          <StatusBadge status={job.status} />
                          {job.urgency && <Chip>{job.urgency.replace("_", " ")}</Chip>}
                          {job.requiredSkill && <Chip>{job.requiredSkill}</Chip>}
                        </div>
                        <p style={S.jobSummary}>{job.problemSummary}</p>
                        {job.priceEstimate && (
                          <p style={S.jobPrice}>
                            {formatMoney(job.priceEstimate.calloutFeePence, job.priceEstimate.currency)} call-out ·{" "}
                            {formatMoney(job.priceEstimate.repairEstimateMinPence, job.priceEstimate.currency)}–
                            {formatMoney(job.priceEstimate.repairEstimateMaxPence, job.priceEstimate.currency)} repair
                          </p>
                        )}
                      </div>
                      <div style={S.transitionBox}>
                        <p style={S.transitionLabel}>Next step</p>
                        <p style={S.transitionFlow}>
                          {nextStatus ? `${job.status} → ${nextStatus}` : "Terminal state"}
                        </p>
                        {transition && (
                          <p style={{ fontSize: 12, fontWeight: 600, color: transition.allowed ? "#22c55e" : "#f87171" }}>
                            {transition.allowed ? "✓ Allowed" : `✗ ${transition.reason}`}
                          </p>
                        )}
                        {!transition && (
                          <p style={{ fontSize: 12, color: "#475569" }}>No further steps</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            {/* Sidebar */}
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
              {/* Workers */}
              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardTitle}>Workers</span>
                  <span style={S.cardCount}>{demoWorkers.length} active</span>
                </div>
                <div>
                  {demoWorkers.map((worker) => (
                    <div key={worker.id} style={S.workerRow}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={S.workerAvatar}>{worker.name[0]}</div>
                        <div>
                          <p style={S.workerName}>{worker.name}</p>
                          <p style={S.workerArea}>{worker.serviceArea}</p>
                        </div>
                      </div>
                      <Chip>{worker.skill}</Chip>
                    </div>
                  ))}
                </div>
              </div>

              {/* Info */}
              <div style={S.infoCard}>
                <p style={S.infoTitle}>System Status</p>
                <div style={S.infoItem}>
                  <span style={S.infoDot} />
                  <span>Supabase schema with all core tables and enums live</span>
                </div>
                <div style={S.infoItem}>
                  <span style={S.infoDot} />
                  <span>Seed data: workers, availability, jobs, and payments</span>
                </div>
                <div style={S.infoItem}>
                  <span style={S.infoDot} />
                  <span>AI agent on +44 1392 321 255 — ready to take calls</span>
                </div>
                <div style={{ ...S.infoItem, marginBottom: 0 }}>
                  <span style={S.infoDot} />
                  <span>
                    Confirmed jobs:{" "}
                    <strong style={{ color: "#22c55e" }}>{confirmedJobs.length}</strong>
                  </span>
                </div>
              </div>

              {/* Call CTA */}
              <a
                href="tel:+441392321255"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px 20px", borderRadius: 14, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontWeight: 600, fontSize: 15, boxShadow: "0 8px 28px rgba(99,102,241,0.3)", textDecoration: "none" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" /></svg>
                Test the AI Agent
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Metric({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ padding: "12px 16px", borderRadius: 12, background: "#0f1623", border: "1px solid rgba(255,255,255,0.07)", minWidth: 90, textAlign: "center" as const }}>
      <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color, margin: 0, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 11, color: "#475569", fontWeight: 500, marginTop: 4, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{label}</p>
    </div>
  );
}

const statusConfig: Record<string, { bg: string; color: string; label: string }> = {
  intake:           { bg: "rgba(99,102,241,0.12)",  color: "#a5b4fc", label: "Intake" },
  qualified:        { bg: "rgba(59,130,246,0.12)",  color: "#93c5fd", label: "Qualified" },
  priced:           { bg: "rgba(245,158,11,0.12)",  color: "#fcd34d", label: "Priced" },
  slot_held:        { bg: "rgba(139,92,246,0.12)",  color: "#c4b5fd", label: "Slot held" },
  awaiting_payment: { bg: "rgba(251,146,60,0.12)",  color: "#fdba74", label: "Awaiting payment" },
  confirmed:        { bg: "rgba(34,197,94,0.12)",   color: "#86efac", label: "Confirmed" },
  completed:        { bg: "rgba(100,116,139,0.12)", color: "#94a3b8", label: "Completed" },
  expired:          { bg: "rgba(239,68,68,0.12)",   color: "#fca5a5", label: "Expired" },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const cfg = statusConfig[status] ?? { bg: "rgba(255,255,255,0.08)", color: "#94a3b8", label: status };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: cfg.bg, color: cfg.color, letterSpacing: "0.04em" }}>
      {cfg.label}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 6, background: "rgba(255,255,255,0.05)", color: "#64748b", border: "1px solid rgba(255,255,255,0.07)" }}>
      {children}
    </span>
  );
}
