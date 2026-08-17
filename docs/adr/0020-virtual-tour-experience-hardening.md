# ADR 0020: Virtual Tour Experience & Embed Hardening

## Status

Accepted.

## Context

ADR 0019 (v0.7) delivered the functional baseline: a closed, first-party
provider registry; a deterministic, safe `src`; a CSP `frame-src`
allowlist synced to that registry; and an `<iframe>` that mounts
unconditionally on render. Decision 10 of that ADR explicitly deferred two
things as real, tracked gaps rather than implementing them speculatively:
click-to-load, and a `sandbox` attribute study. v0.7.1 is the
production-hardening milestone that closes both — plus timeout/error/retry
handling, accessibility, responsive behavior, and a referrer-policy
decision — without touching v0.7's data model, security guarantees, or
Presentation-Frozen/Business-Live semantics. No migration was needed: the
Business VirtualTour entity, the provider registry, and
`buildSafeVirtualTourEmbed` are all reused completely unchanged. Only
`packages/renderer`'s presentation layer changes.

## Decision 1 — click-to-load via a server/client split, not a new renderer

The public/preview-facing surface previously rendered a single server
component (`virtual-tour.tsx`) that both resolved tenant data and emitted
the `<iframe>` directly. That single component is now split in two:

- `virtual-tour.tsx` stays a plain **async server component** — it still
  does 100% of the tenant-scoped work (`getVirtualTour`/
  `getPublicVirtualTour`, `resolveMediaDescriptor` for the poster,
  `buildSafeVirtualTourEmbed`) exactly as before. Nothing about _what_ it
  resolves or _how_ it resolves it changed.
- `virtual-tour-embed.tsx` is a new, minimal `"use client"` leaf —
  `packages/renderer`'s and `apps/web`'s public runtime's **first ever
  client component** (confirmed by grep: every prior `"use client"` file
  in this repo was admin-only). It receives only already-safe,
  serializable props (`src`, `title`, booleans, plain strings) — never
  `tx`, never a raw tenant/provider row, never anything the server
  resolved that isn't meant to become a rendered attribute. It owns
  exactly one concern: turning a click into a mounted iframe, and
  reporting load/timeout/error back into a small state machine.

This keeps the "isolate only the interactive part in a minimal client
component" requirement true by construction — the rest of
`PageRenderer`/`renderBlocks` remains 100% server components, and adding
this one interactive leaf required zero changes to any other block
renderer.

## Decision 2 — a pure, dependency-free state machine, tested without a DOM

`packages/renderer/src/blocks/virtual-tour-embed-state.ts` models the
embed's lifecycle as a discriminated union —
`{status: "idle"|"loading"|"loaded"|"error", attempt: number}` — with a
pure `(state, action) => state` reducer, no React/DOM/timers inside it at
all. `attempt` increments on every `start` action (the first click, and
every retry) and is used as the rendered `<iframe>`'s React `key`, so a
retry always forces a full DOM remount rather than reusing a
possibly-stuck element.

The reducer's own invariant — `loaded`/`timeout`/`error` only ever apply
to the attempt currently `loading`; a stale event from an attempt that has
since timed out or been superseded by a retry is silently ignored — is
what makes the trickiest race conditions (a late `load` event arriving
after the timeout already fired; a late timeout firing after a genuine
load already succeeded) structurally impossible to get wrong, and fully
provable with plain `vitest` calls (`virtual-tour-embed-state.test.ts`,
11 tests) with no jsdom/browser involved. This repo has no
jsdom/happy-dom/`@testing-library` dependency anywhere (checked against
`pnpm-lock.yaml` and every package's `vitest.config.ts`) — a deliberate
choice kept from v0.7, not reversed here: extracting all the
state-transition logic into a framework-agnostic module is what lets that
choice stand without sacrificing coverage of the hard cases.

The React component itself (`virtual-tour-embed.tsx`) only wires real
`setTimeout`/`useEffect`/DOM events to `dispatch` — it owns no transition
logic of its own. Its own idle-render output (title, CTA label, poster
background, ARIA attributes, absence of any `<iframe>`) is covered by
`virtual-tour-embed.test.tsx` via `renderToStaticMarkup`, the same
technique `render-page.test.tsx` already used for every other block —
`useEffect` never runs under `renderToStaticMarkup`, so this captures
exactly what a visitor's browser receives from the server before any
client JS runs.

## Decision 3 — click-to-load is the default, with no separate public/preview toggle

`virtualTourRendererV1` (the server component) is unchanged in shape and
is called identically by both `apps/web`'s public runtime
(`RenderContext.publicOnly: true`) and `apps/admin`'s Preview page (a bare
`RenderContext`, no `publicOnly`). Both pass through the same
`renderBlocks` → `virtualTourRendererV1` → `VirtualTourEmbed` chain, so
click-to-load applies identically to both **by construction**, not by a
flag either surface could accidentally flip. There is no
`autoLoadInPreview` prop, no environment check, nothing that could
silently diverge public behavior from preview behavior. This satisfies
the brief's explicit safety requirement (§16) more strongly than an
explicit-but-toggleable design would: the only way preview could ever load
automatically is by literally forking the component, which nobody did.

Proven end-to-end, with a real browser and a real click, by
`apps/admin/e2e/virtual-tour-preview.spec.ts` — no iframe exists on the
Preview page until the CTA is clicked, exactly like the public runtime.

## Decision 4 — explicit states, not boolean soup

`idle` → `loading` (on click) → `loaded` (iframe `onLoad`) or `error`
(iframe `onError`, or the load timeout). `error` → `loading` again on
retry (a fresh `attempt`, fresh iframe). No `isLoading`/`isLoaded`/
`hasError` triple that could ever disagree with itself — the reducer's
return type is always exactly one of the four states.

## Decision 5 — a centralized, cancellable load timeout

`DEFAULT_VIRTUAL_TOUR_LOAD_TIMEOUT_MS = 20_000`, exported and overridable
via a `loadTimeoutMs` prop (production callers rely on the default; only a
future test would ever override it with a low value to avoid a real
20-second wait). The timer is armed by a `useEffect` keyed on
`[state.status, state.attempt, loadTimeoutMs]` — it only exists while
`status === "loading"`, and React's own effect-cleanup semantics clear the
previous timer the instant a load finishes, fails, or gets superseded by
a retry (a fresh `attempt` re-triggers the effect, cleaning up the old
timer first). There is no code path where two timers can be armed at
once, and a timeout never navigates anywhere — it only dispatches
`{type: "timeout"}` into the same local reducer.

## Decision 6 — fallback/error UI: neutral, bilingual, never leaking internals

On `error` (from either a timeout or a genuine iframe `error` event — the
two are indistinguishable from a `<iframe onError>` handler's perspective
and produce identical UI, matching the brief's "don't over-engineer"
instruction), the surface shows a plain `role="alert"` message
("La visite virtuelle n'a pas pu être chargée." / English equivalent) and
a "Réessayer"/"Retry" button that re-triggers `start`. Never shown: a
stack trace, the raw `src`, the `providerAssetId`, or any tenant data —
the component has no such data to leak in the first place, since it only
ever received the already-safe `src`/`title` strings the server
constructed.

## Decision 7 — accessibility: contextualized title, focus retained, keyboard-only path

- The embed's accessible name (`aria-label` on the `role="region"`
  wrapper, and the `<iframe>`'s own `title` once mounted) is always
  `"Visite virtuelle — {tour.publicName}"` / `"Virtual tour — {...}"` —
  never a bare "iframe" or "Matterport", built in `virtual-tour.tsx`
  (server-side, from the live `tour.publicName`) and passed down as a
  single `title` string.
- The trigger is a real `<button type="button">` — no `onClick` on a
  `<div>`, no mouse-only affordance.
- **No focus loss on click-to-load.** The trigger button is removed from
  the DOM the instant `status` leaves `idle`/`error` (it's only rendered
  in those two states); without intervention, the browser drops focus to
  `<body>` the moment its focused element unmounts. A `useEffect` watches
  for exactly the `idle|error → loading` transition and moves focus to
  the region wrapper itself (`tabIndex={-1}`, so it's programmatically
  focusable but never added to the natural Tab order) — the visitor's
  next Tab/keyboard action still lands somewhere sensible.
- `aria-live="polite"` is scoped to the loading indicator only — present
  exactly while `status === "loading"`, absent in every other state, so
  assistive tech isn't told to announce anything before there's something
  worth announcing.
- Colors/spacing/radii all come from `RenderContext.tokens`, the same
  closed token set every other block already uses — no new, ungoverned
  styling surface.

## Decision 8 — poster reuses the existing frozen-media pipeline exactly

`posterMediaId` (added to `virtual-tour@1` back in v0.7, precisely so this
moment would need no schema change) resolves through
`resolveMediaDescriptor` — the same function, same
frozen-manifest/live-lookup split, Hero and Gallery already use. No second
media system, no new column, no Matterport-hosted image ever fetched or
stored as a "poster" — if a tenant sets no poster, the surface falls back
to a plain `tokens["color.surface"]` background, never a new heavy graphic
dependency.

## Decision 9 — privacy: zero requests to the provider's origin before a click

Before the visitor clicks "Démarrer la visite virtuelle", there is no
`<iframe>` element in the DOM at all — `VirtualTourEmbed`'s render only
emits one when `status` is `loading` or `loaded`. Consequently: no request
to Matterport's origin, no hidden/offscreen iframe, no `<link
rel="preconnect">` or `rel="preload">` this feature introduces, no
provider script, no server-side fetch to Matterport (the server only ever
talks to this codebase's own database), no SDK. Proven directly at the
SSR level (`render-page.test.tsx`, `virtual-tour-embed.test.tsx`: the
initial HTML never contains `<iframe`) and at the real-browser level
(`apps/admin/e2e/virtual-tour-preview.spec.ts`: `page.locator("iframe")`
has count `0` immediately after navigation, count `1` only after the
click).

**What this guarantee does not cover, and why that's the correct
boundary, not a gap:** the safe, server-constructed `src` string is
present in the raw HTTP response before the click — inside Next's RSC
hydration payload (an inert `<script>` tag carrying the client
component's serialized props), not in the rendered DOM. This is required
for the click to mount a real iframe instantly, with no second
server round-trip — deferring it behind an on-demand fetch endpoint would
add a new, unauthenticated public API surface (its own attack surface:
tourId enumeration, rate-limiting, an additional CSP/response-shape
question) to protect a URL string that is not secret, not tenant-scoped
in a way that matters (it's the exact identifier the visitor is about to
be shown anyway), and never sent anywhere by the browser — no fetch,
no `<img>`, no `<iframe>`, nothing reads that payload until the click
constructs the real element. The mission's own stated success criterion
is that the page never _contacts_ Matterport before interaction; contact
means a network request to Matterport's origin, and that guarantee holds
absolutely. Building a deferred-fetch architecture to additionally hide an
inert, non-secret string from the page's own bytes would be
over-engineering relative to what was asked, and would trade a real,
verified security property (no unauthenticated new endpoint) for a
cosmetic one.

## Decision 10 — `sandbox`: studied, not guessed, decision unchanged from v0.7

The brief required an actual technical study this time, not a repeat of
v0.7's "no live-test capability" reasoning. The study:

- `sandbox="allow-scripts allow-same-origin"` together is only a real
  security downgrade when the sandboxed document shares an **origin**
  with the parent page — in that case a script inside the frame could
  reach `window.parent` and manipulate the embedding page directly. That
  is not the case here: Matterport's Showcase viewer is always served
  from `my.matterport.com`, a different origin from every Provence360
  tenant site. The commonly-cited risk of that attribute combination does
  not apply to this specific embed.
- What Matterport's Showcase viewer plausibly needs to function at all —
  its own cookies/local storage (`allow-same-origin`), a non-null
  `Origin` header for its own CORS-gated asset requests
  (`allow-same-origin`), potentially opening help/share links
  (`allow-popups`), and possibly `allow-forms`/`allow-downloads`/
  `allow-presentation` for parts of its UI — could not be exhaustively,
  reliably verified: this sandbox has no live network path to
  `my.matterport.com`, and there is no official Matterport documentation
  enumerating a minimal sufficient `sandbox` policy for third-party
  embedders.
- Shipping a guessed, restrictive `sandbox` value risks silently breaking
  a production tour for a real tenant the first time this code runs
  against the real Matterport Showcase — a worse outcome than omitting
  the attribute, per the brief's own explicit instruction not to "break
  the tour just to claim sandbox is present."

**Decision: no `sandbox` attribute, same as v0.7 — but now backed by an
actual study, not an unexamined default.** This is Decision B of the two
outcomes the brief itself pre-approved as acceptable. The compensating
controls are unchanged and already verified: the closed provider registry
(no arbitrary provider can ever be registered), the CSP `frame-src`
allowlist (the browser itself refuses to load a non-Matterport origin in
any frame on this site, regardless of what `src` string might ever reach
an `<iframe>`), and the fact that `src` is always
server-constructed from a normalized, validated identifier — never
tenant-controlled HTML, never an arbitrary URL. A future iteration with
real access to Matterport's production Showcase could re-run this study
against the actual viewer and tighten this if a minimal working policy is
found.

## Decision 11 — `referrerPolicy="no-referrer"`

The strictest plausible value. Matterport's base Showcase viewer has no
documented dependency on the referring page's URL to function, and there
is no reason to transmit a Provence360 tenant's site URL (which may
itself contain the property's public name in its path/slug) to Matterport
on every embed load. Verified end-to-end by
`apps/admin/e2e/virtual-tour-preview.spec.ts`'s
`toHaveAttribute("referrerpolicy", "no-referrer")` check on the real
mounted iframe — the SSR-level tests can't observe this attribute since
the iframe doesn't exist in the idle-state markup by design.

## Decision 12 — `loading` attribute: superseded, not applicable

v0.7's `<iframe>` set `loading="lazy"`, a reasonable choice when the
iframe mounted unconditionally on render. v0.7.1's `<iframe>` only ever
mounts _after_ the visitor has already clicked its own trigger — at that
point the element is, by definition, already in the visitor's viewport
and the subject of their most recent interaction. Setting `loading="lazy"`
on it would add a second, redundant deferral on top of click-to-load
itself, with no benefit and a small risk of perceived-latency regression
(the browser waiting to decide the element is "near the viewport" before
starting a load the visitor already explicitly requested). The attribute
is deliberately omitted post-click; click-to-load itself is the
deferral mechanism now.

## Decision 13 — fullscreen: unchanged, still delegated to the provider

`allowFullscreen`/`allow={iframeAllow}` are passed through from
`buildSafeVirtualTourEmbed` exactly as in v0.7 — Matterport's own embed
already implements a working fullscreen control inside its viewer.
Nothing about click-to-load changes this; no custom fullscreen system was
built.

## Decision 14 — multiple tours per page: independent by construction

Each `VirtualTourEmbed` instance owns its own `useReducer` state — there
is no module-level or context-shared state anywhere in this feature.
Two (or more) `virtual-tour@1` blocks on the same page are, by React's
own component-instance model, guaranteed to have fully independent
`status`/`attempt`/timers: starting one can never auto-start another, and
one instance's timeout/error/retry cannot affect a sibling's state. Proven
directly by the reducer-level "multiple independent state instances never
share attempt counters" unit test and, with real clicks in a real
browser, by `apps/admin/e2e/virtual-tour-preview.spec.ts`'s two-tour
scenario.

## Decision 15 — lightweight observability: extension points, not a platform

`VirtualTourEmbed` accepts optional `onStart`/`onLoaded`/`onFailed`
callback props, fired on genuine state transitions (never on a caller
passing a new function identity on every render — the effects are keyed
on `state.status` alone). They are **not wired to anything** by
`virtual-tour.tsx` today — this codebase has no client-side telemetry
sink, and building one (a new dependency, a new endpoint, a data-retention
question) is explicitly out of scope for this mission. This is the
concrete, testable extension point the brief asked for in lieu of either
inventing a parallel analytics framework or doing nothing: a future sink
can wire these three callbacks to `virtual_tour_started`/`_loaded`/
`_failed` events without this component changing at all. Per the brief's
own constraint, no personal data, no full URL, and no `providerAssetId`
would ever need to flow through this path — `onFailed`'s only payload is
a coarse `"timeout" | "network"` reason, nothing tour-identifying.

## Decision 16 — responsive layout: unchanged intrinsic-ratio technique, reserved before load

The `padding-bottom` intrinsic-ratio container (`56.25%` for `16:9`,
`75%` for `4:3`) is unchanged from v0.7 and is part of the **idle-state**
render — the space is reserved the instant the block renders, long before
any click, so activating the tour causes no layout shift. No fixed pixel
height anywhere. Verified end-to-end on a real mobile viewport (390×844)
by `apps/admin/e2e/virtual-tour-preview.spec.ts`, which asserts the
embed's own bounding box never exceeds the viewport width and its height
does not jump between the idle and loaded states.

## Consequences

- No database migration. `virtual_tours`, the provider registry, and
  `buildSafeVirtualTourEmbed` are all unchanged; only
  `packages/renderer`'s presentation layer changed.
- `packages/renderer` and `apps/web`'s public runtime gain their first
  `"use client"` component. `@provence360/renderer` was already listed in
  both apps' `transpilePackages`, and React 19 + `jsx: "react-jsx"` were
  already configured — no build-tooling changes were needed.
- New files: `packages/renderer/src/blocks/virtual-tour-embed-state.ts`
  (+ its test), `packages/renderer/src/blocks/virtual-tour-embed.tsx`
  (+ its test). `virtual-tour.tsx` is modified to delegate to the new
  component instead of rendering an `<iframe>` directly.
- Two pre-existing v0.7 tests in `packages/renderer/src/render-page.test.tsx`
  were rewritten, not deleted, to assert what's actually true
  post-click-to-load (the iframe/its `src` no longer exist in the initial
  SSR HTML) rather than the old always-mounted assumption. No test was
  removed to make CI pass.
- New E2E coverage: `apps/web/e2e/virtual-tour.spec.ts` (public runtime,
  HTTP-level: no iframe/CTA-present/poster/multi-tour/archived-tour
  degradation) and `apps/admin/e2e/virtual-tour-preview.spec.ts` (Preview
  page, real browser: click → real iframe → real security attributes,
  mobile viewport, two-tour independence).
- `docs/SECURITY.md`'s "Known gaps" list loses its "no click-to-load"
  entry (resolved) and its "no `sandbox`" entry is reworded from "we
  can't test this" to "studied, deliberately kept absent, with
  documented reasoning."
