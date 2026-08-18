export {
  ACCEPTED_IMAGE_FORMATS,
  FORMAT_TO_MIME_TYPE,
  IMAGE_VARIANT_TOKENS,
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
  UPLOAD_INTENT_TTL_MS,
  VARIANT_MAX_WIDTH,
} from "./domain/constants";
export type { AcceptedImageFormat, ImageVariantToken } from "./domain/constants";

export {
  MEDIA_VARIANTS_VERSION,
  mediaVariantsV1Schema,
  resolveMediaVariants,
} from "./domain/media-variants";
export type { MediaVariantEntry, MediaVariantsV1 } from "./domain/media-variants";

export {
  MediaDecodeError,
  MediaObjectMissingError,
  MediaStorageUnavailableError,
  MediaTooLargeError,
  MediaTypeRejectedError,
  MediaUploadAlreadyFinalizedError,
  MediaUploadExpiredError,
  MediaUploadNotFoundError,
} from "./errors";

export { validateImageBytes } from "./validation/image-validation";
export type { ValidatedImage } from "./validation/image-validation";

export { generateImageVariants, storeImageVariants } from "./processing/variants";

export type { ObjectMetadata, ObjectStorage } from "./storage/object-storage";
export { MemoryObjectStorage } from "./storage/memory-object-storage";
export { S3ObjectStorage } from "./storage/s3-object-storage";
export type { S3ObjectStorageConfig } from "./storage/s3-object-storage";
export { getObjectStorage, resetObjectStorageForTests } from "./storage/config";

export {
  buildOriginalStorageKey,
  buildUploadStorageKey,
  buildVariantStorageKey,
} from "./upload/object-keys";
export {
  claimMediaUploadForFinalize,
  createMediaUploadIntent,
  expireOverdueMediaUploads,
  getMediaUploadIntent,
  listExpiredPendingMediaUploads,
  markMediaUploadFailed,
  markMediaUploadFinalized,
} from "./repository/media-upload-repository";
export type {
  CreateMediaUploadIntentInput,
  MediaUploadRow,
} from "./repository/media-upload-repository";
export { finalizeMediaUpload, finalizeMediaUploadSafely } from "./upload/finalize";

export { buildMediaDeliveryUrl, resolveDeliveryStorageKey } from "./delivery/media-url";
export type { DeliverableAsset, DeliveryVariant } from "./delivery/media-url";
export { resolveMediaDelivery } from "./delivery/media-delivery-handler";
export type { MediaDeliveryResult } from "./delivery/media-delivery-handler";
export { buildMediaDeliveryResponse } from "./delivery/media-response";

export { cleanupExpiredMediaUploads } from "./cleanup";

export { findDbOrphans, findStorageOrphans } from "./reconciliation/orphan-scan";
export type { DbOrphan, DbOrphanKind, StorageOrphan } from "./reconciliation/orphan-scan";
