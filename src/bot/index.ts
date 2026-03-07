import { Bot } from "grammy";
import "dotenv/config";
import { db } from "../core/db";
import { signState } from "../core/state";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

async function ensureUser(chatId: string) {
const r = await db.query(
`insert into users(telegram_chat_id) values($1)
on conflict (telegram_chat_id) do update set telegram_chat_id=excluded.telegram_chat_id
returning id`,
[chatId]
);
return r.rows[0].id as string;
}

bot.command("start", async (ctx) => {
await ctx.reply(
"Welcome 👋\nCommands:\n/connect_instagram\n/connect_youtube\n/status\n/sync_now"
);
});
bot.catch((err) => {
console.error("BOT ERROR:", err);
});

(async () => {
await bot.api.deleteWebhook({ drop_pending_updates: true }); // important for polling mode
await bot.start();
console.log("Bot started");
})();
bot.command("connect_instagram", async (ctx) => {
const chatId = String(ctx.chat.id);
const uid = await ensureUser(chatId);
const state = signState({ uid, chatId, provider: "instagram" });
await ctx.reply(`${process.env.APP_URL}/oauth/instagram/start?state=${encodeURIComponent(state)}`);
});

bot.command("connect_youtube", async (ctx) => {
const chatId = String(ctx.chat.id);
const uid = await ensureUser(chatId);
const state = signState({ uid, chatId, provider: "youtube" });
await ctx.reply(`${process.env.APP_URL}/oauth/youtube/start?state=${encodeURIComponent(state)}`);
});

bot.command("status", async (ctx) => {
const chatId = String(ctx.chat.id);
const u = await db.query("select id from users where telegram_chat_id=$1", [chatId]);
if (!u.rowCount) return ctx.reply("No account found. Run /connect_instagram first.");

const c = await db.query("select provider from connections where user_id=$1", [u.rows[0].id]);
const providers = c.rows.map((x) => x.provider);
await ctx.reply(
`Instagram: ${providers.includes("instagram") ? "✅" : "❌"}\nYouTube: ${providers.includes("youtube") ? "✅" : "❌"}`
);
});

bot.start();
console.log("Bot running");