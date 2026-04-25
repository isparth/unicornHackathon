import { appConfig } from "@/config/app-config";

export function GET() {
  return Response.json({
    ok: true,
    service: "ai-job-intake-booking-agent",
    reservationHoldMinutes: appConfig.reservationHoldMinutes,
    missingRequiredEnvironment: appConfig.missingRequiredKeys,
  });
}
