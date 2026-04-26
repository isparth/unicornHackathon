"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduleEvent {
  id: string;
  job_id: string;
  status: string;
  job_category: string | null;
  urgency: string | null;
  customer_name: string | null;
  worker_id: string | null;
  worker_name: string | null;
  worker_skill: string | null;
  starts_at: string;
  ends_at: string | null;
  reservation_status: string | null;
}

interface Worker {
  id: string;
  name: string;
  skill: string | null;
  active: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  slot_held:        { color: "#a78bfa", bg: "rgba(167,139,250,0.15)", border: "rgba(167,139,250,0.3)", label: "Slot Held"        },
  awaiting_payment: { color: "#fb923c", bg: "rgba(251,146,60,0.15)",  border: "rgba(251,146,60,0.3)",  label: "Awaiting Payment" },
  confirmed:        { color: "#4ade80", bg: "rgba(74,222,128,0.15)",  border: "rgba(74,222,128,0.3)",  label: "Confirmed"        },
  completed:        { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.2)", label: "Completed"        },
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day; // Mon=start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(eventDate: Date, dayDate: Date): boolean {
  return (
    eventDate.getFullYear() === dayDate.getFullYear() &&
    eventDate.getMonth() === dayDate.getMonth() &&
    eventDate.getDate() === dayDate.getDate()
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/schedule");
      const data = await res.json();
      if (data.events) setEvents(data.events);
      if (data.workers) setWorkers(data.workers);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 7);

  // Filter events for current week
  const weekEvents = events.filter((e) => {
    const d = new Date(e.starts_at);
    return d >= weekStart && d < weekEnd;
  });

  // Filter by worker
  const filteredEvents = selectedWorker
    ? weekEvents.filter((e) => e.worker_id === selectedWorker)
    : weekEvents;

  // Workers who have events this week
  const activeWorkerIds = new Set(weekEvents.map((e) => e.worker_id).filter(Boolean));

  function prevWeek() { setWeekStart((d) => addDays(d, -7)); }
  function nextWeek() { setWeekStart((d) => addDays(d, 7)); }
  function goToday() { setWeekStart(getWeekStart(new Date())); }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');

        .sc-page {
          min-height: 100vh;
          background: #080c14;
          color: #e2e8f0;
          font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
          padding: 0 0 80px;
        }

        /* Header */
        .sc-header {
          padding: 28px 32px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .sc-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .sc-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.025em;
          margin: 0;
          color: #f1f5f9;
        }

        /* Week nav */
        .sc-week-nav {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sc-nav-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .sc-nav-btn:hover { background: rgba(255,255,255,0.08); color: #94a3b8; border-color: rgba(255,255,255,0.14); }
        .sc-week-label {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          color: #94a3b8;
          padding: 0 4px;
          min-width: 160px;
          text-align: center;
        }
        .sc-today-btn {
          padding: 5px 12px;
          border-radius: 7px;
          background: rgba(99,102,241,0.12);
          border: 1px solid rgba(99,102,241,0.25);
          color: #818cf8;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: all 0.15s;
        }
        .sc-today-btn:hover { background: rgba(99,102,241,0.2); }

        /* Worker filter pills */
        .sc-workers-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .sc-worker-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 12px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          color: #475569;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .sc-worker-pill:hover { background: rgba(255,255,255,0.06); color: #94a3b8; }
        .sc-worker-pill.active {
          background: rgba(99,102,241,0.12);
          border-color: rgba(99,102,241,0.3);
          color: #a5b4fc;
        }
        .sc-worker-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }

        /* Calendar grid */
        .sc-cal {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 1px;
          background: rgba(255,255,255,0.04);
          margin: 20px 32px;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.06);
        }

        /* Day column */
        .sc-day {
          background: #0f1623;
          min-height: 280px;
          display: flex;
          flex-direction: column;
        }
        .sc-day-head {
          padding: 10px 10px 8px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .sc-day-name {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #475569;
        }
        .sc-day-num {
          font-family: 'DM Mono', monospace;
          font-size: 18px;
          font-weight: 500;
          line-height: 1;
          color: #94a3b8;
        }
        .sc-day-num.today {
          color: #6366f1;
          background: rgba(99,102,241,0.12);
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
        }
        .sc-day-head.today { background: rgba(99,102,241,0.04); }

        /* Events in column */
        .sc-day-events {
          padding: 6px 6px;
          display: flex;
          flex-direction: column;
          gap: 5px;
          flex: 1;
        }
        .sc-event {
          border-radius: 7px;
          padding: 7px 9px;
          border-left: 2px solid;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          text-decoration: none;
          display: block;
        }
        .sc-event:hover { opacity: 0.85; transform: translateY(-1px); }
        .sc-event-customer {
          font-size: 11.5px;
          font-weight: 600;
          color: #e2e8f0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 2px;
        }
        .sc-event-category {
          font-size: 10px;
          color: #94a3b8;
          margin-bottom: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sc-event-time {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          opacity: 0.75;
        }
        .sc-event-worker {
          font-size: 9.5px;
          opacity: 0.7;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* No bookings */
        .sc-no-events {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10.5px;
          color: #1e293b;
          font-style: italic;
          padding: 16px 8px;
          text-align: center;
          letter-spacing: 0.02em;
        }

        /* Legend */
        .sc-legend {
          display: flex;
          gap: 14px;
          padding: 0 32px 16px;
          flex-wrap: wrap;
        }
        .sc-legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: #475569;
        }
        .sc-legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 2px;
        }

        /* Skeleton */
        .sc-skel {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 200% 100%;
          animation: sc-shimmer 1.4s infinite;
          border-radius: 6px;
        }
        @keyframes sc-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        @media (max-width: 900px) {
          .sc-cal { grid-template-columns: repeat(3, 1fr); margin: 16px; }
          .sc-header { padding: 20px 16px 16px; }
          .sc-legend { padding: 0 16px 12px; }
        }
        @media (max-width: 600px) {
          .sc-cal { grid-template-columns: repeat(2, 1fr); }
          .sc-day { min-height: 180px; }
        }
      `}</style>

      <div className="sc-page">
        {/* Header */}
        <header className="sc-header">
          <div className="sc-header-row">
            <h1 className="sc-title">Schedule</h1>
            <div className="sc-week-nav">
              <button className="sc-nav-btn" onClick={prevWeek} aria-label="Previous week">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="sc-week-label">
                {fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}
              </span>
              <button className="sc-nav-btn" onClick={nextWeek} aria-label="Next week">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
              <button className="sc-today-btn" onClick={goToday}>Today</button>
            </div>
          </div>

          {/* Worker filter pills */}
          <div className="sc-workers-row">
            <button
              className={`sc-worker-pill${selectedWorker === null ? " active" : ""}`}
              onClick={() => setSelectedWorker(null)}
            >
              All workers
            </button>
            {workers
              .filter((w) => activeWorkerIds.has(w.id) || !selectedWorker)
              .map((worker, i) => {
                const dotColors = ["#818cf8", "#60a5fa", "#fbbf24", "#4ade80", "#fb923c", "#a78bfa"];
                const color = dotColors[i % dotColors.length];
                return (
                  <button
                    key={worker.id}
                    className={`sc-worker-pill${selectedWorker === worker.id ? " active" : ""}`}
                    onClick={() => setSelectedWorker(selectedWorker === worker.id ? null : worker.id)}
                  >
                    <div className="sc-worker-dot" style={{ background: color }} />
                    {worker.name}
                  </button>
                );
              })}
          </div>
        </header>

        {/* Legend */}
        <div className="sc-legend">
          {Object.entries(STATUS_CFG).map(([key, cfg]) => (
            <div key={key} className="sc-legend-item">
              <div className="sc-legend-dot" style={{ background: cfg.color }} />
              {cfg.label}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="sc-cal">
          {weekDays.map((day, dayIdx) => {
            const dayEvents = filteredEvents.filter((e) => isSameDay(new Date(e.starts_at), day));
            const isToday = isSameDay(day, today);

            return (
              <div key={dayIdx} className="sc-day">
                <div className={`sc-day-head${isToday ? " today" : ""}`}>
                  <span className="sc-day-name">{DAY_NAMES[dayIdx]}</span>
                  <span className={`sc-day-num${isToday ? " today" : ""}`}>{day.getDate()}</span>
                </div>

                <div className="sc-day-events">
                  {loading ? (
                    <div className="sc-skel" style={{ width: "100%", height: 60, borderRadius: 7 }} />
                  ) : dayEvents.length === 0 ? (
                    <div className="sc-no-events">No bookings</div>
                  ) : (
                    dayEvents.map((event) => {
                      const cfg = STATUS_CFG[event.status] ?? STATUS_CFG.slot_held;
                      return (
                        <Link
                          key={event.id}
                          href={`/dashboard/jobs/${event.job_id}` as any}
                          className="sc-event"
                          style={{
                            background: cfg.bg,
                            borderLeftColor: cfg.color,
                          }}
                        >
                          <div className="sc-event-customer">
                            {event.customer_name ?? "Unknown"}
                          </div>
                          {event.job_category && (
                            <div className="sc-event-category" style={{ color: cfg.color }}>
                              {event.job_category}
                            </div>
                          )}
                          <div className="sc-event-time" style={{ color: cfg.color }}>
                            {fmtTime(event.starts_at)}
                            {event.ends_at ? ` – ${fmtTime(event.ends_at)}` : ""}
                          </div>
                          {event.worker_name && (
                            <div className="sc-event-worker" style={{ color: cfg.color }}>
                              👷 {event.worker_name}
                            </div>
                          )}
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        {!loading && (
          <div style={{ padding: "0 32px", fontSize: 12, color: "#334155", fontFamily: "'DM Mono', monospace" }}>
            {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""} this week
            {selectedWorker && workers.find((w) => w.id === selectedWorker) && (
              <span style={{ color: "#475569" }}>
                {" "}· {workers.find((w) => w.id === selectedWorker)!.name}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
