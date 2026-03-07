import express from "express";
import axios from "axios";
import "dotenv/config";
import { verifyState } from "../core/state";
import { db } from "../core/db";
import { encrypt } from "../core/crypto";

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
console.log("IG_ACCESS_TOKEN_DEBUG:", accessToken); // temporary

await db.query(
`insert into connections(user_id, provider, access_token_enc)
values($1,'instagram',$2)
on conflict (user_id, provider)
do update set access_token_enc=excluded.access_token_enc, updated_at=now()`,
[state.uid, encrypt(accessToken)]
);

res.send("Instagram connected. You can return to Telegram.");
} catch (e: any) {
res.status(500).send(`Instagram auth failed: ${e.message}`);
}
});

app.get("/oauth/youtube/start", async (req, res) => {
const state = req.query.state as string;
const scope = encodeURIComponent("https://www.googleapis.com/auth/youtube.upload");
const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI!)}&response_type=code&access_type=offline&prompt=consent&scope=${scope}&state=${encodeURIComponent(state)}`;
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

res.send("YouTube connected. You can return to Telegram.");
} catch (e: any) {
res.status(500).send(`YouTube auth failed: ${e.message}`);
}
});

app.listen(process.env.API_PORT || 3000, () => {
console.log(`API running on :${process.env.API_PORT || 3000}`);
});





// curl "https://graph.facebook.com/v19.0/me/accounts?fields=id,name&access_token=YOUR_TOKEN"
// curl "https://graph.facebook.com/v19.0/me/accounts?fields=id,name&access_token=YOUR_TOKEN"


