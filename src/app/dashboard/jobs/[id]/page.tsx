"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  status: string;
  job_category: string | null;
  urgency: string | null;
  problem_description: string | null;
  summary: string | null;
  transcript: string | null;
  customer_name: string | null;
  phone_number: string | null;
  address_line_1: string | null;
  city: string | null;
  postcode: string | null;
  worker_name: string | null;
  worker_skill: string | null;
  amount_pence: number | null;
  payment_currency: string | null;
  payment_status: string | null;
  stripe_checkout_session_id: string | null;
  reservation_status: string | null;
  reservation_starts_at: string | null;
  reservation_ends_at: string | null;
  intake_form_completed_at: string | null;
  created_at: string;
}

interface Photo {
  id: string;
  storage_path: string;
  file_name: string | null;
  content_type: string | null;
  created_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const URGENCY_CFG: Record<string, { color: string; label: string }> = {
  emergency: { color: "#f87171", label: "Emergency" },
  same_day:  { color: "#fbbf24", label: "Same Day"  },
  scheduled: { color: "#4ade80", label: "Scheduled" },
};

const PAY_CFG: Record<string, { color: string; label: string; bg: string }> = {
  paid:    { color: "#4ade80", label: "Paid",    bg: "rgba(74,222,128,0.12)"  },
  pending: { color: "#fbbf24", label: "Pending", bg: "rgba(251,191,36,0.12)"  },
  failed:  { color: "#f87171", label: "Failed",  bg: "rgba(248,113,113,0.12)" },
  expired: { color: "#94a3b8", label: "Expired", bg: "rgba(148,163,184,0.12)" },
};

const PIPELINE = ["intake", "qualified", "priced", "slot_held", "awaiting_payment", "confirmed", "completed"] as const;

function fmt(pence: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [job, setJob] = useState<Job | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await fetch(`/api/dashboard/jobs/${id}`);
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
        setJob(data.job);
        setPhotos(data.photos ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load job");
      } finally {
        setLoading(false);
      }
    }
    fetchJob();
  }, [id]);

  const statusCfg = job ? (STATUS_CFG[job.status] ?? STATUS_CFG.intake) : null;
  const urgencyCfg = job?.urgency ? URGENCY_CFG[job.urgency] : null;
  const payCfg = job?.payment_status ? (PAY_CFG[job.payment_status] ?? null) : null;
  const pipelineIdx = job ? PIPELINE.indexOf(job.status as (typeof PIPELINE)[number]) : -1;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');

        .jd-page {
          min-height: 100vh;
          background: #080c14;
          color: #e2e8f0;
          font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
          padding: 0 0 80px;
        }

        /* Header */
        .jd-header {
          padding: 24px 32px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .jd-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12.5px;
          color: #475569;
          text-decoration: none;
          margin-bottom: 14px;
          padding: 4px 0;
          transition: color 0.15s;
        }
        .jd-back:hover { color: #94a3b8; }
        .jd-header-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .jd-title {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin: 0 0 8px;
          color: #f1f5f9;
          text-transform: capitalize;
        }
        .jd-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .jd-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          letter-spacing: 0.03em;
        }
        .jd-badge-dot { width: 6px; height: 6px; border-radius: 50%; }
        .jd-id {
          font-family: 'DM Mono', monospace;
          font-size: 10.5px;
          color: #334155;
          margin-top: 4px;
        }

        /* Pipeline progress */
        .jd-pipeline {
          margin: 20px 32px 0;
          background: #0f1623;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px;
          padding: 14px 18px;
        }
        .jd-pipeline-label {
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: #334155;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .jd-pipeline-track {
          display: flex;
          align-items: center;
          position: relative;
        }
        .jd-pipe-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          position: relative;
        }
        .jd-pipe-node {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          z-index: 1;
          transition: all 0.3s;
        }
        .jd-pipe-connector {
          flex: 1;
          height: 2px;
          margin: 0 -1px;
        }
        .jd-pipe-label {
          font-size: 8px;
          margin-top: 5px;
          font-weight: 500;
          letter-spacing: 0.03em;
          text-align: center;
          line-height: 1.2;
        }

        /* Two-col layout */
        .jd-grid {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 20px;
          padding: 24px 32px;
        }
        .jd-left { display: flex; flex-direction: column; gap: 16px; }
        .jd-right { display: flex; flex-direction: column; gap: 16px; }

        /* Cards */
        .jd-card {
          background: #0f1623;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          overflow: hidden;
        }
        .jd-card-head {
          padding: 12px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .jd-card-title {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .jd-card-body { padding: 16px 18px; }

        /* Info rows */
        .jd-info-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 10px;
        }
        .jd-info-row:last-child { margin-bottom: 0; }
        .jd-info-key {
          font-size: 11px;
          color: #475569;
          min-width: 110px;
          padding-top: 2px;
          font-weight: 500;
          flex-shrink: 0;
        }
        .jd-info-val {
          font-size: 13px;
          color: #e2e8f0;
          font-weight: 500;
          word-break: break-word;
        }
        .jd-info-val-mono {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: #94a3b8;
          word-break: break-all;
        }
        .jd-info-pending {
          font-size: 12px;
          color: #334155;
          font-style: italic;
        }

        /* Summary text */
        .jd-summary-text {
          font-size: 13.5px;
          line-height: 1.65;
          color: #cbd5e1;
          margin: 0;
        }

        /* Transcript collapsible */
        .jd-transcript-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 18px;
          cursor: pointer;
          border-top: 1px solid rgba(255,255,255,0.06);
          font-size: 12px;
          font-weight: 600;
          color: #6366f1;
          transition: background 0.15s;
          background: none;
          border: none;
          border-top: 1px solid rgba(255,255,255,0.06);
          width: 100%;
          text-align: left;
        }
        .jd-transcript-toggle:hover { background: rgba(99,102,241,0.05); }
        .jd-transcript-body {
          padding: 14px 18px;
          border-top: 1px solid rgba(255,255,255,0.05);
        }
        .jd-transcript-text {
          font-family: 'DM Mono', monospace;
          font-size: 11.5px;
          line-height: 1.7;
          color: #64748b;
          white-space: pre-wrap;
          margin: 0;
          max-height: 300px;
          overflow-y: auto;
        }
        .jd-transcript-text::-webkit-scrollbar { width: 4px; }
        .jd-transcript-text::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

        /* Photos */
        .jd-photos-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          padding: 14px 18px;
        }
        .jd-photo-thumb {
          aspect-ratio: 4/3;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.07);
          transition: border-color 0.15s;
        }
        .jd-photo-thumb:hover { border-color: rgba(255,255,255,0.2); }
        .jd-photo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .jd-no-photos {
          padding: 24px 18px;
          text-align: center;
          color: #334155;
          font-size: 12.5px;
        }

        /* Skeleton */
        .jd-skel {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 200% 100%;
          animation: jd-shimmer 1.4s infinite;
          border-radius: 6px;
        }
        @keyframes jd-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        @media (max-width: 900px) {
          .jd-grid { grid-template-columns: 1fr; padding: 16px; }
          .jd-header { padding: 16px 16px 16px; }
          .jd-pipeline { margin: 12px 16px 0; }
        }
      `}</style>

      <div className="jd-page">
        {/* Header */}
        <header className="jd-header">
          <Link href={"/dashboard/jobs" as any} className="jd-back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Jobs
          </Link>

          {loading ? (
            <div>
              <div className="jd-skel" style={{ width: 220, height: 22, marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <div className="jd-skel" style={{ width: 90, height: 26 }} />
                <div className="jd-skel" style={{ width: 70, height: 26 }} />
              </div>
            </div>
          ) : error ? (
            <div style={{ color: "#f87171", fontSize: 14 }}>{error}</div>
          ) : job && (
            <div className="jd-header-row">
              <div>
                <h1 className="jd-title">
                  {job.job_category ?? "Job"}{" "}
                  <span style={{ fontWeight: 400, color: "#475569", fontSize: 16 }}>
                    {job.urgency ? `· ${URGENCY_CFG[job.urgency]?.label ?? job.urgency}` : ""}
                  </span>
                </h1>
                <div className="jd-badges">
                  {statusCfg && (
                    <span className="jd-badge" style={{ background: statusCfg.bg, color: statusCfg.color }}>
                      <span className="jd-badge-dot" style={{ background: statusCfg.dot, boxShadow: `0 0 0 2px ${statusCfg.dot}30` }} />
                      {statusCfg.label}
                    </span>
                  )}
                  {urgencyCfg && (
                    <span className="jd-badge" style={{ background: `${urgencyCfg.color}18`, color: urgencyCfg.color }}>
                      {urgencyCfg.label}
                    </span>
                  )}
                </div>
                <p className="jd-id">Job ID: {job.id}</p>
              </div>
              <div style={{ fontSize: 12, color: "#475569", textAlign: "right" }}>
                <div>Created {fmtDate(job.created_at)}</div>
                <div style={{ fontSize: 11, color: "#334155" }}>{fmtTime(job.created_at)}</div>
              </div>
            </div>
          )}
        </header>

        {/* Pipeline progress bar */}
        {!loading && job && (
          <div className="jd-pipeline">
            <div className="jd-pipeline-label">Status Pipeline</div>
            <div className="jd-pipeline-track">
              {PIPELINE.map((step, i) => {
                const cfg = STATUS_CFG[step];
                const isDone = pipelineIdx >= i;
                const isCurrent = pipelineIdx === i;
                return (
                  <div key={step} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                    <div className="jd-pipe-step">
                      <div
                        className="jd-pipe-node"
                        style={{
                          background: isDone ? cfg.dot : "rgba(255,255,255,0.08)",
                          boxShadow: isCurrent ? `0 0 0 3px ${cfg.dot}35` : "none",
                        }}
                        title={cfg.label}
                      />
                      <div className="jd-pipe-label" style={{ color: isDone ? cfg.color : "#334155" }}>
                        {step.replace("_", " ")}
                      </div>
                    </div>
                    {i < PIPELINE.length - 1 && (
                      <div
                        className="jd-pipe-connector"
                        style={{
                          background: pipelineIdx > i
                            ? `linear-gradient(90deg, ${STATUS_CFG[PIPELINE[i]].dot}, ${STATUS_CFG[PIPELINE[i+1]].dot})`
                            : "rgba(255,255,255,0.07)",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Two-column layout */}
        {loading ? (
          <div className="jd-grid">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[140, 120, 100].map((h, i) => (
                <div key={i} className="jd-card">
                  <div className="jd-card-head"><div className="jd-skel" style={{ width: 100, height: 11 }} /></div>
                  <div className="jd-card-body"><div className="jd-skel" style={{ width: "100%", height: h }} /></div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[100, 80, 100].map((h, i) => (
                <div key={i} className="jd-card">
                  <div className="jd-card-head"><div className="jd-skel" style={{ width: 80, height: 11 }} /></div>
                  <div className="jd-card-body"><div className="jd-skel" style={{ width: "100%", height: h }} /></div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? null : job && (
          <div className="jd-grid">
            {/* LEFT COLUMN */}
            <div className="jd-left">
              {/* Customer details */}
              <div className="jd-card">
                <div className="jd-card-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                  <span className="jd-card-title">Customer</span>
                </div>
                <div className="jd-card-body">
                  <div className="jd-info-row">
                    <span className="jd-info-key">Name</span>
                    {job.customer_name
                      ? <span className="jd-info-val">{job.customer_name}</span>
                      : <span className="jd-info-pending">Pending form</span>}
                  </div>
                  <div className="jd-info-row">
                    <span className="jd-info-key">Phone</span>
                    {job.phone_number
                      ? <span className="jd-info-val-mono">{job.phone_number}</span>
                      : <span className="jd-info-pending">Pending form</span>}
                  </div>
                  <div className="jd-info-row">
                    <span className="jd-info-key">Address</span>
                    {job.address_line_1
                      ? <span className="jd-info-val">
                          {job.address_line_1}
                          {job.city ? `, ${job.city}` : ""}
                          {job.postcode ? ` ${job.postcode}` : ""}
                        </span>
                      : <span className="jd-info-pending">Pending form</span>}
                  </div>
                  <div className="jd-info-row">
                    <span className="jd-info-key">Form status</span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: job.intake_form_completed_at ? "rgba(74,222,128,0.12)" : "rgba(251,191,36,0.1)",
                      color: job.intake_form_completed_at ? "#4ade80" : "#fbbf24",
                    }}>
                      {job.intake_form_completed_at ? "Completed" : "Pending"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Problem summary */}
              <div className="jd-card">
                <div className="jd-card-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="jd-card-title">Problem Summary</span>
                </div>
                <div className="jd-card-body">
                  {job.summary || job.problem_description ? (
                    <p className="jd-summary-text">{job.summary ?? job.problem_description}</p>
                  ) : (
                    <p style={{ color: "#334155", fontSize: 13, margin: 0, fontStyle: "italic" }}>
                      No summary yet — will be generated after the call.
                    </p>
                  )}
                </div>

                {/* Collapsible transcript */}
                {job.transcript && (
                  <>
                    <button className="jd-transcript-toggle" onClick={() => setTranscriptOpen(p => !p)}>
                      <span>📝 Call Transcript</span>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: transcriptOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {transcriptOpen && (
                      <div className="jd-transcript-body">
                        <pre className="jd-transcript-text">{job.transcript}</pre>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Price estimate */}
              <div className="jd-card">
                <div className="jd-card-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <span className="jd-card-title">Price Estimate</span>
                </div>
                <div className="jd-card-body">
                  {job.amount_pence != null ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 500, color: "#fbbf24", lineHeight: 1, marginBottom: 4 }}>
                          {fmt(job.amount_pence, job.payment_currency ?? "GBP")}
                        </div>
                        <div style={{ fontSize: 11, color: "#475569" }}>Total estimate</div>
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: "#334155", fontSize: 13, margin: 0, fontStyle: "italic" }}>
                      Not yet priced
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="jd-right">
              {/* Worker assignment */}
              <div className="jd-card">
                <div className="jd-card-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                  <span className="jd-card-title">Worker</span>
                </div>
                <div className="jd-card-body">
                  {job.worker_name ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{
                          width: 38,
                          height: 38,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#fff",
                          flexShrink: 0,
                        }}>
                          {job.worker_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{job.worker_name}</div>
                          {job.worker_skill && (
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, textTransform: "capitalize" }}>{job.worker_skill}</div>
                          )}
                        </div>
                      </div>
                      {job.reservation_starts_at && (
                        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "#334155", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Slot</div>
                          <div style={{ fontSize: 13, color: "#94a3b8", fontFamily: "'DM Mono', monospace" }}>
                            {fmtDate(job.reservation_starts_at)}
                          </div>
                          <div style={{ fontSize: 12, color: "#475569", fontFamily: "'DM Mono', monospace", marginTop: 2 }}>
                            {fmtTime(job.reservation_starts_at)}
                            {job.reservation_ends_at ? ` – ${fmtTime(job.reservation_ends_at)}` : ""}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ color: "#334155", fontSize: 12.5, margin: 0, fontStyle: "italic" }}>No worker assigned yet</p>
                  )}
                </div>
              </div>

              {/* Payment */}
              <div className="jd-card">
                <div className="jd-card-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                  <span className="jd-card-title">Payment</span>
                </div>
                <div className="jd-card-body">
                  {payCfg ? (
                    <>
                      <div className="jd-info-row">
                        <span className="jd-info-key">Status</span>
                        <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: 5, background: payCfg.bg, color: payCfg.color }}>
                          {payCfg.label}
                        </span>
                      </div>
                      {job.amount_pence != null && (
                        <div className="jd-info-row">
                          <span className="jd-info-key">Amount</span>
                          <span className="jd-info-val" style={{ fontFamily: "'DM Mono', monospace" }}>
                            {fmt(job.amount_pence, job.payment_currency ?? "GBP")}
                          </span>
                        </div>
                      )}
                      {job.stripe_checkout_session_id && (
                        <div className="jd-info-row">
                          <span className="jd-info-key">Stripe ID</span>
                          <span className="jd-info-val-mono" style={{ fontSize: 10.5 }}>
                            {job.stripe_checkout_session_id.slice(0, 24)}…
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ color: "#334155", fontSize: 12.5, margin: 0, fontStyle: "italic" }}>No payment record</p>
                  )}
                </div>
              </div>

              {/* Photos */}
              <div className="jd-card">
                <div className="jd-card-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span className="jd-card-title">Photos</span>
                  {photos.length > 0 && (
                    <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#475569", background: "rgba(255,255,255,0.04)", padding: "1px 7px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.06)" }}>
                      {photos.length}
                    </span>
                  )}
                </div>
                {photos.length > 0 ? (
                  <div className="jd-photos-grid">
                    {photos.map((photo) => {
                      const url = `${supabaseUrl}/storage/v1/object/public/job-photos/${photo.storage_path}`;
                      return (
                        <a key={photo.id} href={url} target="_blank" rel="noopener noreferrer" className="jd-photo-thumb">
                          <img
                            src={url}
                            alt={photo.file_name ?? "Job photo"}
                            className="jd-photo-img"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <div className="jd-no-photos">
                    <div style={{ fontSize: 24, marginBottom: 6 }}>📷</div>
                    No photos uploaded
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
