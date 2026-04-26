import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/server/supabase/client";

const BIZ_ID = "00000000-0000-4000-8000-000000000001";

export async function GET() {
  try {
    const supabase = createSupabaseServiceClient();

    // 1. Fetch workers
    const { data: workers, error: workersError } = await supabase
      .from("workers")
      .select("id, name, skill, service_area, active")
      .eq("service_business_id", BIZ_ID)
      .order("name", { ascending: true });

    if (workersError) throw workersError;

    // 2. Fetch jobs that have reservations (slot_held, awaiting_payment, confirmed)
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, status, job_category, urgency, customer_id, assigned_worker_id, reservation_id")
      .eq("service_business_id", BIZ_ID)
      .in("status", ["slot_held", "awaiting_payment", "confirmed", "completed"]);

    if (jobsError) throw jobsError;

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ events: [], workers: workers ?? [] });
    }

    // 3. Fetch reservations
    const reservationIds = [...new Set(jobs.map((j) => j.reservation_id).filter(Boolean))];
    const resMap: Record<string, Record<string, unknown>> = {};
    if (reservationIds.length > 0) {
      const { data: reservations } = await supabase
        .from("reservations")
        .select("id, starts_at, ends_at, status")
        .in("id", reservationIds);
      for (const r of reservations ?? []) {
        resMap[r.id] = r;
      }
    }

    // 4. Fetch customers
    const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
    const customerMap: Record<string, Record<string, unknown>> = {};
    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name")
        .in("id", customerIds);
      for (const c of customers ?? []) {
        customerMap[c.id] = c;
      }
    }

    // 5. Fetch workers map
    const workerIds = [...new Set(jobs.map((j) => j.assigned_worker_id).filter(Boolean))];
    const workerMap: Record<string, Record<string, unknown>> = {};
    if (workerIds.length > 0) {
      const { data: wData } = await supabase
        .from("workers")
        .select("id, name, skill")
        .in("id", workerIds);
      for (const w of wData ?? []) {
        workerMap[w.id] = w;
      }
    }

    // 6. Build events
    const events = jobs
      .map((j) => {
        const res = j.reservation_id ? resMap[j.reservation_id] : null;
        if (!res || !res.starts_at) return null;

        const customer = j.customer_id ? customerMap[j.customer_id] ?? {} : {};
        const worker = j.assigned_worker_id ? workerMap[j.assigned_worker_id] ?? {} : {};

        return {
          id: j.id,
          job_id: j.id,
          status: j.status,
          job_category: j.job_category ?? null,
          urgency: j.urgency ?? null,
          customer_name: customer.name ?? null,
          worker_id: j.assigned_worker_id ?? null,
          worker_name: worker.name ?? null,
          worker_skill: worker.skill ?? null,
          starts_at: res.starts_at,
          ends_at: res.ends_at ?? null,
          reservation_status: res.status ?? null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ events, workers: workers ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("GET /api/dashboard/schedule error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
