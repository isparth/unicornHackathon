"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  status: string;
  job_category: string | null;
  urgency: string | null;
  problem_description: string | null;
  summary: string | null;
  amount_pence: number | null;
  payment_currency: string | null;
  payment_status: string | null;
  customer_name: string | null;
  worker_name: string | null;
  created_at: string;
}

interface ActivityLog {
  id: string;
  tool_name: string;
  success: boolean;
  duration_ms: number | null;
  created_at: string;
  job_id: string | null;
  args: Record<string, unknown> | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { color: string; bg: string; label: string; dot: string }> = {
  intake:           { color: "#818cf8", bg: "rgba(129,140,248,0.12)", label: "Intake",           dot: "#818cf8" },
  qualified:        { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  label: "Qualified",        dot: "#60a5fa" },
  priced:           { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  label: "Priced",           dot: "#fbbf24" },
  slot_held:        { color: "#a78bfa", bg: "rgba(167,139,250,0.12)", label: "Slot Held",        dot: "#a78bfa" },
  awaiting_payment: { color: "#fb923c", bg: "rgba(251,146,60,0.12)",  label: "Awaiting Payment", dot: "#fb923c" },
  confirmed:        { color: "#4ade80", bg: "rgba(74,222,128,0.12)",  label: "Confirmed",        dot: "#4ade80" },
  completed:        { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Completed",        dot: "#94a3b8" },
  expired:          { color: "#f87171", bg: "rgba(248,113,113,0.12)", label: "Expired",          dot: "#f87171" },
};

const TOOL_ICONS: Record<string, string> = {
  classify_job: "🏷️",
  price_job: "💰",
  hold_slot: "📅",
  create_payment_session: "💳",
  generate_intake_token: "🔗",
  summarise_call: "🎙️",
  check_form_status: "📋",
  get_available_slots: "🗓️",
  create_call_session: "📞",
};

function fmt(pence: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Live Activity Feed (Client Component) ────────────────────────────────────

function LiveActivityFeed() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=8");
      const data = await res.json();
      if (data.logs) setLogs(data.logs.slice().reverse());
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 5000);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  if (loading) {
    return (
      <div style={{ padding: "12px 0" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="ov-skel" style={{ width: 28, height: 28, borderRadius: 7 }} />
            <div style={{ flex: 1 }}>
              <div className="ov-skel" style={{ width: "55%", height: 11, borderRadius: 4, marginBottom: 5 }} />
              <div className="ov-skel" style={{ width: "30%", height: 9, borderRadius: 4 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div style={{ padding: "32px 18px", textAlign: "center", color: "#334155", fontSize: 13 }}>
        No recent activity
      </div>
    );
  }

  return (
    <div>
      {logs.map((log) => {
        const icon = TOOL_ICONS[log.tool_name] ?? "⚡";
        return (
          <div key={log.id} className="ov-activity-row">
            <div className="ov-activity-icon" style={{ background: log.success ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)" }}>
              <span style={{ fontSize: 13 }}>{icon}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, color: "#cbd5e1", fontWeight: 500 }}>
                  {log.tool_name.replace(/_/g, "_\u200B")}
                </span>
                <span style={{
                  fontSize: 9,
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 3,
                  letterSpacing: "0.06em",
                  background: log.success ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
                  color: log.success ? "#4ade80" : "#f87171",
                }}>
                  {log.success ? "OK" : "ERR"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                {log.duration_ms != null && <span style={{ fontFamily: "'DM Mono', monospace" }}>{log.duration_ms}ms</span>}
                {log.job_id && <span style={{ marginLeft: 6 }}>· job {log.job_id.slice(0, 8)}</span>}
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: "#334155", fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
              {timeAgo(log.created_at)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Dashboard Page ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [workers, setWorkers] = useState<{ id: string; active: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const [jobsRes, workersRes] = await Promise.all([
        fetch("/api/dashboard/jobs"),
        fetch("/api/dashboard/workers"),
      ]);
      const jobsData = await jobsRes.json();
      const workersData = await workersRes.json();
      if (jobsData.jobs) setJobs(jobsData.jobs);
      if (workersData.workers) setWorkers(workersData.workers);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    setNow(new Date());

    // Supabase realtime
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const channel = supabase
      .channel("overview-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        fetchData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const activeJobs = jobs.filter((j) => !["expired", "completed"].includes(j.status));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const confirmedToday = jobs.filter((j) => {
    if (j.status !== "confirmed") return false;
    const d = new Date(j.created_at);
    return d >= today;
  });
  const pendingPayment = jobs.filter((j) => j.payment_status === "pending" || j.status === "awaiting_payment");
  const activeWorkers = workers.filter((w) => w.active !== false);
  const recentJobs = jobs.slice(0, 6);

  const STATS = [
    { label: "Active Jobs", value: activeJobs.length, color: "#6366f1", icon: "📋" },
    { label: "Confirmed Today", value: confirmedToday.length, color: "#4ade80", icon: "✅" },
    { label: "Pending Payment", value: pendingPayment.length, color: "#fb923c", icon: "💳" },
    { label: "Active Workers", value: activeWorkers.length, color: "#60a5fa", icon: "👷" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');

        .ov-page {
          min-height: 100vh;
          background: #080c14;
          color: #e2e8f0;
          font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
          padding: 0 0 80px;
        }

        /* Header */
        .ov-header {
          padding: 32px 32px 0;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 24px;
        }
        .ov-eyebrow {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.12em;
          color: #6366f1;
          text-transform: uppercase;
          margin: 0 0 6px;
        }
        .ov-title {
          font-size: clamp(22px, 3vw, 30px);
          font-weight: 700;
          letter-spacing: -0.025em;
          margin: 0;
          color: #f1f5f9;
        }
        .ov-date {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: #475569;
          padding: 5px 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 6px;
        }

        /* Stats */
        .ov-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          padding: 24px 32px;
        }
        .ov-stat {
          background: #0f1623;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          padding: 18px 20px;
          position: relative;
          overflow: hidden;
          transition: border-color 0.2s;
        }
        .ov-stat:hover { border-color: rgba(255,255,255,0.12); }
        .ov-stat::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent-color);
          opacity: 0.7;
        }
        .ov-stat-icon {
          font-size: 18px;
          margin-bottom: 10px;
        }
        .ov-stat-val {
          font-family: 'DM Mono', monospace;
          font-size: 32px;
          font-weight: 500;
          line-height: 1;
          margin: 0 0 4px;
        }
        .ov-stat-label {
          font-size: 11.5px;
          color: #475569;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        /* Content grid */
        .ov-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 16px;
          padding: 0 32px;
        }

        /* Cards */
        .ov-card {
          background: #0f1623;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          overflow: hidden;
        }
        .ov-card-head {
          padding: 14px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ov-card-title {
          font-size: 13px;
          font-weight: 600;
          color: #cbd5e1;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ov-card-badge {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          color: #475569;
          background: rgba(255,255,255,0.04);
          padding: 2px 7px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.06);
        }
        .ov-card-link {
          font-size: 12px;
          color: #6366f1;
          text-decoration: none;
          transition: color 0.15s;
        }
        .ov-card-link:hover { color: #818cf8; }

        /* Job rows */
        .ov-job-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          text-decoration: none;
          color: inherit;
          transition: background 0.15s;
        }
        .ov-job-row:last-child { border-bottom: none; }
        .ov-job-row:hover { background: rgba(255,255,255,0.025); }
        .ov-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .ov-job-name {
          font-size: 13px;
          font-weight: 500;
          color: #e2e8f0;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .ov-job-cat {
          font-size: 11px;
          color: #475569;
          white-space: nowrap;
        }
        .ov-status-badge {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 4px;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .ov-job-price {
          font-family: 'DM Mono', monospace;
          font-size: 11.5px;
          color: #64748b;
          white-space: nowrap;
        }
        .ov-job-time {
          font-family: 'DM Mono', monospace;
          font-size: 10.5px;
          color: #334155;
          white-space: nowrap;
        }
        .ov-job-arrow {
          font-size: 12px;
          color: #334155;
          flex-shrink: 0;
        }

        /* Activity feed */
        .ov-activity-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.15s;
        }
        .ov-activity-row:last-child { border-bottom: none; }
        .ov-activity-row:hover { background: rgba(255,255,255,0.02); }
        .ov-activity-icon {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        /* Skeleton */
        .ov-skel {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 200% 100%;
          animation: ov-shimmer 1.4s infinite;
        }
        @keyframes ov-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Pipeline status bar */
        .ov-pipeline {
          display: flex;
          gap: 0;
          padding: 0 18px 14px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .ov-pipeline::-webkit-scrollbar { display: none; }
        .ov-pipe-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          flex: 1;
          min-width: 60px;
        }
        .ov-pipe-node {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .ov-pipe-connector {
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.07);
          margin-top: 4px;
          align-self: flex-start;
          margin-left: 4px;
        }
        .ov-pipe-label {
          font-size: 8.5px;
          color: #334155;
          text-align: center;
          font-weight: 500;
          letter-spacing: 0.04em;
        }

        /* Responsive */
        @media (max-width: 1024px) {
          .ov-stats { grid-template-columns: repeat(2, 1fr); }
          .ov-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .ov-header { padding: 20px 16px 16px; }
          .ov-stats { padding: 16px; gap: 10px; }
          .ov-grid { padding: 0 16px; }
          .ov-stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div className="ov-page">
        {/* Background glow */}
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
          <div style={{ position: "absolute", top: -120, right: "10%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)", filter: "blur(80px)" }} />
          <div style={{ position: "absolute", bottom: -80, left: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%)", filter: "blur(60px)" }} />
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Header */}
          <header className="ov-header">
            <div>
              <p className="ov-eyebrow">Operations Centre · Live</p>
              <h1 className="ov-title">QuickFix Operations</h1>
            </div>
            <div className="ov-date">
              {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
          </header>

          {/* Stats */}
          <div className="ov-stats">
            {loading
              ? STATS.map((s) => (
                  <div key={s.label} className="ov-stat" style={{ "--accent-color": s.color } as React.CSSProperties}>
                    <div className="ov-skel" style={{ width: 28, height: 28, borderRadius: 6, marginBottom: 10 }} />
                    <div className="ov-skel" style={{ width: 48, height: 30, borderRadius: 5, marginBottom: 6 }} />
                    <div className="ov-skel" style={{ width: "70%", height: 10, borderRadius: 4 }} />
                  </div>
                ))
              : STATS.map((s) => (
                  <div key={s.label} className="ov-stat" style={{ "--accent-color": s.color } as React.CSSProperties}>
                    <div className="ov-stat-icon">{s.icon}</div>
                    <div className="ov-stat-val" style={{ color: s.color }}>{s.value}</div>
                    <div className="ov-stat-label">{s.label}</div>
                  </div>
                ))}
          </div>

          {/* Job pipeline bar */}
          {!loading && jobs.length > 0 && (
            <div style={{ padding: "0 32px 20px" }}>
              <div style={{ background: "#0f1623", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 18px 10px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#334155", textTransform: "uppercase", marginBottom: 12 }}>
                  Job Pipeline
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
                  {(["intake","qualified","priced","slot_held","awaiting_payment","confirmed","completed","expired"] as const).map((s, i, arr) => {
                    const cfg = STATUS_CFG[s];
                    const count = jobs.filter(j => j.status === s).length;
                    return (
                      <div key={s} style={{ display: "flex", alignItems: "flex-start", flex: 1 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                          <div style={{
                            width: count > 0 ? 10 : 8,
                            height: count > 0 ? 10 : 8,
                            borderRadius: "50%",
                            background: count > 0 ? cfg.dot : "rgba(255,255,255,0.08)",
                            boxShadow: count > 0 ? `0 0 0 3px ${cfg.dot}25` : "none",
                            transition: "all 0.3s",
                          }} title={`${cfg.label}: ${count}`} />
                          <span style={{ fontSize: 8, color: count > 0 ? cfg.color : "#334155", fontWeight: 500, textAlign: "center", letterSpacing: "0.03em" }}>
                            {count > 0 ? count : ""}
                          </span>
                        </div>
                        {i < arr.length - 1 && <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)", marginTop: 5 }} />}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingRight: 0 }}>
                  {["intake","qualified","priced","slot held","awaiting","confirmed","completed","expired"].map((l) => (
                    <span key={l} style={{ fontSize: 7.5, color: "#334155", flex: 1, textAlign: "center", letterSpacing: "0.02em" }}>{l}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Main grid */}
          <div className="ov-grid">
            {/* Recent Jobs */}
            <div className="ov-card">
              <div className="ov-card-head">
                <span className="ov-card-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6366f1" }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="9" y1="13" x2="15" y2="13" />
                    <line x1="9" y1="17" x2="15" y2="17" />
                  </svg>
                  Recent Jobs
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="ov-card-badge">{jobs.length} total</span>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Link href={"/dashboard/jobs" as any} className="ov-card-link">View all →</Link>
                </div>
              </div>

              {loading ? (
                <div>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="ov-skel" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
                      <div className="ov-skel" style={{ flex: 1, height: 11, borderRadius: 4 }} />
                      <div className="ov-skel" style={{ width: 60, height: 11, borderRadius: 4 }} />
                    </div>
                  ))}
                </div>
              ) : recentJobs.length === 0 ? (
                <div style={{ padding: "40px 18px", textAlign: "center", color: "#334155", fontSize: 13 }}>
                  No jobs yet
                </div>
              ) : (
                recentJobs.map((job) => {
                  const cfg = STATUS_CFG[job.status] ?? STATUS_CFG.intake;
                  return (
                    <Link key={job.id} href={`/dashboard/jobs/${job.id}` as any} className="ov-job-row">
                      <div className="ov-status-dot" style={{ background: cfg.dot, boxShadow: `0 0 0 2px ${cfg.dot}30` }} />
                      <div className="ov-job-name">
                        {job.customer_name ?? "Unknown Customer"}
                      </div>
                      {job.job_category && <span className="ov-job-cat">{job.job_category}</span>}
                      <span
                        className="ov-status-badge"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.label}
                      </span>
                      {job.amount_pence != null && (
                        <span className="ov-job-price">{fmt(job.amount_pence, job.payment_currency ?? "GBP")}</span>
                      )}
                      <span className="ov-job-time">{timeAgo(job.created_at)}</span>
                      <span className="ov-job-arrow">›</span>
                    </Link>
                  );
                })
              )}
            </div>

            {/* Live Activity */}
            <div className="ov-card" style={{ height: "fit-content" }}>
              <div className="ov-card-head">
                <span className="ov-card-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  Live Activity
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", animation: "ov-pulse 2s infinite", boxShadow: "0 0 0 2px rgba(74,222,128,0.2)" }} />
                  <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600, letterSpacing: "0.06em" }}>LIVE</span>
                </div>
              </div>
              <style>{`@keyframes ov-pulse { 0%,100%{box-shadow:0 0 0 2px rgba(74,222,128,0.2)} 50%{box-shadow:0 0 0 5px rgba(74,222,128,0.08)} }`}</style>
              <LiveActivityFeed />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
