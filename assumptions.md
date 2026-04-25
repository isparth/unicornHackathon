# Assumptions

- The first version is single-business, so the schema includes `service_businesses` as a simple ownership table rather than a full multi-tenant account model.
- Milestone 1 should not require live OpenAI, Vapi, Stripe, or Inngest credentials; those integrations are reserved for later milestones.
- Supabase is represented by SQL migrations and seed data now. A live local Supabase database can be started with the Supabase CLI when available.
- Reservation holds default to 120 minutes, matching the product spec example.
- Pricing defaults use GBP pence values because the product examples use UK pricing.
- Worker skills are limited to `plumbing`, `heating`, and `electrical` for the demo scenarios in the specs.
- The dashboard uses local demo data in Milestone 1 so the app can be viewed before database query services are implemented in later milestones.
