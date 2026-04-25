import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#2454a6]">
            Milestone 1
          </p>
          <h1 className="text-5xl leading-tight font-bold text-[#17201b] md:text-7xl">
            AI Job Intake & Booking Agent
          </h1>
          <p className="mt-5 max-w-2xl text-xl leading-8 text-[#4c5b53]">
            A typed Next.js foundation with Supabase schema, seeded service
            data, and an explicit job state machine ready for intake, pricing,
            scheduling, and payment milestones.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="w-fit border-2 border-[#17201b] bg-[#17201b] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#fffdf8] shadow-[6px_6px_0_#c58b23] transition hover:-translate-y-0.5 hover:shadow-[8px_8px_0_#c58b23]"
        >
          Open Dashboard
        </Link>
      </section>
    </main>
  );
}
