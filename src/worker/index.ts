import "dotenv/config";
import cron from "node-cron";
import { runSync } from "./sync";

cron.schedule("*/2 * * * *", runSync);
console.log("Worker running every 2 minutes");
runSync();