import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "./schema";

/**
 * DataModel derived directly from convex/schema.ts. Convex codegen
 * (`npm run convex`) will generate convex/_generated/* on first run against a
 * deployment; until then this module keeps the whole backend type-checkable
 * without a live deployment (P0 — accounts are a human step, roadmap §6).
 */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;

/** Document / ID helpers (convex 1.51 exports these as DocumentByName / GenericId). */
export type Doc<TableName extends TableNamesInDataModel<DataModel>> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNamesInDataModel<DataModel>> = GenericId<TableName>;
