import "dotenv/config";
import "./api/index"; // starts express server
import "./worker/index"; // starts cron scheduler
import "./bot/index";