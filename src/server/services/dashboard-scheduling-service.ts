/**
 * Dashboard Scheduling Service
 *
 * Read-only queries that power the dashboard calendar, job list, and worker
 * schedule views.  All functions return data in a normalised shape ready for
 * the UI — no raw DB rows are exposed.
 *
 * Provided queries:
 *   getWorkerCalendar(workerId, from, to)
 *     → availability windows, confirmed jobs, and active reservations for a
 *       worker in a time range.
 *
 *   getSchedulingOverview(businessId, from, to)
 *     → all workers with their confirmed jobs and active reservations in range;
 *       suitable for a multi-worker calendar view.
 *
 *   getJobsForDashboard(businessId)
 *     → jobs grouped by status with enough fields for a list + detail view.
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarWindow = {
  id: string;
  startsAt: string;
  endsAt: string;
  type: "availability" | "reservation" | "confirmed_job";
  label: string;
  jobId?: string;
  reservationId?: string;
};

export type WorkerCalendar = {
  workerId: string;
  workerName: string;
  workerSkill: string;
  windows: CalendarWindow[];
};

export type SchedulingOverview = {
  workers: WorkerCalendar[];
};

export type DashboardJob = {
  id: string;
  status: string;
  customerName: string | null;
  problemSummary: string | null;
  urgency: string | null;
  requiredSkill: string | null;
  jobCategory: string | null;
  assignedWorkerName: string | null;
  selectedSlotStartsAt: string | null;
  selectedSlotEndsAt: string | null;
  intakeFormCompleted: boolean;
  priceEstimate: unknown;
  createdAt: string;
  updatedAt: string;
};

// ─── getWorkerCalendar ────────────────────────────────────────────────────────

export async function getWorkerCalendar(
  workerId: string,
  from: Date,
  to: Date,
): Promise<WorkerCalendar | null> {
  const supabase = createSupabaseServiceClient();

  // Load worker
  const { data: worker, error: workerError } = await supabase
    .from("workers")
    .select("id, name, skill")
    .eq("id", workerId)
    .single();

  if (workerError || !worker) return null;

  const w = worker as { id: string; name: string; skill: string };

  // Availability windows in range
  const { data: availWindows } = await supabase
    .from("availability_windows")
    .select("id, starts_at, ends_at")
    .eq("worker_id", workerId)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at", { ascending: true });

  // Active reservations in range
  const { data: reservations } = await supabase
    .from("reservations")
    .select("id, job_id, starts_at, ends_at, status")
    .eq("worker_id", workerId)
    .in("status", ["held", "confirmed"])
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at", { ascending: true });

  // Confirmed jobs in range
  const { data: confirmedJobs } = await supabase
    .from("jobs")
    .select("id, selected_slot_starts_at, selected_slot_ends_at, problem_summary, job_category")
    .eq("assigned_worker_id", workerId)
    .eq("status", "confirmed")
    .lt("selected_slot_starts_at", to.toISOString())
    .gt("selected_slot_ends_at", from.toISOString())
    .order("selected_slot_starts_at", { ascending: true });

  const windows: CalendarWindow[] = [
    ...((availWindows ?? []) as Array<{ id: string; starts_at: string; ends_at: string }>).map(
      (aw) => ({
        id: aw.id,
        startsAt: aw.starts_at,
        endsAt: aw.ends_at,
        type: "availability" as const,
        label: "Available",
      }),
    ),
    ...((reservations ?? []) as Array<{
      id: string;
      job_id: string;
      starts_at: string;
      ends_at: string;
      status: string;
    }>).map((r) => ({
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      type: "reservation" as const,
      label: r.status === "held" ? "Slot held" : "Confirmed",
      jobId: r.job_id,
      reservationId: r.id,
    })),
    ...((confirmedJobs ?? []) as Array<{
      id: string;
      selected_slot_starts_at: string;
      selected_slot_ends_at: string;
      problem_summary: string | null;
      job_category: string | null;
    }>).map((j) => ({
      id: j.id,
      startsAt: j.selected_slot_starts_at,
      endsAt: j.selected_slot_ends_at,
      type: "confirmed_job" as const,
      label: j.job_category ?? j.problem_summary ?? "Confirmed job",
      jobId: j.id,
    })),
  ];

  // Sort all windows by start time
  windows.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return {
    workerId: w.id,
    workerName: w.name,
    workerSkill: w.skill,
    windows,
  };
}

// ─── getSchedulingOverview ────────────────────────────────────────────────────

export async function getSchedulingOverview(
  businessId: string,
  from: Date,
  to: Date,
): Promise<SchedulingOverview> {
  const supabase = createSupabaseServiceClient();

  const { data: workers } = await supabase
    .from("workers")
    .select("id")
    .eq("service_business_id", businessId)
    .eq("active", true);

  const workerIds = ((workers ?? []) as Array<{ id: string }>).map((w) => w.id);

  const calendars = await Promise.all(
    workerIds.map((id) => getWorkerCalendar(id, from, to)),
  );

  return {
    workers: calendars.filter((c): c is WorkerCalendar => c !== null),
  };
}

// ─── getJobsForDashboard ──────────────────────────────────────────────────────

export async function getJobsForDashboard(businessId: string): Promise<DashboardJob[]> {
  const supabase = createSupabaseServiceClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select(`
      id,
      status,
      problem_summary,
      urgency,
      required_skill,
      job_category,
      selected_slot_starts_at,
      selected_slot_ends_at,
      price_estimate,
      created_at,
      updated_at,
      customers(name),
      workers!assigned_worker_id(name),
      call_sessions(intake_form_completed_at)
    `)
    .eq("service_business_id", businessId)
    .order("created_at", { ascending: false });

  return ((jobs ?? []) as Array<Record<string, unknown>>).map((j) => {
    const customer = (j.customers as { name: string | null } | null);
    const worker = (j.workers as { name: string | null } | null);
    const sessions = (j.call_sessions as Array<{ intake_form_completed_at: string | null }> | null) ?? [];
    const intakeFormCompleted = sessions.some((s) => s.intake_form_completed_at != null);

    return {
      id: j.id as string,
      status: j.status as string,
      customerName: customer?.name ?? null,
      problemSummary: j.problem_summary as string | null,
      urgency: j.urgency as string | null,
      requiredSkill: j.required_skill as string | null,
      jobCategory: j.job_category as string | null,
      assignedWorkerName: worker?.name ?? null,
      selectedSlotStartsAt: j.selected_slot_starts_at as string | null,
      selectedSlotEndsAt: j.selected_slot_ends_at as string | null,
      intakeFormCompleted,
      priceEstimate: j.price_estimate,
      createdAt: j.created_at as string,
      updatedAt: j.updated_at as string,
    };
  });
}
