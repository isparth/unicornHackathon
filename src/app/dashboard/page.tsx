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

const statusConfig: Record<string, { bg: string; color: string; dot: string; label: string }> = {
  intake:           { bg: "rgba(99,102,241,0.12)",  color: "#a5b4fc", dot: "#6366f1", label: "Intake" },
  qualified:        { bg: "rgba(59,130,246,0.12)",  color: "#93c5fd", dot: "#3b82f6", label: "Qualified" },
  priced:           { bg: "rgba(245,158,11,0.12)",  color: "#fcd34d", dot: "#f59e0b", label: "Priced" },
  slot_held:        { bg: "rgba(139,92,246,0.12)",  color: "#c4b5fd", dot: "#8b5cf6", label: "Slot held" },
  awaiting_payment: { bg: "rgba(251,146,60,0.12)",  color: "#fdba74", dot: "#f97316", label: "Awaiting payment" },
  confirmed:        { bg: "rgba(34,197,94,0.12)",   color: "#86efac", dot: "#22c55e", label: "Confirmed" },
  completed:        { bg: "rgba(100,116,139,0.12)", color: "#94a3b8", dot: "#64748b", label: "Completed" },
  expired:          { bg: "rgba(239,68,68,0.12)",   color: "#fca5a5", dot: "#ef4444", label: "Expired" },
};

const skillColors: Record<string, { bg: string; color: string }> = {
  heating:    { bg: "rgba(239,68,68,0.1)",   color: "#fca5a5" },
  plumbing:   { bg: "rgba(59,130,246,0.1)",  color: "#93c5fd" },
  electrical: { bg: "rgba(250,204,21,0.1)",  color: "#fde047" },
};

const urgencyColors: Record<string, { bg: string; color: string; label: string }> = {
  emergency: { bg: "rgba(239,68,68,0.1)",   color: "#fca5a5", label: "Emergency" },
  same_day:  { bg: "rgba(245,158,11,0.1)",  color: "#fcd34d", label: "Same day" },
  scheduled: { bg: "rgba(34,197,94,0.1)",   color: "#86efac", label: "Scheduled" },
};

export default function DashboardPage() {
  const activeJobs = demoJobs.filter((j) => !["expired", "completed"].includes(j.status));
  const confirmedJobs = demoJobs.filter((j) => j.status === "confirmed");

  return (
    <>
      <style>{`
        .db-page { background: #080c14; min-height: 100vh; color: #f0f4ff; font-family: 'Inter', system-ui, sans-serif; }
        .db-nav { border-bottom: 1px solid rgba(255,255,255,0.07); padding: 14px 20px; }
        .db-nav-inner { max-width: 1280px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
        .db-logo { display: flex; align-items: center; gap: 10px; }
        .db-logo-icon { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .db-logo-text { font-weight: 700; font-size: 17px; letter-spacing: -0.02em; }
        .db-nav-back { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #64748b; padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); text-decoration: none; transition: border-color 0.2s, color 0.2s; }
        .db-nav-back:hover { border-color: rgba(255,255,255,0.15); color: #94a3b8; }

        .db-main { max-width: 1280px; margin: 0 auto; padding: 0 20px 60px; position: relative; z-index: 1; }

        .db-header { padding: 36px 0 28px; }
        .db-header-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .db-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; color: #6366f1; text-transform: uppercase; margin: 0 0 6px; }
        .db-business-name { font-size: clamp(24px, 4vw, 40px); font-weight: 800; letter-spacing: -0.03em; margin: 0; line-height: 1.1; }
        .db-metrics { display: flex; gap: 10px; flex-wrap: wrap; }
        .db-metric { padding: 12px 18px; border-radius: 12px; background: #0f1623; border: 1px solid rgba(255,255,255,0.07); text-align: center; min-width: 80px; }
        .db-metric-val { font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin: 0; line-height: 1; }
        .db-metric-lbl { font-size: 10px; color: #475569; font-weight: 500; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em; }

        /* Two-column layout on large screens, single on mobile */
        .db-grid { display: grid; grid-template-columns: 1fr 340px; gap: 18px; align-items: start; }

        .db-sidebar { display: flex; flex-direction: column; gap: 16px; }

        /* Card */
        .db-card { border-radius: 16px; background: #0f1623; border: 1px solid rgba(255,255,255,0.07); overflow: hidden; }
        .db-card-head { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: space-between; }
        .db-card-title { font-weight: 600; font-size: 14px; color: #e2e8f0; }
        .db-card-count { font-size: 11px; color: #475569; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 20px; }

        /* Job rows */
        .db-job { padding: 16px 18px; border-bottom: 1px solid rgba(255,255,255,0.045); }
        .db-job:last-child { border-bottom: none; }
        .db-job-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .db-job-summary { font-weight: 600; font-size: 14px; line-height: 1.45; margin: 0 0 6px; color: #e2e8f0; }
        .db-job-price { font-size: 12px; color: #64748b; margin: 0; }
        .db-job-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; gap: 10px; flex-wrap: wrap; }
        .db-next-step { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #161e2e; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); font-size: 12px; }
        .db-next-flow { color: #64748b; font-family: 'SFMono-Regular', 'Consolas', monospace; }
        .db-next-ok { font-weight: 600; color: #22c55e; }
        .db-next-err { font-weight: 600; color: #f87171; }
        .db-slot-info { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 6px; }

        /* Worker rows */
        .db-worker { padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.045); display: flex; align-items: center; gap: 12px; }
        .db-worker:last-child { border-bottom: none; }
        .db-worker-avatar { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .db-worker-name { font-weight: 600; font-size: 13px; margin: 0 0 2px; color: #e2e8f0; }
        .db-worker-area { font-size: 11px; color: #64748b; margin: 0; }
        .db-worker-skill-wrap { margin-left: auto; }

        /* Status & chips */
        .db-chip { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 5px; background: rgba(255,255,255,0.05); color: #64748b; border: 1px solid rgba(255,255,255,0.07); white-space: nowrap; }

        /* Info & CTA */
        .db-info-card { border-radius: 16px; background: #0f1623; border: 1px solid rgba(255,255,255,0.07); padding: 18px; }
        .db-info-title { font-weight: 600; font-size: 13px; margin: 0 0 12px; color: #e2e8f0; }
        .db-info-item { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; font-size: 12px; color: #64748b; line-height: 1.55; }
        .db-info-item:last-child { margin-bottom: 0; }
        .db-info-dot { width: 5px; height: 5px; border-radius: 50%; background: #6366f1; margin-top: 5px; flex-shrink: 0; }
        .db-cta { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 14px 20px; border-radius: 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; font-weight: 600; font-size: 14px; box-shadow: 0 8px 28px rgba(99,102,241,0.25); text-decoration: none; transition: opacity 0.2s, transform 0.15s; }
        .db-cta:hover { opacity: 0.92; transform: translateY(-1px); }

        /* Pipeline progress bar */
        .db-pipeline { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .db-pipeline-label { font-size: 10px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.07em; margin: 0 0 10px; }
        .db-pipeline-steps { display: flex; align-items: center; gap: 0; }
        .db-pipeline-step { display: flex; align-items: center; flex: 1; }
        .db-pipeline-node { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .db-pipeline-line { flex: 1; height: 1px; background: rgba(255,255,255,0.08); }
        .db-pipeline-node.active { box-shadow: 0 0 0 3px rgba(99,102,241,0.25); }

        /* Responsive */
        @media (max-width: 900px) {
          .db-grid { grid-template-columns: 1fr; }
          .db-sidebar { display: contents; }
          .db-sidebar > * { order: 10; }
        }
        @media (max-width: 600px) {
          .db-main { padding: 0 14px 48px; }
          .db-header { padding: 24px 0 20px; }
          .db-metrics { gap: 8px; }
          .db-metric { padding: 10px 14px; min-width: 70px; }
          .db-metric-val { font-size: 22px; }
          .db-nav { padding: 12px 14px; }
        }
      `}</style>

      <div className="db-page">
        {/* Background glow */}
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
          <div style={{ position: "absolute", top: -150, right: "5%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)", filter: "blur(80px)" }} />
          <div style={{ position: "absolute", bottom: -100, left: "10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%)", filter: "blur(60px)" }} />
        </div>

        {/* Nav */}
        <nav className="db-nav">
          <div className="db-nav-inner">
            <div className="db-logo">
              <div className="db-logo-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              </div>
              <span className="db-logo-text">QuickFix</span>
            </div>
            <Link href="/" className="db-nav-back">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              Back to home
            </Link>
          </div>
        </nav>

        <div className="db-main">
          {/* Header */}
          <header className="db-header">
            <div className="db-header-top">
              <div>
                <p className="db-eyebrow">{demoBusiness.serviceArea} &bull; Live demo</p>
                <h1 className="db-business-name">{demoBusiness.name}</h1>
              </div>
              <div className="db-metrics">
                <div className="db-metric">
                  <p className="db-metric-val" style={{ color: "#6366f1" }}>{activeJobs.length}</p>
                  <p className="db-metric-lbl">Active jobs</p>
                </div>
                <div className="db-metric">
                  <p className="db-metric-val" style={{ color: "#22c55e" }}>{demoWorkers.length}</p>
                  <p className="db-metric-lbl">Workers</p>
                </div>
                <div className="db-metric">
                  <p className="db-metric-val" style={{ color: "#f59e0b" }}>{confirmedJobs.length}</p>
                  <p className="db-metric-lbl">Confirmed</p>
                </div>
                <div className="db-metric">
                  <p className="db-metric-val" style={{ color: "#94a3b8", fontSize: 18 }}>{appConfig.reservationHoldMinutes}m</p>
                  <p className="db-metric-lbl">Hold window</p>
                </div>
              </div>
            </div>
          </header>

          {/* Main grid */}
          <div className="db-grid">
            {/* Jobs panel */}
            <div className="db-card">
              <div className="db-card-head">
                <span className="db-card-title">Job Pipeline</span>
                <span className="db-card-count">{demoJobs.length} jobs</span>
              </div>

              {/* Pipeline legend */}
              <div className="db-pipeline">
                <p className="db-pipeline-label">Lifecycle stages</p>
                <div className="db-pipeline-steps">
                  {(["intake","qualified","priced","slot_held","awaiting_payment","confirmed","completed"] as JobStatus[]).map((s, i, arr) => {
                    const cfg = statusConfig[s];
                    const activeJobs2 = demoJobs.filter(j => j.status === s);
                    return (
                      <div key={s} className="db-pipeline-step">
                        <div
                          className={`db-pipeline-node${activeJobs2.length ? " active" : ""}`}
                          style={{ background: activeJobs2.length ? cfg.dot : "rgba(255,255,255,0.1)" }}
                          title={`${cfg.label}${activeJobs2.length ? ` (${activeJobs2.length})` : ""}`}
                        />
                        {i < arr.length - 1 && <div className="db-pipeline-line" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Job list */}
              {demoJobs.map((job) => {
                const nextStatus = nextStatusByJobStatus[job.status];
                const transition = nextStatus ? canTransitionJob(job, nextStatus) : null;
                const statusCfg = statusConfig[job.status] ?? statusConfig.intake;
                const urgencyCfg = job.urgency ? urgencyColors[job.urgency] : null;
                const skillCfg = job.requiredSkill ? skillColors[job.requiredSkill] : null;

                return (
                  <article key={job.id} className="db-job">
                    {/* Chips row */}
                    <div className="db-job-chips">
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, background: statusCfg.bg, color: statusCfg.color, letterSpacing: "0.04em" }}>
                        {statusCfg.label}
                      </span>
                      {urgencyCfg && (
                        <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 5, background: urgencyCfg.bg, color: urgencyCfg.color }}>
                          {urgencyCfg.label}
                        </span>
                      )}
                      {skillCfg && job.requiredSkill && (
                        <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 5, background: skillCfg.bg, color: skillCfg.color }}>
                          {job.requiredSkill}
                        </span>
                      )}
                      {job.jobCategory && <span className="db-chip">{job.jobCategory}</span>}
                    </div>

                    {/* Summary */}
                    <p className="db-job-summary">{job.problemSummary}</p>

                    {/* Price */}
                    {job.priceEstimate && (
                      <p className="db-job-price">
                        {formatMoney(job.priceEstimate.calloutFeePence, job.priceEstimate.currency)} call-out &nbsp;&middot;&nbsp;{" "}
                        {formatMoney(job.priceEstimate.repairEstimateMinPence, job.priceEstimate.currency)}–{formatMoney(job.priceEstimate.repairEstimateMaxPence, job.priceEstimate.currency)} repair
                      </p>
                    )}

                    {/* Footer row: slot info + next step */}
                    <div className="db-job-footer">
                      {job.selectedSlotStartsAt && (
                        <div className="db-slot-info">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                          {new Date(job.selectedSlotStartsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                          {" "}
                          {new Date(job.selectedSlotStartsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–{new Date(job.selectedSlotEndsAt!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                      {transition && (
                        <div className="db-next-step">
                          <span className="db-next-flow">{job.status} → {nextStatus}</span>
                          {transition.allowed
                            ? <span className="db-next-ok">✓ ready</span>
                            : <span className="db-next-err">✗ blocked</span>
                          }
                        </div>
                      )}
                      {!transition && (
                        <div className="db-next-step">
                          <span style={{ color: "#475569", fontSize: 12 }}>Terminal state</span>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Sidebar */}
            <div className="db-sidebar">
              {/* Workers card */}
              <div className="db-card">
                <div className="db-card-head">
                  <span className="db-card-title">Workers</span>
                  <span className="db-card-count">{demoWorkers.length} active</span>
                </div>
                {demoWorkers.map((worker) => {
                  const sc = skillColors[worker.skill] ?? { bg: "rgba(255,255,255,0.05)", color: "#94a3b8" };
                  const avatarColors = ["linear-gradient(135deg,#6366f1,#8b5cf6)", "linear-gradient(135deg,#3b82f6,#06b6d4)", "linear-gradient(135deg,#f59e0b,#ef4444)"];
                  const avatarGrad = avatarColors[demoWorkers.indexOf(worker) % avatarColors.length];
                  return (
                    <div key={worker.id} className="db-worker">
                      <div className="db-worker-avatar" style={{ background: avatarGrad }}>
                        {worker.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p className="db-worker-name">{worker.name}</p>
                        <p className="db-worker-area">{worker.serviceArea}</p>
                      </div>
                      <div className="db-worker-skill-wrap">
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 5, background: sc.bg, color: sc.color }}>
                          {worker.skill}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* System status */}
              <div className="db-info-card">
                <p className="db-info-title">System Status</p>
                <div className="db-info-item">
                  <span className="db-info-dot" style={{ background: "#22c55e" }} />
                  <span>Vapi AI agent live — handles inbound calls end-to-end</span>
                </div>
                <div className="db-info-item">
                  <span className="db-info-dot" style={{ background: "#22c55e" }} />
                  <span>Supabase schema with full job state machine active</span>
                </div>
                <div className="db-info-item">
                  <span className="db-info-dot" style={{ background: "#22c55e" }} />
                  <span>WhatsApp &amp; SMS delivery via Twilio confirmed working</span>
                </div>
                <div className="db-info-item">
                  <span className="db-info-dot" style={{ background: "#f59e0b" }} />
                  <span>Slot reservations auto-expire after {appConfig.reservationHoldMinutes} minutes</span>
                </div>
                <div className="db-info-item" style={{ marginBottom: 0 }}>
                  <span className="db-info-dot" />
                  <span>Stripe checkout integrated for callout-fee payment</span>
                </div>
              </div>

              {/* CTA */}
              <a href="tel:+441392321255" className="db-cta">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" /></svg>
                Call +44 1392 321255
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
