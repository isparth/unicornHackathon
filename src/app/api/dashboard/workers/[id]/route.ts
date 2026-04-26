import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/server/supabase/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createSupabaseServiceClient();
    const body = await request.json();

    const { name, skill, serviceArea, active } = body as {
      name?: string;
      skill?: string;
      serviceArea?: string;
      active?: boolean;
    };

    // Build update payload with only provided fields
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (skill !== undefined) updates.skill = skill;
    if (serviceArea !== undefined) updates.service_area = serviceArea;
    if (active !== undefined) updates.active = active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data: worker, error } = await supabase
      .from("workers")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    if (!worker) {
      return NextResponse.json({ error: "Worker not found" }, { status: 404 });
    }

    return NextResponse.json({ worker });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("PATCH /api/dashboard/workers/[id] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createSupabaseServiceClient();

    const { error } = await supabase
      .from("workers")
      .update({ active: false })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("DELETE /api/dashboard/workers/[id] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
