import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/server/supabase/client";

const BIZ_ID = "00000000-0000-4000-8000-000000000001";

export async function GET() {
  try {
    const supabase = createSupabaseServiceClient();

    const { data: workers, error } = await supabase
      .from("workers")
      .select("*")
      .eq("service_business_id", BIZ_ID)
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ workers: workers ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("GET /api/dashboard/workers error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const body = await request.json();

    const { name, skill, serviceArea } = body as {
      name?: string;
      skill?: string;
      serviceArea?: string;
    };

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data: worker, error } = await supabase
      .from("workers")
      .insert({
        name,
        skill: skill ?? null,
        service_area: serviceArea ?? null,
        service_business_id: BIZ_ID,
        active: true,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ worker }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("POST /api/dashboard/workers error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
