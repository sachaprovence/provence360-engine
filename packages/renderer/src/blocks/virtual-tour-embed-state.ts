// A pure, framework-agnostic state machine for the click-to-load
// VirtualTour embed (v0.7.1 — see
// docs/adr/0020-virtual-tour-experience-hardening.md). Deliberately
// separated from the React component (`virtual-tour-embed.tsx`): every
// transition below is a plain function of (state, action) with no timers,
// no DOM, no React — so the full transition matrix (including the
// easy-to-get-wrong "late event after timeout/retry" cases) is provable
// with ordinary `vitest` calls, no jsdom/browser needed. The component
// itself only wires real timers/DOM events to `dispatch`.
export type VirtualTourEmbedStatus = "idle" | "loading" | "loaded" | "error";

export interface VirtualTourEmbedState {
  status: VirtualTourEmbedStatus;
  /**
   * Bumped on every `start` action (the initial click, and every retry).
   * Used as the rendered `<iframe>`'s React `key` — a retry always forces
   * a full DOM remount (a fresh iframe element, a fresh load) rather than
   * reusing one that's already in a failed/stuck state.
   */
  attempt: number;
}

export type VirtualTourEmbedAction =
  /** The visitor clicked "Démarrer la visite virtuelle" — from `idle` on first load, or from `error` on retry. */
  | { type: "start" }
  /** The mounted iframe's `load` event fired. */
  | { type: "loaded" }
  /** The load timeout elapsed while still `loading`. */
  | { type: "timeout" }
  /** The mounted iframe's `error` event fired (rare — most provider failures render inside the iframe rather than firing a DOM error, but some network-level failures do). */
  | { type: "error" };

export const initialVirtualTourEmbedState: VirtualTourEmbedState = {
  status: "idle",
  attempt: 0,
};

/**
 * `loaded`/`timeout`/`error` only ever apply to the attempt currently
 * `loading` — a stale event from an attempt that has since timed out (the
 * mission's explicit "iframe tardive après timeout" case) or been
 * superseded by a newer retry is ignored, never silently flipping an
 * already-shown error back to success or vice versa. `start` is the only
 * action valid from every status (it's how both the first load and every
 * retry begin).
 */
export function virtualTourEmbedReducer(
  state: VirtualTourEmbedState,
  action: VirtualTourEmbedAction,
): VirtualTourEmbedState {
  switch (action.type) {
    case "start":
      return { status: "loading", attempt: state.attempt + 1 };
    case "loaded":
      return state.status === "loading" ? { ...state, status: "loaded" } : state;
    case "timeout":
    case "error":
      return state.status === "loading" ? { ...state, status: "error" } : state;
    default:
      return state;
  }
}
