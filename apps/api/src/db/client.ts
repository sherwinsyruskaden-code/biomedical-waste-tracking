import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.js";
import * as schema from "./schema.js";

// Return numeric/bigint columns as JS numbers where safe (counts, sums).
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export type DB = NodePgDatabase<typeof schema>;
/** Either the root db or a transaction handle. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;
