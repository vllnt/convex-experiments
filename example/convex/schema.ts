import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The example host app's own table. Conversions live in the HOST's table —
 * entirely outside the component's sandboxed tables — to demonstrate the
 * boundary: the component owns assignment + exposure; the host measures the
 * outcome it cares about and joins on the variant.
 */
export default defineSchema({
  conversions: defineTable({
    subjectRef: v.string(),
    variant: v.string(),
  }).index("by_variant", ["variant"]),
});
