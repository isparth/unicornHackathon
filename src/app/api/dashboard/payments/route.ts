import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/server/supabase/client";

const BIZ_ID = "00000000-0000-4000-8000-000000000001";

export async function GET() {
  try {
    const supabase = createSupabaseServiceClient();

    // 1. Fetch all jobs for this business (to scope payments)
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, job_category, urgency, status, customer_id, reservation_id")
      .eq("service_business_id", BIZ_ID);

    if (jobsError) throw jobsError;

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ payments: [] });
    }

    const jobIds = jobs.map((j) => j.id);
    const jobMap: Record<string, (typeof jobs)[number]> = {};
    for (const j of jobs) {
      jobMap[j.id] = j;
    }

    // 2. Fetch payments for those jobs
    const { data: payments, error: payError } = await supabase
      .from("payments")
      .select("*")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false });

    if (payError) throw payError;

    if (!payments || payments.length === 0) {
      return NextResponse.json({ payments: [] });
    }

    // 3. Fetch customers
    const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
    const customerMap: Record<string, Record<string, unknown>> = {};
    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name, phone_number")
        .in("id", customerIds);
      for (const c of customers ?? []) {
        customerMap[c.id] = c;
      }
    }

    // 4. Fetch reservations
    const reservationIds = [...new Set(jobs.map((j) => j.reservation_id).filter(Boolean))];
    const resMap: Record<string, Record<string, unknown>> = {};
    if (reservationIds.length > 0) {
      const { data: reservations } = await supabase
        .from("reservations")
        .select("id, starts_at, ends_at")
        .in("id", reservationIds);
      for (const r of reservations ?? []) {
        resMap[r.id] = r;
      }
    }

    // 5. Merge
    const enrichedPayments = payments.map((p) => {
      const job = jobMap[p.job_id] ?? {};
      const customer = job.customer_id ? customerMap[job.customer_id] ?? {} : {};
      const reservation = job.reservation_id ? resMap[job.reservation_id] ?? {} : {};

      return {
        ...p,
        job_category: (job as Record<string, unknown>).job_category ?? null,
        urgency: (job as Record<string, unknown>).urgency ?? null,
        job_status: (job as Record<string, unknown>).status ?? null,
        customer_name: customer.name ?? null,
        phone_number: customer.phone_number ?? null,
        slot_starts_at: reservation.starts_at ?? null,
        slot_ends_at: reservation.ends_at ?? null,
      };
    });

    return NextResponse.json({ payments: enrichedPayments });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("GET /api/dashboard/payments error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
