import { virtualTourProviderRegistry } from "../provider-registry";
import { matterportProvider } from "./matterport";

// Registers every built-in provider exactly once, as a side effect of
// importing this module — same "registration lives in exactly one place"
// pattern as `packages/content`'s `blocks/index.ts`. A future second
// provider is one more `VirtualTourProviderDefinition` plus one more
// `register(...)` call here, nothing else in the codebase changes.
virtualTourProviderRegistry.register(matterportProvider);

export { matterportProvider };
