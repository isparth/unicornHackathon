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
- The assistant should gather information opportunistically rather than forcing a fixed script.
- A booking is only confirmed after successful payment.
- The first version is for a single service business, not a multi-tenant platform.

## End-to-End User Flow

### 1. Customer Calls

- Customer calls a business phone number
- AI answers instantly

### 2. AI Intake Conversation

The AI should:

- Understand the customer problem
- Ask structured follow-up questions naturally
- Gather enough information to qualify the job

Example questions:

- What’s the issue?
- Where is it located?
- Is it urgent?
- Are there any error codes?
- Has this happened before?

### 3. Optional Image Upload

If useful, the AI sends a link by SMS so the customer can upload an image.

The image is used to improve:

- Diagnosis quality
- Confidence in classification
- Price estimate context

Image upload is optional and should not block the booking flow.

### 4. Job Classification

The system determines:

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

### 5. Price Estimation

The AI provides a pricing response that may include:

- Fixed call-out fee
- Repair estimate range

Example:

`Estimated cost: £80 call-out fee, plus likely repair cost in the £100–£250 range depending on the underlying issue.`

Pricing should be clear enough to move the customer forward, without pretending to guarantee a final repair total before inspection.

### 6. Scheduling

The AI checks worker availability and proposes suitable time slots.

Example:

`I can offer tomorrow 2–4pm or the next day morning. Which works better for you?`

### 7. Reservation

Once the customer selects a slot, the system places a temporary hold on that booking.

- The slot is reserved, not yet confirmed
- The reservation is time-limited
- Default example hold window: 2 hours

### 8. Payment Request

The AI sends a payment link by SMS or web link to collect the call-out fee.

Supported payment methods in v1:

- Card
- Apple Pay
- Google Pay

Example:

`To confirm your booking, please pay the £80 call-out fee using the secure link I’ve just sent.`

### 9. Booking Confirmation

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

- Customer details
- AI-generated issue summary
- Uploaded images, if any
- Price estimate
- Assigned worker
- Job status

Core statuses:

- Pending
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
- Hold a natural conversation
- Extract structured data from speech
- Save the key information so the worker can review it before the appointment

### 2. Call + SMS Hybrid Flow

The system must support phone conversation plus outbound messages for:

- Image upload link
- Payment link
- Booking confirmation

### 3. Structured Intake Engine

The system must capture:

- Problem type
- Urgency
- Customer details
- Location
- Relevant issue details

### 4. Image Upload + Analysis

- Customer can upload an image through a link
- System stores the image
- System may analyze the image for additional context

### 5. Pricing Logic

Pricing must support:

- Fixed call-out fee
- Price ranges
- Business-configurable pricing inputs

### 6. Availability + Scheduling

The system must:

- Track worker availability
- Match jobs to workers based on skill
- Generate available slots

### 7. Reservation System

- Support a temporary booking state
- Expire unpaid reservations automatically

### 8. Payment Integration

- Generate a payment link
- Accept card, Apple Pay, and Google Pay
- Confirm the booking only after payment success

### 9. Notifications

Customer notifications:

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
3. The judge says, `My boiler isn’t working`
4. The AI asks natural follow-up questions
5. The AI sends an image upload link
6. The AI gives a price expectation
7. The AI offers available time slots
8. The AI sends a payment link
9. The judge pays
10. The dashboard updates live with the confirmed booking

## Success Criteria For v1

- A caller can move from first contact to paid booking in a few minutes
- The interaction feels conversational rather than scripted
- The business gets enough structured data to act on the job
- The system clearly distinguishes reserved bookings from confirmed bookings
- The dashboard reflects call, booking, and payment state accurately
