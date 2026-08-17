import { InvalidVirtualTourProviderInputError } from "../errors";
import type { VirtualTourProviderDefinition } from "../provider-registry";

// Verified against Matterport's official Help Center documentation
// (support.matterport.com, "Embed a Space with an iframe" and "URL
// Parameters" articles) — not a remembered/old snippet, per the v0.7
// brief's explicit instruction. The canonical Showcase share/embed URL is
// `https://my.matterport.com/show/?m=<11-character alphanumeric Model
// SID>`; the official embed snippet is
// `<iframe ... src="https://my.matterport.com/show/?m=<SID>" allowfullscreen allow="xr-spatial-tracking"></iframe>`.
// This module deliberately implements nothing beyond that: no Embed SDK,
// no `applicationKey`, no GraphQL/OAuth/API token — see section 9 of the
// brief and docs/adr/0019-virtual-tour-immersive-kernel.md.
const MATTERPORT_ORIGIN = "https://my.matterport.com";

// The Model SID is documented as an 11-character alphanumeric identifier
// (e.g. "uRGXgoiYk9f"). A closed allowlist pattern, not a blocklist — a
// value that merely "isn't obviously wrong" is not accepted.
const MODEL_SID_PATTERN = /^[A-Za-z0-9]{11}$/;

/**
 * Extracts a canonical Model SID from admin-supplied input — either a bare
 * SID, or an official `https://my.matterport.com/show/?m=<SID>` (or the
 * older bare `https://my.matterport.com/?m=<SID>`) share URL. Returns
 * `null` for anything else: a different host, a lookalike subdomain
 * (`my.matterport.com.evil.example`), a non-`https` scheme (including
 * `javascript:`/`data:`/`blob:`, which `new URL()` either rejects outright
 * or parses with a `protocol` that fails the check below), a missing/
 * malformed `m` parameter, or a bare string that isn't itself a valid SID.
 * Any *other* query parameters on the input URL are read never propagated
 * — the canonical embed URL this module builds is always freshly
 * constructed from just the SID (see `buildEmbedUrl`).
 */
function extractModelSid(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) return null;
  if (MODEL_SID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "my.matterport.com") return null;
  if (url.pathname !== "/show/" && url.pathname !== "/") return null;

  const sid = url.searchParams.get("m");
  if (!sid || !MODEL_SID_PATTERN.test(sid)) return null;
  return sid;
}

export const matterportProvider: VirtualTourProviderDefinition = {
  provider: "matterport",

  normalize(rawInput) {
    const sid = extractModelSid(rawInput);
    if (!sid) {
      throw new InvalidVirtualTourProviderInputError(
        "matterport",
        'expected an official Matterport share URL ("https://my.matterport.com/show/?m=<id>") or an 11-character Model SID',
      );
    }
    return { providerAssetId: sid };
  },

  validateExternalId(providerAssetId) {
    return MODEL_SID_PATTERN.test(providerAssetId);
  },

  // Deterministic and first-party-constructed: the only variable input is
  // an already-normalized/validated SID, never anything read back from a
  // caller-supplied URL string.
  buildEmbedUrl(providerAssetId) {
    return `${MATTERPORT_ORIGIN}/show/?m=${providerAssetId}`;
  },

  buildPublicUrl(providerAssetId) {
    return `${MATTERPORT_ORIGIN}/show/?m=${providerAssetId}`;
  },

  frameOrigins: [MATTERPORT_ORIGIN],

  capabilities: {
    allowFullscreen: true,
    // Verbatim from the official embed snippet cited above.
    iframeAllow: "xr-spatial-tracking",
  },
};
