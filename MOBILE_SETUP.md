# Publishing Ikigai to the App Store

## Phase 1: PWA (Available now)
The app is configured as a PWA. To install on iPhone:
1. Open the app URL in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"
4. The app will launch in standalone mode

## Phase 2: Native App with Capacitor

### Prerequisites
- Xcode 15+ installed
- Apple Developer account ($99/year)
- Node.js 18+

### Setup
1. Install Capacitor:
   ```
   pnpm add @capacitor/core @capacitor/cli @capacitor/ios
   ```

2. Build the static web app:
   ```
   pnpm build:mobile
   ```

3. Initialize Capacitor (already configured via capacitor.config.ts):
   ```
   npx cap init
   ```

4. Add iOS platform:
   ```
   npx cap add ios
   ```

5. Sync web assets:
   ```
   npx cap sync ios
   ```

6. Open in Xcode:
   ```
   npx cap open ios
   ```

7. In Xcode:
   - Set your Team (Apple Developer account)
   - Set Bundle Identifier: com.ikigai.app
   - Add app icons (use the SVG in /public/icons/ as source)
   - Set deployment target: iOS 16+
   - Archive and upload to App Store Connect

### App Store Requirements
- App icons: 1024x1024 PNG (no transparency)
- Screenshots: 6.7" iPhone screenshots required
- Privacy policy URL (required if any data collection)
- Since this app uses only local storage (IndexedDB), minimal privacy requirements
- App description focusing on mindful planning, ikigai concept

### Ongoing: Sync after web changes
After any web changes, run:
```
pnpm build:mobile && npx cap sync ios
```
