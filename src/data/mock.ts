import { AppUser, Incident, Responder } from "../types";

export const activeIncident: Incident = {
  id: "INC-4821",
  service: "Core Identity Platform",
  summary: "Authentication requests are timing out across production.",
  severity: "sev-1",
  startedAt: "02:13",
  status: "new",
  bridgeNumber: "+44 20 7946 0113",
  runbookUrl: "https://internal.example/runbooks/identity-sev1",
  escalationClockMinutes: 7,
};

export const responders: Responder[] = [
  {
    id: "r1",
    name: "Ava Patel",
    role: "Primary On-Call",
    shift: "Tonight until 08:00",
    phone: "+44 7700 900111",
    notificationMode: "critical",
    status: "acked",
  },
  {
    id: "r2",
    name: "Morgan Reed",
    role: "Secondary On-Call",
    shift: "Escalates after 7 min",
    phone: "+44 7700 900222",
    notificationMode: "critical",
    status: "available",
  },
  {
    id: "r3",
    name: "Jordan Bell",
    role: "Duty Manager",
    shift: "Escalates after 12 min",
    phone: "+44 7700 900333",
    notificationMode: "sms-fallback",
    status: "available",
  },
];

export const deliveryRules = [
  "Push critical alert to primary responder",
  "Repeat every 90 seconds until acknowledged",
  "Escalate to secondary after 7 minutes",
  "Trigger SMS fallback after 12 minutes",
];

export const seedUsers: AppUser[] = [
  {
    id: "u-admin",
    username: "admin",
    password: "pass123",
    displayName: "System Administrator",
    role: "admin",
  },
  {
    id: "u-nick",
    username: "nick",
    password: "TempPass1!",
    displayName: "Nick",
    role: "user",
  },
  {
    id: "u-milo",
    username: "milo",
    password: "TempPass1!",
    displayName: "Milo",
    role: "user",
  },
  {
    id: "u-jacob",
    username: "jacob",
    password: "TempPass1!",
    displayName: "Jacob",
    role: "user",
  },
];
