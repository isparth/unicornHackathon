"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Payment {
  id: string;
  job_id: string;
  status: string;
  amount_pence: number | null;
  currency: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string;
  job_category: string | null;
  urgency: string | null;
  job_status: string | null;
  customer_name: string | null;
  slot_starts_at: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAY_STATUS_CFG: Record<string, { color: string; bg: string; border: string; label: string; dot: string }> = {
  paid:    { color: "#4ade80", bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.3)",  label: "Paid",    dot: "#4ade80" },
  pending: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.3)",  label: "Pending", dot: "#fbbf24" },
  failed:  { color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)", label: "Failed",  dot: "#f87171" },
  expired: { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.2)", label: "Expired", dot: "#94a3b8" },
};

const FILTER_TABS = [
  { key: "all",     label: "All" },
  { key: "paid",    label: "Paid" },
  { key: "pending", label: "Pending" },
  { key: "failed",  label: "Failed" },
  { key: "expired", label: "Expired" },
];

function fmt(pence: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const fetchPayments = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/payments");
      const data = await res.json();
      if (data.payments) setPayments(data.payments);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  // Filtered
  const filtered = filter === "all" ? payments : payments.filter((p) => p.status === filter);

  // Stats
  const totalRevenue = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + (p.amount_pence ?? 0), 0);
  const pendingCount = payments.filter((p) => p.status === "pending").length;
  const failedCount = payments.filter((p) => p.status === "failed").length;
  const paidCount = payments.filter((p) => p.status === "paid").length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');

        .py-page {
          min-height: 100vh;
          background: #080c14;
          color: #e2e8f0;
          font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
          padding: 0 0 80px;
        }

        /* Header */
        .py-header {
          padding: 28px 32px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .py-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.025em;
          margin: 0;
          color: #f1f5f9;
        }

        /* Stats row */
        .py-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          padding: 20px 32px;
        }
        .py-stat {
          background: #0f1623;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          padding: 16px 18px;
          position: relative;
          overflow: hidden;
        }
        .py-stat::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent);
          opacity: 0.8;
        }
        .py-stat-label {
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #475569;
          margin-bottom: 8px;
        }
        .py-stat-val {
          font-family: 'DM Mono', monospace;
          font-size: 26px;
          font-weight: 500;
          line-height: 1;
          margin: 0;
        }
        .py-stat-sub {
          font-size: 11px;
          color: #334155;
          margin-top: 4px;
        }

        /* Filter tabs */
        .py-filters {
          padding: 16px 32px;
          display: flex;
          gap: 6px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          overflow-x: auto;
          scrollbar-width: none;
        }
        .py-filters::-webkit-scrollbar { display: none; }
        .py-filter-tab {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 14px;
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
        .py-filter-tab:hover { background: rgba(255,255,255,0.05); color: #94a3b8; border-color: rgba(255,255,255,0.12); }
        .py-filter-tab.active {
          background: var(--tab-bg);
          color: var(--tab-color);
          border-color: var(--tab-border);
        }
        .py-filter-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--tab-color);
          display: none;
        }
        .py-filter-tab.active .py-filter-dot { display: block; }

        /* Table head */
        .py-table-head {
          display: grid;
          grid-template-columns: 1fr 120px 100px 110px 140px 70px;
          padding: 10px 24px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: #334155;
          text-transform: uppercase;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        /* Payment rows */
        .py-row {
          display: grid;
          grid-template-columns: 1fr 120px 100px 110px 140px 70px;
          padding: 0 24px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          min-height: 52px;
          align-items: center;
          transition: background 0.15s;
        }
        .py-row:hover { background: rgba(255,255,255,0.025); }
        .py-row:last-child { border-bottom: none; }

        .py-cell { display: flex; align-items: center; }
        .py-cell-main { flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 0; }

        .py-customer {
          font-size: 13.5px;
          font-weight: 600;
          color: #e2e8f0;
        }
        .py-category {
          font-size: 11px;
          color: #475569;
        }

        .py-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 5px;
          letter-spacing: 0.03em;
        }
        .py-status-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }

        .py-amount {
          font-family: 'DM Mono', monospace;
          font-size: 14px;
          font-weight: 500;
          color: #e2e8f0;
        }
        .py-amount-zero { color: #334155; }

        .py-slot {
          font-size: 12px;
          color: #64748b;
        }
        .py-slot-none { color: #334155; }

        .py-stripe {
          font-family: 'DM Mono', monospace;
          font-size: 10.5px;
          color: #475569;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .py-stripe-none { color: #1e293b; }

        .py-date {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #475569;
        }

        /* Skeleton */
        .py-skel {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 200% 100%;
          animation: py-shimmer 1.4s infinite;
          border-radius: 4px;
        }
        @keyframes py-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Empty */
        .py-empty {
          padding: 70px 32px;
          text-align: center;
        }
        .py-empty-icon { font-size: 32px; margin-bottom: 12px; }
        .py-empty-text { font-size: 14px; color: #334155; }

        @media (max-width: 900px) {
          .py-stats { grid-template-columns: repeat(2, 1fr); }
          .py-table-head { display: none; }
          .py-row {
            grid-template-columns: 1fr auto;
            gap: 8px;
            padding: 12px 16px;
          }
          .py-cell:not(.py-cell-main):not(:last-child) { display: none; }
          .py-header { padding: 20px 16px 16px; }
          .py-filters { padding: 12px 16px; }
          .py-stats { padding: 16px; }
        }
        @media (max-width: 600px) {
          .py-stats { grid-template-columns: 1fr 1fr; gap: 10px; }
        }
      `}</style>

      <div className="py-page">
        {/* Header */}
        <header className="py-header">
          <h1 className="py-title">Payments</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {!loading && (
              <>
                <span style={{ fontSize: 12, color: "#475569", fontFamily: "'DM Mono', monospace" }}>
                  {payments.length} total
                </span>
              </>
            )}
          </div>
        </header>

        {/* Stats row */}
        <div className="py-stats">
          {loading ? (
            [1,2,3,4].map((i) => (
              <div key={i} className="py-stat" style={{ "--accent": "rgba(255,255,255,0.08)" } as React.CSSProperties}>
                <div className="py-skel" style={{ width: "60%", height: 10, marginBottom: 10 }} />
                <div className="py-skel" style={{ width: "45%", height: 24 }} />
              </div>
            ))
          ) : (
            <>
              <div className="py-stat" style={{ "--accent": "#4ade80" } as React.CSSProperties}>
                <div className="py-stat-label">Total Revenue</div>
                <div className="py-stat-val" style={{ color: "#4ade80" }}>
                  {fmt(totalRevenue)}
                </div>
                <div className="py-stat-sub">{paidCount} paid payment{paidCount !== 1 ? "s" : ""}</div>
              </div>
              <div className="py-stat" style={{ "--accent": "#fbbf24" } as React.CSSProperties}>
                <div className="py-stat-label">Pending</div>
                <div className="py-stat-val" style={{ color: "#fbbf24" }}>{pendingCount}</div>
                <div className="py-stat-sub">Awaiting payment</div>
              </div>
              <div className="py-stat" style={{ "--accent": "#f87171" } as React.CSSProperties}>
                <div className="py-stat-label">Failed</div>
                <div className="py-stat-val" style={{ color: "#f87171" }}>{failedCount}</div>
                <div className="py-stat-sub">Need attention</div>
              </div>
              <div className="py-stat" style={{ "--accent": "#6366f1" } as React.CSSProperties}>
                <div className="py-stat-label">All Payments</div>
                <div className="py-stat-val" style={{ color: "#6366f1" }}>{payments.length}</div>
                <div className="py-stat-sub">Lifetime</div>
              </div>
            </>
          )}
        </div>

        {/* Filter tabs */}
        <div className="py-filters">
          {FILTER_TABS.map((tab) => {
            const cfg = PAY_STATUS_CFG[tab.key] ?? null;
            const isActive = filter === tab.key;
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
                className={`py-filter-tab${isActive ? " active" : ""}`}
                style={{ ...style, ...allStyle }}
                onClick={() => setFilter(tab.key)}
              >
                {cfg && <div className="py-filter-dot" style={{ "--tab-color": cfg.color } as React.CSSProperties} />}
                {!cfg && isActive && <div className="py-filter-dot" style={{ background: "#6366f1" }} />}
                {tab.label}
                {!loading && (
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, opacity: 0.6 }}>
                    {tab.key === "all"
                      ? payments.length
                      : payments.filter((p) => p.status === tab.key).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div>
          {/* Table header */}
          <div className="py-table-head">
            <span>Customer</span>
            <span>Status</span>
            <span>Amount</span>
            <span>Slot Date</span>
            <span>Stripe ID</span>
            <span>Created</span>
          </div>

          {/* Loading */}
          {loading && Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ flex: 1 }}>
                <div className="py-skel" style={{ width: "40%", height: 13, marginBottom: 5 }} />
                <div className="py-skel" style={{ width: "25%", height: 10 }} />
              </div>
              <div className="py-skel" style={{ width: 75, height: 22, borderRadius: 5 }} />
              <div className="py-skel" style={{ width: 65, height: 14 }} />
              <div className="py-skel" style={{ width: 80, height: 12 }} />
              <div className="py-skel" style={{ width: 120, height: 11 }} />
              <div className="py-skel" style={{ width: 60, height: 11 }} />
            </div>
          ))}

          {/* Empty state */}
          {!loading && filtered.length === 0 && (
            <div className="py-empty">
              <div className="py-empty-icon">💸</div>
              <p className="py-empty-text">
                No {filter !== "all" ? `${PAY_STATUS_CFG[filter]?.label ?? filter} ` : ""}payments yet
              </p>
            </div>
          )}

          {/* Rows */}
          {!loading && filtered.map((payment) => {
            const cfg = PAY_STATUS_CFG[payment.status] ?? PAY_STATUS_CFG.pending;
            return (
              <div key={payment.id} className="py-row">
                {/* Customer + category */}
                <div className="py-cell py-cell-main">
                  <span className="py-customer">{payment.customer_name ?? "Unknown"}</span>
                  {payment.job_category && <span className="py-category">{payment.job_category}</span>}
                </div>

                {/* Status */}
                <div className="py-cell">
                  <span
                    className="py-status-badge"
                    style={{ background: cfg.bg, color: cfg.color }}
                  >
                    <span className="py-status-dot" style={{ background: cfg.dot }} />
                    {cfg.label}
                  </span>
                </div>

                {/* Amount */}
                <div className="py-cell">
                  {payment.amount_pence != null ? (
                    <span className="py-amount">{fmt(payment.amount_pence, payment.currency ?? "GBP")}</span>
                  ) : (
                    <span className="py-amount py-amount-zero">—</span>
                  )}
                </div>

                {/* Slot date */}
                <div className="py-cell">
                  {payment.slot_starts_at ? (
                    <span className="py-slot">{fmtSlot(payment.slot_starts_at)}</span>
                  ) : (
                    <span className="py-slot py-slot-none">—</span>
                  )}
                </div>

                {/* Stripe ID */}
                <div className="py-cell">
                  {payment.stripe_checkout_session_id ? (
                    <span
                      className="py-stripe"
                      title={payment.stripe_checkout_session_id}
                    >
                      {payment.stripe_checkout_session_id.slice(0, 22)}…
                    </span>
                  ) : (
                    <span className="py-stripe py-stripe-none">—</span>
                  )}
                </div>

                {/* Date */}
                <div className="py-cell">
                  <span className="py-date">{fmtDate(payment.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
