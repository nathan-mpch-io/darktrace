import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { seedUsers } from "./src/data/mock";
import { palette } from "./src/theme";
import { AppUser, OnCallSchedule, RegisteredDevice, ScheduleDayKey } from "./src/types";

const WEEK_DAYS: Array<{ key: ScheduleDayKey; label: string }> = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

const DEFAULT_USER_TIMEZONE = "Europe/London";
const TIMEZONE_ALIASES: Record<string, string> = {
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

function resolveTimezoneIdentifier(input?: string) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return DEFAULT_USER_TIMEZONE;
  }

  const alias = TIMEZONE_ALIASES[trimmed.toUpperCase()];
  if (alias) {
    return alias;
  }

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_USER_TIMEZONE;
  }
}

function getTimezoneContext(input?: string, date = new Date()) {
  const timeZone = resolveTimezoneIdentifier(input);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);

  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const weekday = getPart("weekday").toLowerCase() as ScheduleDayKey;
  const hour = Number(getPart("hour") || "0");
  const minute = Number(getPart("minute") || "0");
  const zoneLabel = getPart("timeZoneName") || timeZone;

  return {
    timeZone,
    weekday,
    currentMinutes: hour * 60 + minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${zoneLabel}`,
  };
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function App() {
  const alarmSoundRef = useRef<Audio.Sound | null>(null);
  const authTokenRef = useRef("");
  const defaultApiUrl =
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) || "http://127.0.0.1:4000";
  const defaultProjectId =
    ((Constants.expoConfig?.extra as { eas?: { projectId?: string }; projectId?: string } | undefined)?.eas
      ?.projectId ||
      (Constants.expoConfig?.extra as { eas?: { projectId?: string }; projectId?: string } | undefined)?.projectId ||
      Constants.easConfig?.projectId ||
      "");
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiUrl);
  const [expoProjectId, setExpoProjectId] = useState(defaultProjectId);
  const [authToken, setAuthToken] = useState("");
  const [users, setUsers] = useState<AppUser[]>(seedUsers);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showDevicesPanel, setShowDevicesPanel] = useState(false);
  const [selectedScheduleUser, setSelectedScheduleUser] = useState<AppUser | null>(null);
  const [selectedManageUser, setSelectedManageUser] = useState<AppUser | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<AppUser | null>(null);
  const [pageMessage, setPageMessage] = useState("");
  const [alertAllMode, setAlertAllMode] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState<{
    recipient: AppUser;
    message: string;
  } | null>(null);
  const [alarmFlash, setAlarmFlash] = useState(false);
  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("pass123");
  const [loginError, setLoginError] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [scheduleDrafts, setScheduleDrafts] = useState<
    Record<
      string,
      {
        timezone: string;
        days: Record<ScheduleDayKey, { enabled: boolean; startTime: string; endTime: string }>;
      }
    >
  >({});
  const [backendError, setBackendError] = useState("");
  const [permissionSummary, setPermissionSummary] = useState("Checking notification access...");
  const [pushSummary, setPushSummary] = useState("Remote push registration not started yet.");
  const [registeredDevices, setRegisteredDevices] = useState<RegisteredDevice[]>([]);
  const [editUsername, setEditUsername] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [timeTick, setTimeTick] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    void prepareNotifications();
  }, []);

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      handleIncomingNotification(notification);
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleIncomingNotification(response.notification);
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if ((showAdminPanel || showDevicesPanel) && currentUser?.role === "admin") {
      void loadDevices();
    }
  }, [showAdminPanel, showDevicesPanel, currentUser]);

  useEffect(() => {
    if (!currentUser || !authTokenRef.current) {
      return;
    }

    const refreshTimer = setInterval(() => {
      void refreshLiveData(true);
    }, 20000);

    return () => clearInterval(refreshTimer);
  }, [currentUser]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeTick(Date.now());
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeAlarm) {
      return;
    }

    void startAlarmSound();

    const flashTimer = setInterval(() => {
      setAlarmFlash((current) => !current);
    }, 650);

    const hapticTimer = setInterval(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Vibration.vibrate([0, 800, 250, 900]);
    }, 1800);

    Vibration.vibrate([0, 1000, 250, 1000], true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    return () => {
      clearInterval(flashTimer);
      clearInterval(hapticTimer);
      Vibration.cancel();
      setAlarmFlash(false);
      void stopAlarmSound();
    };
  }, [activeAlarm]);

  async function prepareNotifications() {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("incident-critical", {
        name: "Incident Critical",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: "default",
      });
    }

    const permissions = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: true,
      },
    });

    if (!permissions.granted) {
      setPermissionSummary("Notifications are not granted yet. The app can install, but paging will not work until enabled.");
      return;
    }

    if (permissions.ios?.allowsCriticalAlerts) {
      setPermissionSummary("Critical alerts are enabled. This is the strongest iPhone alert mode.");
      return;
    }

    setPermissionSummary("Notifications are enabled. On iPhone, Critical Alerts still need Apple entitlement approval.");
  }

  function handleIncomingNotification(notification: Notifications.Notification) {
    const notificationData = notification.request.content.data || {};
    const targetDisplayName =
      typeof notificationData.recipientDisplayName === "string" && notificationData.recipientDisplayName
        ? notificationData.recipientDisplayName
        : "DarkTrace user";
    const message =
      notification.request.content.body ||
      (typeof notificationData.message === "string" ? notificationData.message : "Urgent IT response required.");

    setActiveAlarm({
      recipient: {
        id: typeof notificationData.targetUserId === "string" ? notificationData.targetUserId : "remote",
        username: "",
        password: "",
        displayName: targetDisplayName,
        role: "user",
      },
      message,
    });
  }

  function handleLogin() {
    void loginToBackend();
  }

  function resetLocalSession() {
    setCurrentUser(null);
    setShowAdminPanel(false);
    setShowDevicesPanel(false);
    setSelectedScheduleUser(null);
    setSelectedManageUser(null);
    setAlertAllMode(false);
    setAuthToken("");
    authTokenRef.current = "";
    setLoginUsername("admin");
    setLoginPassword("pass123");
    setBackendError("");
    setPushSummary("Remote push registration not started yet.");
  }

  function handleLogout() {
    void logoutFromBackend();
  }

  function handleCreateUser() {
    void createUserInBackend();
  }

  function handleRefresh() {
    void refreshLiveData();
  }

  async function handlePreviewAlert() {
    if (!selectedRecipient && !alertAllMode) {
      return;
    }

    const trimmedMessage = pageMessage.trim();
    const body = alertAllMode
      ? trimmedMessage || "Alerting all users for urgent IT response."
      : trimmedMessage
        ? `${selectedRecipient?.displayName}: ${trimmedMessage}`
        : `Paging ${selectedRecipient?.displayName} for urgent IT response.`;

    if (alertAllMode) {
      const firstCheck = await confirmAction(
        "Confirm ALERT ALL",
        "This will send a broadcast pager to every user. Do you want to continue?",
        "Continue",
      );

      if (!firstCheck) {
        return;
      }

      const secondCheck = await confirmAction(
        "Final confirmation",
        "Send this pager to all users now?",
        "Send to all",
      );

      if (!secondCheck) {
        return;
      }
    }

    await sendPageToBackend(body);
    setSelectedRecipient(null);
    setAlertAllMode(false);
    setPageMessage("");
  }

  function handleSelectRecipient(user: AppUser) {
    if (user.role !== "admin" && !isUserOnCall(user)) {
      return;
    }
    setAlertAllMode(false);
    setSelectedRecipient(user);
    setPageMessage("");
  }

  function handleSelectAlertAll() {
    setSelectedRecipient(null);
    setAlertAllMode(true);
    setPageMessage("");
  }

  const tileUsers = users;
  const allPagingUsers = users;

  async function apiRequest(path: string, options: RequestInit = {}, tokenOverride?: string) {
    const activeToken = tokenOverride || authTokenRef.current || authToken;
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "Bypass-Tunnel-Reminder": "true",
        ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        ...((options.headers as Record<string, string> | undefined) || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  function confirmAction(title: string, message: string, confirmLabel: string) {
    return new Promise<boolean>((resolve) => {
      Alert.alert(title, message, [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: confirmLabel,
          style: "destructive",
          onPress: () => resolve(true),
        },
      ]);
    });
  }

  async function loginToBackend() {
    try {
      setLoginError("");
      setBackendError("");
      const data = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });

      const appUser = {
        id: data.user.id,
        username: data.user.username,
        password: "",
        displayName: data.user.displayName,
        role: data.user.role,
      } satisfies AppUser;

      setAuthToken(data.token);
      authTokenRef.current = data.token;
      setCurrentUser(appUser);
      await loadUsers(data.token);
      await registerDeviceForPush(data.token, appUser);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to login");
    }
  }

  async function logoutFromBackend() {
    try {
      await apiRequest("/api/logout", {
        method: "POST",
      });
    } catch {
      // Best effort; local session still needs clearing.
    } finally {
      resetLocalSession();
    }
  }

  async function registerDeviceForPush(token: string, user: AppUser) {
    if (Platform.OS === "web") {
      setPushSummary("Remote push registration is only available on iPhone and Android.");
      return;
    }

    try {
      const existingPermissions = await Notifications.getPermissionsAsync();
      let finalStatus = existingPermissions.status;

      if (finalStatus !== "granted") {
        const requestedPermissions = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowCriticalAlerts: true,
          },
        });
        finalStatus = requestedPermissions.status;
      }

      if (finalStatus !== "granted") {
        setPushSummary("This device has not granted notification permission yet.");
        return;
      }

      const projectId = expoProjectId.trim();
      if (!projectId) {
        setPushSummary("Remote push registration failed. Add an Expo projectId before testing remote push in Expo Go.");
        return;
      }

      const expoPushToken = await Notifications.getExpoPushTokenAsync({ projectId });

      await apiRequest(
        "/api/devices/register",
        {
          method: "POST",
          body: JSON.stringify({
            pushToken: expoPushToken.data,
            platform: Platform.OS === "ios" ? "ios" : "android",
            deviceName: `${user.displayName} ${Platform.OS.toUpperCase()} device`,
          }),
        },
        token,
      );

      setPushSummary(`Remote push ready on this ${Platform.OS} device.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown push registration error";
      setPushSummary(`Remote push registration failed. ${message}`);
    }
  }

  async function loadUsers(tokenOverride?: string) {
    try {
      const activeToken = tokenOverride || authTokenRef.current || authToken;
      if (!activeToken) {
        return;
      }

      const response = await fetch(`${apiBaseUrl}/api/users`, {
        headers: {
          "Bypass-Tunnel-Reminder": "true",
          Authorization: `Bearer ${activeToken}`,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to load users");
      }

      setUsers(
        data.users.map(mapApiUserToAppUser),
      );
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : "Unable to load users");
    }
  }

  async function loadDevices() {
    try {
      const data = await apiRequest("/api/devices");
      setRegisteredDevices(data.devices);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : "Unable to load devices");
    }
  }

  async function refreshLiveData(silent = false) {
    if (!currentUser || !authTokenRef.current) {
      return;
    }

    if (!silent) {
      setIsRefreshing(true);
    }

    try {
      setBackendError("");
      await loadUsers();
      if (currentUser.role === "admin" && (showAdminPanel || showDevicesPanel)) {
        await loadDevices();
      }
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : "Unable to refresh live data";
        setBackendError(message);
        Alert.alert("Refresh failed", message);
      }
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  }

  async function createUserInBackend() {
    const username = newUsername.trim();
    const password = newPassword.trim();
    const displayName = newDisplayName.trim();

    if (!username || !password || !displayName) {
      Alert.alert("Missing details", "Enter a display name, username, and password for the new user.");
      return;
    }

    try {
      setBackendError("");
      await apiRequest("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          displayName,
          role: newUserRole,
        }),
      });

      setNewUsername("");
      setNewPassword("");
      setNewDisplayName("");
      setNewUserRole("user");
      await loadUsers(undefined);
      Alert.alert("User created", `Credentials ready for ${displayName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create user";
      setBackendError(message);
      Alert.alert("Create user failed", message);
    }
  }

  async function sendPageToBackend(message: string) {
    try {
      setBackendError("");

      if (alertAllMode) {
        await Promise.all(
          allPagingUsers.map((user) =>
            apiRequest("/api/pages/send", {
              method: "POST",
              body: JSON.stringify({
                targetUserId: user.id,
                message,
              }),
            }),
          ),
        );
      } else if (selectedRecipient) {
        await apiRequest("/api/pages/send", {
          method: "POST",
          body: JSON.stringify({
            targetUserId: selectedRecipient.id,
            message,
          }),
        });
      }

      Alert.alert(
        "Pager sent",
        alertAllMode
          ? `Broadcast pager request sent to ${allPagingUsers.length} users.`
          : `Pager request sent to ${selectedRecipient?.displayName}.`,
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unable to send page";
      setBackendError(messageText);
      Alert.alert("Send failed", messageText);
      throw error;
    }
  }

  function mapApiUserToAppUser(user: {
    id: string;
    username?: string;
    displayName: string;
    role: "admin" | "user" | "responder";
    onCallSchedule?: OnCallSchedule;
    isOnCallNow?: boolean;
  }): AppUser {
    return {
      id: user.id,
      username: user.username || "",
      password: "",
      displayName: user.displayName,
      role: user.role === "admin" ? "admin" : "user",
      onCallSchedule: user.onCallSchedule,
      isOnCallNow: user.isOnCallNow,
    };
  }

  function isUserOnCall(user: AppUser) {
    if (typeof user.isOnCallNow === "boolean") {
      return user.isOnCallNow;
    }

    const schedule = user.onCallSchedule;
    if (!schedule?.days) {
      return false;
    }

    const context = getTimezoneContext(schedule.timezone);
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

  function getUserTimeLabel(user: AppUser) {
    return getTimezoneContext(user.onCallSchedule?.timezone, new Date(timeTick)).time;
  }

  function getScheduleDraft(user: AppUser) {
    const schedule = user.onCallSchedule || createDefaultSchedule();

    return (
      scheduleDrafts[user.id] || {
        timezone: schedule.timezone,
        days: cloneScheduleDays(schedule.days),
      }
    );
  }

  function updateScheduleDraftDay(
    userId: string,
    dayKey: ScheduleDayKey,
    patch: Partial<{ startTime: string; endTime: string; enabled: boolean }>,
  ) {
    const baseUser = users.find((user) => user.id === userId) || seedUsers[0];
    setScheduleDrafts((current) => ({
      ...current,
      [userId]: {
        ...getScheduleDraft(baseUser),
        ...current[userId],
        days: {
          ...getScheduleDraft(baseUser).days,
          ...(current[userId]?.days || {}),
          [dayKey]: {
            ...getScheduleDraft(baseUser).days[dayKey],
            ...(current[userId]?.days?.[dayKey] || {}),
            ...patch,
          },
        },
      },
    }));
  }

  function updateScheduleDraftTimezone(userId: string, timezone: string) {
    const baseUser = users.find((user) => user.id === userId) || seedUsers[0];
    setScheduleDrafts((current) => ({
      ...current,
      [userId]: {
        ...getScheduleDraft(baseUser),
        ...current[userId],
        timezone,
      },
    }));
  }

  async function saveSchedule(user: AppUser) {
    const draft = getScheduleDraft(user);

    try {
      setBackendError("");
      await apiRequest(`/api/users/${user.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          timezone: draft.timezone,
          days: draft.days,
        }),
      });

      await loadUsers();
      Alert.alert("Schedule saved", `${user.displayName}'s weekly schedule has been updated.`);
      setSelectedScheduleUser(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save schedule";
      setBackendError(message);
      Alert.alert("Schedule update failed", message);
    }
  }

  async function updateUserRole(user: AppUser, role: "admin" | "user") {
    try {
      setBackendError("");
      await apiRequest(`/api/users/${user.id}`, {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      await loadUsers();
      if (currentUser?.id === user.id) {
        setCurrentUser({
          ...currentUser,
          role,
        });
      }
      Alert.alert("Role updated", `${user.displayName} is now ${role}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update role";
      setBackendError(message);
      Alert.alert("Role update failed", message);
    }
  }

  function openManageUser(user: AppUser) {
    setSelectedManageUser(user);
    setEditDisplayName(user.displayName);
    setEditUsername(user.username);
    setEditPassword("");
  }

  async function saveManagedUser(user: AppUser) {
    const username = editUsername.trim();
    const displayName = editDisplayName.trim();

    if (!username || !displayName) {
      Alert.alert("Missing details", "Display name and username are required.");
      return;
    }

    try {
      setBackendError("");
      await apiRequest(`/api/users/${user.id}`, {
        method: "POST",
        body: JSON.stringify({
          username,
          displayName,
          ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
        }),
      });
      await loadUsers();
      Alert.alert("User updated", `${displayName}'s details have been saved.`);
      setSelectedManageUser(null);
      setEditPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update user";
      setBackendError(message);
      Alert.alert("User update failed", message);
    }
  }

  async function deleteUser(user: AppUser) {
    const confirmed = await confirmAction(
      "Delete user",
      `Delete ${user.displayName}? This will also remove their registered devices.`,
      "Delete user",
    );

    if (!confirmed) {
      return;
    }

    try {
      setBackendError("");
      await apiRequest(`/api/users/${user.id}/delete`, {
        method: "POST",
      });
      await loadUsers();
      await loadDevices();
      Alert.alert("User deleted", `${user.displayName} has been removed.`);
      setSelectedManageUser(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete user";
      setBackendError(message);
      Alert.alert("Delete failed", message);
    }
  }

  async function deleteRegisteredDevice(device: RegisteredDevice) {
    try {
      setBackendError("");
      await apiRequest(`/api/devices/${device.id}/delete`, {
        method: "POST",
      });
      await loadDevices();
      Alert.alert("Device removed", `${device.deviceName} has been detached.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove device";
      setBackendError(message);
      Alert.alert("Device removal failed", message);
    }
  }

  async function startAlarmSound() {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
    });

    if (alarmSoundRef.current) {
      await alarmSoundRef.current.unloadAsync();
      alarmSoundRef.current = null;
    }

    const { sound } = await Audio.Sound.createAsync(
      require("./assets/alarm.wav"),
      {
        isLooping: true,
        shouldPlay: true,
        volume: 1,
      },
    );

    alarmSoundRef.current = sound;
  }

  async function stopAlarmSound() {
    if (!alarmSoundRef.current) {
      return;
    }

    await alarmSoundRef.current.stopAsync();
    await alarmSoundRef.current.unloadAsync();
    alarmSoundRef.current = null;
  }

  function handleAcknowledgeAlarm() {
    Vibration.cancel();
    void stopAlarmSound();
    setActiveAlarm(null);
  }

  if (!currentUser) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.loginScreen}>
          <View style={styles.loginCard}>
            <Text style={styles.kicker}>DarkTrace</Text>
            <Text style={styles.title}>Access control required</Text>
            <Text style={styles.subtitle}>
              Sign in to reach the incident console. Admin can create user logins and share credentials with the team.
            </Text>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>backend_url</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setApiBaseUrl}
                placeholder="http://127.0.0.1:4000"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={apiBaseUrl}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>expo_project_id</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setExpoProjectId}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={expoProjectId}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>username</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setLoginUsername}
                returnKeyType="next"
                placeholder="admin"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={loginUsername}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>password</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setLoginPassword}
                returnKeyType="done"
                placeholder="pass123"
                placeholderTextColor={palette.muted}
                secureTextEntry
                style={styles.input}
                value={loginPassword}
              />
            </View>

            <Pressable
              onPress={handleLogin}
              style={({ pressed }) => [
                styles.button,
                styles.buttonSolid,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonSolidText}>Login</Text>
            </Pressable>

            {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
            <Text style={styles.note}>{permissionSummary}</Text>
            <Text style={styles.note}>{pushSummary}</Text>

            <View style={styles.loginHintBox}>
              <Text style={styles.sectionTitle}>{">"} Starter admin credentials</Text>
              <Text style={styles.note}>username=admin</Text>
              <Text style={styles.note}>password=pass123</Text>
              <Text style={styles.note}>If testing on a phone, set `backend_url` to your computer's LAN IP.</Text>
              <Text style={styles.note}>Remote push in Expo Go also needs a valid `expo_project_id`.</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (selectedScheduleUser && currentUser.role === "admin") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.fullScreenPanel}>
          <View style={styles.adminHeader}>
            <Text style={styles.sectionTitle}>Schedule {selectedScheduleUser.displayName}</Text>
            <View style={styles.headerActionsCompact}>
              <Pressable
                onPress={() => {
                  void saveSchedule(selectedScheduleUser);
                }}
                style={({ pressed }) => [
                  styles.button,
                  styles.buttonSolid,
                  styles.smallButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.buttonSolidText}>Save</Text>
              </Pressable>
              <Pressable
                onPress={() => setSelectedScheduleUser(null)}
                style={({ pressed }) => [
                  styles.button,
                  styles.buttonOutline,
                  styles.smallButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.buttonOutlineText}>Close</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView
            style={styles.fullScreenScroll}
            contentContainerStyle={styles.scheduleModalContent}
            showsVerticalScrollIndicator
          >
            <View style={styles.scheduleDayCard}>
              <Text style={styles.responderName}>Timezone</Text>
              <Text style={styles.responderMeta}>
                Use an IANA zone like `America/New_York` or a common label like `EST`.
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => updateScheduleDraftTimezone(selectedScheduleUser.id, value)}
                placeholder="America/New_York"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={getScheduleDraft(selectedScheduleUser).timezone}
              />
            </View>
            {WEEK_DAYS.map((day) => {
              const draft = getScheduleDraft(selectedScheduleUser).days[day.key];
              return (
                <View key={day.key} style={styles.scheduleDayCard}>
                  <Text style={styles.responderName}>{day.label}</Text>
                  <Text style={styles.responderMeta}>
                    {draft.enabled ? "On-call enabled" : "Off-call"}
                  </Text>
                  <View style={styles.scheduleRow}>
                    <View style={styles.scheduleField}>
                      <Text style={styles.inputLabel}>start</Text>
                      <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={(value) =>
                          updateScheduleDraftDay(selectedScheduleUser.id, day.key, {
                            startTime: value,
                          })
                        }
                        placeholder="09:00"
                        placeholderTextColor={palette.muted}
                        style={styles.smallInput}
                        value={draft.startTime}
                      />
                    </View>
                    <View style={styles.scheduleField}>
                      <Text style={styles.inputLabel}>end</Text>
                      <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={(value) =>
                          updateScheduleDraftDay(selectedScheduleUser.id, day.key, {
                            endTime: value,
                          })
                        }
                        placeholder="17:00"
                        placeholderTextColor={palette.muted}
                        style={styles.smallInput}
                        value={draft.endTime}
                      />
                    </View>
                  </View>
                  <Pressable
                    onPress={() =>
                      updateScheduleDraftDay(selectedScheduleUser.id, day.key, {
                        enabled: !draft.enabled,
                      })
                    }
                    style={({ pressed }) => [
                      styles.button,
                      styles.buttonOutline,
                      styles.smallButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.buttonOutlineText}>
                      {draft.enabled ? "Disable day" : "Enable day"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={() => {
              void saveSchedule(selectedScheduleUser);
            }}
            style={({ pressed }) => [
              styles.button,
              styles.buttonSolid,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonSolidText}>Save weekly schedule</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (selectedManageUser && currentUser.role === "admin") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.fullScreenPanel}>
          <View style={styles.adminHeader}>
            <Text style={styles.sectionTitle}>Manage {selectedManageUser.displayName}</Text>
            <Pressable
              onPress={() => setSelectedManageUser(null)}
              style={({ pressed }) => [
                styles.button,
                styles.buttonOutline,
                styles.smallButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonOutlineText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.fullScreenScroll}
            contentContainerStyle={styles.adminScrollContent}
            showsVerticalScrollIndicator
          >
            {backendError ? <Text style={styles.errorText}>{backendError}</Text> : null}
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>display_name</Text>
              <TextInput
                autoCorrect={false}
                onChangeText={setEditDisplayName}
                placeholder="Display name"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={editDisplayName}
              />
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>username</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setEditUsername}
                placeholder="username"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={editUsername}
              />
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>new_password</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setEditPassword}
                placeholder="Leave blank to keep existing password"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={editPassword}
              />
            </View>
            <View style={styles.composeActions}>
              <Pressable
                onPress={() => {
                  void saveManagedUser(selectedManageUser);
                }}
                style={({ pressed }) => [
                  styles.button,
                  styles.buttonSolid,
                  styles.smallButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.buttonSolidText}>SAVE USER</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void deleteUser(selectedManageUser);
                }}
                style={({ pressed }) => [
                  styles.button,
                  styles.buttonOutline,
                  styles.smallButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.buttonOutlineText}>DELETE USER</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  if (showAdminPanel && currentUser.role === "admin") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.fullScreenPanel}>
          <View style={styles.adminHeader}>
            <Text style={styles.sectionTitle}>User administration</Text>
            <Pressable
              onPress={() => setShowAdminPanel(false)}
              style={({ pressed }) => [
                styles.button,
                styles.buttonOutline,
                styles.smallButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonOutlineText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.fullScreenScroll}
            contentContainerStyle={styles.adminScrollContent}
            showsVerticalScrollIndicator
          >
            <Text style={styles.note}>
              Create login credentials here, then share the username and password with each user.
            </Text>
            <Text style={styles.note}>Press `EDIT SCHEDULE` for each user.</Text>
            {backendError ? <Text style={styles.errorText}>{backendError}</Text> : null}

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>display_name</Text>
              <TextInput
                autoCorrect={false}
                onChangeText={setNewDisplayName}
                placeholder="Jordan Bell"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={newDisplayName}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>username</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setNewUsername}
                placeholder="jordan.bell"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={newUsername}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>password</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setNewPassword}
                placeholder="TempPass1!"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={newPassword}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>role</Text>
              <View style={styles.rolePickerRow}>
                <Pressable
                  onPress={() => setNewUserRole("user")}
                  style={({ pressed }) => [
                    styles.button,
                    newUserRole === "user" ? styles.buttonSolid : styles.buttonOutline,
                    styles.smallButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text
                    style={
                      newUserRole === "user" ? styles.buttonSolidText : styles.buttonOutlineText
                    }
                  >
                    USER
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setNewUserRole("admin")}
                  style={({ pressed }) => [
                    styles.button,
                    newUserRole === "admin" ? styles.buttonSolid : styles.buttonOutline,
                    styles.smallButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text
                    style={
                      newUserRole === "admin" ? styles.buttonSolidText : styles.buttonOutlineText
                    }
                  >
                    ADMIN
                  </Text>
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={handleCreateUser}
              style={({ pressed }) => [
                styles.button,
                styles.buttonSolid,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonSolidText}>Create user</Text>
            </Pressable>

            <View style={styles.userList}>
              {users.map((user) => (
                <View key={user.id} style={styles.userRow}>
                  <View style={styles.responderCopy}>
                    <Text style={styles.responderName}>{user.displayName}</Text>
                    <Text style={styles.responderMeta}>
                      username={user.username} role={user.role}
                    </Text>
                    <View style={styles.rolePickerRow}>
                      <Pressable
                        onPress={() => {
                          void updateUserRole(user, "user");
                        }}
                        style={({ pressed }) => [
                          styles.button,
                          user.role === "user" ? styles.buttonSolid : styles.buttonOutline,
                          styles.smallButton,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text
                          style={user.role === "user" ? styles.buttonSolidText : styles.buttonOutlineText}
                        >
                          USER
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          void updateUserRole(user, "admin");
                        }}
                        style={({ pressed }) => [
                          styles.button,
                          user.role === "admin" ? styles.buttonSolid : styles.buttonOutline,
                          styles.smallButton,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text
                          style={user.role === "admin" ? styles.buttonSolidText : styles.buttonOutlineText}
                        >
                          ADMIN
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={() => openManageUser(user)}
                      style={({ pressed }) => [
                        styles.button,
                        styles.buttonOutline,
                        styles.smallButton,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.buttonOutlineText}>MANAGE USER</Text>
                    </Pressable>
                    {user.role !== "admin" ? (
                      <View style={styles.scheduleEditor}>
                        <Text style={styles.responderMeta}>
                          active={isUserOnCall(user) ? "on-call now" : "off-call now"}
                        </Text>
                        <Pressable
                          onPress={() => setSelectedScheduleUser(user)}
                          style={({ pressed }) => [
                            styles.button,
                            styles.buttonOutline,
                            styles.smallButton,
                            styles.scheduleLaunchButton,
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <Text style={styles.buttonOutlineText}>EDIT SCHEDULE</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  if (showDevicesPanel && currentUser.role === "admin") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.fullScreenPanel}>
          <View style={styles.adminHeader}>
            <Text style={styles.sectionTitle}>Registered devices</Text>
            <Pressable
              onPress={() => setShowDevicesPanel(false)}
              style={({ pressed }) => [
                styles.button,
                styles.buttonOutline,
                styles.smallButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonOutlineText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.fullScreenScroll}
            contentContainerStyle={styles.adminScrollContent}
            showsVerticalScrollIndicator
          >
            <Text style={styles.note}>Use `REMOVE DEVICE` if the wrong phone is getting somebody else's alerts.</Text>
            {backendError ? <Text style={styles.errorText}>{backendError}</Text> : null}
            <View style={styles.userList}>
              {registeredDevices.map((device) => {
                const linkedUser = users.find((user) => user.id === device.userId);
                return (
                  <View key={device.id} style={styles.userRow}>
                    <View style={styles.responderCopy}>
                      <Text style={styles.responderName}>{device.deviceName}</Text>
                      <Text style={styles.responderMeta}>
                        user={linkedUser?.displayName || device.userId} platform={device.platform}
                      </Text>
                      <Text style={styles.responderMeta}>
                        token={device.pushToken.slice(0, 24)}...
                      </Text>
                      <Pressable
                        onPress={() => {
                          void deleteRegisteredDevice(device);
                        }}
                        style={({ pressed }) => [
                          styles.button,
                          styles.buttonOutline,
                          styles.smallButton,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.buttonOutlineText}>REMOVE DEVICE</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <Modal animationType="fade" transparent visible={Boolean(activeAlarm)}>
        {activeAlarm ? (
          <View style={styles.alarmBackdrop}>
            <View
              style={[
                styles.alarmPanel,
                alarmFlash ? styles.alarmPanelHot : styles.alarmPanelCool,
              ]}
            >
              <Text style={styles.alarmKicker}>DARKTRACE ALERT</Text>
              <Text style={styles.alarmRecipient}>{activeAlarm.recipient.displayName}</Text>
              <Text style={styles.alarmMessage}>{activeAlarm.message}</Text>
              <Text style={styles.alarmMeta}>This alert keeps vibrating until acknowledged.</Text>
              <Pressable
                onPress={handleAcknowledgeAlarm}
                style={({ pressed }) => [
                  styles.alarmButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.alarmButtonText}>Acknowledge</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Modal>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.logoWrap}>
              <Text style={styles.logoWordmark}>MPCH</Text>
            </View>
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>LIVE PAGER CONSOLE</Text>
            </View>
          </View>
          <Text style={styles.brandTitle}>DarkTrace</Text>
          <Text style={styles.subtitle}>
            Cross-platform incident paging for overnight IT response, with repeated escalation until somebody owns the issue.
          </Text>
          <Text style={styles.note}>{permissionSummary}</Text>
          <Text style={styles.note}>{pushSummary}</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={handleRefresh}
              style={({ pressed }) => [
                styles.button,
                styles.buttonOutline,
                styles.smallButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonOutlineText}>{isRefreshing ? "REFRESHING" : "REFRESH"}</Text>
            </Pressable>
            {currentUser.role === "admin" ? (
              <>
                <Pressable
                  onPress={() => setShowAdminPanel(true)}
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonOutline,
                    styles.smallButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.buttonOutlineText}>ADMIN</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowDevicesPanel(true)}
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonOutline,
                    styles.smallButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.buttonOutlineText}>DEVICES</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.button,
                styles.buttonOutline,
                styles.smallButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonOutlineText}>Logout</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          {selectedRecipient || alertAllMode ? (
            <View style={styles.composeCard}>
              <Text style={styles.composeTitle}>
                {alertAllMode
                  ? "Message all users"
                  : `Message ${selectedRecipient?.displayName}`}
              </Text>
              <TextInput
                multiline
                onChangeText={setPageMessage}
                placeholder="Type the pager message"
                placeholderTextColor={palette.muted}
                style={styles.messageInput}
                textAlignVertical="top"
                value={pageMessage}
              />
              <View style={styles.composeActions}>
                <Pressable
                  onPress={() => {
                    setSelectedRecipient(null);
                    setAlertAllMode(false);
                    setPageMessage("");
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonOutline,
                    styles.smallButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.buttonOutlineText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void handlePreviewAlert();
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonSolid,
                    styles.smallButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.buttonSolidText}>Send pager</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <View style={styles.tileGrid}>
            <Pressable
              onPress={handleSelectAlertAll}
              style={({ pressed }) => [
                styles.userTile,
                styles.alertAllTile,
                alertAllMode && styles.alertAllTileActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.alertAllButtonText}>ALERT ALL</Text>
            </Pressable>
            {tileUsers.map((user) => (
              <Pressable
                key={user.id}
                disabled={user.role !== "admin" && !isUserOnCall(user)}
                onPress={() => {
                  handleSelectRecipient(user);
                }}
                style={({ pressed }) => [
                  styles.userTile,
                  user.role !== "admin" && !isUserOnCall(user) && styles.userTileDisabled,
                  selectedRecipient?.id === user.id && styles.userTileActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.userTileName}>{user.displayName}</Text>
                <Text
                  style={[
                    styles.userTileMeta,
                    user.role !== "admin" && !isUserOnCall(user) && styles.userTileDisabled,
                  ]}
                >
                  current time {getUserTimeLabel(user)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  screen: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 16,
  },
  loginScreen: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: palette.background,
  },
  loginCard: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
    padding: 22,
    gap: 16,
  },
  hero: {
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  liveBadge: {
    borderWidth: 1,
    borderColor: palette.green,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#081408",
  },
  liveBadgeText: {
    color: palette.green,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  logoWrap: {
    height: 88,
    minWidth: 120,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 4,
    backgroundColor: "#050505",
  },
  logoWordmark: {
    color: "#f5f5f5",
    fontSize: 34,
    letterSpacing: 8,
    fontWeight: "200",
  },
  kicker: {
    color: palette.green,
    letterSpacing: 1.4,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Courier",
  },
  title: {
    color: palette.text,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    fontFamily: "Courier",
  },
  brandTitle: {
    color: palette.text,
    fontSize: 54,
    lineHeight: 58,
    fontWeight: "800",
    fontFamily: "Courier",
  },
  subtitle: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 620,
    fontFamily: "Courier",
  },
  headerActions: {
    flexDirection: "row",
    gap: 10,
    alignSelf: "flex-start",
  },
  headerActionsCompact: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  card: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
    padding: 18,
    gap: 14,
    shadowColor: palette.green,
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  button: {
    borderRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonSolid: {
    backgroundColor: "#112d14",
    borderColor: palette.green,
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "#154f1e",
    backgroundColor: palette.panelRaised,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonSolidText: {
    color: palette.text,
    fontWeight: "700",
    fontFamily: "Courier",
  },
  buttonOutlineText: {
    color: palette.text,
    fontWeight: "700",
    fontFamily: "Courier",
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Courier",
  },
  formGroup: {
    gap: 8,
  },
  inputLabel: {
    color: palette.muted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontFamily: "Courier",
  },
  input: {
    borderWidth: 1,
    borderColor: "#154f1e",
    backgroundColor: palette.panelRaised,
    color: palette.text,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "Courier",
  },
  smallInput: {
    borderWidth: 1,
    borderColor: "#154f1e",
    backgroundColor: palette.panelRaised,
    color: palette.text,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Courier",
  },
  errorText: {
    color: palette.red,
    fontSize: 14,
    fontFamily: "Courier",
  },
  loginHintBox: {
    borderWidth: 1,
    borderColor: "#154f1e",
    backgroundColor: "#081408",
    borderRadius: 4,
    padding: 14,
    gap: 6,
  },
  responderCopy: {
    flex: 1,
    gap: 4,
  },
  responderName: {
    color: palette.text,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Courier",
  },
  responderMeta: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Courier",
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  composeCard: {
    borderWidth: 1,
    borderColor: "#154f1e",
    backgroundColor: palette.panelRaised,
    borderRadius: 4,
    padding: 14,
    gap: 12,
  },
  alertAllButtonText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1.2,
    fontFamily: "Courier",
  },
  composeTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Courier",
  },
  messageInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: palette.green,
    borderRadius: 4,
    backgroundColor: "#050505",
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Courier",
  },
  composeActions: {
    flexDirection: "row",
    gap: 10,
  },
  fullScreenPanel: {
    flex: 1,
    backgroundColor: palette.panel,
    borderTopWidth: 1,
    borderTopColor: palette.green,
    padding: 18,
    gap: 14,
  },
  fullScreenScroll: {
    flex: 1,
  },
  overlayScreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  adminBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    justifyContent: "center",
    padding: 20,
  },
  adminPanel: {
    width: "100%",
    height: "88%",
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.green,
    borderRadius: 8,
    padding: 18,
    gap: 14,
  },
  schedulePanel: {
    width: "100%",
    height: "92%",
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.green,
    borderRadius: 8,
    padding: 18,
    gap: 14,
  },
  adminHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  adminScroll: {
    flex: 1,
  },
  adminScrollContent: {
    gap: 14,
    paddingBottom: 8,
  },
  scheduleModalContent: {
    gap: 12,
  },
  scheduleDayCard: {
    borderWidth: 1,
    borderColor: "#154f1e",
    backgroundColor: palette.panelRaised,
    borderRadius: 6,
    padding: 14,
    gap: 10,
  },
  alarmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.94)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  alarmPanel: {
    width: "100%",
    borderWidth: 2,
    borderRadius: 8,
    padding: 24,
    gap: 18,
  },
  alarmPanelHot: {
    backgroundColor: "#3a0000",
    borderColor: "#ff3b30",
  },
  alarmPanelCool: {
    backgroundColor: "#000000",
    borderColor: palette.green,
  },
  alarmKicker: {
    color: "#ff6b6b",
    fontSize: 18,
    letterSpacing: 2,
    fontWeight: "800",
    fontFamily: "Courier",
  },
  alarmRecipient: {
    color: "#ffffff",
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "800",
    fontFamily: "Courier",
  },
  alarmMessage: {
    color: "#ffffff",
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
    fontFamily: "Courier",
  },
  alarmMeta: {
    color: "#f5b5b5",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "Courier",
  },
  alarmButton: {
    marginTop: 8,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "#111111",
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: "center",
  },
  alarmButtonText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
    fontFamily: "Courier",
  },
  userTile: {
    width: "48%",
    minHeight: 96,
    borderWidth: 1,
    borderColor: palette.green,
    borderRadius: 4,
    backgroundColor: "#081408",
    padding: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  userTileDisabled: {
    opacity: 0.32,
  },
  userTileActive: {
    backgroundColor: "#103015",
  },
  alertAllTile: {
    borderColor: "#ff3b30",
    backgroundColor: "#4a0000",
  },
  alertAllTileActive: {
    backgroundColor: "#6a0000",
  },
  userTileName: {
    color: palette.text,
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Courier",
    textAlign: "center",
  },
  userTileMeta: {
    marginTop: 8,
    color: palette.muted,
    fontSize: 14,
    fontFamily: "Courier",
    textAlign: "center",
  },
  note: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: "Courier",
  },
  userList: {
    gap: 12,
  },
  userRow: {
    borderWidth: 1,
    borderColor: "#154f1e",
    borderRadius: 4,
    backgroundColor: palette.panelRaised,
    padding: 14,
  },
  scheduleEditor: {
    marginTop: 10,
    gap: 10,
  },
  scheduleRow: {
    flexDirection: "row",
    gap: 10,
  },
  scheduleField: {
    flex: 1,
    gap: 6,
  },
  scheduleButtons: {
    flexDirection: "row",
    gap: 10,
  },
  rolePickerRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  scheduleLaunchButton: {
    alignSelf: "flex-start",
  },
});

function createDefaultSchedule(): OnCallSchedule {
  return {
    timezone: "Europe/London",
    days: Object.fromEntries(
      WEEK_DAYS.map((day) => [
        day.key,
        {
          enabled: true,
          startTime: "00:00",
          endTime: "23:59",
        },
      ]),
    ) as OnCallSchedule["days"],
  };
}

function cloneScheduleDays(scheduleDays: OnCallSchedule["days"]) {
  return Object.fromEntries(
    WEEK_DAYS.map((day) => [
      day.key,
      {
        enabled: scheduleDays[day.key].enabled,
        startTime: scheduleDays[day.key].startTime,
        endTime: scheduleDays[day.key].endTime,
      },
    ]),
  ) as OnCallSchedule["days"];
}

function parseTimeToMinutes(time: string) {
  const normalized = String(time || "").replace(".", ":");
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return 0;
  }

  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
}
