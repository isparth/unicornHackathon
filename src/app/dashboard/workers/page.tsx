"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Worker {
  id: string;
  name: string;
  skill: string | null;
  service_area: string | null;
  active: boolean;
  created_at: string;
}

interface WorkerFormState {
  name: string;
  skill: string;
  serviceArea: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SKILL_CFG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  plumbing:   { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.25)",  label: "Plumbing"   },
  heating:    { color: "#fb923c", bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.25)",  label: "Heating"    },
  electrical: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.25)",  label: "Electrical" },
};

const AVATAR_GRADS = [
  "linear-gradient(135deg, #6366f1, #8b5cf6)",
  "linear-gradient(135deg, #3b82f6, #06b6d4)",
  "linear-gradient(135deg, #f59e0b, #ef4444)",
  "linear-gradient(135deg, #10b981, #06b6d4)",
  "linear-gradient(135deg, #ec4899, #8b5cf6)",
  "linear-gradient(135deg, #f97316, #fbbf24)",
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const EMPTY_FORM: WorkerFormState = { name: "", skill: "plumbing", serviceArea: "" };

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<WorkerFormState>(EMPTY_FORM);
  const [addLoading, setAddLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<WorkerFormState>(EMPTY_FORM);
  const [editLoading, setEditLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchWorkers = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/workers");
      const data = await res.json();
      if (data.workers) setWorkers(data.workers);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
  }, [fetchWorkers]);

  async function handleAddWorker(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    setAddLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/dashboard/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          skill: addForm.skill,
          serviceArea: addForm.serviceArea.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.error) { setErrorMsg(data.error); return; }
      await fetchWorkers();
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to add worker");
    } finally {
      setAddLoading(false);
    }
  }

  function startEdit(worker: Worker) {
    setEditId(worker.id);
    setEditForm({
      name: worker.name,
      skill: worker.skill ?? "plumbing",
      serviceArea: worker.service_area ?? "",
    });
  }

  async function handleEditWorker(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/dashboard/workers/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          skill: editForm.skill,
          serviceArea: editForm.serviceArea.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.error) { setErrorMsg(data.error); return; }
      await fetchWorkers();
      setEditId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update worker");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggleActive(worker: Worker) {
    try {
      await fetch(`/api/dashboard/workers/${worker.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !worker.active }),
      });
      await fetchWorkers();
    } catch {
      // silently fail
    }
  }

  const activeCount = workers.filter((w) => w.active).length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');

        .wk-page {
          min-height: 100vh;
          background: #080c14;
          color: #e2e8f0;
          font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
          padding: 0 0 80px;
        }

        /* Header */
        .wk-header {
          padding: 28px 32px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .wk-title-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .wk-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.025em;
          margin: 0;
          color: #f1f5f9;
        }
        .wk-meta {
          font-size: 12px;
          color: #475569;
          font-family: 'DM Mono', monospace;
        }

        .wk-add-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none;
          border-radius: 9px;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: opacity 0.15s, transform 0.1s;
          box-shadow: 0 4px 14px rgba(99,102,241,0.25);
        }
        .wk-add-btn:hover { opacity: 0.9; transform: translateY(-1px); }
        .wk-add-btn:active { transform: translateY(0); }

        /* Grid */
        .wk-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          padding: 24px 32px;
        }

        /* Worker card */
        .wk-card {
          background: #0f1623;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          overflow: hidden;
          transition: border-color 0.2s;
          position: relative;
        }
        .wk-card:hover { border-color: rgba(255,255,255,0.12); }
        .wk-card-inactive { opacity: 0.6; }

        .wk-card-body { padding: 20px; }

        .wk-avatar-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .wk-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .wk-toggle-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .wk-toggle-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .wk-toggle {
          width: 34px;
          height: 18px;
          border-radius: 9px;
          border: none;
          cursor: pointer;
          position: relative;
          transition: background 0.2s;
          flex-shrink: 0;
        }
        .wk-toggle::after {
          content: '';
          position: absolute;
          top: 2px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          transition: left 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .wk-toggle.on { background: #4ade80; }
        .wk-toggle.on::after { left: 18px; }
        .wk-toggle.off { background: rgba(255,255,255,0.1); }
        .wk-toggle.off::after { left: 2px; }

        .wk-worker-name {
          font-size: 16px;
          font-weight: 700;
          color: #f1f5f9;
          margin: 0 0 4px;
          letter-spacing: -0.01em;
        }
        .wk-worker-area {
          font-size: 12px;
          color: #475569;
          margin: 0 0 12px;
        }

        .wk-skill-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 9px;
          border-radius: 5px;
          border: 1px solid;
          letter-spacing: 0.03em;
        }

        .wk-card-footer {
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 10px 20px;
          display: flex;
          justify-content: flex-end;
        }
        .wk-edit-btn {
          font-size: 12px;
          font-weight: 600;
          color: #6366f1;
          background: none;
          border: none;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          padding: 4px 8px;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
        }
        .wk-edit-btn:hover { background: rgba(99,102,241,0.1); color: #818cf8; }

        /* Inline form */
        .wk-form-card {
          background: #0f1623;
          border: 1px solid rgba(99,102,241,0.3);
          border-radius: 14px;
          padding: 20px;
        }
        .wk-form-title {
          font-size: 13px;
          font-weight: 600;
          color: #a5b4fc;
          margin: 0 0 16px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .wk-form-group {
          margin-bottom: 12px;
        }
        .wk-form-label {
          display: block;
          font-size: 10.5px;
          font-weight: 600;
          color: #475569;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 5px;
        }
        .wk-form-input {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 8px 12px;
          color: #e2e8f0;
          font-size: 13px;
          font-family: 'DM Sans', sans-serif;
          transition: border-color 0.15s;
          box-sizing: border-box;
        }
        .wk-form-input:focus {
          outline: none;
          border-color: rgba(99,102,241,0.5);
          background: rgba(255,255,255,0.06);
        }
        .wk-form-select {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 8px 12px;
          color: #e2e8f0;
          font-size: 13px;
          font-family: 'DM Sans', sans-serif;
          transition: border-color 0.15s;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          padding-right: 30px;
        }
        .wk-form-select:focus { outline: none; border-color: rgba(99,102,241,0.5); }
        .wk-form-select option { background: #0f1623; color: #e2e8f0; }

        .wk-form-actions {
          display: flex;
          gap: 8px;
          margin-top: 14px;
        }
        .wk-form-save {
          flex: 1;
          padding: 9px 0;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none;
          border-radius: 8px;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: opacity 0.15s;
        }
        .wk-form-save:hover { opacity: 0.9; }
        .wk-form-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .wk-form-cancel {
          padding: 9px 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: #64748b;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: background 0.15s, color 0.15s;
        }
        .wk-form-cancel:hover { background: rgba(255,255,255,0.07); color: #94a3b8; }

        /* Error */
        .wk-error {
          margin: 0 32px 16px;
          padding: 10px 14px;
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.2);
          border-radius: 8px;
          color: #f87171;
          font-size: 12.5px;
        }

        /* Skeleton */
        .wk-skel {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 200% 100%;
          animation: wk-shimmer 1.4s infinite;
          border-radius: 6px;
        }
        @keyframes wk-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* Empty */
        .wk-empty {
          grid-column: 1 / -1;
          padding: 60px 32px;
          text-align: center;
        }
        .wk-empty-icon { font-size: 32px; margin-bottom: 12px; }
        .wk-empty-text { font-size: 14px; color: #334155; }

        @media (max-width: 1024px) {
          .wk-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .wk-grid { grid-template-columns: 1fr; padding: 16px; }
          .wk-header { padding: 20px 16px 16px; }
        }
      `}</style>

      <div className="wk-page">
        {/* Header */}
        <header className="wk-header">
          <div className="wk-title-row">
            <h1 className="wk-title">Workers</h1>
            {!loading && (
              <span className="wk-meta">{activeCount}/{workers.length} active</span>
            )}
          </div>
          <button className="wk-add-btn" onClick={() => { setShowAddForm(true); setEditId(null); setErrorMsg(null); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Worker
          </button>
        </header>

        {/* Error */}
        {errorMsg && <div className="wk-error">⚠ {errorMsg}</div>}

        {/* Grid */}
        <div className="wk-grid">
          {/* Add form */}
          {showAddForm && (
            <div className="wk-form-card">
              <p className="wk-form-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Worker
              </p>
              <form onSubmit={handleAddWorker}>
                <div className="wk-form-group">
                  <label className="wk-form-label">Name</label>
                  <input
                    className="wk-form-input"
                    type="text"
                    placeholder="Full name"
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    autoFocus
                  />
                </div>
                <div className="wk-form-group">
                  <label className="wk-form-label">Skill</label>
                  <select
                    className="wk-form-select"
                    value={addForm.skill}
                    onChange={(e) => setAddForm((f) => ({ ...f, skill: e.target.value }))}
                  >
                    <option value="plumbing">Plumbing</option>
                    <option value="heating">Heating</option>
                    <option value="electrical">Electrical</option>
                  </select>
                </div>
                <div className="wk-form-group">
                  <label className="wk-form-label">Service Area</label>
                  <input
                    className="wk-form-input"
                    type="text"
                    placeholder="e.g. Exeter, Devon"
                    value={addForm.serviceArea}
                    onChange={(e) => setAddForm((f) => ({ ...f, serviceArea: e.target.value }))}
                  />
                </div>
                <div className="wk-form-actions">
                  <button type="submit" className="wk-form-save" disabled={addLoading}>
                    {addLoading ? "Saving…" : "Add Worker"}
                  </button>
                  <button type="button" className="wk-form-cancel" onClick={() => { setShowAddForm(false); setErrorMsg(null); }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Loading skeletons */}
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="wk-card">
              <div className="wk-card-body">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                  <div className="wk-skel" style={{ width: 48, height: 48, borderRadius: "50%" }} />
                  <div className="wk-skel" style={{ width: 34, height: 18, borderRadius: 9 }} />
                </div>
                <div className="wk-skel" style={{ width: "65%", height: 16, marginBottom: 6 }} />
                <div className="wk-skel" style={{ width: "45%", height: 12, marginBottom: 12 }} />
                <div className="wk-skel" style={{ width: 70, height: 22, borderRadius: 5 }} />
              </div>
            </div>
          ))}

          {/* Empty */}
          {!loading && workers.length === 0 && !showAddForm && (
            <div className="wk-empty">
              <div className="wk-empty-icon">👷</div>
              <p className="wk-empty-text">No workers yet. Add your first worker to get started.</p>
            </div>
          )}

          {/* Worker cards */}
          {!loading && workers.map((worker, idx) => {
            const skillCfg = worker.skill ? (SKILL_CFG[worker.skill] ?? null) : null;
            const avatarGrad = AVATAR_GRADS[idx % AVATAR_GRADS.length];
            const isEditing = editId === worker.id;

            return (
              <div key={worker.id} className={`wk-card${!worker.active ? " wk-card-inactive" : ""}`}>
                {isEditing ? (
                  <div className="wk-card-body">
                    <form onSubmit={handleEditWorker}>
                      <p className="wk-form-title" style={{ color: "#94a3b8" }}>
                        Edit Worker
                      </p>
                      <div className="wk-form-group">
                        <label className="wk-form-label">Name</label>
                        <input
                          className="wk-form-input"
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="wk-form-group">
                        <label className="wk-form-label">Skill</label>
                        <select
                          className="wk-form-select"
                          value={editForm.skill}
                          onChange={(e) => setEditForm((f) => ({ ...f, skill: e.target.value }))}
                        >
                          <option value="plumbing">Plumbing</option>
                          <option value="heating">Heating</option>
                          <option value="electrical">Electrical</option>
                        </select>
                      </div>
                      <div className="wk-form-group">
                        <label className="wk-form-label">Service Area</label>
                        <input
                          className="wk-form-input"
                          type="text"
                          value={editForm.serviceArea}
                          onChange={(e) => setEditForm((f) => ({ ...f, serviceArea: e.target.value }))}
                        />
                      </div>
                      <div className="wk-form-actions">
                        <button type="submit" className="wk-form-save" disabled={editLoading}>
                          {editLoading ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="wk-form-cancel" onClick={() => { setEditId(null); setErrorMsg(null); }}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <>
                    <div className="wk-card-body">
                      <div className="wk-avatar-row">
                        <div className="wk-avatar" style={{ background: avatarGrad }}>
                          {getInitials(worker.name)}
                        </div>
                        <div className="wk-toggle-wrap">
                          <span className="wk-toggle-label" style={{ color: worker.active ? "#4ade80" : "#475569" }}>
                            {worker.active ? "Active" : "Off"}
                          </span>
                          <button
                            className={`wk-toggle ${worker.active ? "on" : "off"}`}
                            onClick={() => handleToggleActive(worker)}
                            aria-label={`Toggle ${worker.name} active status`}
                          />
                        </div>
                      </div>

                      <h3 className="wk-worker-name">{worker.name}</h3>
                      <p className="wk-worker-area">{worker.service_area ?? "No area set"}</p>

                      {skillCfg ? (
                        <span
                          className="wk-skill-badge"
                          style={{ color: skillCfg.color, background: skillCfg.bg, borderColor: skillCfg.border }}
                        >
                          {skillCfg.label}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#334155" }}>No skill set</span>
                      )}
                    </div>

                    <div className="wk-card-footer">
                      <button className="wk-edit-btn" onClick={() => startEdit(worker)}>
                        Edit →
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
