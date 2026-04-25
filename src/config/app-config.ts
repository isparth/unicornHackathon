type Environment = Record<string, string | undefined>;

export type AppConfig = {
  serviceCredentials: {
    supabase: {
      url: string;
      anonKey: string;
      serviceRoleKey: string;
    };
    openai: {
      apiKey: string;
      summaryModel: string;
    };
    stripe: {
      secretKey: string;
      publishableKey: string;
      webhookSecret: string;
    };
    twilio: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
    };
    vapi: {
      apiKey: string;
      webhookSecret: string;
    };
  };
  appUrl: string;
  /** UUID of the default service business — used when the caller doesn't supply one. */
  defaultBusinessId: string;
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
  "OPENAI_API_KEY",
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
      openai: {
        apiKey: environment.OPENAI_API_KEY ?? "",
        summaryModel: environment.OPENAI_SUMMARY_MODEL ?? "gpt-4.1-mini",
      },
      stripe: {
        secretKey: environment.STRIPE_SECRET_KEY ?? "",
        publishableKey: environment.STRIPE_PUBLISHABLE_KEY ?? "",
        webhookSecret: environment.STRIPE_WEBHOOK_SECRET ?? "",
      },
      twilio: {
        accountSid: environment.TWILIO_ACCOUNT_SID ?? "",
        authToken: environment.TWILIO_AUTH_TOKEN ?? "",
        fromNumber: environment.TWILIO_FROM_NUMBER ?? "",
      },
      vapi: {
        apiKey: environment.VAPI_API_KEY ?? "",
        webhookSecret: environment.VAPI_WEBHOOK_SECRET ?? "",
      },
    },
    appUrl: environment.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    defaultBusinessId:
      environment.DEFAULT_SERVICE_BUSINESS_ID ??
      "00000000-0000-4000-8000-000000000001",
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
