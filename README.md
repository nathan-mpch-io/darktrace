# DarkTrace

Cross-platform incident paging starter app for iOS and Android, aimed at overnight IT response.

## What this starter includes

- Expo + React Native TypeScript app shell
- Local backend scaffold for auth, users, devices, pages, acknowledgement, and escalation
- Incident alert screen with acknowledge, escalate, and resolve actions
- Mock responder roster and escalation policy
- Notification permission request flow prepared for strong alerting
- Platform notes for loud emergency-style paging

## Important platform limits

### iPhone

Apple only allows alerts that bypass mute switch and Focus modes through the `Critical Alerts` capability. That requires:

- Apple approval for the entitlement
- User permission for critical alerts
- A justified use case with high urgency

Without that approval, an iPhone app can still send urgent notifications, but it cannot promise "wake the user even if the phone is muted."

Official references:

- [Apple Critical Alerts entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts)
- [Apple critical alert authorization](https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/criticalalert)

### Android

Android supports very aggressive alerting through high-importance channels and full-screen intents for urgent cases, but user settings still matter and exact alarm permissions have become stricter on newer Android versions.

Official references:

- [Android notification channels](https://developer.android.com/develop/ui/views/notifications/channels)
- [Android full-screen notifications](https://developer.android.com/develop/ui/views/notifications/build-notification?hl=en)
- [Android exact alarm changes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)

## Recommended real-world alert flow

1. Send push alert with the highest allowed urgency.
2. Repeat the alert until acknowledged.
3. Escalate to the next responder after a short timeout.
4. Fall back to SMS or voice call if nobody responds.
5. Keep a clear audit trail of who was paged, when, and how they responded.

## Suggested backend shape

- `POST /incidents`: create a new incident and target an escalation policy
- `POST /incidents/:id/page`: trigger immediate push delivery
- `POST /incidents/:id/acknowledge`: mark responder ownership
- `POST /incidents/:id/escalate`: move to next responder or team
- `POST /devices/register`: bind push token to a user device

You will also want:

- APNs for iOS delivery
- Firebase Cloud Messaging for Android delivery
- A job worker for repeated notification attempts and escalation timers
- SMS or voice fallback through a provider such as Twilio

## Run locally

```bash
npm install
npm run start
```

Run the local backend with:

```bash
npm run backend
```

Then build device apps with:

```bash
npm run ios
npm run android
```

## Next build steps

- Replace mock incident data with a real API
- Connect the mobile app to the new backend endpoints
- Register device tokens from the app
- Implement push delivery through APNs and FCM
- Add escalation timers on the server
- Prepare Apple Critical Alerts entitlement request
# darktrace
## Installable Builds

DarkTrace can be shared as proper installable builds through EAS Build instead of relying on Expo Go QR sessions.

### Android internal build

```bash
npx eas-cli@latest build --platform android --profile preview
```

This produces an installable Android build you can share with testers.

### iPhone internal build

```bash
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile preview
```

For iPhone internal distribution, Expo uses ad hoc provisioning, so each tester device must be registered first. After the iPhone device is registered, build again and share the install URL.

### iPhone simulator build

```bash
npx eas-cli@latest build --platform ios --profile preview-ios-simulator
```

This is only for the simulator and is not a real push notification target.

### Notes

- Internal distribution build URLs can be shared directly with testers.
- Android Expo Go is not a reliable remote-push target on SDK 54, so Android testers should use an installable build instead.
- iPhone internal distribution requires an Apple Developer account and registered tester devices.
