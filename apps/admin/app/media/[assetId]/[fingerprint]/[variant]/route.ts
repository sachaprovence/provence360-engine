import {
  buildMediaDeliveryResponse,
  getObjectStorage,
  resolveMediaDelivery,
  type DeliveryVariant,
} from "@provence360/media";
import { listMembershipsForUser } from "@provence360/auth";
import { withTenantContext } from "@provence360/tenant";
import { uuidSchema } from "@provence360/validation";
import { getCurrentUserOrNull } from "@/lib/actor";

// v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (see
// docs/adr/0022-media-ingestion-asset-delivery.md). Same URL shape and
// same `resolveMediaDelivery` core as `apps/web`'s public route — the
// only thing that differs is *how tenant is resolved*, because Admin
// Preview isn't reached via the Site's own hostname the way the public
// runtime is: it's reached over the admin app's own domain, with the
// tenant determined by the logged-in user's session instead.
//
// Preview/Public parity (brief §15) is about the *rendered HTML/CSS* —
// `resolveResponsiveImage` (packages/renderer) emits the identical
// `/media/{assetId}/{fingerprint}/{variant}` path regardless of which app
// renders it, so this route exists to make that URL actually resolve here
// too, not to reimplement any decision logic: `resolveMediaDelivery`
// itself is the exact same function `apps/web` calls.
//
// Never trusts a bare `tenantId` in the URL (there isn't one) — instead,
// tries each tenant the *authenticated* user actually has a Membership in
// (bounded: a user belongs to a handful of tenants at most) until one's
// RLS-scoped lookup resolves the asset. An unauthenticated request, or one
// for an asset outside every tenant the user belongs to, 404s — same
// fail-closed contract `withTenantPage` already uses everywhere else in
// this app.

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

  const user = await getCurrentUserOrNull();
  if (!user) return new Response(null, { status: 404 });

  const memberships = await listMembershipsForUser(user.id);
  const storage = getObjectStorage();

  for (const membership of memberships) {
    const result = await withTenantContext(membership.tenantId, (tx) =>
      resolveMediaDelivery(tx, storage, parsedAssetId.data, fingerprint, variant),
    );
    if (result) {
      return buildMediaDeliveryResponse(result, {
        method,
        ifNoneMatch: request.headers.get("if-none-match"),
        // Admin Preview always shows a private, per-tenant view — never a
        // shared public cache, regardless of the asset's own fingerprint
        // immutability.
        cacheControl: "private, no-store",
      });
    }
  }

  return new Response(null, { status: 404 });
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
