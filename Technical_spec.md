# Technical Spec — AI Job Intake & Booking Agent (v1)

## Overview

This system will be built as a single-business v1 using a `Next.js` and `TypeScript` application as the main product surface and backend runtime.

The architecture is designed to balance:

- Fast implementation speed
- Strong live demo quality
- Clear upgrade path into a more durable MVP
- Natural voice interaction without losing structured business control

## Chosen Stack

### Application Layer

- `Next.js`
- `React`
- `TypeScript`
- `Tailwind CSS`

### Core Services

- `Vapi` for inbound voice runtime and SMS handoff
- `Supabase` for Postgres, auth, storage, and realtime updates
- `Stripe` for payment collection and payment confirmation
- `OpenAI` for structured extraction, classification, and image analysis
- `Inngest` for async workflows, delays, retries, and reservation expiry

### Deployment Assumption

- Main application deployed on `Vercel` or equivalent managed hosting
- Managed cloud services used for all external dependencies

## Architecture

### 1. Next.js Monolith

The application will use a `Next.js` monolith for:

- Business dashboard UI
- Server-rendered and client-side app flows
- API route handlers
- Webhook endpoints
- Server-side orchestration modules

This is intentionally not a frontend-only app. The product logic will live in a backend domain layer inside the same TypeScript codebase.

### 2. App-Owned Orchestration

The system will not rely on `Vapi` as the primary business brain.

Instead:

- `Vapi` handles voice runtime and telephony interaction
- The app owns job state, pricing decisions, scheduling, reservation logic, payment progression, and booking confirmation

This keeps the system flexible while preventing the voice experience from becoming a brittle scripted bot.

### 3. Strict Business Flow, Flexible Conversation

The design separates:

- Business workflow state
- Conversational behavior

The assistant must sound natural and adaptive, but the backend controls what actions are allowed and what information is still required before the flow can progress.

## Conversation Orchestration Model

### Guiding Principle

The assistant should not behave like a rigid call-center script.

Instead:

- It can vary wording
- It can ask questions in different orders
- It can acknowledge context naturally
- It can skip already-known questions

But underneath that flexibility, the system tracks required structured fields and business state transitions deterministically.

### Structured Intake Model

The system should collect required information opportunistically rather than with a fixed sequence.

Expected core intake fields:

- Customer name
- Phone number
- Service address or location details
- Problem summary
- Problem category
- Urgency
- Required trade or skill
- Optional image attachment
- Selected slot

## Core State Machine

The booking workflow should use an explicit job state machine.

Primary states:

- `intake`
- `qualified`
- `priced`
- `slot_held`
- `awaiting_payment`
- `confirmed`
- `expired`
- `completed`

### State Intent

- `intake`: call is active or initial information is being gathered
- `qualified`: enough structured information exists to classify the job
- `priced`: pricing response has been prepared or delivered
- `slot_held`: a time slot is reserved temporarily
- `awaiting_payment`: customer has been sent to payment
- `confirmed`: payment succeeded and booking is locked in
- `expired`: reservation expired before successful payment
- `completed`: job was finished by the business

The state machine governs system actions, but not the exact wording or turn-by-turn order of the conversation.

## Main Components

### 1. Voice Session Layer

Responsibilities:

- Receive inbound call events from `Vapi`
- Track live call/session context
- Capture transcript and event history
- Send SMS links for image upload and payment when needed

Key output:

- Structured call session record
- Events that drive orchestration decisions

### 2. Intake And Classification Service

Responsibilities:

- Extract structured fields from transcript and interaction context
- Classify problem type
- Determine urgency
- Infer required worker skill
- Generate a worker-friendly summary of the issue

This layer uses `OpenAI` and persists the resulting structured data into the application database.

### 3. Image Analysis Service

Responsibilities:

- Accept uploaded image references
- Store images in `Supabase Storage`
- Analyze images with `OpenAI` when useful
- Add image-derived context to the job record

Image analysis is supplemental and must not block the main booking flow.

### 4. Pricing Service

Responsibilities:

- Apply configurable pricing logic for the business
- Return call-out fee and estimated range where applicable
- Produce a customer-facing price explanation

For v1, pricing remains simple and intentionally non-exhaustive.

### 5. Scheduling Service

Responsibilities:

- Read worker availability
- Match worker skills to job requirements
- Generate valid bookable slots
- Prevent double-booking
- Create temporary reservations

The scheduling model is intentionally simple for v1:

- Skill matching
- Basic availability windows
- Optional rough service area matching
- No route optimization

### 6. Payment Orchestration Service

Responsibilities:

- Create Stripe-backed payment flow
- Link payment attempt to reservation
- Advance job state on successful payment
- Prevent duplicate confirmations from repeated webhook delivery

### 7. Notification Service

Responsibilities:

- Send customer-facing messages such as:
  - image upload prompt
  - payment link
  - booking confirmation
- Surface business-facing alerts and realtime dashboard updates

### 8. Async Workflow Layer

`Inngest` will handle:

- Reservation-expiry timers
- Webhook retries and recovery steps
- Delayed follow-up work
- Event-driven background orchestration

This avoids pushing long-running logic into request-response route handlers.

## Data Model

The database will be centered in `Supabase Postgres`.

### Core Entities

#### `Customer`

Stores:

- Name
- Phone number
- Contact metadata
- Address or location details

#### `CallSession`

Stores:

- Link to customer
- Voice session identifiers
- Transcript or transcript references
- Session events
- Summary and extraction status

#### `Job`

Stores:

- Link to customer
- Problem summary
- Classification outputs
- Urgency
- Required skill
- Price estimate data
- Current job status
- Assigned worker reference
- Selected slot reference

#### `Worker`

Stores:

- Name
- Skill or trade
- Service area
- Availability metadata
- Current status

#### `AvailabilityWindow`

Stores:

- Worker reference
- Day/time availability windows
- Bookable periods
- Exceptions if needed

#### `Reservation`

Stores:

- Job reference
- Worker reference
- Reserved slot
- Expiry time
- Reservation status

#### `Payment`

Stores:

- Job reference
- Reservation reference
- Stripe identifiers
- Payment amount
- Payment status

#### `UploadedAsset`

Stores:

- Job or call session reference
- Storage path
- Asset type
- Analysis metadata

### Important Enums

Define and use shared enums for:

- `job_status`
- `payment_status`
- `urgency`
- `worker_skill`

## External Integrations

### Vapi

`Vapi` is responsible for:

- Inbound call handling
- Live voice runtime
- Conversation execution at the telephony layer
- Sending SMS handoff messages where supported
- Emitting webhook or event callbacks into the app

The app remains responsible for business decisions and persistence.

### OpenAI

`OpenAI` is responsible for:

- Transcript-to-structure extraction
- Job classification
- Urgency interpretation
- Worker summary generation
- Optional image analysis

The app must validate and persist the outputs before relying on them for business actions.

### Supabase

`Supabase` is responsible for:

- Primary relational database
- Authentication for internal dashboard users
- Private image storage
- Realtime updates for dashboard views

### Stripe

`Stripe` is responsible for:

- Hosted payment flow
- Card, Apple Pay, and Google Pay support
- Payment status webhooks

The application should never handle raw card details directly.

### Inngest

`Inngest` is responsible for:

- Delayed hold expiry
- Retry-safe background execution
- Event-driven orchestration support
- Audit-friendly async workflow visibility

## API And Interface Expectations

### Public/External Endpoints

The app should expose webhook endpoints for:

- `Vapi` call and event callbacks
- `Stripe` payment events

### Internal Application Endpoints

The app should expose server-side actions or route handlers for:

- Worker management
- Availability updates
- Job listing and detail retrieval
- Slot generation and reservation actions
- Dashboard payment visibility
- Image upload initiation and completion

### Upload Flow

The image flow should support one of:

- Signed upload URL generation
- App-mediated upload endpoint

The uploaded asset should be stored privately and linked back to the relevant job or call session.

## Dashboard Requirements

The dashboard should support:

- Worker management
- Scheduling calendar
- Job detail inspection
- Payment tracking
- Realtime updates when a reservation or booking changes state

The UI should clearly distinguish:

- Pending jobs
- Reserved jobs
- Confirmed bookings
- Completed work

## Reliability Rules

- A slot must not be double-booked
- Payment success must be idempotent
- Replayed webhooks must not create duplicate confirmations
- Reservation expiry must release held capacity automatically
- Image analysis failure must not block booking progression
- Missing structured fields must block business transitions that require them

## Security And Compliance Baseline

For v1:

- Do not store or process card details directly
- Use Stripe-hosted payment flows
- Restrict dashboard access to authenticated business users
- Store uploaded images privately
- Use signed access when temporary asset display is needed
- Keep customer PII in controlled database records only

## Acceptance Scenarios

### 1. Successful End-to-End Booking

- Customer calls
- AI gathers issue details
- System classifies the problem
- AI shares price expectation
- Customer selects a slot
- System holds the slot
- Customer pays
- Booking becomes confirmed
- Dashboard updates live

### 2. Image Upload Enhances Context

- AI sends an image upload link
- Customer uploads an image
- System stores and analyzes it
- Analysis improves context but does not block booking if unavailable

### 3. Reservation Expiry

- Customer chooses a slot
- Slot is held
- Customer does not pay
- Hold expires automatically after the configured window
- Slot becomes available again

### 4. Payment Retry Safety

- Stripe webhook is delivered more than once
- System processes the event idempotently
- Booking is confirmed once only

### 5. Availability Protection

- Two customers try to claim overlapping capacity
- System prevents double-booking
- Dashboard reflects final reservation and confirmation state correctly

### 6. Natural Conversation With Structured Completion

- The AI varies the wording and order of questions
- The customer experience remains conversational
- The required structured fields are still collected before pricing, slot hold, or payment progression

## v1 Boundaries

The first implementation intentionally excludes:

- Multi-tenant architecture
- Advanced routing optimization
- Real-time vehicle tracking
- Complex tax logic
- Enterprise operations tooling

This keeps the product focused on one strong flow: inbound call to paid booking.
