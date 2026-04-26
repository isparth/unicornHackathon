"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolLog = {
  id: string;
  tool_name: string;
  call_id: string | null;
  job_id: string | null;
  session_id: string | null;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
  success: boolean | null;
  duration_ms: number | null;
  created_at: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;
const MAX_LOGS = 200;

const TOOL_COLORS: Record<string, { bg: string; border: string; label: string; icon: string }> = {
  "create-call-session":    { bg: "rgba(99,102,241,0.12)",  border: "#6366f1", label: "create-call-session",    icon: "📞" },
  "classify-job":           { bg: "rgba(59,130,246,0.12)",  border: "#3b82f6", label: "classify-job",           icon: "🔍" },
  "price-job":              { bg: "rgba(245,158,11,0.12)",  border: "#f59e0b", label: "price-job",              icon: "💷" },
  "get-available-slots":    { bg: "rgba(139,92,246,0.12)",  border: "#8b5cf6", label: "get-available-slots",    icon: "📅" },
  "hold-slot":              { bg: "rgba(168,85,247,0.12)",  border: "#a855f7", label: "hold-slot",              icon: "🔒" },
  "create-payment-session": { bg: "rgba(34,197,94,0.12)",   border: "#22c55e", label: "create-payment-session", icon: "💳" },
  "check-form-status":      { bg: "rgba(20,184,166,0.12)",  border: "#14b8a6", label: "check-form-status",      icon: "📋" },
  "generate-intake-token":  { bg: "rgba(251,146,60,0.12)",  border: "#fb923c", label: "generate-intake-token",  icon: "🔑" },
  "summarise-call":         { bg: "rgba(236,72,153,0.12)",  border: "#ec4899", label: "summarise-call",         icon: "📝" },
};

function getToolMeta(name: string) {
  return TOOL_COLORS[name] ?? { bg: "rgba(100,116,139,0.12)", border: "#64748b", label: name, icon: "⚙️" };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return formatTime(iso);
}

function shortId(id: string | null) {
  if (!id) return null;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function prettyJson(obj: unknown) {
  return JSON.stringify(obj, null, 2);
}

// ─── Log Entry Component ──────────────────────────────────────────────────────

function LogEntry({ log, isNew }: { log: ToolLog; isNew: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getToolMeta(log.tool_name);
  const success = log.success !== false;

  return (
    <div
      className={`log-entry ${isNew ? "log-entry--new" : ""}`}
      style={{
        background: meta.bg,
        borderLeft: `3px solid ${success ? meta.border : "#ef4444"}`,
        borderRadius: "10px",
        padding: "12px 16px",
        cursor: "pointer",
        transition: "opacity 0.3s, transform 0.3s",
        animation: isNew ? "slideIn 0.35s ease" : "none",
      }}
      onClick={() => setExpanded((e) => !e)}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "18px" }}>{meta.icon}</span>
        <span style={{ fontWeight: 600, fontSize: "13px", color: "#e2e8f0", fontFamily: "monospace", letterSpacing: "0.01em" }}>
          {log.tool_name}
        </span>
        <span style={{
          fontSize: "11px",
          padding: "2px 8px",
          borderRadius: "999px",
          background: success ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: success ? "#86efac" : "#fca5a5",
          fontWeight: 600,
        }}>
          {success ? "OK" : "ERR"}
        </span>
        {log.duration_ms != null && (
          <span style={{ fontSize: "11px", color: "#64748b" }}>{log.duration_ms}ms</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: "11px", color: "#475569" }}>
          {formatRelative(log.created_at)}
        </span>
        <span style={{ fontSize: "11px", color: "#334155" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Quick metadata row */}
      <div style={{ display: "flex", gap: "12px", marginTop: "6px", flexWrap: "wrap" }}>
        {log.call_id && (
          <span style={{ fontSize: "11px", color: "#475569" }}>
            call <span style={{ color: "#7c8fa8", fontFamily: "monospace" }}>{shortId(log.call_id)}</span>
          </span>
        )}
        {log.job_id && (
          <span style={{ fontSize: "11px", color: "#475569" }}>
            job <span style={{ color: "#7c8fa8", fontFamily: "monospace" }}>{shortId(log.job_id)}</span>
          </span>
        )}
        {log.session_id && (
          <span style={{ fontSize: "11px", color: "#475569" }}>
            session <span style={{ color: "#7c8fa8", fontFamily: "monospace" }}>{shortId(log.session_id)}</span>
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <div>
            <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569", marginBottom: "4px" }}>Args</div>
            <pre style={{
              fontSize: "11px",
              background: "rgba(0,0,0,0.3)",
              borderRadius: "6px",
              padding: "10px",
              color: "#94a3b8",
              overflow: "auto",
              maxHeight: "200px",
              margin: 0,
              fontFamily: "monospace",
              lineHeight: 1.5,
            }}>{prettyJson(log.args)}</pre>
          </div>
          <div>
            <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569", marginBottom: "4px" }}>Result</div>
            <pre style={{
              fontSize: "11px",
              background: "rgba(0,0,0,0.3)",
              borderRadius: "6px",
              padding: "10px",
              color: success ? "#86efac" : "#fca5a5",
              overflow: "auto",
              maxHeight: "200px",
              margin: 0,
              fontFamily: "monospace",
              lineHeight: 1.5,
            }}>{prettyJson(log.result)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const [logs, setLogs] = useState<ToolLog[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [filter, setFilter] = useState<string>("all");
  const [filterCall, setFilterCall] = useState("");
  const [filterJob, setFilterJob] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async (since?: string) => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (since) params.set("since", since);
      if (filterCall.trim()) params.set("callId", filterCall.trim());
      if (filterJob.trim()) params.set("jobId", filterJob.trim());

      const res = await fetch(`/api/activity?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { success: boolean; logs: ToolLog[]; fetchedAt: string };

      if (!data.success) throw new Error("API error");

      setStatus("live");
      setLastFetch(data.fetchedAt);

      if (data.logs.length > 0) {
        const freshIds = new Set(data.logs.map((l) => l.id));
        setNewIds(freshIds);
        setTimeout(() => setNewIds(new Set()), 2500);

        setLogs((prev) => {
          // If this is an initial load (no since), replace all
          if (!since) return data.logs;
          // Merge: append new logs not already in prev
          const existingIds = new Set(prev.map((l) => l.id));
          const added = data.logs.filter((l) => !existingIds.has(l.id));
          const merged = [...prev, ...added];
          // Trim to MAX_LOGS
          return merged.slice(-MAX_LOGS);
        });
      }
    } catch (err) {
      console.error("[activity] fetch error:", err);
      setStatus("error");
    }
  }, [filterCall, filterJob]);

  // Initial load
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Polling
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      // Use the most recent log timestamp so we only fetch new ones
      setLogs((prev) => {
        const last = prev[prev.length - 1];
        void fetchLogs(last?.created_at);
        return prev;
      });
    }, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLogs]);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (autoScroll && newIds.size > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, newIds, autoScroll]);

  const toolNames = Array.from(new Set(logs.map((l) => l.tool_name))).sort();

  const visibleLogs = logs.filter((l) => {
    if (filter !== "all" && l.tool_name !== filter) return false;
    return true;
  });

  const totalSuccess = logs.filter((l) => l.success !== false).length;
  const totalError   = logs.filter((l) => l.success === false).length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #060a12; }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }

        .act-page { background: #060a12; min-height: 100vh; color: #f0f4ff; font-family: 'Inter', system-ui, sans-serif; }

        /* NAV */
        .act-nav { border-bottom: 1px solid rgba(255,255,255,0.06); padding: 14px 20px; background: rgba(6,10,18,0.95); position: sticky; top: 0; z-index: 100; backdrop-filter: blur(12px); }
        .act-nav-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .act-logo { display: flex; align-items: center; gap: 10px; }
        .act-logo-icon { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .act-logo-text { font-weight: 700; font-size: 16px; letter-spacing: -0.02em; }
        .act-nav-links { display: flex; align-items: center; gap: 8px; }
        .act-nav-link { font-size: 13px; color: #64748b; padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); text-decoration: none; transition: border-color 0.2s, color 0.2s; }
        .act-nav-link:hover { border-color: rgba(255,255,255,0.12); color: #94a3b8; }
        .act-nav-link--active { border-color: rgba(99,102,241,0.4); color: #a5b4fc; background: rgba(99,102,241,0.08); }

        /* STATUS DOT */
        .act-status { display: flex; align-items: center; gap: 6px; font-size: 12px; }
        .act-dot { width: 8px; height: 8px; border-radius: 50%; }
        .act-dot--live        { background: #22c55e; animation: pulse 2s infinite; }
        .act-dot--connecting  { background: #f59e0b; animation: pulse 1s infinite; }
        .act-dot--error       { background: #ef4444; }

        /* MAIN */
        .act-main { max-width: 1200px; margin: 0 auto; padding: 24px 20px 80px; }

        /* STATS BAR */
        .act-stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
        .act-stat { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px 16px; min-width: 100px; }
        .act-stat-value { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
        .act-stat-label { font-size: 11px; color: #475569; margin-top: 4px; }

        /* CONTROLS */
        .act-controls { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
        .act-input { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 7px 12px; color: #e2e8f0; font-size: 12px; font-family: monospace; outline: none; transition: border-color 0.2s; }
        .act-input::placeholder { color: #334155; }
        .act-input:focus { border-color: rgba(99,102,241,0.5); }
        .act-select { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 7px 12px; color: #94a3b8; font-size: 12px; outline: none; cursor: pointer; }
        .act-select option { background: #0f1624; }
        .act-btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 7px 12px; color: #94a3b8; font-size: 12px; cursor: pointer; transition: border-color 0.2s, color 0.2s; }
        .act-btn:hover { border-color: rgba(255,255,255,0.15); color: #e2e8f0; }
        .act-btn--active { border-color: rgba(99,102,241,0.4); color: #a5b4fc; background: rgba(99,102,241,0.08); }
        .act-spacer { flex: 1; }

        /* LOG LIST */
        .act-logs { display: flex; flex-direction: column; gap: 8px; }

        /* EMPTY */
        .act-empty { text-align: center; padding: 60px 20px; color: #334155; }
        .act-empty-icon { font-size: 40px; margin-bottom: 12px; }
        .act-empty-title { font-size: 15px; color: #475569; margin-bottom: 6px; }
        .act-empty-sub { font-size: 12px; }

        /* LAST FETCH */
        .act-last-fetch { font-size: 11px; color: #1e293b; margin-top: 16px; text-align: center; }

        /* SCROLL PILL */
        .act-scroll-pill { position: fixed; bottom: 24px; right: 24px; background: rgba(99,102,241,0.9); color: #fff; border: none; border-radius: 999px; padding: 8px 16px; font-size: 12px; cursor: pointer; font-family: inherit; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(99,102,241,0.4); transition: opacity 0.2s; }
        .act-scroll-pill:hover { opacity: 0.85; }

        @media (max-width: 640px) {
          .act-stats { gap: 8px; }
          .act-stat { min-width: 80px; padding: 10px 12px; }
          .act-stat-value { font-size: 20px; }
        }
      `}</style>

      <div className="act-page">
        {/* NAV */}
        <nav className="act-nav">
          <div className="act-nav-inner">
            <div className="act-logo">
              <div className="act-logo-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="act-logo-text">Unicorn</span>
            </div>

            <div className="act-nav-links">
              <Link href="/" className="act-nav-link">Home</Link>
              <Link href="/dashboard" className="act-nav-link">Dashboard</Link>
              <Link href="/activity" className="act-nav-link act-nav-link--active">Activity</Link>
            </div>

            <div className="act-status">
              <div className={`act-dot act-dot--${status}`} />
              <span style={{ color: status === "live" ? "#22c55e" : status === "error" ? "#ef4444" : "#f59e0b" }}>
                {status === "live" ? "Live" : status === "error" ? "Error" : "Connecting…"}
              </span>
            </div>
          </div>
        </nav>

        <main className="act-main">
          {/* Title */}
          <div style={{ marginBottom: "20px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: "4px" }}>
              Activity log
            </h1>
            <p style={{ fontSize: "13px", color: "#475569" }}>
              Real-time stream of every Vapi tool call — polled every {POLL_INTERVAL_MS / 1000}s
            </p>
          </div>

          {/* Stats */}
          <div className="act-stats">
            <div className="act-stat">
              <div className="act-stat-value" style={{ color: "#e2e8f0" }}>{logs.length}</div>
              <div className="act-stat-label">Total</div>
            </div>
            <div className="act-stat">
              <div className="act-stat-value" style={{ color: "#86efac" }}>{totalSuccess}</div>
              <div className="act-stat-label">Success</div>
            </div>
            <div className="act-stat">
              <div className="act-stat-value" style={{ color: "#fca5a5" }}>{totalError}</div>
              <div className="act-stat-label">Errors</div>
            </div>
            <div className="act-stat">
              <div className="act-stat-value" style={{ color: "#a5b4fc" }}>{new Set(logs.map((l) => l.call_id).filter(Boolean)).size}</div>
              <div className="act-stat-label">Calls</div>
            </div>
            <div className="act-stat">
              <div className="act-stat-value" style={{ color: "#c4b5fd" }}>{new Set(logs.map((l) => l.job_id).filter(Boolean)).size}</div>
              <div className="act-stat-label">Jobs</div>
            </div>
          </div>

          {/* Controls */}
          <div className="act-controls">
            <select
              className="act-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All tools</option>
              {toolNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>

            <input
              className="act-input"
              placeholder="Filter by call ID…"
              value={filterCall}
              onChange={(e) => setFilterCall(e.target.value)}
              style={{ width: "180px" }}
            />
            <input
              className="act-input"
              placeholder="Filter by job ID…"
              value={filterJob}
              onChange={(e) => setFilterJob(e.target.value)}
              style={{ width: "180px" }}
            />

            <div className="act-spacer" />

            <button
              className={`act-btn ${autoScroll ? "act-btn--active" : ""}`}
              onClick={() => setAutoScroll((v) => !v)}
            >
              {autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
            </button>
            <button
              className="act-btn"
              onClick={() => { setLogs([]); void fetchLogs(); }}
            >
              Clear
            </button>
          </div>

          {/* Log list */}
          <div className="act-logs">
            {visibleLogs.length === 0 ? (
              <div className="act-empty">
                <div className="act-empty-icon">📡</div>
                <div className="act-empty-title">No tool calls yet</div>
                <div className="act-empty-sub">
                  Make a call to <strong style={{ color: "#a5b4fc" }}>+441392321255</strong> — tool calls will appear here in real time
                </div>
              </div>
            ) : (
              visibleLogs.map((log) => (
                <LogEntry
                  key={log.id}
                  log={log}
                  isNew={newIds.has(log.id)}
                />
              ))
            )}
          </div>

          {lastFetch && (
            <div className="act-last-fetch">
              Last fetched {new Date(lastFetch).toLocaleTimeString("en-GB", { hour12: false })}
            </div>
          )}
          <div ref={bottomRef} />
        </main>

        {!autoScroll && (
          <button
            className="act-scroll-pill"
            onClick={() => {
              setAutoScroll(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            ↓ Jump to latest
          </button>
        )}
      </div>
    </>
  );
}
