# Product Spec — AI Job Intake & Booking Agent (v1)

## Goal

Build an AI system that turns a customer call into a confirmed, paid booking in minutes.

## Product Positioning

This product is designed for service businesses that lose revenue through missed calls, delayed responses, and manual booking workflows. The system should answer instantly, gather the right information, provide a clear next step, and move the customer toward payment-backed booking confirmation.

## Target Users

### Primary User: Customer

A customer calls with a practical home-service problem such as:

- Boiler not working
- Leak under sink
- No hot water
- Electrical fault

They want:

- Fast response
- Clear price expectations
- A quick booking process
- Confidence that someone is coming

### Business User: Service Company

A small plumbing, electrical, or heating business with:

- Limited office staff
- Missed inbound calls
- Manual scheduling
- Slow response times outside working hours

They want:

- More jobs booked
- Less admin work
- Faster qualification of incoming jobs
- Better visibility into bookings, workers, and payments

## Core Product Principles

- The conversation should feel natural and human, not like a rigid phone tree.
- The business flow must still remain structured underneath the conversation.
- Customer contact details are collected through a form, not parsed from speech — this ensures accuracy.
- The problem description comes from the voice conversation, not the form — the customer already described it to the agent verbally.
- A booking is only confirmed after successful payment.
- The payment link is never sent before the customer has completed the intake form — this is a hard system rule.
- The first version is for a single service business, not a multi-tenant platform.

## End-to-End User Flow

### 1. Customer Calls

- Customer calls a business phone number
- AI answers instantly

### 2. AI Gathers Problem Context

The AI should:

- Understand the customer problem through natural conversation
- Establish the urgency level (emergency, same-day, or scheduled)
- Ask any relevant follow-up questions about the issue

The AI collects only problem context verbally. It does not attempt to collect names, addresses, or phone numbers over the phone.

Example verbal exchange:

- What's the issue?
- Is it urgent or can it wait?
- Any error codes or visible damage?

### 3. Intake Form Sent Mid-Call

Immediately after the problem context is established, the AI sends a short intake form link to the customer's phone via WhatsApp — while the call is still active.

The AI tells the customer:

`I've just sent you a quick form on WhatsApp — it takes less than a minute. Could you fill it in now while we're on the call?`

The form collects:

- Customer name
- Service address (line 1, city, postcode)
- Phone number confirmation
- Photos of the issue (optional, up to 5)

The form does not ask the customer to describe the problem in writing — they have already done so verbally with the agent. The form is mobile-optimised and designed to be completed in under 60 seconds on a phone screen.

### 4. Form Completion Advances the Job

Once the customer submits the form, the system:

- Writes the verified customer details to the database
- Advances the job from `intake` to `qualified`
- Signals the AI that it can proceed with pricing and scheduling

If the customer has not yet submitted the form, the AI holds back and gently reminds them, but does not proceed to pricing or payment.

### 5. AI Call Summary Generated

After the conversation, the system generates a clean AI summary of what was discussed — what the problem is, urgency signals, any relevant detail mentioned verbally.

This summary is stored on the job record and is what the worker sees before attending. It is not typed by the customer — it is derived from the actual conversation.

Example summary: `Customer reports boiler losing pressure and no hot water for two days. Last serviced three years ago. No error codes visible. Treating as same-day.`

### 6. Job Classification

Using the AI-generated call summary, the system determines:

- Job type
- Urgency level
- Required trade or skill

Examples:

- Boiler repair
- Leak investigation
- Emergency electrical fault

Urgency examples:

- Emergency
- Same-day
- Scheduled

### 7. Price Estimation

The AI provides a pricing response that may include:

- Fixed call-out fee
- Repair estimate range

Example:

`Estimated cost: £80 call-out fee, plus likely repair cost in the £100–£250 range depending on the underlying issue.`

Pricing should be clear enough to move the customer forward, without pretending to guarantee a final repair total before inspection.

### 8. Scheduling

The AI checks worker availability and proposes suitable time slots.

Example:

`I can offer tomorrow 2–4pm or the next day morning. Which works better for you?`

### 9. Reservation

Once the customer selects a slot, the system places a temporary hold on that booking.

- The slot is reserved, not yet confirmed
- The reservation is time-limited
- Default example hold window: 2 hours

### 10. Payment Request

Only after the intake form is fully submitted does the system send a payment link via WhatsApp to collect the call-out fee.

This is enforced at the system level — the payment link cannot be generated if the intake form is incomplete.

Supported payment methods in v1:

- Card
- Apple Pay
- Google Pay

Example:

`To confirm your booking, please pay the £80 call-out fee using the secure link I've just sent on WhatsApp.`

### 11. Booking Confirmation

If payment succeeds:

- Booking is confirmed
- Worker is assigned
- Calendar is updated
- Customer receives confirmation
- Business sees the new confirmed job

If payment does not succeed:

- Booking remains unconfirmed
- Reservation expires automatically when the hold window ends

## Business Dashboard (Back Office)

### Worker Management

The dashboard should show:

- Worker name
- Trade or skill
- Service area or rough location
- Availability
- Current job status

### Scheduling View

The dashboard should include a calendar-style view showing:

- Confirmed jobs
- Reserved slots
- Open availability gaps

### Job View

Each job should include:

- Customer details (from the verified intake form: name, address, phone)
- AI-generated call summary (what the customer described verbally to the agent)
- Photos uploaded by the customer via the form, if any
- Price estimate
- Assigned worker
- Job status
- Intake form completion status

Core statuses:

- Pending (form not yet submitted)
- Qualified (form complete, awaiting pricing or slot)
- Reserved
- Confirmed
- Completed

### Payment Tracking

The dashboard should show payment state linked to the booking:

- Pending
- Paid
- Failed

## Functional Requirements

### 1. AI Call Handling

- Answer inbound calls
- Hold a natural conversation about the problem
- Establish urgency verbally
- Save the transcript so the worker can review it before the appointment

### 2. Mid-Call Form Handoff

The AI must send an intake form link via WhatsApp at the start of every call and actively guide the customer to complete it during the call.

The form link must:

- Be sent immediately after the problem context is established
- Be tied to the specific call session via a signed token
- Expire after a configurable window
- Be mobile-optimised and fast to complete

### 3. Call + WhatsApp Hybrid Flow

The system must support phone conversation plus outbound WhatsApp messages for:

- Intake form link (sent mid-call)
- Image upload link
- Payment link
- Booking confirmation

### 4. Structured Intake Via Form

The form must capture:

- Customer name
- Service address
- Phone number confirmation
- Photos of the issue (optional, up to 5)

The form must not ask the customer to describe the problem — they have already done so verbally.

### 5. AI Call Summary

After the conversation ends, the system generates a concise AI summary of what was discussed. This is stored on the job as `problem_summary` and is what the worker sees before attending. It is derived from the call transcript, not from the form.

### 6. Image Upload + Analysis

- Customer uploads photos via the intake form (up to 5, optional)
- System stores photos in Supabase Storage
- System may analyse photos with OpenAI for additional context

### 7. Classification

The system classifies the job using the AI-generated call summary to determine trade, urgency, and job type.

### 8. Pricing Logic

Pricing must support:

- Fixed call-out fee
- Price ranges
- Business-configurable pricing inputs

### 9. Availability + Scheduling

The system must:

- Track worker availability
- Match jobs to workers based on skill
- Generate available slots

### 10. Reservation System

- Support a temporary booking state
- Expire unpaid reservations automatically — handled by lazy expiry on every reservation read and a periodic database sweep, with no external workflow engine required

### 11. Payment Integration

- Generate a payment link only after the intake form is complete
- Accept card, Apple Pay, and Google Pay
- Confirm the booking only after payment success

### 12. Notifications

Customer notifications (sent via WhatsApp):

- Intake form link (mid-call)
- Image upload prompt
- Payment link
- Booking confirmation

Business notifications:

- New booked job alert
- Visibility into reservation and payment status

## Non-Goals For Hackathon v1

Do not build:

- Full ERP or field-service management system
- Complex route optimization
- Real-time GPS tracking
- Advanced pricing engine
- Multi-region tax logic
- Multi-tenant business support

## Demo Scenario

The demo should show:

1. A judge calls the number
2. The AI answers immediately
3. The judge says, `My boiler isn't working`
4. The AI asks two or three natural follow-up questions about the problem
5. The AI says: `I've just sent you a quick form on WhatsApp — fill it in now and we'll get you sorted`
6. The judge opens the WhatsApp message, fills in their name and address on the form (and optionally adds a photo)
7. The system generates an AI summary of the conversation and advances the job to qualified
8. The AI provides a price expectation
9. The AI offers available time slots
10. The AI sends a payment link — only now that the form is complete
11. The judge pays
12. The dashboard updates live with the confirmed booking

## Success Criteria For v1

- A caller can move from first contact to paid booking in a few minutes
- The interaction feels conversational rather than scripted
- Customer details are accurate because they came directly from the customer via the form
- The payment link is never sent to a customer who has not completed the intake form
- The business gets enough structured data to act on the job
- The system clearly distinguishes reserved bookings from confirmed bookings
- The dashboard reflects call, booking, and payment state accurately
