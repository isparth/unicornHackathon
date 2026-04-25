import { appConfig } from "@/config/app-config";
import { verifyIntakeToken } from "@/server/services/intake-token-service";
import { getCallSessionByToken } from "@/server/services/call-session-service";
import { IntakeForm } from "./intake-form";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function IntakePage({ params }: Props) {
  const { token } = await params;

  // Server-side token verification before rendering anything
  const verification = verifyIntakeToken(token, appConfig.intakeToken.secret);

  if (!verification.valid) {
    return (
      <PageShell>
        <ErrorCard
          heading="This link is no longer valid"
          body={
            verification.reason === "expired"
              ? "This form link has expired. Please ask the agent to send you a new one."
              : "This form link is not recognised. Please ask the agent to send you a new one."
          }
        />
      </PageShell>
    );
  }

  // Check if already completed
  const session = await getCallSessionByToken(token);
  if (session?.intakeFormCompletedAt) {
    return (
      <PageShell>
        <SuccessCard alreadyDone />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <IntakeForm token={token} />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-start bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

function ErrorCard({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-white px-6 py-8 shadow-sm">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg
          className="h-6 w-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-gray-900">{heading}</h1>
      <p className="mt-2 text-sm text-gray-600">{body}</p>
    </div>
  );
}

export function SuccessCard({ alreadyDone = false }: { alreadyDone?: boolean }) {
  return (
    <div className="rounded-2xl border border-green-200 bg-white px-6 py-8 shadow-sm">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <svg
          className="h-6 w-6 text-green-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-gray-900">
        {alreadyDone ? "Already submitted" : "Details received"}
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        {alreadyDone
          ? "We already have your details. You're all set — the agent will continue shortly."
          : "Thanks! We have everything we need. The agent will continue with your booking shortly."}
      </p>
    </div>
  );
}
