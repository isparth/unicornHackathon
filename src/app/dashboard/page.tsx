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
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(pence / 100);
}

export default function DashboardPage() {
  const activeJobs = demoJobs.filter(
    (job) => !["expired", "completed"].includes(job.status),
  );
  const confirmedJobs = demoJobs.filter((job) => job.status === "confirmed");

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="border-b-2 border-[#17201b] pb-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#2454a6]">
                {demoBusiness.serviceArea}
              </p>
              <h1 className="mt-2 text-4xl font-bold md:text-6xl">
                {demoBusiness.name}
              </h1>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <Metric
                label="Active jobs"
                value={activeJobs.length.toString()}
                tone="green"
              />
              <Metric
                label="Workers"
                value={demoWorkers.length.toString()}
                tone="blue"
              />
              <Metric
                label="Hold window"
                value={`${appConfig.reservationHoldMinutes}m`}
                tone="gold"
              />
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div className="border-2 border-[#17201b] bg-[#fffdf8]">
            <div className="flex items-center justify-between border-b-2 border-[#17201b] px-4 py-3">
              <h2 className="text-xl font-bold">Job State Machine</h2>
              <span className="text-sm text-[#64706a]">
                {demoJobs.length} demo jobs
              </span>
            </div>
            <div className="divide-y-2 divide-[#d8d1c4]">
              {demoJobs.map((job) => {
                const nextStatus = nextStatusByJobStatus[job.status];
                const transition = nextStatus
                  ? canTransitionJob(job, nextStatus)
                  : null;

                return (
                  <article
                    key={job.id}
                    className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_auto]"
                  >
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={job.status} />
                        {job.urgency ? (
                          <SmallBadge>
                            {job.urgency.replace("_", " ")}
                          </SmallBadge>
                        ) : null}
                        {job.requiredSkill ? (
                          <SmallBadge>{job.requiredSkill}</SmallBadge>
                        ) : null}
                      </div>
                      <h3 className="text-lg font-bold">
                        {job.problemSummary}
                      </h3>
                      {job.priceEstimate ? (
                        <p className="mt-2 text-sm text-[#4c5b53]">
                          {formatMoney(
                            job.priceEstimate.calloutFeePence,
                            job.priceEstimate.currency,
                          )}{" "}
                          call-out, repair range{" "}
                          {formatMoney(
                            job.priceEstimate.repairEstimateMinPence,
                            job.priceEstimate.currency,
                          )}
                          -
                          {formatMoney(
                            job.priceEstimate.repairEstimateMaxPence,
                            job.priceEstimate.currency,
                          )}
                        </p>
                      ) : null}
                    </div>
                    <div className="min-w-56 border border-[#d8d1c4] bg-[#f7f3ea] p-3 text-sm">
                      <p className="font-bold">Next transition</p>
                      <p className="mt-1 text-[#4c5b53]">
                        {nextStatus
                          ? `${job.status} -> ${nextStatus}`
                          : "No further transition"}
                      </p>
                      <p
                        className={`mt-2 font-semibold ${
                          transition?.allowed
                            ? "text-[#116149]"
                            : "text-[#a43e37]"
                        }`}
                      >
                        {transition
                          ? transition.allowed
                            ? "Allowed"
                            : transition.reason
                          : "Terminal state"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="flex flex-col gap-5">
            <section className="border-2 border-[#17201b] bg-[#fffdf8]">
              <div className="border-b-2 border-[#17201b] px-4 py-3">
                <h2 className="text-xl font-bold">Workers</h2>
              </div>
              <div className="divide-y-2 divide-[#d8d1c4]">
                {demoWorkers.map((worker) => (
                  <article key={worker.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-bold">{worker.name}</h3>
                      <SmallBadge>{worker.skill}</SmallBadge>
                    </div>
                    <p className="mt-1 text-sm text-[#4c5b53]">
                      {worker.serviceArea}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section className="border-2 border-[#17201b] bg-[#fffdf8] p-4">
              <h2 className="text-xl font-bold">Demo Readiness</h2>
              <ul className="mt-3 space-y-2 text-sm text-[#4c5b53]">
                <li>
                  Supabase schema covers core Milestone 1 tables and enums.
                </li>
                <li>
                  Seed data includes one business, workers, availability, jobs,
                  and payment data.
                </li>
                <li>
                  Unit tests cover enum mappings, config defaults, and state
                  validation.
                </li>
                <li>
                  Confirmed jobs: <strong>{confirmedJobs.length}</strong>
                </li>
              </ul>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "blue" | "gold";
}) {
  const colors = {
    green: "bg-[#116149] text-[#fffdf8]",
    blue: "bg-[#2454a6] text-[#fffdf8]",
    gold: "bg-[#c58b23] text-[#17201b]",
  };

  return (
    <div className={`border-2 border-[#17201b] px-4 py-3 ${colors[tone]}`}>
      <p className="text-3xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em]">
        {label}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="border border-[#17201b] bg-[#17201b] px-2 py-1 text-xs font-bold uppercase tracking-[0.1em] text-[#fffdf8]">
      {status.replace("_", " ")}
    </span>
  );
}

function SmallBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-[#d8d1c4] bg-[#f7f3ea] px-2 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-[#4c5b53]">
      {children}
    </span>
  );
}
