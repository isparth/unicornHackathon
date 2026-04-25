# Tasks — AI Job Intake & Booking Agent

## Milestone 1: Product Skeleton And Core Domain Foundation

**Goal:** Establish the Next.js application, shared domain model, database schema, and development conventions needed for the rest of the product.

### Application Foundation

- Scaffold the `Next.js` TypeScript app with Tailwind CSS and a clear folder structure for dashboard UI, API routes, server actions, and domain services.
- Configure linting, formatting, environment variable handling, and baseline project scripts for local development and CI.
- Create a shared configuration module for service credentials, business settings, reservation hold duration, and pricing defaults.

### Data Model

- Create Supabase tables for customers, call sessions, jobs, workers, availability windows, reservations, payments, and uploaded assets.
- Define database enums for job status, payment status, urgency, reservation status, worker skill, and uploaded asset type.
- Add relational constraints and indexes for common lookups such as jobs by status, reservations by expiry, workers by skill, and payments by Stripe ID.

### Domain Layer

- Define TypeScript types for the core entities and enums used across backend services and dashboard components.
- Implement the explicit job state machine covering `intake`, `qualified`, `priced`, `slot_held`, `awaiting_payment`, `confirmed`, `expired`, and `completed`.
- Add validation helpers that block invalid state transitions when required structured fields are missing.

### Seed And Demo Data

- Create seed data for one service business, example workers, worker skills, availability windows, and sample jobs.
- Add a local reset or seed script so the demo environment can be restored quickly.

### QA And Developer Experience

- Add focused unit tests for state transitions, enum mappings, and validation rules.
- Document local setup, required environment variables, and seed-data usage in the project README.

### After this milestone, you can…

- Run the application locally with a real database-backed domain model.
- Demonstrate core job states and seeded workers without external integrations.
- Build backend services and dashboard screens against stable types and schema.

## Milestone 2: Structured Intake, Classification, And Pricing

**Goal:** Convert call or transcript information into structured job data, classify the work, and produce a clear customer-facing price expectation.

### Intake Service

- Implement a transcript-to-structured-data service that extracts customer name, phone number, address, problem summary, urgency signals, and relevant issue details.
- Support partial intake updates so the system can accumulate fields opportunistically across a conversation.
- Store extraction results on the call session and linked job records with clear timestamps and status metadata.

### OpenAI Classification

- Build the OpenAI-backed classification flow for problem category, required worker skill, urgency, and worker-facing issue summary.
- Validate AI outputs against allowed enum values before persisting or using them for state transitions.
- Add fallback behavior for low-confidence or invalid model outputs so the job remains in intake rather than progressing incorrectly.

### Pricing Service

- Implement configurable pricing rules for fixed call-out fees and estimated repair ranges by trade, category, and urgency.
- Generate a customer-facing explanation that clearly distinguishes the call-out fee from the non-guaranteed repair range.
- Store pricing data on the job in a structured format suitable for dashboard display and payment creation.

### Backend Interfaces

- Add internal route handlers or server actions for creating call sessions, updating intake data, running classification, and generating pricing.
- Ensure missing required fields block progression to `qualified` or `priced` states.

### QA And Acceptance Coverage

- Add tests for extraction validation, classification mapping, pricing rule selection, and required-field enforcement.
- Create fixture transcripts for common scenarios such as boiler failure, leak investigation, and electrical fault.

### After this milestone, you can…

- Feed a transcript or mocked call event into the system and produce a structured, classified, priced job.
- Show a worker-ready issue summary and customer-ready pricing response.
- Demo the structured business flow without live phone, scheduling, or payment integrations.

## Milestone 3: Worker Availability, Scheduling, And Reservation Holds

**Goal:** Match qualified jobs to available workers, offer valid appointment slots, and reserve selected capacity without double-booking.

### Scheduling Service

- Implement worker matching by required skill, basic service area, availability windows, and current job status.
- Generate bookable time slots from availability windows while excluding confirmed jobs and active reservations.
- Add deterministic slot selection rules so the same inputs produce predictable demo results.

### Reservation Service

- Create temporary reservations for selected slots and link them to jobs and workers.
- Enforce reservation expiry timestamps using the configured hold duration.
- Advance jobs to `slot_held` or `awaiting_payment` only when a reservation is successfully created.

### Concurrency Protection

- Add database-level protection or transactional logic to prevent overlapping active reservations and confirmed bookings for the same worker.
- Make reservation creation idempotent for repeated customer or webhook actions where appropriate.
- Add tests covering overlapping slot attempts and expired holds.

### Dashboard Scheduling Data

- Add backend queries for confirmed jobs, active reservations, open availability gaps, and worker calendars.
- Return scheduling data in a shape that supports calendar, list, and job-detail views.

### QA And Acceptance Coverage

- Test skill matching, availability filtering, double-booking prevention, and reservation status changes.
- Add demo scenarios for same-day, scheduled, and emergency jobs.

### After this milestone, you can…

- Offer real available slots for a classified job.
- Temporarily hold a worker slot and prevent conflicting bookings.
- Demo the path from structured intake through price estimate and slot reservation.

## Milestone 4: Payments, Expiry Workflows, And Booking Confirmation

**Goal:** Require successful Stripe payment before confirming bookings, and automatically release unpaid reservations.

### Stripe Payment Flow

- Create Stripe Checkout or Payment Link sessions for the call-out fee tied to a job and reservation.
- Store Stripe identifiers, payment amount, payment status, and related metadata in the payment table.
- Generate a secure customer payment URL that can be sent by SMS or displayed in a demo flow.

### Stripe Webhooks

- Implement the Stripe webhook endpoint for successful payment, failed payment, and relevant retry events.
- Make webhook processing idempotent so repeated delivery cannot create duplicate confirmations.
- Advance the job to `confirmed`, mark the payment as paid, and lock the reservation only after payment success.

### Inngest Workflows

- Add an Inngest workflow to expire unpaid reservations after the configured hold window.
- Release held capacity and move the job to `expired` when payment has not succeeded in time.
- Add retry-safe background handling for webhook follow-up actions and recovery paths.

### Notification Hooks

- Define notification events for payment requested, booking confirmed, payment failed, and reservation expired.
- Implement a placeholder notification service interface that can later be backed by Vapi SMS or another provider.

### QA And Acceptance Coverage

- Test successful payment confirmation, failed payment handling, repeated webhook delivery, and reservation expiry.
- Add integration-style tests for the full priced job to reserved slot to paid confirmation path using mocked Stripe events.

### After this milestone, you can…

- Confirm bookings only after successful payment.
- Demonstrate unpaid reservations expiring automatically.
- Show retry-safe behavior for repeated Stripe webhook events.

## Milestone 5: Voice, SMS Handoff, And Image Upload

**Goal:** Connect the app-owned business flow to Vapi voice events, SMS handoffs, optional image upload, and image analysis.

### Vapi Voice Integration

- Implement the Vapi webhook endpoint for inbound call lifecycle events, transcript updates, and tool/action callbacks.
- Map Vapi session identifiers to internal call sessions and jobs.
- Return app-owned business decisions to the voice layer without embedding core workflow logic in Vapi prompts.

### Conversation Orchestration

- Create backend actions the voice assistant can call for intake updates, classification, pricing, slot generation, reservation creation, and payment-link creation.
- Define required-field checks so the assistant can ask natural follow-up questions while the backend controls progression.
- Store transcripts, event history, and summaries for worker review.

### SMS Handoff

- Implement message generation for image upload links, payment links, and booking confirmations.
- Wire SMS sending through Vapi where supported, or through a notification adapter with a mocked local fallback.
- Track outbound messages and delivery-relevant metadata for troubleshooting.

### Image Upload

- Build the customer image upload page linked to a job or call session through a signed token.
- Store uploaded images privately in Supabase Storage and create uploaded asset records.
- Ensure the booking flow continues when image upload is skipped or fails.

### Image Analysis

- Add optional OpenAI image analysis for uploaded assets.
- Append image-derived context to the job record without overwriting verified intake details.
- Surface analysis status and results in the job detail data model.

### QA And Acceptance Coverage

- Test Vapi event ingestion, repeated transcript updates, SMS link generation, signed upload access, and image-analysis failure handling.
- Run a mocked end-to-end call flow from intake through payment link creation.

### After this milestone, you can…

- Demo the real call and SMS hybrid flow.
- Let customers upload images that enrich job context.
- Show a natural conversation that still produces structured, state-controlled booking progress.

## Milestone 6: Business Dashboard

**Goal:** Give the service business a usable back-office view for workers, schedules, jobs, images, and payments.

### Authentication And Layout

- Add Supabase-authenticated dashboard access for internal business users.
- Build the main dashboard layout with navigation for jobs, schedule, workers, and payments.
- Add protected-route handling and clear unauthenticated states.

### Job Management UI

- Build job list views filtered by pending, reserved, confirmed, completed, and expired states.
- Build a job detail view showing customer details, problem summary, classification, urgency, price estimate, assigned worker, reservation, payment status, transcript summary, and uploaded images.
- Add status actions for completing a job and reviewing expired or failed-payment jobs.

### Worker Management UI

- Build worker list, create, edit, and status controls.
- Support worker skill, rough service area, availability metadata, and current status.
- Add validation to prevent unusable worker records such as missing skill or availability.

### Scheduling UI

- Build a calendar-style schedule view that displays confirmed jobs, active reservations, and open gaps.
- Add worker and date filters so dispatchers can inspect capacity quickly.
- Clearly distinguish reserved, confirmed, completed, and expired states visually.

### Payment Tracking UI

- Build payment overview widgets or tables for pending, paid, failed, and expired booking attempts.
- Link payment records back to the related job and reservation.
- Display Stripe status and relevant timestamps without exposing raw payment details.

### Realtime Updates

- Subscribe dashboard views to Supabase realtime changes for jobs, reservations, and payments.
- Update relevant lists and detail pages when a booking is confirmed, expired, or completed.

### QA And Acceptance Coverage

- Add component and route-level tests for dashboard views and protected access.
- Run responsive checks for desktop and mobile dashboard usability.

### After this milestone, you can…

- Demo the complete business back office.
- Watch bookings, reservations, workers, images, and payments update from a single dashboard.
- Let a service company manage the operational output of the AI booking flow.

## Milestone 7: End-To-End Demo Hardening And Launch Readiness

**Goal:** Turn the individual features into a reliable, polished v1 demo that proves inbound call to paid booking.

### End-To-End Flow

- Script and test the successful booking scenario from customer call through intake, classification, pricing, slot hold, payment, confirmation, and dashboard update.
- Script and test the image upload scenario where analysis improves context but does not block booking.
- Script and test reservation expiry, payment retry safety, and overlapping availability protection.

### Reliability And Observability

- Add structured logging for call sessions, classification attempts, reservation creation, payment events, webhook processing, and expiry workflows.
- Add admin-visible error states for failed classification, failed image analysis, failed SMS delivery, and failed payment creation.
- Ensure external webhook endpoints validate signatures or shared secrets where applicable.

### Security Baseline

- Confirm dashboard routes require authentication.
- Confirm uploaded images are private and displayed through signed access.
- Confirm Stripe-hosted payment is used and raw card data is never stored.
- Review customer PII storage and remove unnecessary sensitive fields from logs.

### Demo Operations

- Create a repeatable demo reset process for data, workers, availability, and reservations.
- Add sample call scripts and expected outcomes for the main acceptance scenarios.
- Prepare environment setup notes for Vercel, Supabase, Stripe, Vapi, OpenAI, and Inngest.

### Polish And Usability

- Improve dashboard empty states, loading states, error messages, and status labels.
- Review the voice assistant wording for clarity around estimates, reservation holds, and payment-backed confirmation.
- Verify the UI clearly communicates that bookings are not confirmed until payment succeeds.

### Final Verification

- Run the full automated test suite.
- Manually verify webhook replay safety and double-booking prevention.
- Manually verify the final demo path in a production-like environment.

### After this milestone, you can…

- Present a credible end-to-end v1 demo to customers, judges, or stakeholders.
- Show the core product promise: a customer call becomes a confirmed, paid booking in minutes.
- Decide whether the next phase should focus on multi-business support, richer scheduling, improved routing, or production operations.
