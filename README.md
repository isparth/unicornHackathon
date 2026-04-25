# AI Job Intake & Booking Agent

Milestone 1 establishes the product skeleton for a single-service-business booking agent:

- Next.js, React, TypeScript, and Tailwind CSS application foundation
- Shared domain types and enum mappings
- Explicit job state machine with validation for required structured fields
- Supabase schema for customers, calls, jobs, workers, availability, reservations, payments, and uploaded assets
- Seed data for one demo service business, workers, availability windows, sample jobs, a reservation, and a payment
- Focused unit tests for configuration defaults, enum values, and job transitions

## Requirements

- Node.js 22 or newer
- npm
- Optional for local database work: Supabase CLI and Docker

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then use the dashboard link.

The app can build and run without real external API credentials. Supabase credentials are required only when code calls the Supabase service client or when you want to run against a local or hosted database.

## Environment Variables

| Variable                        | Required                       | Purpose                                           |
| ------------------------------- | ------------------------------ | ------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes for database access        | Supabase project URL or local API URL             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes for client database access | Supabase anonymous key                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes for server database access | Server-side Supabase service role key             |
| `RESERVATION_HOLD_MINUTES`      | No                             | Reservation hold duration, defaults to `120`      |
| `DEFAULT_CURRENCY`              | No                             | Pricing currency, defaults to `gbp`               |
| `DEFAULT_CALLOUT_FEE_PENCE`     | No                             | Default call-out fee, defaults to `8000`          |
| `DEFAULT_REPAIR_MIN_PENCE`      | No                             | Default repair range minimum, defaults to `10000` |
| `DEFAULT_REPAIR_MAX_PENCE`      | No                             | Default repair range maximum, defaults to `25000` |

## Scripts

```bash
npm run dev        # start the Next.js app
npm test           # run unit tests
npm run lint       # run ESLint
npm run typecheck  # run TypeScript without emitting files
npm run build      # production build
npm run db:reset   # reset local Supabase database and apply seed data
npm run db:seed    # alias for db:reset
```

## Database Setup

Start Supabase locally, then reset the database:

```bash
supabase start
npm run db:reset
```

The migration lives in `supabase/migrations/202604250001_milestone_1_core_schema.sql`.
The demo seed data lives in `supabase/seed.sql`.

After seeding, the database contains:

- `Northstar Home Services`
- Three workers: heating, plumbing, and electrical
- Three availability windows
- Three sample jobs across `intake`, `priced`, and `confirmed`
- One confirmed reservation and one paid payment
- One call session and one transcript uploaded asset record

## What To Check

1. Run `npm test` and confirm all unit tests pass.
2. Run `npm run build` and confirm the production build completes.
3. Run `npm run dev`, open [http://localhost:3000/dashboard](http://localhost:3000/dashboard), and confirm you can see demo jobs, workers, state-transition checks, and config-derived hold duration.
4. Open [http://localhost:3000/api/health](http://localhost:3000/api/health) and confirm it returns JSON with `ok: true`.
5. If Supabase CLI is installed, run `supabase start && npm run db:reset`, then inspect the seeded tables in Supabase Studio at [http://localhost:54323](http://localhost:54323).
