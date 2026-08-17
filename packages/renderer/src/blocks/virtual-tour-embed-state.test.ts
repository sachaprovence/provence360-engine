import { describe, expect, it } from "vitest";
import {
  initialVirtualTourEmbedState,
  virtualTourEmbedReducer,
  type VirtualTourEmbedState,
} from "./virtual-tour-embed-state";

describe("virtualTourEmbedReducer", () => {
  it("starts idle, attempt 0", () => {
    expect(initialVirtualTourEmbedState).toEqual({ status: "idle", attempt: 0 });
  });

  it("idle --start--> loading, attempt incremented", () => {
    const next = virtualTourEmbedReducer(initialVirtualTourEmbedState, { type: "start" });
    expect(next).toEqual({ status: "loading", attempt: 1 });
  });

  it("loading --loaded--> loaded", () => {
    const loading: VirtualTourEmbedState = { status: "loading", attempt: 1 };
    expect(virtualTourEmbedReducer(loading, { type: "loaded" })).toEqual({
      status: "loaded",
      attempt: 1,
    });
  });

  it("loading --timeout--> error", () => {
    const loading: VirtualTourEmbedState = { status: "loading", attempt: 1 };
    expect(virtualTourEmbedReducer(loading, { type: "timeout" })).toEqual({
      status: "error",
      attempt: 1,
    });
  });

  it("loading --error--> error", () => {
    const loading: VirtualTourEmbedState = { status: "loading", attempt: 1 };
    expect(virtualTourEmbedReducer(loading, { type: "error" })).toEqual({
      status: "error",
      attempt: 1,
    });
  });

  it("error --start (retry)--> loading, attempt incremented again", () => {
    const error: VirtualTourEmbedState = { status: "error", attempt: 1 };
    expect(virtualTourEmbedReducer(error, { type: "start" })).toEqual({
      status: "loading",
      attempt: 2,
    });
  });

  it("a late `loaded` after an already-fired `timeout` is ignored — does not flip error back to loaded", () => {
    const loading: VirtualTourEmbedState = { status: "loading", attempt: 1 };
    const afterTimeout = virtualTourEmbedReducer(loading, { type: "timeout" });
    expect(afterTimeout.status).toBe("error");

    const afterLateLoad = virtualTourEmbedReducer(afterTimeout, { type: "loaded" });
    expect(afterLateLoad).toEqual(afterTimeout);
  });

  it("a late `timeout` after an already-fired `loaded` is ignored — does not flip a successful load into an error", () => {
    const loading: VirtualTourEmbedState = { status: "loading", attempt: 1 };
    const afterLoad = virtualTourEmbedReducer(loading, { type: "loaded" });
    expect(afterLoad.status).toBe("loaded");

    const afterLateTimeout = virtualTourEmbedReducer(afterLoad, { type: "timeout" });
    expect(afterLateTimeout).toEqual(afterLoad);
  });

  it("`loaded`/`timeout`/`error` from `idle` are no-ops (nothing is loading yet)", () => {
    expect(virtualTourEmbedReducer(initialVirtualTourEmbedState, { type: "loaded" })).toEqual(
      initialVirtualTourEmbedState,
    );
    expect(virtualTourEmbedReducer(initialVirtualTourEmbedState, { type: "timeout" })).toEqual(
      initialVirtualTourEmbedState,
    );
    expect(virtualTourEmbedReducer(initialVirtualTourEmbedState, { type: "error" })).toEqual(
      initialVirtualTourEmbedState,
    );
  });

  it("a full retry cycle: idle -> loading -> error -> loading (retry) -> loaded", () => {
    let state = initialVirtualTourEmbedState;
    state = virtualTourEmbedReducer(state, { type: "start" });
    expect(state).toEqual({ status: "loading", attempt: 1 });

    state = virtualTourEmbedReducer(state, { type: "timeout" });
    expect(state).toEqual({ status: "error", attempt: 1 });

    state = virtualTourEmbedReducer(state, { type: "start" });
    expect(state).toEqual({ status: "loading", attempt: 2 });

    state = virtualTourEmbedReducer(state, { type: "loaded" });
    expect(state).toEqual({ status: "loaded", attempt: 2 });
  });

  it("multiple independent state instances never share attempt counters (no module-level state)", () => {
    let stateA = initialVirtualTourEmbedState;
    let stateB = initialVirtualTourEmbedState;
    stateA = virtualTourEmbedReducer(stateA, { type: "start" });
    stateA = virtualTourEmbedReducer(stateA, { type: "start" });
    stateB = virtualTourEmbedReducer(stateB, { type: "start" });
    expect(stateA.attempt).toBe(2);
    expect(stateB.attempt).toBe(1);
  });
});
