import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/server/supabase/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createSupabaseServiceClient();

    // 1. Fetch the job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: jobError?.message ?? "Job not found" },
        { status: 404 }
      );
    }

    // 2. Fetch customer
    let customer: Record<string, unknown> = {};
    if (job.customer_id) {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone_number, address_line_1, city, postcode")
        .eq("id", job.customer_id)
        .single();
      if (data) customer = data;
    }

    // 3. Fetch worker
    let worker: Record<string, unknown> = {};
    if (job.assigned_worker_id) {
      const { data } = await supabase
        .from("workers")
        .select("id, name, skill")
        .eq("id", job.assigned_worker_id)
        .single();
      if (data) worker = data;
    }

    // 4. Fetch call session
    const { data: callSession } = await supabase
      .from("call_sessions")
      .select("job_id, intake_form_completed_at, transcript, summary, provider_session_id")
      .eq("job_id", id)
      .maybeSingle();

    // 5. Fetch payment
    const { data: payment } = await supabase
      .from("payments")
      .select("job_id, status, amount_pence, currency")
      .eq("job_id", id)
      .maybeSingle();

    // 6. Fetch reservation
    let reservation: Record<string, unknown> = {};
    if (job.reservation_id) {
      const { data } = await supabase
        .from("reservations")
        .select("id, status, starts_at, ends_at, expires_at")
        .eq("id", job.reservation_id)
        .single();
      if (data) reservation = data;
    }

    // 7. Fetch uploaded assets (photos)
    const { data: photos } = await supabase
      .from("uploaded_assets")
      .select("*")
      .eq("job_id", id);

    // 8. Merge into a single enriched job object
    const enrichedJob = {
      ...job,
      customer_name: customer.name ?? null,
      phone_number: customer.phone_number ?? null,
      address_line_1: customer.address_line_1 ?? null,
      city: customer.city ?? null,
      postcode: customer.postcode ?? null,
      worker_name: worker.name ?? null,
      worker_skill: worker.skill ?? null,
      intake_form_completed_at: callSession?.intake_form_completed_at ?? null,
      transcript: callSession?.transcript ?? null,
      summary: callSession?.summary ?? null,
      provider_session_id: callSession?.provider_session_id ?? null,
      payment_status: payment?.status ?? null,
      amount_pence: payment?.amount_pence ?? null,
      payment_currency: payment?.currency ?? null,
      reservation_status: reservation.status ?? null,
      reservation_starts_at: reservation.starts_at ?? null,
      reservation_ends_at: reservation.ends_at ?? null,
      expires_at: reservation.expires_at ?? null,
    };

    return NextResponse.json({ job: enrichedJob, photos: photos ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("GET /api/dashboard/jobs/[id] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
