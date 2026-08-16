/**
 * Rendered in place of ANY block instance `renderBlocks()` could not turn
 * into a real component — a malformed envelope, an unknown type@version,
 * props that fail their schema, or a registered type with no renderer
 * (docs/adr/0014-block-registry-versioning.md: "an unrecognized block
 * never crashes the page"). Deliberately does not echo the raw props or
 * the underlying error message into the DOM — this is public-facing
 * output, not a debug view.
 */
export function UnrenderableBlock({ blockKey }: { blockKey: string }) {
  return (
    <section
      data-block="unrenderable"
      data-block-key={blockKey}
      style={{ display: "none" }}
      aria-hidden="true"
    />
  );
}
