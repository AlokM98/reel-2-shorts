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

async function sendConnectMessage(ctx: any, provider: "instagram" | "youtube") {
    const chatId = String(ctx.chat.id);
    const uid = await ensureUser(chatId);
    const state = signState({ uid, chatId, provider });
    const url = `${process.env.APP_URL}/oauth/${provider}/start?state=${encodeURIComponent(state)}`;

    const platformName = provider === "instagram" ? "Instagram" : "YouTube";
    const reconnectHint = provider === "instagram" ? "/connect_instagram" : "/connect_youtube";

    await ctx.reply(
        `🔗 Let’s connect your ${platformName} account!\n\n` +
        `1) Tap this link: ${url}\n` +
        `2) Approve access on ${platformName}\n` +
        `3) Come back here — I’ll confirm success automatically ✅\n\n` +
        `If anything fails, just run ${reconnectHint} again and we’ll retry.`
    );
}

bot.command("start", async (ctx) => {
    await ctx.reply(
        "Welcome 👋\n\nI can auto-upload your reels to YouTube Shorts.\n\nCommands:\n/connect_instagram\n/connect_youtube\n/status"
    );
});

bot.command("connect_instagram", async (ctx) => {
    await sendConnectMessage(ctx, "instagram");
});

bot.command("connect_youtube", async (ctx) => {
    await sendConnectMessage(ctx, "youtube");
});

bot.command("status", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const u = await db.query("select id from users where telegram_chat_id=$1", [chatId]);
    if (!u.rowCount) return ctx.reply("No account found yet. Start with /connect_instagram");

    const c = await db.query("select provider from connections where user_id=$1", [u.rows[0].id]);
    const providers = c.rows.map((x: any) => x.provider);
    await ctx.reply(
        `Connection status:\nInstagram: ${providers.includes("instagram") ? "✅ Connected" : "❌ Not connected"}\nYouTube: ${providers.includes("youtube") ? "✅ Connected" : "❌ Not connected"}`
    );
});

bot.catch((err) => {
    console.error("BOT ERROR:", err);
});

(async () => {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    await bot.start();
    console.log("Bot started");
})();