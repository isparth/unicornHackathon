import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/server/supabase/client";

const BIZ_ID = "00000000-0000-4000-8000-000000000001";

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const status = request.nextUrl.searchParams.get("status");

    // 1. Fetch jobs
    let jobsQuery = supabase
      .from("jobs")
      .select("*")
      .eq("service_business_id", BIZ_ID)
      .order("created_at", { ascending: false })
      .limit(100);

    if (status) {
      jobsQuery = jobsQuery.eq("status", status);
    }

    const { data: jobs, error: jobsError } = await jobsQuery;
    if (jobsError) throw jobsError;

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ jobs: [] });
    }

    // 2. Fetch related customers
    const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
    const customerMap: Record<string, Record<string, unknown>> = {};
    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name, phone_number, address_line_1, city, postcode")
        .in("id", customerIds);
      for (const c of customers ?? []) {
        customerMap[c.id] = c;
      }
    }

    // 3. Fetch related workers
    const workerIds = [...new Set(jobs.map((j) => j.assigned_worker_id).filter(Boolean))];
    const workerMap: Record<string, Record<string, unknown>> = {};
    if (workerIds.length > 0) {
      const { data: workers } = await supabase
        .from("workers")
        .select("id, name, skill")
        .in("id", workerIds);
      for (const w of workers ?? []) {
        workerMap[w.id] = w;
      }
    }

    // 4. Fetch call sessions for these jobs
    const jobIds = jobs.map((j) => j.id);
    const { data: callSessions } = await supabase
      .from("call_sessions")
      .select("job_id, intake_form_completed_at, transcript, summary")
      .in("job_id", jobIds);
    const csMap: Record<string, Record<string, unknown>> = {};
    for (const cs of callSessions ?? []) {
      csMap[cs.job_id] = cs;
    }

    // 5. Fetch payments for these jobs
    const { data: payments } = await supabase
      .from("payments")
      .select("job_id, status, amount_pence, currency, stripe_checkout_session_id")
      .in("job_id", jobIds);
    const payMap: Record<string, Record<string, unknown>> = {};
    for (const p of payments ?? []) {
      payMap[p.job_id] = p;
    }

    // 6. Fetch reservations
    const reservationIds = [...new Set(jobs.map((j) => j.reservation_id).filter(Boolean))];
    const resMap: Record<string, Record<string, unknown>> = {};
    if (reservationIds.length > 0) {
      const { data: reservations } = await supabase
        .from("reservations")
        .select("id, status, starts_at, ends_at, expires_at")
        .in("id", reservationIds);
      for (const r of reservations ?? []) {
        resMap[r.id] = r;
      }
    }

    // 7. Merge everything
    const enrichedJobs = jobs.map((j) => {
      const customer = customerMap[j.customer_id] ?? {};
      const worker = workerMap[j.assigned_worker_id] ?? {};
      const cs = csMap[j.id] ?? {};
      const pay = payMap[j.id] ?? {};
      const res = resMap[j.reservation_id] ?? {};

      return {
        ...j,
        customer_name: customer.name ?? null,
        phone_number: customer.phone_number ?? null,
        address_line_1: customer.address_line_1 ?? null,
        city: customer.city ?? null,
        postcode: customer.postcode ?? null,
        worker_name: worker.name ?? null,
        worker_skill: worker.skill ?? null,
        intake_form_completed_at: cs.intake_form_completed_at ?? null,
        transcript: cs.transcript ?? null,
        summary: cs.summary ?? null,
        payment_status: pay.status ?? null,
        amount_pence: pay.amount_pence ?? null,
        payment_currency: pay.currency ?? null,
        stripe_checkout_session_id: pay.stripe_checkout_session_id ?? null,
        reservation_status: res.status ?? null,
        reservation_starts_at: res.starts_at ?? null,
        reservation_ends_at: res.ends_at ?? null,
        expires_at: res.expires_at ?? null,
      };
    });

    return NextResponse.json({ jobs: enrichedJobs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("GET /api/dashboard/jobs error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
