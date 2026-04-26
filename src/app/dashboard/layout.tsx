"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Overview",
    exact: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/dashboard/jobs",
    label: "Jobs",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="15" y2="17" />
        <line x1="9" y1="9" x2="11" y2="9" />
      </svg>
    ),
  },
  {
    href: "/dashboard/workers",
    label: "Workers",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/dashboard/schedule",
    label: "Schedule",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: "/dashboard/payments",
    label: "Payments",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (item: (typeof NAV_ITEMS)[0]) => {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');

        .dbl-root {
          display: flex;
          min-height: 100vh;
          background: #080c14;
          font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
        }

        /* ── Sidebar ── */
        .dbl-sidebar {
          position: fixed;
          top: 0;
          left: 0;
          width: 220px;
          height: 100vh;
          background: #0a0e18;
          border-right: 1px solid rgba(255,255,255,0.06);
          display: flex;
          flex-direction: column;
          z-index: 50;
          overflow: hidden;
        }
        .dbl-sidebar::before {
          content: '';
          position: absolute;
          top: -80px;
          left: -40px;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%);
          pointer-events: none;
        }

        /* Logo */
        .dbl-logo-wrap {
          padding: 20px 18px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .dbl-logo-icon {
          width: 32px;
          height: 32px;
          border-radius: 9px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 4px 14px rgba(99,102,241,0.35);
        }
        .dbl-logo-text {
          font-family: 'DM Sans', sans-serif;
          font-weight: 700;
          font-size: 16px;
          letter-spacing: -0.02em;
          color: #e2e8f0;
        }
        .dbl-logo-tag {
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #4ade80;
          text-transform: uppercase;
          background: rgba(74,222,128,0.1);
          padding: 1px 5px;
          border-radius: 3px;
          margin-left: auto;
        }

        /* Nav section label */
        .dbl-nav-section {
          padding: 16px 18px 6px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: #334155;
          text-transform: uppercase;
        }

        /* Nav items */
        .dbl-nav {
          flex: 1;
          overflow-y: auto;
          padding: 8px 10px;
          scrollbar-width: none;
        }
        .dbl-nav::-webkit-scrollbar { display: none; }

        .dbl-nav-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          font-size: 13.5px;
          font-weight: 500;
          color: #475569;
          text-decoration: none;
          transition: background 0.15s, color 0.15s;
          margin-bottom: 1px;
          position: relative;
          white-space: nowrap;
        }
        .dbl-nav-item:hover {
          background: rgba(255,255,255,0.04);
          color: #94a3b8;
        }
        .dbl-nav-item.active {
          background: rgba(99,102,241,0.12);
          color: #a5b4fc;
        }
        .dbl-nav-item.active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 18px;
          background: #6366f1;
          border-radius: 0 2px 2px 0;
        }
        .dbl-nav-icon {
          flex-shrink: 0;
          opacity: 0.7;
        }
        .dbl-nav-item.active .dbl-nav-icon { opacity: 1; }
        .dbl-nav-item:hover .dbl-nav-icon { opacity: 0.9; }

        /* Bottom section */
        .dbl-bottom {
          padding: 14px 14px 18px;
          border-top: 1px solid rgba(255,255,255,0.05);
          flex-shrink: 0;
        }

        .dbl-callline {
          background: rgba(74,222,128,0.06);
          border: 1px solid rgba(74,222,128,0.15);
          border-radius: 10px;
          padding: 10px 12px;
          margin-bottom: 10px;
        }
        .dbl-callline-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 4px;
        }
        .dbl-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #4ade80;
          box-shadow: 0 0 0 2px rgba(74,222,128,0.25);
          animation: dbl-pulse 2s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes dbl-pulse {
          0%, 100% { box-shadow: 0 0 0 2px rgba(74,222,128,0.25); }
          50% { box-shadow: 0 0 0 5px rgba(74,222,128,0.1); }
        }
        .dbl-live-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #4ade80;
          text-transform: uppercase;
        }
        .dbl-callline-number {
          font-family: 'DM Mono', 'SF Mono', monospace;
          font-size: 12px;
          color: #94a3b8;
          letter-spacing: 0.02em;
        }

        .dbl-back-link {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #334155;
          padding: 6px 8px;
          border-radius: 7px;
          text-decoration: none;
          transition: color 0.15s, background 0.15s;
        }
        .dbl-back-link:hover {
          color: #64748b;
          background: rgba(255,255,255,0.03);
        }

        /* ── Main content ── */
        .dbl-main {
          margin-left: 220px;
          flex: 1;
          min-height: 100vh;
          overflow-y: auto;
          background: #080c14;
        }

        /* ── Mobile top bar ── */
        .dbl-mobile-bar {
          display: none;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: #0a0e18;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          position: sticky;
          top: 0;
          z-index: 40;
        }
        .dbl-mobile-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: 'DM Sans', sans-serif;
          font-weight: 700;
          font-size: 15px;
          color: #e2e8f0;
        }
        .dbl-hamburger {
          background: none;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 7px;
          padding: 6px 8px;
          cursor: pointer;
          color: #64748b;
          display: flex;
          align-items: center;
        }
        .dbl-hamburger:hover { border-color: rgba(255,255,255,0.2); color: #94a3b8; }

        /* Mobile nav drawer */
        .dbl-mobile-nav {
          display: none;
          flex-direction: column;
          background: #0a0e18;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding: 8px 10px 12px;
        }
        .dbl-mobile-nav.open { display: flex; }
        .dbl-mobile-nav .dbl-nav-item { font-size: 14px; padding: 10px 12px; }

        @media (max-width: 768px) {
          .dbl-sidebar { display: none; }
          .dbl-main { margin-left: 0; }
          .dbl-mobile-bar { display: flex; }
        }
      `}</style>

      <div className="dbl-root">
        {/* Fixed sidebar */}
        <aside className="dbl-sidebar">
          {/* Logo */}
          <div className="dbl-logo-wrap">
            <div className="dbl-logo-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <span className="dbl-logo-text">QuickFix</span>
            <span className="dbl-logo-tag">Live</span>
          </div>

          {/* Nav */}
          <nav className="dbl-nav">
            <div className="dbl-nav-section">Navigation</div>
            {NAV_ITEMS.map((item) => (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <Link
                key={item.href}
                href={item.href as any}
                className={`dbl-nav-item${isActive(item) ? " active" : ""}`}
              >
                <span className="dbl-nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Bottom */}
          <div className="dbl-bottom">
            <div className="dbl-callline">
              <div className="dbl-callline-header">
                <div className="dbl-live-dot" />
                <span className="dbl-live-label">Call line</span>
              </div>
              <div className="dbl-callline-number">+44 1392 321 255</div>
            </div>
            <Link href="/" className="dbl-back-link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back to site
            </Link>
          </div>
        </aside>

        {/* Main area */}
        <div className="dbl-main">
          {/* Mobile top bar */}
          <div className="dbl-mobile-bar">
            <div className="dbl-mobile-logo">
              <div className="dbl-logo-icon" style={{ width: 26, height: 26, borderRadius: 7 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              QuickFix
            </div>
            <button className="dbl-hamburger" onClick={() => setMobileOpen((p) => !p)} aria-label="Toggle menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {mobileOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="7" x2="21" y2="7" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="17" x2="21" y2="17" />
                  </>
                )}
              </svg>
            </button>
          </div>

          {/* Mobile nav drawer */}
          <div className={`dbl-mobile-nav${mobileOpen ? " open" : ""}`}>
            {NAV_ITEMS.map((item) => (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <Link
                key={item.href}
                href={item.href as any}
                className={`dbl-nav-item${isActive(item) ? " active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <span className="dbl-nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>

          {children}
        </div>
      </div>
    </>
  );
}
