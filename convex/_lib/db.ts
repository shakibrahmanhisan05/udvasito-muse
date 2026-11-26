import type { IndexRange } from "convex/server";

/**
 * Multi-field equality index range for `withIndex`.
 *
 * The repo's hand-derived DataModel (convex/schemaTypes.ts, kept so the
 * backend type-checks before codegen) cannot express chained `.eq()`
 * calls — those need codegen's concrete per-index field tuples. Building
 * the chain here keeps call sites clean; Convex still validates the
 * fields and order against the real schema at runtime.
 */
export function eqRange(pairs: readonly (readonly [string, unknown])[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see header
  return (q: any): IndexRange => {
    let range = q as { eq: (field: string, value: unknown) => unknown };
    for (const [field, value] of pairs) {
      range = range.eq(field, value) as typeof range;
    }
    return range as unknown as IndexRange;
  };
}
