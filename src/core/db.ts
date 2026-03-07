import { Pool } from "pg";
import "dotenv/config";

export const db = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: { rejectUnauthorized: false },
});