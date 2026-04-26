"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  worker_skill: string | null;
  created_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { color: string; bg: string; label: string; dot: string; border: string }> = {
  intake:           { color: "#818cf8", bg: "rgba(129,140,248,0.12)", label: "Intake",           dot: "#818cf8", border: "rgba(129,140,248,0.3)" },
  qualified:        { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  label: "Qualified",        dot: "#60a5fa", border: "rgba(96,165,250,0.3)"  },
  priced:           { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  label: "Priced",           dot: "#fbbf24", border: "rgba(251,191,36,0.3)"  },
  slot_held:        { color: "#a78bfa", bg: "rgba(167,139,250,0.12)", label: "Slot Held",        dot: "#a78bfa", border: "rgba(167,139,250,0.3)" },
  awaiting_payment: { color: "#fb923c", bg: "rgba(251,146,60,0.12)",  label: "Awaiting Payment", dot: "#fb923c", border: "rgba(251,146,60,0.3)"  },
  confirmed:        { color: "#4ade80", bg: "rgba(74,222,128,0.12)",  label: "Confirmed",        dot: "#4ade80", border: "rgba(74,222,128,0.3)"  },
  completed:        { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Completed",        dot: "#94a3b8", border: "rgba(148,163,184,0.3)" },
  expired:          { color: "#f87171", bg: "rgba(248,113,113,0.12)", label: "Expired",          dot: "#f87171", border: "rgba(248,113,113,0.3)" },
};

const URGENCY_CFG: Record<string, { color: string; label: string }> = {
  emergency: { color: "#f87171", label: "Emergency" },
  same_day:  { color: "#fbbf24", label: "Same Day"  },
  scheduled: { color: "#4ade80", label: "Scheduled" },
};

const FILTER_TABS = [
  { key: "all",             label: "All" },
  { key: "intake",          label: "Intake" },
  { key: "qualified",       label: "Qualified" },
  { key: "priced",          label: "Priced" },
  { key: "slot_held",       label: "Slot Held" },
  { key: "awaiting_payment",label: "Awaiting Payment" },
  { key: "confirmed",       label: "Confirmed" },
  { key: "completed",       label: "Completed" },
  { key: "expired",         label: "Expired" },
];

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");

  const fetchJobs = useCallback(async () => {
    try {
      const url = activeFilter === "all"
        ? "/api/dashboard/jobs"
        : `/api/dashboard/jobs?status=${activeFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.jobs) setJobs(data.jobs);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const timer = setInterval(fetchJobs, 10000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  // Supabase realtime
  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const channel = supabase
      .channel("jobs-list-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        fetchJobs();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchJobs]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');

        .jl-page {
          min-height: 100vh;
          background: #080c14;
          color: #e2e8f0;
          font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
          padding: 0 0 80px;
        }

        /* Header */
        .jl-header {
          padding: 28px 32px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .jl-title-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .jl-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.025em;
          margin: 0;
          color: #f1f5f9;
        }
        .jl-count-badge {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: #6366f1;
          background: rgba(99,102,241,0.12);
          border: 1px solid rgba(99,102,241,0.25);
          padding: 3px 10px;
          border-radius: 20px;
          font-weight: 500;
        }

        /* Filter tabs */
        .jl-filters {
          padding: 16px 32px;
          display: flex;
          gap: 6px;
          overflow-x: auto;
          scrollbar-width: none;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .jl-filters::-webkit-scrollbar { display: none; }
        .jl-filter-tab {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.02);
          color: #475569;
          transition: all 0.15s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .jl-filter-tab:hover {
          background: rgba(255,255,255,0.05);
          color: #94a3b8;
          border-color: rgba(255,255,255,0.12);
        }
        .jl-filter-tab.active {
          color: var(--tab-color);
          background: var(--tab-bg);
          border-color: var(--tab-border);
        }
        .jl-filter-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--tab-color);
          display: none;
        }
        .jl-filter-tab.active .jl-filter-dot { display: block; }

        /* Table header */
        .jl-table-head {
          display: grid;
          grid-template-columns: 1fr 130px 90px 110px 110px 80px 60px;
          gap: 0;
          padding: 10px 24px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: #334155;
          text-transform: uppercase;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        /* Job rows */
        .jl-job-row {
          display: grid;
          grid-template-columns: 1fr 130px 90px 110px 110px 80px 60px;
          gap: 0;
          padding: 0 24px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.15s;
          text-decoration: none;
          color: inherit;
          align-items: center;
          min-height: 54px;
        }
        .jl-job-row:hover { background: rgba(255,255,255,0.025); }
        .jl-job-row:last-child { border-bottom: none; }

        .jl-cell { display: flex; align-items: center; }
        .jl-cell-main { flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 0; }

        .jl-customer {
          font-size: 13.5px;
          font-weight: 600;
          color: #e2e8f0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .jl-category {
          font-size: 11.5px;
          color: #475569;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .jl-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 5px;
          letter-spacing: 0.03em;
          white-space: nowrap;
        }
        .jl-status-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .jl-urgency {
          font-size: 10.5px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 4px;
          white-space: nowrap;
        }

        .jl-price {
          font-family: 'DM Mono', monospace;
          font-size: 12.5px;
          color: #e2e8f0;
          font-weight: 500;
        }
        .jl-price-none { color: #334155; }

        .jl-worker {
          font-size: 12px;
          color: #64748b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .jl-worker-none { color: #334155; font-style: italic; }

        .jl-time {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #475569;
        }

        .jl-view-btn {
          font-size: 12px;
          color: #6366f1;
          font-weight: 600;
          white-space: nowrap;
          transition: color 0.15s;
        }
        .jl-job-row:hover .jl-view-btn { color: #818cf8; }

        /* Skeleton */
        .jl-skel {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 200% 100%;
          animation: jl-shimmer 1.4s infinite;
          border-radius: 4px;
        }
        @keyframes jl-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Empty state */
        .jl-empty {
          padding: 80px 32px;
          text-align: center;
        }
        .jl-empty-icon {
          font-size: 36px;
          margin-bottom: 16px;
        }
        .jl-empty-title {
          font-size: 16px;
          font-weight: 600;
          color: #475569;
          margin: 0 0 6px;
        }
        .jl-empty-sub {
          font-size: 13px;
          color: #334155;
        }

        @media (max-width: 900px) {
          .jl-table-head { display: none; }
          .jl-job-row {
            grid-template-columns: 1fr auto;
            gap: 8px;
            padding: 12px 16px;
          }
          .jl-cell:not(.jl-cell-main):not(:last-child):not(.jl-status-cell) { display: none; }
          .jl-header { padding: 20px 16px 16px; }
          .jl-filters { padding: 12px 16px; }
        }
      `}</style>

      <div className="jl-page">
        {/* Header */}
        <header className="jl-header">
          <div className="jl-title-row">
            <h1 className="jl-title">Jobs</h1>
            {!loading && <span className="jl-count-badge">{jobs.length}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 0 3px rgba(74,222,128,0.15)", animation: "jl-glow 2s infinite" }} />
            <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600, letterSpacing: "0.06em" }}>LIVE</span>
            <style>{`@keyframes jl-glow { 0%,100%{box-shadow:0 0 0 3px rgba(74,222,128,0.15)} 50%{box-shadow:0 0 0 6px rgba(74,222,128,0.06)} }`}</style>
          </div>
        </header>

        {/* Filter tabs */}
        <div className="jl-filters">
          {FILTER_TABS.map((tab) => {
            const cfg = STATUS_CFG[tab.key] ?? null;
            const isActive = activeFilter === tab.key;
            const style = cfg && isActive ? {
              "--tab-color": cfg.color,
              "--tab-bg": cfg.bg,
              "--tab-border": cfg.border,
            } as React.CSSProperties : {};
            const allStyle = tab.key === "all" && isActive ? {
              "--tab-color": "#6366f1",
              "--tab-bg": "rgba(99,102,241,0.12)",
              "--tab-border": "rgba(99,102,241,0.3)",
            } as React.CSSProperties : {};
            return (
              <button
                key={tab.key}
                className={`jl-filter-tab${isActive ? " active" : ""}`}
                style={{ ...style, ...allStyle }}
                onClick={() => setActiveFilter(tab.key)}
              >
                {cfg && <div className="jl-filter-dot" style={{ "--tab-color": cfg.color } as React.CSSProperties} />}
                {!cfg && isActive && <div className="jl-filter-dot" style={{ background: "#6366f1" }} />}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div>
          {/* Table header (desktop) */}
          <div className="jl-table-head">
            <span>Customer</span>
            <span>Status</span>
            <span>Urgency</span>
            <span>Price</span>
            <span>Worker</span>
            <span>Created</span>
            <span></span>
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ flex: 1 }}>
                    <div className="jl-skel" style={{ width: "45%", height: 13, marginBottom: 6 }} />
                    <div className="jl-skel" style={{ width: "25%", height: 10 }} />
                  </div>
                  <div className="jl-skel" style={{ width: 90, height: 22, borderRadius: 5 }} />
                  <div className="jl-skel" style={{ width: 65, height: 20, borderRadius: 4 }} />
                  <div className="jl-skel" style={{ width: 70, height: 13 }} />
                  <div className="jl-skel" style={{ width: 90, height: 13 }} />
                  <div className="jl-skel" style={{ width: 50, height: 11 }} />
                  <div className="jl-skel" style={{ width: 40, height: 11 }} />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && jobs.length === 0 && (
            <div className="jl-empty">
              <div className="jl-empty-icon">📭</div>
              <p className="jl-empty-title">No jobs {activeFilter !== "all" ? `with status "${STATUS_CFG[activeFilter]?.label ?? activeFilter}"` : ""}</p>
              <p className="jl-empty-sub">Jobs will appear here when created via the AI call agent.</p>
            </div>
          )}

          {/* Job rows */}
          {!loading && jobs.map((job) => {
            const cfg = STATUS_CFG[job.status] ?? STATUS_CFG.intake;
            const urgency = job.urgency ? URGENCY_CFG[job.urgency] : null;

            return (
              <Link key={job.id} href={`/dashboard/jobs/${job.id}` as any} className="jl-job-row">
                {/* Customer + category */}
                <div className="jl-cell jl-cell-main">
                  <span className="jl-customer">{job.customer_name ?? "Unknown Customer"}</span>
                  {job.job_category && (
                    <span className="jl-category">
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#334155", display: "inline-block" }} />
                      {job.job_category}
                    </span>
                  )}
                </div>

                {/* Status */}
                <div className="jl-cell jl-status-cell">
                  <span
                    className="jl-status-badge"
                    style={{ background: cfg.bg, color: cfg.color }}
                  >
                    <span className="jl-status-dot" style={{ background: cfg.dot }} />
                    {cfg.label}
                  </span>
                </div>

                {/* Urgency */}
                <div className="jl-cell">
                  {urgency ? (
                    <span className="jl-urgency" style={{ color: urgency.color, background: `${urgency.color}18` }}>
                      {urgency.label}
                    </span>
                  ) : (
                    <span style={{ color: "#334155", fontSize: 11 }}>—</span>
                  )}
                </div>

                {/* Price */}
                <div className="jl-cell">
                  {job.amount_pence != null ? (
                    <span className="jl-price">{fmt(job.amount_pence, job.payment_currency ?? "GBP")}</span>
                  ) : (
                    <span className="jl-price jl-price-none">—</span>
                  )}
                </div>

                {/* Worker */}
                <div className="jl-cell">
                  <span className={`jl-worker${!job.worker_name ? " jl-worker-none" : ""}`}>
                    {job.worker_name ?? "Unassigned"}
                  </span>
                </div>

                {/* Time */}
                <div className="jl-cell">
                  <span className="jl-time">{timeAgo(job.created_at)}</span>
                </div>

                {/* Action */}
                <div className="jl-cell" style={{ justifyContent: "flex-end" }}>
                  <span className="jl-view-btn">View →</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
