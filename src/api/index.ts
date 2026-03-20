import express from "express";
import axios from "axios";
import "dotenv/config";
import { verifyState } from "../core/state";
import { db } from "../core/db";
import { encrypt } from "../core/crypto";
import notify = require("../services/notify");

const app = express();

app.get("/health", (_, res) => res.send("ok"));

app.get("/oauth/instagram/start", async (req, res) => {
const state = req.query.state as string;
const scope = [
"instagram_basic",
"pages_show_list",
"pages_read_engagement",
"business_management",
].join(",");
const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.META_APP_ID}&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI!)}&scope=${encodeURIComponent(scope)}&response_type=code&state=${encodeURIComponent(state)}&auth_type=rerequest`;
res.redirect(url);
});

app.get("/oauth/instagram/callback", async (req, res) => {
try {
const code = req.query.code as string;
const state = verifyState(req.query.state as string);

const tokenResp = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
params: {
client_id: process.env.META_APP_ID,
client_secret: process.env.META_APP_SECRET,
redirect_uri: process.env.META_REDIRECT_URI,
code
}
});

const accessToken = tokenResp.data.access_token as string;

await db.query(
`insert into connections(user_id, provider, access_token_enc)
values($1,'instagram',$2)
on conflict (user_id, provider)
do update set access_token_enc=excluded.access_token_enc, updated_at=now()`,
[state.uid, encrypt(accessToken)]
);

await notify.sendTelegram(
state.chatId,
"✅ Instagram connected successfully!\nYou can now run /connect_youtube (if not connected yet) and start syncing 🚀"
);

res.send("Instagram connected successfully ✅ You can return to Telegram.");
} catch (e: any) {
const stateToken = req.query.state as string;
try {
if (stateToken) {
const state = verifyState(stateToken);
await notify.sendTelegram(
state.chatId,
`❌ Instagram connection failed.\nReason: ${e?.message || "Unknown error"}\n\nPlease run /connect_instagram to try again.`
);
}
} catch {
// ignore state parse issues
}
res.status(500).send(`Instagram auth failed: ${e.message}`);
}
});

app.get("/oauth/youtube/start", async (req, res) => {
const state = req.query.state as string;
const scopes = [
"https://www.googleapis.com/auth/youtube.upload",
"https://www.googleapis.com/auth/youtube.readonly",
];
const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI!)}&response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent(scopes.join(" "))}&state=${encodeURIComponent(state)}`;
res.redirect(url);
});

app.get("/oauth/youtube/callback", async (req, res) => {
try {
const code = req.query.code as string;
const state = verifyState(req.query.state as string);

const tokenResp = await axios.post("https://oauth2.googleapis.com/token", null, {
params: {
client_id: process.env.GOOGLE_CLIENT_ID,
client_secret: process.env.GOOGLE_CLIENT_SECRET,
code,
grant_type: "authorization_code",
redirect_uri: process.env.GOOGLE_REDIRECT_URI
}
});

const { access_token, refresh_token, expires_in } = tokenResp.data;

await db.query(
`insert into connections(user_id, provider, access_token_enc, refresh_token_enc, expires_at)
values($1,'youtube',$2,$3,now() + ($4 || ' seconds')::interval)
on conflict (user_id, provider) do update
set access_token_enc=excluded.access_token_enc,
refresh_token_enc=coalesce(excluded.refresh_token_enc, connections.refresh_token_enc),
expires_at=excluded.expires_at,
updated_at=now()`,
[state.uid, encrypt(access_token), encrypt(refresh_token ?? ""), String(expires_in ?? 3600)]
);

await notify.sendTelegram(
state.chatId,
"✅ YouTube connected successfully!\nYour next reel will be uploaded automatically when sync runs 🎬"
);

res.send("YouTube connected successfully ✅ You can return to Telegram.");
} catch (e: any) {
const stateToken = req.query.state as string;
try {
if (stateToken) {
const state = verifyState(stateToken);
await notify.sendTelegram(
state.chatId,
`❌ YouTube connection failed.\nReason: ${e?.message || "Unknown error"}\n\nPlease run /connect_youtube to try again.`
);
}
} catch {
// ignore state parse issues
}
res.status(500).send(`YouTube auth failed: ${e.message}`);
}
});

app.listen(process.env.API_PORT || 3000, () => {
console.log(`API running on :${process.env.API_PORT || 3000}`);
});





// curl "https://graph.facebook.com/v19.0/me/accounts?fields=id,name&access_token=YOUR_TOKEN"
// curl "https://graph.facebook.com/v19.0/me/accounts?fields=id,name&access_token=YOUR_TOKEN"


