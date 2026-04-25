import { createClient } from "@supabase/supabase-js";

import { appConfig } from "@/config/app-config";

export function createSupabaseServiceClient() {
  const { url, serviceRoleKey } = appConfig.serviceCredentials.supabase;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
