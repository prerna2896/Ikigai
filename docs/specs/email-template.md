# Spec: branded transactional email templates

Status: **deferred to a follow-up mini-milestone after M2.2 lands.**

## Why deferred

M2.1 needed *some* email template to fix the cross-browser magic-link bug (default Supabase template uses PKCE-tied `ConfirmationURL`, doesn't work when the email is opened in a different browser than the one that initiated sign-in). The minimal template shipped in [`supabase/templates/`](../../supabase/templates/) is functional (uses `TokenHash` → `/auth/confirm`, cross-browser-safe) but visually plain — no logo, no color scheme, no Kenji.

Cleaning up the visuals is real work (HTML email is finicky — inline styles, table layouts, image hosting decisions, dark-mode considerations, DKIM/SPF for production). It's not on the critical path for M2, and shipping it now would trade M2.2 velocity for polish on a mock user's inbox. Better to lock in the auth mechanics first, then beautify.

## When to pick this up

After **M2.2** exit criteria are green (Profile + Settings writing to Supabase via CloudRepository). At that point:
- Real users start touching the app for onboarding tests.
- Email polish becomes a first-impression concern.
- Nothing about email affects sync correctness, so it can slot in as a small side quest.

## Scope

Three transactional emails need branded templates:

1. **`magic_link.html`** — returning user sign-in (currently minimal, works).
2. **`confirmation.html`** — new user first sign-in / signup (currently minimal, works).
3. **`recovery.html`** — password reset. *Not yet needed; passwordless flow doesn't use it. Add when/if password auth is introduced.*

## Requirements

### Visual
- Use the sunset theme's palette: ivory background `#FEF7ED`, accent `#C97644` (or the actual `--accent` token in `app/globals.css`), text `#2C2416` (or the actual `--text` token).
- Serif heading font for "Ikigai" wordmark; system-safe fallback body (`system-ui, -apple-system, Segoe UI, Roboto, sans-serif`) — no web fonts (fail-safe across email clients).
- Kenji illustration OR the brand mark (`/brand/mark-light.png`) at the top. **Image hosting**: Supabase Storage is the natural pick — public bucket `email-assets`, referenced by absolute URL from the template. Inline base64 is another option but bloats every email and some clients strip it.
- Dark-mode-friendly (Apple Mail / Gmail app both support). Use `@media (prefers-color-scheme: dark)` inside `<style>` — most modern clients respect it.

### Structural
- Table-based layout (HTML email standard — flexbox / grid unreliable across Outlook + older clients).
- Inline styles on every element (Gmail strips `<head>` styles when the email is deep-nested).
- Max width 560px, centered.
- CTA button rendered as a table cell (not `<button>`), background = accent, white text.
- Footer with small print: what Ikigai is, unsubscribe link (not applicable to transactional), and a note that ignoring the email is safe if unintended.

### Functional (do not regress)
- Link must remain the token_hash flow: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={magiclink|signup}&next=%2F` — this is what makes cross-browser work.
- Subject line stays short: "Your Ikigai sign-in link" for magic_link, "Confirm your Ikigai account" for confirmation.

### Testing
- Render in [Mailpit](http://127.0.0.1:54324) locally and eyeball.
- For production readiness, run through [Litmus](https://litmus.com) or [Email on Acid](https://emailonacid.com) — verifies against 90+ real clients. Skip if budget-constrained; then at minimum: Apple Mail (macOS + iOS), Gmail web, Gmail Android, Outlook web.

## Implementation approach

1. Draft the HTML in a new file per template.
2. Move brand asset to Supabase Storage. Note the public URL.
3. Update `supabase/templates/*.html` in-place (config.toml paths stay the same).
4. `supabase stop && supabase start` to reload.
5. Trigger a fresh magic link via `/login`, screenshot in Mailpit, iterate.
6. Commit template files. Update this spec's status to "shipped".

## Out of scope (further follow-ups)
- Weekly reflection prompt emails (product feature, not transactional).
- Multi-language templates (English only for now).
- Custom `From` address / DKIM setup — Supabase-hosted transactional SMTP is fine for MVP; SendGrid/Resend/Postmark for production sender reputation.
