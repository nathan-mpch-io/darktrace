import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");
const dbPath = join(dataDir, "db.json");
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_TIMEZONE = "Europe/London";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEZONE_ALIASES = {
  UTC: "UTC",
  GMT: "Europe/London",
  BST: "Europe/London",
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  CET: "Europe/Paris",
  CEST: "Europe/Paris",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
};
const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function defaultWeeklySchedule(startTime = "00:00", endTime = "23:59") {
  return {
    timezone: DEFAULT_TIMEZONE,
    days: Object.fromEntries(
      DAY_KEYS.map((day) => [
        day,
        {
          enabled: true,
          startTime,
          endTime,
        },
      ]),
    ),
  };
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = stored.split(":");
  if (!salt || !originalHash) {
    return false;
  }

  const candidateHash = scryptSync(password, salt, 64);
  const originalBuffer = Buffer.from(originalHash, "hex");

  if (candidateHash.length !== originalBuffer.length) {
    return false;
  }

  return timingSafeEqual(candidateHash, originalBuffer);
}

function nowIso() {
  return new Date().toISOString();
}

function plusMsIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function nextId(prefix) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function createSeedDb() {
  return {
    users: [
      {
        id: "usr_admin",
        username: "admin",
        passwordHash: hashPassword("pass123"),
        displayName: "System Administrator",
        role: "admin",
        onCallSchedule: defaultWeeklySchedule(),
        createdAt: nowIso(),
      },
      {
        id: "usr_nick",
        username: "nick",
        passwordHash: hashPassword("TempPass1!"),
        displayName: "Nick",
        role: "user",
        onCallSchedule: defaultWeeklySchedule("00:00", "08:00"),
        createdAt: nowIso(),
      },
      {
        id: "usr_milo",
        username: "milo",
        passwordHash: hashPassword("TempPass1!"),
        displayName: "Milo",
        role: "user",
        onCallSchedule: defaultWeeklySchedule("08:00", "16:00"),
        createdAt: nowIso(),
      },
      {
        id: "usr_jacob",
        username: "jacob",
        passwordHash: hashPassword("TempPass1!"),
        displayName: "Jacob",
        role: "user",
        onCallSchedule: defaultWeeklySchedule("16:00", "23:59"),
        createdAt: nowIso(),
      },
    ],
    sessions: [],
    devices: [],
    pages: [],
    auditLogs: [],
  };
}

function ensureDb() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dbPath)) {
    writeFileSync(dbPath, JSON.stringify(createSeedDb(), null, 2));
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  let changed = false;

  const now = Date.now();
  const originalSessionCount = Array.isArray(db.sessions) ? db.sessions.length : 0;
  db.sessions = (db.sessions || []).filter((session) => {
    if (!session?.expiresAt) {
      return false;
    }

    return Date.parse(session.expiresAt) > now;
  });
  if (db.sessions.length !== originalSessionCount) {
    changed = true;
  }

  db.users = db.users.map((user) => {
    let nextUser = user;

    if (nextUser.role === "responder") {
      nextUser = {
        ...nextUser,
        role: "user",
      };
      changed = true;
    }

    if (nextUser.onCallSchedule?.days) {
      return nextUser;
    }

    changed = true;
    return {
      ...nextUser,
      onCallSchedule: normalizeSchedule(nextUser.onCallSchedule || {}),
    };
  });

  if (changed) {
    writeDb(db);
  }

  return db;
}

function writeDb(db) {
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    onCallSchedule: user.onCallSchedule,
    isOnCallNow: user.role === "admin" ? true : isScheduleOnCallNow(user.onCallSchedule),
    createdAt: user.createdAt,
  };
}

function sanitizeUserForViewer(user, viewer) {
  if (viewer.role === "admin") {
    return sanitizeUser(user);
  }

  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    isOnCallNow: user.role === "admin" ? true : isScheduleOnCallNow(user.onCallSchedule),
  };
}

function sanitizeDevice(device) {
  return {
    id: device.id,
    userId: device.userId,
    platform: device.platform,
    deviceName: device.deviceName,
    pushToken: device.pushToken,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

function normalizeTimeString(input, fallback) {
  const value = String(input || fallback).replace(".", ":");
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }

  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeSchedule(input = {}) {
  const migratedDays =
    input.days ||
    Object.fromEntries(
      DAY_KEYS.map((day) => [
        day,
        {
          enabled: input.enabled !== false,
          startTime:
            typeof input.startHour === "number"
              ? `${String(Math.max(0, Math.min(23, input.startHour))).padStart(2, "0")}:00`
              : "00:00",
          endTime:
            typeof input.endHour === "number"
              ? `${String(Math.max(0, Math.min(23, input.endHour))).padStart(2, "0")}:00`
              : "23:59",
        },
      ]),
    );

  return {
    timezone: String(input.timezone || DEFAULT_TIMEZONE),
    days: Object.fromEntries(
      DAY_KEYS.map((day) => {
        const dayInput = migratedDays[day] || {};
        return [
          day,
          {
            enabled: dayInput.enabled !== false,
            startTime: normalizeTimeString(dayInput.startTime, "00:00"),
            endTime: normalizeTimeString(dayInput.endTime, "23:59"),
          },
        ];
      }),
    ),
  };
}

function resolveTimezoneIdentifier(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return DEFAULT_TIMEZONE;
  }

  const alias = TIMEZONE_ALIASES[trimmed.toUpperCase()];
  if (alias) {
    return alias;
  }

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getTimezoneContext(input, date = new Date()) {
  const timeZone = resolveTimezoneIdentifier(input);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const getPart = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = getPart("weekday").toLowerCase();
  const hour = Number(getPart("hour") || "0");
  const minute = Number(getPart("minute") || "0");

  return {
    timeZone,
    weekday,
    currentMinutes: hour * 60 + minute,
  };
}

function isScheduleOnCallNow(schedule, date = new Date()) {
  if (!schedule?.days) {
    return false;
  }

  const context = getTimezoneContext(schedule.timezone, date);
  const day = schedule.days[context.weekday];
  if (!day || !day.enabled) {
    return false;
  }

  const startMinutes = parseTimeToMinutes(day.startTime);
  const endMinutes = parseTimeToMinutes(day.endTime);

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return context.currentMinutes >= startMinutes && context.currentMinutes < endMinutes;
  }

  return context.currentMinutes >= startMinutes || context.currentMinutes < endMinutes;
}

function parseTimeToMinutes(value) {
  const normalized = normalizeTimeString(value, "00:00");
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7);
}

function getSessionUser(db, req) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) {
    return null;
  }

  if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
    return null;
  }

  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) {
    return null;
  }

  return { session, user };
}

function requireAuth(db, req, res) {
  const auth = getSessionUser(db, req);
  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return auth;
}

function requireAdmin(db, req, res) {
  const auth = requireAuth(db, req, res);
  if (!auth) {
    return null;
  }
  if (auth.user.role !== "admin") {
    sendJson(res, 403, { error: "Admin access required" });
    return null;
  }
  return auth;
}

function logAudit(db, event, actorUserId, details = {}) {
  db.auditLogs.unshift({
    id: nextId("audit"),
    event,
    actorUserId,
    createdAt: nowIso(),
    details,
  });
}

function isExpoPushToken(pushToken) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(pushToken || ""));
}

function buildPushDeliveries(db, page) {
  return db.devices
    .filter((device) => device.userId === page.targetUserId)
    .map((device) => ({
      id: nextId("delivery"),
      pageId: page.id,
      userId: page.targetUserId,
      deviceId: device.id,
      pushToken: device.pushToken,
      platform: device.platform,
      status: "queued",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      note: "Queued for Expo Push delivery.",
    }));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function deliverPageViaExpo(page, targetUser, attemptsToSend = page.deliveryAttempts) {
  if (!Array.isArray(attemptsToSend) || attemptsToSend.length === 0) {
    return {
      attempts: Array.isArray(page.deliveryAttempts) ? page.deliveryAttempts : [],
      deliveryStatus: "No registered devices yet for this user.",
    };
  }

  const attempts = attemptsToSend.map((attempt) => ({
    ...attempt,
    updatedAt: nowIso(),
  }));
  const validAttempts = attempts.filter((attempt) => isExpoPushToken(attempt.pushToken));

  if (validAttempts.length === 0) {
    return {
      attempts: attempts.map((attempt) => ({
        ...attempt,
        status: "failed",
        note: "Device token is not an Expo push token yet.",
        updatedAt: nowIso(),
      })),
      deliveryStatus: "Registered devices found, but none are ready for Expo Push.",
    };
  }

  const messageEntries = validAttempts.map((attempt) => ({
    attemptId: attempt.id,
    message: {
      to: attempt.pushToken,
      sound: "default",
      title: "SEV-1: DarkTrace",
      body: page.message,
      priority: "high",
      channelId: "incident-critical",
      data: {
        darkTracePage: true,
        pageId: page.id,
        targetUserId: page.targetUserId,
        recipientDisplayName: targetUser.displayName,
        message: page.message,
      },
    },
  }));

  try {
    const ticketByAttemptId = new Map();

    for (const batch of chunkArray(messageEntries, 100)) {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch.map((entry) => entry.message)),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.errors?.[0]?.message || payload.error || "Expo Push request failed");
      }

      const tickets = Array.isArray(payload.data) ? payload.data : [];
      batch.forEach((entry, index) => {
        ticketByAttemptId.set(entry.attemptId, tickets[index] || null);
      });
    }

    const updatedAttempts = attempts.map((attempt) => {
      if (!isExpoPushToken(attempt.pushToken)) {
        return {
          ...attempt,
          status: "failed",
          note: "Device token is not an Expo push token yet.",
          updatedAt: nowIso(),
        };
      }

      const ticket = ticketByAttemptId.get(attempt.id);
      if (!ticket) {
        return {
          ...attempt,
          status: "failed",
          note: "Expo Push did not return a ticket for this device.",
          updatedAt: nowIso(),
        };
      }

      if (ticket.status === "ok") {
        return {
          ...attempt,
          status: "sent",
          ticketId: ticket.id || null,
          note: "Expo Push accepted the notification.",
          updatedAt: nowIso(),
        };
      }

      return {
        ...attempt,
        status: "failed",
        ticketId: ticket.id || null,
        note: ticket.message || ticket.details?.error || "Expo Push rejected the notification.",
        updatedAt: nowIso(),
      };
    });

    const sentCount = updatedAttempts.filter((attempt) => attempt.status === "sent").length;
    const failedCount = updatedAttempts.length - sentCount;
    return {
      attempts: Array.isArray(page.deliveryAttempts)
        ? page.deliveryAttempts.map((attempt) => {
            const updatedAttempt = updatedAttempts.find((entry) => entry.id === attempt.id);
            return updatedAttempt || attempt;
          })
        : updatedAttempts,
      deliveryStatus:
        failedCount === 0
          ? `Delivered to Expo Push for ${sentCount} device${sentCount === 1 ? "" : "s"}.`
          : `Delivered to Expo Push for ${sentCount} device${sentCount === 1 ? "" : "s"} with ${failedCount} failure${failedCount === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return {
      attempts: Array.isArray(page.deliveryAttempts)
        ? page.deliveryAttempts.map((attempt) => {
            const matchingAttempt = attempts.find((entry) => entry.id === attempt.id);
            if (!matchingAttempt) {
              return attempt;
            }

            return {
              ...matchingAttempt,
              status: "failed",
              note: error instanceof Error ? error.message : "Expo Push delivery failed.",
              updatedAt: nowIso(),
            };
          })
        : attempts.map((attempt) => ({
            ...attempt,
            status: "failed",
            note: error instanceof Error ? error.message : "Expo Push delivery failed.",
            updatedAt: nowIso(),
          })),
      deliveryStatus: error instanceof Error ? error.message : "Expo Push delivery failed.",
    };
  }
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const db = readDb();

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "darktrace-backend",
        sdkReady: "Expo SDK 54",
        timestamp: nowIso(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJsonBody(req);
      const user = db.users.find((entry) => entry.username === body.username);

      if (!user || !verifyPassword(body.password || "", user.passwordHash)) {
        sendJson(res, 401, { error: "Invalid username or password" });
        return;
      }

      const session = {
        id: nextId("session"),
        token: randomBytes(24).toString("hex"),
        userId: user.id,
        createdAt: nowIso(),
        expiresAt: plusMsIso(SESSION_TTL_MS),
      };

      db.sessions.push(session);
      logAudit(db, "auth.login", user.id);
      writeDb(db);

      sendJson(res, 200, {
        token: session.token,
        user: sanitizeUser(user),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const auth = requireAuth(db, req, res);
      if (!auth) {
        return;
      }

      sendJson(res, 200, { user: sanitizeUser(auth.user) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = getBearerToken(req);
      if (!token) {
        sendJson(res, 200, { ok: true });
        return;
      }

      const originalLength = db.sessions.length;
      db.sessions = db.sessions.filter((entry) => entry.token !== token);
      if (db.sessions.length !== originalLength) {
        writeDb(db);
      }

      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      const auth = requireAuth(db, req, res);
      if (!auth) {
        return;
      }

      sendJson(res, 200, {
        users: db.users.map((user) => sanitizeUserForViewer(user, auth.user)),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      const body = await readJsonBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();
      const displayName = String(body.displayName || "").trim();
      const role = body.role === "admin" ? "admin" : "user";
      const onCallSchedule = normalizeSchedule(body.onCallSchedule);

      if (!username || !password || !displayName) {
        sendJson(res, 400, { error: "displayName, username, and password are required" });
        return;
      }

      if (db.users.some((entry) => entry.username.toLowerCase() === username.toLowerCase())) {
        sendJson(res, 409, { error: "Username already exists" });
        return;
      }

      const newUser = {
        id: nextId("usr"),
        username,
        passwordHash: hashPassword(password),
        displayName,
        role,
        onCallSchedule,
        createdAt: nowIso(),
      };

      db.users.push(newUser);
      logAudit(db, "users.create", auth.user.id, { targetUserId: newUser.id });
      writeDb(db);

      sendJson(res, 201, { user: sanitizeUser(newUser) });
      return;
    }

    const userUpdateMatch =
      req.method === "POST" && url.pathname.match(/^\/api\/users\/([^/]+)$/);

    if (userUpdateMatch) {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      const userId = userUpdateMatch[1];
      const user = db.users.find((entry) => entry.id === userId);

      if (!user) {
        sendJson(res, 404, { error: "User not found" });
        return;
      }

      const body = await readJsonBody(req);

      if (typeof body.displayName === "string" && body.displayName.trim()) {
        user.displayName = body.displayName.trim();
      }

      if (typeof body.username === "string" && body.username.trim()) {
        const newUsername = body.username.trim();
        const usernameTaken = db.users.some(
          (entry) => entry.id !== userId && entry.username.toLowerCase() === newUsername.toLowerCase(),
        );

        if (usernameTaken) {
          sendJson(res, 409, { error: "Username already exists" });
          return;
        }

        user.username = newUsername;
      }

      if (typeof body.password === "string" && body.password.trim()) {
        user.passwordHash = hashPassword(body.password.trim());
      }

      if (body.role === "admin" || body.role === "user") {
        user.role = body.role;
      }

      logAudit(db, "users.update", auth.user.id, { targetUserId: userId });
      writeDb(db);

      sendJson(res, 200, { user: sanitizeUser(user) });
      return;
    }

    const scheduleMatch =
      req.method === "POST" && url.pathname.match(/^\/api\/users\/([^/]+)\/schedule$/);

    if (scheduleMatch) {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      const userId = scheduleMatch[1];
      const user = db.users.find((entry) => entry.id === userId);

      if (!user) {
        sendJson(res, 404, { error: "User not found" });
        return;
      }

      const body = await readJsonBody(req);
      user.onCallSchedule = normalizeSchedule(body);
      logAudit(db, "users.schedule.update", auth.user.id, { targetUserId: userId });
      writeDb(db);

      sendJson(res, 200, { user: sanitizeUser(user) });
      return;
    }

    const deleteUserMatch =
      req.method === "POST" && url.pathname.match(/^\/api\/users\/([^/]+)\/delete$/);

    if (deleteUserMatch) {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      const userId = deleteUserMatch[1];
      if (auth.user.id === userId) {
        sendJson(res, 400, { error: "You cannot delete the account you are currently using" });
        return;
      }

      const userIndex = db.users.findIndex((entry) => entry.id === userId);
      if (userIndex === -1) {
        sendJson(res, 404, { error: "User not found" });
        return;
      }

      const [removedUser] = db.users.splice(userIndex, 1);
      db.devices = db.devices.filter((entry) => entry.userId !== userId);
      db.sessions = db.sessions.filter((entry) => entry.userId !== userId);
      logAudit(db, "users.delete", auth.user.id, { targetUserId: userId });
      writeDb(db);

      sendJson(res, 200, { user: sanitizeUser(removedUser) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/devices/register") {
      const auth = requireAuth(db, req, res);
      if (!auth) {
        return;
      }

      const body = await readJsonBody(req);
      const pushToken = String(body.pushToken || "").trim();
      const platform = body.platform === "ios" ? "ios" : "android";
      const deviceName = String(body.deviceName || "").trim() || "Unnamed device";

      if (!pushToken) {
        sendJson(res, 400, { error: "pushToken is required" });
        return;
      }

      const existing = db.devices.find((entry) => entry.pushToken === pushToken);

      if (existing) {
        existing.userId = auth.user.id;
        existing.platform = platform;
        existing.deviceName = deviceName;
        existing.updatedAt = nowIso();
        logAudit(db, "devices.update", auth.user.id, { deviceId: existing.id });
        writeDb(db);
        sendJson(res, 200, { device: existing });
        return;
      }

      const device = {
        id: nextId("device"),
        userId: auth.user.id,
        platform,
        deviceName,
        pushToken,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      db.devices.push(device);
      logAudit(db, "devices.register", auth.user.id, { deviceId: device.id });
      writeDb(db);

      sendJson(res, 201, { device });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/devices") {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      sendJson(res, 200, {
        devices: db.devices.map(sanitizeDevice),
      });
      return;
    }

    const deleteDeviceMatch =
      req.method === "POST" && url.pathname.match(/^\/api\/devices\/([^/]+)\/delete$/);

    if (deleteDeviceMatch) {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      const deviceId = deleteDeviceMatch[1];
      const deviceIndex = db.devices.findIndex((entry) => entry.id === deviceId);
      if (deviceIndex === -1) {
        sendJson(res, 404, { error: "Device not found" });
        return;
      }

      const [removedDevice] = db.devices.splice(deviceIndex, 1);
      logAudit(db, "devices.delete", auth.user.id, { deviceId });
      writeDb(db);

      sendJson(res, 200, { device: sanitizeDevice(removedDevice) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pages/send") {
      const auth = requireAuth(db, req, res);
      if (!auth) {
        return;
      }

      const body = await readJsonBody(req);
      const targetUserId = String(body.targetUserId || "").trim();
      const message = String(body.message || "").trim();

      if (!targetUserId || !message) {
        sendJson(res, 400, { error: "targetUserId and message are required" });
        return;
      }

      const targetUser = db.users.find((entry) => entry.id === targetUserId);
      if (!targetUser) {
        sendJson(res, 404, { error: "Target user not found" });
        return;
      }

      const page = {
        id: nextId("page"),
        createdByUserId: auth.user.id,
        targetUserId,
        message,
        status: "sent",
        createdAt: nowIso(),
        acknowledgedAt: null,
        deliveryAttempts: [],
      };

      page.deliveryAttempts = buildPushDeliveries(db, page);
      const deliveryResult = await deliverPageViaExpo(page, targetUser);
      page.deliveryAttempts = deliveryResult.attempts;

      db.pages.unshift(page);
      logAudit(db, "pages.send", auth.user.id, { pageId: page.id, targetUserId });
      writeDb(db);

      sendJson(res, 201, {
        page,
        targetUser: sanitizeUser(targetUser),
        deliveryStatus: deliveryResult.deliveryStatus,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/pages") {
      const auth = requireAuth(db, req, res);
      if (!auth) {
        return;
      }

      const pages =
        auth.user.role === "admin"
          ? db.pages
          : db.pages.filter(
              (page) =>
                page.targetUserId === auth.user.id || page.createdByUserId === auth.user.id,
            );

      sendJson(res, 200, { pages });
      return;
    }

    const acknowledgeMatch =
      req.method === "POST" && url.pathname.match(/^\/api\/pages\/([^/]+)\/acknowledge$/);

    if (acknowledgeMatch) {
      const auth = requireAuth(db, req, res);
      if (!auth) {
        return;
      }

      const pageId = acknowledgeMatch[1];
      const page = db.pages.find((entry) => entry.id === pageId);

      if (!page) {
        sendJson(res, 404, { error: "Page not found" });
        return;
      }

      if (auth.user.role !== "admin" && page.targetUserId !== auth.user.id) {
        sendJson(res, 403, { error: "You cannot acknowledge this page" });
        return;
      }

      page.status = "acknowledged";
      page.acknowledgedAt = nowIso();
      page.acknowledgedByUserId = auth.user.id;
      logAudit(db, "pages.acknowledge", auth.user.id, { pageId });
      writeDb(db);

      sendJson(res, 200, { page });
      return;
    }

    const escalateMatch =
      req.method === "POST" && url.pathname.match(/^\/api\/pages\/([^/]+)\/escalate$/);

    if (escalateMatch) {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      const body = await readJsonBody(req);
      const newTargetUserId = String(body.targetUserId || "").trim();
      const pageId = escalateMatch[1];
      const page = db.pages.find((entry) => entry.id === pageId);

      if (!page) {
        sendJson(res, 404, { error: "Page not found" });
        return;
      }

      const newTarget = db.users.find((entry) => entry.id === newTargetUserId);
      if (!newTarget) {
        sendJson(res, 404, { error: "Escalation target not found" });
        return;
      }

      page.status = "escalated";
      page.targetUserId = newTargetUserId;
      page.escalatedAt = nowIso();
      const newAttempts = buildPushDeliveries(db, { id: page.id, targetUserId: newTargetUserId });
      page.deliveryAttempts.push(...newAttempts);
      const deliveryResult = await deliverPageViaExpo(page, newTarget, newAttempts);
      page.deliveryAttempts = deliveryResult.attempts;

      logAudit(db, "pages.escalate", auth.user.id, {
        pageId,
        targetUserId: newTargetUserId,
      });
      writeDb(db);

      sendJson(res, 200, { page });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/audit-logs") {
      const auth = requireAdmin(db, req, res);
      if (!auth) {
        return;
      }

      sendJson(res, 200, { auditLogs: db.auditLogs.slice(0, 100) });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "Internal server error",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

server.listen(PORT, HOST, () => {
  ensureDb();
  console.log(`DarkTrace backend listening on http://${HOST}:${PORT}`);
});
