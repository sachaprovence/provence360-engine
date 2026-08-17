"use client";

import { useEffect, useReducer, useRef } from "react";
import type { ThemeTokens } from "@provence360/themes";
import { virtualTourEmbedReducer, initialVirtualTourEmbedState } from "./virtual-tour-embed-state";

// How long a click-triggered load may take before we give up and show the
// error/retry UI. Exported so tests can override it via `loadTimeoutMs`
// with a value in the low milliseconds instead of waiting 20 real
// seconds — see virtual-tour-embed.test.tsx.
export const DEFAULT_VIRTUAL_TOUR_LOAD_TIMEOUT_MS = 20_000;

export interface VirtualTourEmbedLabels {
  start: string;
  loading: string;
  error: string;
  retry: string;
}

const DEFAULT_LABELS_FR: VirtualTourEmbedLabels = {
  start: "Démarrer la visite virtuelle",
  loading: "Chargement de la visite virtuelle…",
  error: "La visite virtuelle n'a pas pu être chargée.",
  retry: "Réessayer",
};

const DEFAULT_LABELS_EN: VirtualTourEmbedLabels = {
  start: "Start the virtual tour",
  loading: "Loading the virtual tour…",
  error: "The virtual tour could not be loaded.",
  retry: "Retry",
};

/**
 * v0.7.1 — click-to-load hardening (see
 * docs/adr/0020-virtual-tour-experience-hardening.md). This is the ONLY
 * client-side piece of the VirtualTour block; everything tenant-scoped
 * (resolving the live VirtualTour row, the poster MediaAsset, building the
 * safe embed descriptor) still happens server-side in `virtual-tour.tsx`
 * and is passed down here as already-resolved, serializable props — this
 * component never queries anything itself.
 *
 * Security posture, unchanged from v0.7: `src` is always the value
 * `buildSafeVirtualTourEmbed` produced server-side (a closed provider
 * registry's own deterministic URL) — this component has no way to accept
 * or construct a different one. No `dangerouslySetInnerHTML`.
 *
 * Privacy posture (v0.7.1, section 9 of the brief): before the visitor
 * clicks the start button, the DOM contains no `<iframe>` at all (see the
 * conditional render below) — no request to the provider's origin is
 * possible until then. Proven directly by
 * `packages/renderer/src/render-page.test.tsx`'s SSR-level assertion (the
 * server-rendered HTML, before any client JS runs, never contains an
 * `<iframe>` tag) and by `apps/web/e2e/virtual-tour.spec.ts`.
 */
export function VirtualTourEmbed({
  title,
  src,
  allowFullscreen,
  iframeAllow,
  posterUrl,
  aspectRatioPadding,
  tokens,
  locale,
  loadTimeoutMs = DEFAULT_VIRTUAL_TOUR_LOAD_TIMEOUT_MS,
  onStart,
  onLoaded,
  onFailed,
}: {
  title: string;
  src: string;
  allowFullscreen: boolean;
  iframeAllow?: string;
  posterUrl: string | null;
  aspectRatioPadding: string;
  tokens: ThemeTokens;
  locale: string;
  /** Overridable for tests only — production callers should rely on the default. */
  loadTimeoutMs?: number;
  /**
   * Extension points for future lightweight observability
   * (`virtual_tour_started`/`loaded`/`failed` — section 17 of the brief).
   * Deliberately unwired by default: this codebase has no client-side
   * telemetry sink today, and inventing one is out of scope for this
   * mission. A future caller can pass these to whatever mechanism is
   * eventually built, without this component changing at all.
   */
  onStart?: () => void;
  onLoaded?: () => void;
  onFailed?: (reason: "timeout" | "network") => void;
}) {
  const [state, dispatch] = useReducer(virtualTourEmbedReducer, initialVirtualTourEmbedState);
  const regionRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef(state.status);

  const labels = locale.startsWith("en") ? DEFAULT_LABELS_EN : DEFAULT_LABELS_FR;

  // The load timeout — only armed while `loading`, cleared on every status
  // change (a load that finishes, errors, or gets superseded by a retry
  // all cancel the previous timer; see virtual-tour-embed-state.test.ts
  // for the state transitions this coordinates with).
  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = setTimeout(() => {
      dispatch({ type: "timeout" });
    }, loadTimeoutMs);
    return () => {
      clearTimeout(timer);
    };
  }, [state.status, state.attempt, loadTimeoutMs]);

  // Focus management (section 6 of the brief): a click removes the
  // trigger button from the DOM (it's only rendered in `idle`/`error`).
  // Without this, the browser would drop focus to <body> the instant the
  // button unmounts. Moving focus to the (programmatically focusable,
  // `tabIndex={-1}`) region container instead means the visitor's next
  // Tab/keyboard action still makes sense — never a silently lost focus.
  useEffect(() => {
    const prev = prevStatusRef.current;
    if ((prev === "idle" || prev === "error") && state.status === "loading") {
      regionRef.current?.focus();
    }
    prevStatusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    if (state.status === "loaded") onLoaded?.();
    if (state.status === "error") {
      // We can't distinguish, from here, whether `error` came from the
      // timeout or a genuine iframe error event — both dispatch the same
      // way into the reducer (see virtual-tour-embed-state.ts) since the
      // resulting UI is identical either way. Good enough for a lightweight
      // signal; a future real sink can split this further if it matters.
      onFailed?.("network");
    }
    // Deliberately keyed on `state.status` alone — fires again only on a
    // genuine status transition, never on a caller passing a new callback
    // identity on every render.
  }, [state.status]);

  function start() {
    dispatch({ type: "start" });
    onStart?.();
  }

  const showTrigger = state.status === "idle" || state.status === "error";
  const showIframe = state.status === "loading" || state.status === "loaded";

  return (
    <div
      ref={regionRef}
      // Programmatic focus target only (section 6: no loss of focus on
      // click-to-load) — never added to the natural Tab order.
      tabIndex={-1}
      role="region"
      aria-label={title}
      style={{
        position: "relative",
        width: "100%",
        paddingBottom: aspectRatioPadding,
        background: posterUrl
          ? `${tokens["color.surface"]} url(${posterUrl}) center/cover`
          : tokens["color.surface"],
        borderRadius: tokens["radius.large"],
        overflow: "hidden",
        outline: "none",
      }}
    >
      {showIframe ? (
        <iframe
          key={state.attempt}
          src={src}
          title={title}
          referrerPolicy="no-referrer"
          allow={iframeAllow}
          allowFullScreen={allowFullscreen}
          onLoad={() => {
            dispatch({ type: "loaded" });
          }}
          onError={() => {
            dispatch({ type: "error" });
          }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      ) : null}

      {state.status === "loading" ? (
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: tokens["spacing.medium"],
            color: tokens["color.text"],
            fontFamily: tokens["font.body"],
            background: tokens["color.surface"],
            pointerEvents: "none",
          }}
        >
          {labels.loading}
        </div>
      ) : null}

      {showTrigger ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: tokens["spacing.small"],
            padding: tokens["spacing.medium"],
            textAlign: "center",
          }}
        >
          {state.status === "error" ? (
            <p
              role="alert"
              style={{
                margin: 0,
                color: tokens["color.text"],
                fontFamily: tokens["font.body"],
                background: tokens["color.surface"],
                padding: tokens["spacing.small"],
                borderRadius: tokens["radius.small"],
              }}
            >
              {labels.error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={start}
            style={{
              padding: `${tokens["spacing.small"]} ${tokens["spacing.medium"]}`,
              background: tokens["color.primary"],
              color: tokens["color.primaryContrast"],
              border: "none",
              borderRadius: tokens["radius.small"],
              fontFamily: tokens["font.body"],
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            {state.status === "error" ? labels.retry : labels.start}
          </button>
        </div>
      ) : null}
    </div>
  );
}
