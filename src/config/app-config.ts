type Environment = Record<string, string | undefined>;

export type AppConfig = {
  serviceCredentials: {
    supabase: {
      url: string;
      anonKey: string;
      serviceRoleKey: string;
    };
  };
  intakeToken: {
    secret: string;
    expiryMinutes: number;
  };
  reservationHoldMinutes: number;
  pricingDefaults: {
    currency: string;
    calloutFeePence: number;
    repairEstimateMinPence: number;
    repairEstimateMaxPence: number;
  };
  missingRequiredKeys: string[];
};

const requiredKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INTAKE_TOKEN_SECRET",
] as const;

function readNumber(
  environment: Environment,
  key: string,
  fallback: number,
): number {
  const rawValue = environment[key];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return parsedValue;
}

export function createAppConfig(environment: Environment): AppConfig {
  const missingRequiredKeys = requiredKeys.filter((key) => !environment[key]);

  return {
    serviceCredentials: {
      supabase: {
        url: environment.NEXT_PUBLIC_SUPABASE_URL ?? "",
        anonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY ?? "",
      },
    },
    intakeToken: {
      secret: environment.INTAKE_TOKEN_SECRET ?? "",
      expiryMinutes: readNumber(environment, "INTAKE_TOKEN_EXPIRY_MINUTES", 30),
    },
    reservationHoldMinutes: readNumber(
      environment,
      "RESERVATION_HOLD_MINUTES",
      120,
    ),
    pricingDefaults: {
      currency: environment.DEFAULT_CURRENCY ?? "gbp",
      calloutFeePence: readNumber(
        environment,
        "DEFAULT_CALLOUT_FEE_PENCE",
        8000,
      ),
      repairEstimateMinPence: readNumber(
        environment,
        "DEFAULT_REPAIR_MIN_PENCE",
        10000,
      ),
      repairEstimateMaxPence: readNumber(
        environment,
        "DEFAULT_REPAIR_MAX_PENCE",
        25000,
      ),
    },
    missingRequiredKeys,
  };
}

export const appConfig = createAppConfig(process.env);
