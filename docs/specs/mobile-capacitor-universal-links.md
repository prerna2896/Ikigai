# Capacitor + Universal Links — implementation plan

Status: **spec only, not yet implemented.**

Owner action required at every step — I can't do the Apple side of this from CLI (Developer account, Xcode signing, `apple-app-site-association` upload).

## Why bother

Today iOS users install Ikigai via Safari → Share → Add to Home Screen (PWA). That works, but auth is friction:

- Magic-link taps in Mail open the default browser (Safari), NOT the PWA.
- Safari sets the session cookie in its own cookie jar.
- The PWA has an isolated cookie jar. It stays signed out.
- We work around this by shipping a 6-digit code in every email and asking users to type it into the PWA. Functional but clunky.

Universal Links fix this: an `https://ikigairoots.com/auth/confirm?...` tap opens the native app directly, session sets in the app's context, done. Same URL works in Safari when the app isn't installed (graceful fallback).

The prerequisite for Universal Links is a proper native app wrapper, which is what Capacitor gives us.

## What already exists in the repo

- [`capacitor.config.ts`](../../capacitor.config.ts) — bundle id `com.ikigai.app`, appName `Ikigai`, iOS UI settings
- [`MOBILE_SETUP.md`](../../MOBILE_SETUP.md) — high-level "phase 1 PWA / phase 2 native" outline; the Xcode + App Store steps below live there
- No `ios/` folder yet — `npx cap add ios` hasn't been run
- `next.config.js` — currently server-mode Next.js. Capacitor needs static export (`output: 'export'`) for the JS to run inside the WKWebView

## What Ikigai's app actually needs to change for native

### 1. Static export mode (blocker for the whole thing)

Capacitor bundles a WKWebView pointed at pre-built HTML/JS. Server-rendered pages (which our middleware, API routes, and `/auth/confirm` route handler rely on) can't run there. Two paths:

- **A. Dual-mode build.** Keep the current Vercel/server build, add a separate `next.config.mjs` variant with `output: 'export'` for the mobile build. Static export drops server components and API routes. That means:
  - Middleware: **stops running** — the anonymous-first middleware is already close to a no-op after PR #13, so this is fine.
  - `/auth/confirm` route: needs a client-side equivalent. On mobile the deep link would arrive as `capacitor://localhost/auth/confirm?token_hash=...`; a plain client page can call `supabase.auth.exchangeCodeForSession(token_hash)` and route the user.
  - `/api/dev/reset`: dev-only, fine to drop from mobile bundle.
- **B. Keep Next.js server, point Capacitor at the hosted URL.** `capacitor.config.ts` `server.url = 'https://ikigairoots.com'`. The WKWebView loads the site over HTTPS. No app-store distribution of the JS — every version bump is transparent. **But** Apple will reject an app whose entire UI is just a web view of an existing site. Deal-breaker for App Store distribution unless there's substantial native content.

**Recommendation: A.** Ship static export as `pnpm build:mobile` alongside the existing `pnpm build`.

### 2. Deep linking / Universal Links

Once native shell exists, wire up two flavors of deep links:

- **Custom scheme** (`ikigai://auth/confirm?...`) — trivial, works without Apple config, but ugly URLs.
- **Universal Links** (`https://ikigairoots.com/auth/confirm?...`) — pretty URLs, but requires:
  - `apple-app-site-association` file served from `https://ikigairoots.com/.well-known/apple-app-site-association` (no extension, MIME `application/json`)
  - Contents: `{"applinks":{"apps":[],"details":[{"appID":"<TEAMID>.com.ikigai.app","paths":["/auth/*","/"]}]}}`
  - Vercel needs a rewrite: `next.config.js` `rewrites()` OR a static file at `public/.well-known/apple-app-site-association`
  - iOS entitlements: add `com.apple.developer.associated-domains` = `applinks:ikigairoots.com` in the Xcode project
  - **Requires Apple Developer Team ID** (`<TEAMID>`), which lives in the Apple Developer account

**Recommendation:** ship both. Universal Links as the primary; custom scheme as the fallback for edge cases (email clients that strip HTTPS links, testing).

### 3. Supabase auth callback in-app

The Capacitor App plugin fires `appUrlOpen` when a Universal Link is tapped. Handler:

```ts
// In a client-side effect somewhere (RepositoryProvider is a good spot).
import { App } from '@capacitor/app';

useEffect(() => {
  const sub = App.addListener('appUrlOpen', async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/confirm') {
      const tokenHash = parsed.searchParams.get('token_hash');
      if (!tokenHash) return;
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'magiclink',
      });
      if (!error) router.replace(parsed.searchParams.get('next') ?? '/');
    }
  });
  return () => { void sub.then((s) => s.remove()); };
}, []);
```

### 4. Storage persistence

Capacitor's WKWebView clears IndexedDB when the OS reclaims memory unless persistence is requested. Add `navigator.storage.persist()` on first sign-in — it's a no-op on web.

## Non-blockers worth cleaning up alongside

- **Icons**: `public/icons/` has PWA icons; Capacitor needs matching Xcode Asset Catalog entries at various sizes.
- **Splash screen**: same story — add `@capacitor/splash-screen` config.
- **Status bar**: iOS status bar overlaps the app header without `@capacitor/status-bar` config. Fix now avoids ugly launch.

## Owner checklist

You'll need to do these — none of them from a shell:

- [ ] Sign up for Apple Developer Program ($99/yr) if not already
- [ ] Note your **Team ID** (Apple Developer → Membership)
- [ ] `pnpm add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/app @capacitor/splash-screen @capacitor/status-bar` (I can PR this diff)
- [ ] Add `next.config.mobile.mjs` with `output: 'export'` (I can PR this)
- [ ] Add `pnpm build:mobile` script (I can PR this)
- [ ] Client-side `/auth/confirm` page for the static-export flavor (I can PR this)
- [ ] Add `appUrlOpen` handler for Universal Links (I can PR this)
- [ ] Create `public/.well-known/apple-app-site-association` with your Team ID (I can PR the template)
- [ ] Run `npx cap add ios` + open in Xcode
- [ ] In Xcode: set Team, add associated-domains entitlement (`applinks:ikigairoots.com`), add app icons/splash
- [ ] Test Universal Link tap → app opens signed in
- [ ] Test on TestFlight before App Store submission
- [ ] Submit for App Store review (typically 24–48h)

## What I can pre-stage

Everything under "I can PR this" above can land now as separate, independently-mergeable PRs so that when you're ready to do the Apple side, the code side is done. Split roughly:

- **PR A** — dependencies + `next.config.mobile.mjs` + `pnpm build:mobile` script + static-export tolerance in edge modules
- **PR B** — client-side `/auth/confirm` page + `appUrlOpen` handler
- **PR C** — `.well-known/apple-app-site-association` template (with `<TEAMID>` placeholder) + Vercel rewrite

Tell me when to open any/all of these.

## Sequencing gotchas

- Universal Links won't work until **all three** are in place: entitlement in Xcode, `.well-known` file live on `ikigairoots.com`, app installed via TestFlight or App Store (not local dev — iOS refuses associated-domains for locally-installed builds unless configured through a developer profile).
- The first tap after install requires iOS to fetch the `.well-known` file and cache the association. If the file 404s or has wrong MIME type at that moment, Universal Links stay broken for that install until reinstall.
- App Store review historically rejects "just a web view" apps — offering meaningful offline (which the offline queue + Dexie already provide) usually satisfies this. Keep the offline demo prominent in the App Store screenshots.

## What ships without any of this

Everything the app does today works over the PWA. The 6-digit code flow is the primary auth path (see [login/page.tsx](../../app/login/page.tsx) copy). This plan is about making that flow one-tap instead of type-the-code — worthwhile but not blocking.
