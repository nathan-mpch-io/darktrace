export type IncidentStatus = "new" | "acknowledged" | "escalated" | "resolved";

export type Incident = {
  id: string;
  service: string;
  summary: string;
  severity: "sev-1" | "sev-2" | "sev-3";
  startedAt: string;
  status: IncidentStatus;
  bridgeNumber: string;
  runbookUrl: string;
  escalationClockMinutes: number;
};

export type Responder = {
  id: string;
  name: string;
  role: string;
  shift: string;
  phone: string;
  notificationMode: "critical" | "time-sensitive" | "sms-fallback";
  status: "available" | "acked" | "offline";
};

export type AppUserRole = "admin" | "user";

export type ScheduleDayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type OnCallDayWindow = {
  enabled: boolean;
  startTime: string;
  endTime: string;
};

export type OnCallSchedule = {
  days: Record<ScheduleDayKey, OnCallDayWindow>;
  timezone: string;
};

export type AppUser = {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: AppUserRole;
  onCallSchedule?: OnCallSchedule;
};
