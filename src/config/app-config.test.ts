import { describe, expect, it } from "vitest";

import { createAppConfig } from "@/config/app-config";

describe("app config", () => {
  it("loads business defaults and service credentials from environment values", () => {
    const config = createAppConfig({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      RESERVATION_HOLD_MINUTES: "90",
      DEFAULT_CURRENCY: "gbp",
      DEFAULT_CALLOUT_FEE_PENCE: "8500",
      DEFAULT_REPAIR_MIN_PENCE: "12000",
      DEFAULT_REPAIR_MAX_PENCE: "30000",
    });

    expect(config.reservationHoldMinutes).toBe(90);
    expect(config.pricingDefaults.calloutFeePence).toBe(8500);
    expect(config.serviceCredentials.supabase.serviceRoleKey).toBe(
      "service-key",
    );
  });

  it("falls back to milestone defaults for optional business settings", () => {
    const config = createAppConfig({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
    });

    expect(config.reservationHoldMinutes).toBe(120);
    expect(config.pricingDefaults).toEqual({
      currency: "gbp",
      calloutFeePence: 8000,
      repairEstimateMinPence: 10000,
      repairEstimateMaxPence: 25000,
    });
  });
});
