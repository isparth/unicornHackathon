import type { Job, ServiceBusiness, Worker } from "./types";

export const demoBusiness: ServiceBusiness = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Northstar Home Services",
  phoneNumber: "+44 20 7946 0182",
  serviceArea: "North London",
  createdAt: "2026-04-25T09:00:00.000Z",
  updatedAt: "2026-04-25T09:00:00.000Z",
};

export const demoWorkers: Worker[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    serviceBusinessId: demoBusiness.id,
    name: "Amara Lewis",
    skill: "heating",
    serviceArea: "Islington, Camden",
    active: true,
    createdAt: "2026-04-25T09:00:00.000Z",
    updatedAt: "2026-04-25T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    serviceBusinessId: demoBusiness.id,
    name: "Theo Grant",
    skill: "plumbing",
    serviceArea: "Hackney, Haringey",
    active: true,
    createdAt: "2026-04-25T09:00:00.000Z",
    updatedAt: "2026-04-25T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    serviceBusinessId: demoBusiness.id,
    name: "Priya Shah",
    skill: "electrical",
    serviceArea: "Barnet, Enfield",
    active: true,
    createdAt: "2026-04-25T09:00:00.000Z",
    updatedAt: "2026-04-25T09:00:00.000Z",
  },
];

export const demoJobs: Job[] = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    serviceBusinessId: demoBusiness.id,
    customerId: "00000000-0000-4000-8000-000000000301",
    status: "intake",
    problemSummary:
      "Customer reports no hot water and an error code on the boiler.",
    urgency: "same_day",
    requiredSkill: "heating",
    createdAt: "2026-04-25T09:30:00.000Z",
    updatedAt: "2026-04-25T09:30:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    serviceBusinessId: demoBusiness.id,
    customerId: "00000000-0000-4000-8000-000000000302",
    status: "priced",
    problemSummary: "Leak under kitchen sink after using the washing machine.",
    urgency: "scheduled",
    requiredSkill: "plumbing",
    priceEstimate: {
      currency: "gbp",
      calloutFeePence: 8000,
      repairEstimateMinPence: 10000,
      repairEstimateMaxPence: 25000,
      explanation: "Fixed call-out fee plus a non-guaranteed repair range.",
    },
    createdAt: "2026-04-25T10:00:00.000Z",
    updatedAt: "2026-04-25T10:08:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    serviceBusinessId: demoBusiness.id,
    customerId: "00000000-0000-4000-8000-000000000303",
    status: "confirmed",
    problemSummary: "Downstairs sockets tripping when kettle is switched on.",
    urgency: "emergency",
    requiredSkill: "electrical",
    assignedWorkerId: demoWorkers[2].id,
    reservationId: "00000000-0000-4000-8000-000000000401",
    paymentId: "00000000-0000-4000-8000-000000000501",
    selectedSlotStartsAt: "2026-04-25T14:00:00.000Z",
    selectedSlotEndsAt: "2026-04-25T16:00:00.000Z",
    priceEstimate: {
      currency: "gbp",
      calloutFeePence: 12000,
      repairEstimateMinPence: 15000,
      repairEstimateMaxPence: 35000,
      explanation: "Emergency call-out plus likely fault-finding range.",
    },
    createdAt: "2026-04-25T08:20:00.000Z",
    updatedAt: "2026-04-25T08:45:00.000Z",
  },
];
