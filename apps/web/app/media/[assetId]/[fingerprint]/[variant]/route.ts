import { headers } from "next/headers";
import { resolveSiteByHostname } from "@provence360/domains";
import {
  buildMediaDeliveryResponse,
  getObjectStorage,
  resolveMediaDelivery,
  type DeliveryVariant,
} from "@provence360/media";
import { withTenantContext } from "@provence360/tenant";
import { uuidSchema } from "@provence360/validation";

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md). A stable, same-origin,
// content-addressed URL — `{assetId}/{fingerprint}/{variant}` — never a
// signed/expiring one, so a value frozen into a published Revision's
// snapshot (see `resolve-delivery-url.ts`) never goes stale. Resolves
// tenant from the request's own `Host` header, the exact same
// hostname -> tenant chain `renderPublishedPage` already uses
// (`apps/web/lib/site-page.ts`) — every read below stays inside a real
// RLS-scoped transaction, never a bypass, even though this route needs no
// login (brief §13/§20: no tenant-scoped read outside RLS context, and
// this URL carries no session at all).

const CLOSED_VARIANTS = new Set<DeliveryVariant>([
  "thumbnail",
  "small",
  "medium",
  "large",
  "original",
]);

function isValidVariant(value: string): value is DeliveryVariant {
  return CLOSED_VARIANTS.has(value as DeliveryVariant);
}

async function handle(
  method: "GET" | "HEAD",
  request: Request,
  { params }: { params: Promise<{ assetId: string; fingerprint: string; variant: string }> },
): Promise<Response> {
  const { assetId, fingerprint, variant } = await params;

  const parsedAssetId = uuidSchema.safeParse(assetId);
  const isValidFingerprint = /^[0-9a-f]{64}$/.test(fingerprint);
  if (!parsedAssetId.success || !isValidFingerprint || !isValidVariant(variant)) {
    return new Response(null, { status: 404 });
  }

  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  const resolved = await resolveSiteByHostname(host);
  if (!resolved || resolved.siteStatus !== "active") {
    return new Response(null, { status: 404 });
  }

  const storage = getObjectStorage();
  const result = await withTenantContext(resolved.tenantId, (tx) =>
    resolveMediaDelivery(tx, storage, parsedAssetId.data, fingerprint, variant),
  );
  if (!result) return new Response(null, { status: 404 });

  return buildMediaDeliveryResponse(result, {
    method,
    ifNoneMatch: request.headers.get("if-none-match"),
    cacheControl: result.immutable ? "public, max-age=31536000, immutable" : "private, no-store",
  });
}

export function GET(
  request: Request,
  ctx: { params: Promise<{ assetId: string; fingerprint: string; variant: string }> },
): Promise<Response> {
  return handle("GET", request, ctx);
}

export function HEAD(
  request: Request,
  ctx: { params: Promise<{ assetId: string; fingerprint: string; variant: string }> },
): Promise<Response> {
  return handle("HEAD", request, ctx);
}
