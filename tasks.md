# Tasks — AI Job Intake & Booking Agent

## Milestone 1: Product Skeleton And Core Domain Foundation

**Goal:** Establish the Next.js application, shared domain model, database schema, and development conventions needed for the rest of the product.

### Application Foundation

- [x] Scaffold the `Next.js` TypeScript app with Tailwind CSS and a clear folder structure for dashboard UI, API routes, server actions, and domain services.
- [x] Configure linting, formatting, environment variable handling, and baseline project scripts for local development and CI.
- [x] Create a shared configuration module for service credentials, business settings, reservation hold duration, and pricing defaults.

### Data Model

- [x] Create Supabase tables for customers, call sessions, jobs, workers, availability windows, reservations, payments, and uploaded assets.
- [x] Define database enums for job status, payment status, urgency, reservation status, worker skill, and uploaded asset type.
- [x] Add relational constraints and indexes for common lookups such as jobs by status, reservations by expiry, workers by skill, and payments by Stripe ID.

### Domain Layer

- [x] Define TypeScript types for the core entities and enums used across backend services and dashboard components.
- [x] Implement the explicit job state machine covering `intake`, `qualified`, `priced`, `slot_held`, `awaiting_payment`, `confirmed`, `expired`, and `completed`.
- [x] Add validation helpers that block invalid state transitions when required structured fields are missing.

### Seed And Demo Data

- [x] Create seed data for one service business, example workers, worker skills, availability windows, and sample jobs.
- [x] Add a local reset or seed script so the demo environment can be restored quickly.

### QA And Developer Experience

- [x] Add focused unit tests for state transitions, enum mappings, and validation rules.
- [x] Document local setup, required environment variables, and seed-data usage in the project README.

### After this milestone, you can…

- Run the application locally with a real database-backed domain model.
- Demonstrate core job states and seeded workers without external integrations.
- Build backend services and dashboard screens against stable types and schema.

## Milestone 2: Mid-Call Intake Form, Call Summary, Classification, And Pricing

**Goal:** Collect customer identity details through a mid-call form, derive the problem description from the voice conversation via an AI-generated call summary, use that summary for classification, and produce a clear customer-facing price expectation.

### Three Information Sources

This milestone establishes the three distinct sources of information that together build the complete job record:

| Source | What it provides | Owner |
|---|---|---|
| **Intake form** | Name, address, phone number confirmation, photos | Customer fills in mid-call |
| **Voice conversation** | Problem description (`problem_summary`), urgency | AI summarises from transcript |
| **Worker view** | All three combined | Dashboard shows form data + call summary + photos |

### Intake Form Token Service

- [x] Generate short-lived signed tokens tied to a call session when a call starts.
- [x] Store the token on the call session record with an expiry timestamp.
- [x] Validate tokens server-side on every form page load and submission — reject expired or unrecognised tokens.
- [x] Make token generation idempotent so that a repeated call-start event does not produce duplicate tokens.

### Intake Form Page

- [x] Build the customer-facing intake form at `/intake/[token]` using Next.js app router.
- [x] The form must be mobile-optimised — assume it is always opened on a phone during a live call.
- [x] Fields: customer name, service address (line 1, city, postcode), phone number confirmation, and optional photo upload (up to 5 photos).
- [x] The form must not ask the customer to describe the problem — they have already done so verbally.
- [x] The form must be completable in under 60 seconds with minimal typing effort.
- [x] Show a clear success state once the form is submitted so the customer knows it worked.

### Intake Form Submission Handler

- [x] Accept and validate form submissions via a server action.
- [x] Write verified contact fields directly to the `customers` table.
- [x] Upload photos to Supabase Storage (`job-photos` bucket) and create `uploaded_assets` records.
- [x] Mark the intake form as complete on the call session record with a completion timestamp.
- [x] Advance the job from `intake` to `qualified` once all required contact fields are present.
- [x] Make submission idempotent — resubmitting the same token updates rather than duplicates the record.

### Call Summary Service

- [x] After the call transcript is available, use OpenAI to generate a concise, clean summary of what the customer described.
- [x] Store the summary as `problem_summary` on the job record.
- [x] This is the authoritative source of the problem description — it is what the worker reads before attending.
- [x] It must not be sourced from the form or overwritten by form submission.

### Classification Service

- [ ] Build the classification flow that runs after `problem_summary` is written to the job.
- [ ] Use `OpenAI` to determine problem category, required worker skill, and urgency from the call summary.
- [ ] Validate AI outputs against allowed enum values before persisting or using them for state transitions.
- [ ] Add fallback behavior for low-confidence or invalid model outputs so the job remains in `qualified` rather than progressing incorrectly.

### Pricing Service

- [ ] Implement configurable pricing rules for fixed call-out fees and estimated repair ranges by trade, category, and urgency.
- [ ] Generate a customer-facing explanation that clearly distinguishes the call-out fee from the non-guaranteed repair range.
- [ ] Store pricing data on the job in a structured format suitable for dashboard display and payment creation.

### Hard Gate: Form Before Payment

- [ ] Add a server-side check that blocks payment session creation if the intake form has not been submitted.
- [ ] This check must live at the server action level — it cannot be UI-only.
- [ ] Return a clear error state so the voice assistant or dashboard knows why payment creation was blocked.

### Backend Interfaces

- [ ] Add internal route handlers or server actions for creating call sessions, generating intake form tokens, triggering SMS delivery of the form link, and processing classification and pricing.
- [ ] Ensure missing required fields block progression to `qualified` or `priced` states.

### QA And Acceptance Coverage

- [x] Add tests for token generation, token expiry, and form field validation.
- [x] Add tests for submission idempotency.
- [ ] Add tests for classification mapping, pricing rule selection, and the hard gate that blocks payment when the form is incomplete.
- [ ] Add a demo fixture that simulates a complete mid-call form submission for boiler failure, leak investigation, and electrical fault scenarios.

### After this milestone, you can…

- Simulate a call starting, a form link being generated, a customer filling in the form on their phone, and the job advancing to qualified.
- Show a worker-ready issue summary and customer-ready pricing response built from verified form data.
- Demonstrate that a payment link cannot be created until the form is complete.

## Milestone 3: Worker Availability, Scheduling, And Reservation Holds

**Goal:** Match qualified jobs to available workers, offer valid appointment slots, and reserve selected capacity without double-booking.

### Scheduling Service

- [ ] Implement worker matching by required skill, basic service area, availability windows, and current job status.
- [ ] Generate bookable time slots from availability windows while excluding confirmed jobs and active reservations.
- [ ] Add deterministic slot selection rules so the same inputs produce predictable demo results.

### Reservation Service

- [ ] Create temporary reservations for selected slots and link them to jobs and workers.
- [ ] Enforce reservation expiry timestamps using the configured hold duration.
- [ ] Advance jobs to `slot_held` or `awaiting_payment` only when a reservation is successfully created.

### Concurrency Protection

- [ ] Add database-level protection or transactional logic to prevent overlapping active reservations and confirmed bookings for the same worker.
- [ ] Make reservation creation idempotent for repeated customer or webhook actions where appropriate.
- [ ] Add tests covering overlapping slot attempts and expired holds.

### Dashboard Scheduling Data

- [ ] Add backend queries for confirmed jobs, active reservations, open availability gaps, and worker calendars.
- [ ] Return scheduling data in a shape that supports calendar, list, and job-detail views.

### QA And Acceptance Coverage

- [ ] Test skill matching, availability filtering, double-booking prevention, and reservation status changes.
- [ ] Add demo scenarios for same-day, scheduled, and emergency jobs.

### After this milestone, you can…

- Offer real available slots for a classified job.
- Temporarily hold a worker slot and prevent conflicting bookings.
- Demo the path from form-verified intake through price estimate and slot reservation.

## Milestone 4: Payments, Expiry Workflows, And Booking Confirmation

**Goal:** Require successful Stripe payment before confirming bookings, automatically release unpaid reservations, and enforce that the payment link is only sent after the intake form is complete.

### Stripe Payment Flow

- [ ] Create Stripe Checkout or Payment Link sessions for the call-out fee tied to a job and reservation.
- [ ] Before creating the session, verify that the intake form has been submitted and all required customer fields are present — return an error if not.
- [ ] Store Stripe identifiers, payment amount, payment status, and related metadata in the payment table.
- [ ] Generate a secure customer payment URL that can be sent by SMS or displayed in a demo flow.

### Stripe Webhooks

- [ ] Implement the Stripe webhook endpoint for successful payment, failed payment, and relevant retry events.
- [ ] Make webhook processing idempotent so repeated delivery cannot create duplicate confirmations.
- [ ] Advance the job to `confirmed`, mark the payment as paid, and lock the reservation only after payment success.

### Inngest Workflows

- [ ] Add an Inngest workflow to expire unpaid reservations after the configured hold window.
- [ ] Release held capacity and move the job to `expired` when payment has not succeeded in time.
- [ ] Add retry-safe background handling for webhook follow-up actions and recovery paths.

### Notification Hooks

- [ ] Define notification events for payment requested, booking confirmed, payment failed, and reservation expired.
- [ ] Implement a placeholder notification service interface that can later be backed by Vapi SMS or another provider.

### QA And Acceptance Coverage

- [ ] Test successful payment confirmation, failed payment handling, repeated webhook delivery, and reservation expiry.
- [ ] Test that payment session creation is blocked when the intake form is incomplete.
- [ ] Add integration-style tests for the full qualified job to reserved slot to paid confirmation path using mocked Stripe events.

### After this milestone, you can…

- Confirm bookings only after successful payment.
- Demonstrate that a payment link is never sent to a customer who has not completed the intake form.
- Demonstrate unpaid reservations expiring automatically.
- Show retry-safe behavior for repeated Stripe webhook events.

## Milestone 5: Voice, SMS Handoff, And Image Analysis

**Goal:** Connect the app-owned business flow to Vapi voice events, SMS handoffs for the intake form and payment link, and image analysis.

### Vapi Voice Integration

- [ ] Implement the Vapi webhook endpoint for inbound call lifecycle events, transcript updates, and tool/action callbacks.
- [ ] Map Vapi session identifiers to internal call sessions and jobs.
- [ ] Return app-owned business decisions to the voice layer without embedding core workflow logic in Vapi prompts.

### Conversation Orchestration

- [ ] Create backend actions the voice assistant can call for: triggering the intake form SMS, checking form completion status, running classification, generating pricing, offering slots, creating reservations, and creating the payment link.
- [ ] The assistant must check form completion status before attempting to move to pricing or payment — the backend enforces this, but the assistant must be able to ask the customer to complete the form if it is not yet done.
- [ ] Store transcripts, event history, and summaries for worker review.

### SMS Handoff

- [ ] Implement message generation for intake form links, image upload links, payment links, and booking confirmations.
- [ ] Wire SMS sending through Vapi where supported, or through a notification adapter with a mocked local fallback.
- [ ] Track outbound messages and delivery-relevant metadata for troubleshooting.
- [ ] Ensure the intake form SMS is sent immediately when a call session is created, not deferred.

### Image Analysis

- [ ] Add optional OpenAI image analysis for uploaded assets.
- [ ] Append image-derived context to the job record without overwriting the verified intake form data.
- [ ] Surface analysis status and results in the job detail data model.

### QA And Acceptance Coverage

- [ ] Test Vapi event ingestion, repeated transcript updates, intake form SMS generation, signed upload access, and image-analysis failure handling.
- [ ] Run a mocked end-to-end call flow from call start through form submission, classification, pricing, slot selection, and payment link creation.
- [ ] Verify the assistant correctly holds back from payment when the form is not yet complete.

### After this milestone, you can…

- Demo the real call and SMS hybrid flow including the mid-call intake form handoff.
- Let customers upload images that enrich job context.
- Show a natural conversation that still produces structured, state-controlled booking progress.

## Milestone 6: Business Dashboard

**Goal:** Give the service business a usable back-office view for workers, schedules, jobs, images, and payments.

### Authentication And Layout

- [ ] Add Supabase-authenticated dashboard access for internal business users.
- [ ] Build the main dashboard layout with navigation for jobs, schedule, workers, and payments.
- [ ] Add protected-route handling and clear unauthenticated states.

### Job Management UI

- [ ] Build job list views filtered by pending (form not yet submitted), qualified, reserved, confirmed, completed, and expired states.
- [ ] Build a job detail view showing customer details, intake form completion status, problem summary, classification, urgency, price estimate, assigned worker, reservation, payment status, transcript summary, and uploaded images.
- [ ] Add status actions for completing a job and reviewing expired or failed-payment jobs.

### Worker Management UI

- [ ] Build worker list, create, edit, and status controls.
- [ ] Support worker skill, rough service area, availability metadata, and current status.
- [ ] Add validation to prevent unusable worker records such as missing skill or availability.

### Scheduling UI

- [ ] Build a calendar-style schedule view that displays confirmed jobs, active reservations, and open gaps.
- [ ] Add worker and date filters so dispatchers can inspect capacity quickly.
- [ ] Clearly distinguish reserved, confirmed, completed, and expired states visually.

### Payment Tracking UI

- [ ] Build payment overview widgets or tables for pending, paid, failed, and expired booking attempts.
- [ ] Link payment records back to the related job and reservation.
- [ ] Display Stripe status and relevant timestamps without exposing raw payment details.

### Realtime Updates

- [ ] Subscribe dashboard views to Supabase realtime changes for jobs, reservations, and payments.
- [ ] Update relevant lists and detail pages when a booking is confirmed, expired, or completed.

### QA And Acceptance Coverage

- [ ] Add component and route-level tests for dashboard views and protected access.
- [ ] Run responsive checks for desktop and mobile dashboard usability.

### After this milestone, you can…

- Demo the complete business back office.
- Watch bookings, reservations, workers, images, and payments update from a single dashboard.
- Let a service company manage the operational output of the AI booking flow.

## Milestone 7: End-To-End Demo Hardening And Launch Readiness

**Goal:** Turn the individual features into a reliable, polished v1 demo that proves inbound call to paid booking.

### End-To-End Flow

- [ ] Script and test the successful booking scenario from customer call through mid-call form handoff, form submission, classification, pricing, slot hold, payment, confirmation, and dashboard update.
- [ ] Script and test the scenario where the customer has not filled in the form and the system correctly blocks the payment link until the form is complete.
- [ ] Script and test the image upload scenario where analysis improves context but does not block booking.
- [ ] Script and test reservation expiry, payment retry safety, and overlapping availability protection.

### Reliability And Observability

- [ ] Add structured logging for call sessions, intake form token generation, form submissions, classification attempts, reservation creation, payment events, webhook processing, and expiry workflows.
- [ ] Add admin-visible error states for failed classification, failed image analysis, failed SMS delivery, failed payment creation, and blocked payment attempts due to incomplete intake.
- [ ] Ensure external webhook endpoints validate signatures or shared secrets where applicable.

### Security Baseline

- [ ] Confirm dashboard routes require authentication.
- [x] Confirm intake form tokens are short-lived and validated server-side.
- [x] Confirm uploaded images are private and stored in Supabase Storage.
- [ ] Confirm Stripe-hosted payment is used and raw card data is never stored.
- [ ] Review customer PII storage and remove unnecessary sensitive fields from logs.

### Demo Operations

- [ ] Create a repeatable demo reset process for data, workers, availability, and reservations.
- [ ] Add sample call scripts and expected outcomes for the main acceptance scenarios.
- [ ] Prepare environment setup notes for Vercel, Supabase, Stripe, Vapi, OpenAI, and Inngest.

### Polish And Usability

- [ ] Improve dashboard empty states, loading states, error messages, and status labels.
- [ ] Review the voice assistant wording for clarity around the form handoff, estimates, reservation holds, and payment-backed confirmation.
- [ ] Verify the UI clearly communicates that bookings are not confirmed until payment succeeds.
- [x] Verify the intake form is fast, clear, and pleasant to complete on a mobile screen during a live call.

### Final Verification

- [ ] Run the full automated test suite.
- [ ] Manually verify webhook replay safety and double-booking prevention.
- [ ] Manually verify that the payment link is never reachable before the intake form is complete.
- [ ] Manually verify the final demo path in a production-like environment.

### After this milestone, you can…

- Present a credible end-to-end v1 demo to customers, judges, or stakeholders.
- Show the core product promise: a customer call becomes a confirmed, paid booking in minutes.
- Decide whether the next phase should focus on multi-business support, richer scheduling, improved routing, or production operations.
