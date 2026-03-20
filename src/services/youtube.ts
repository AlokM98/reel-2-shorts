import axios from "axios";
import fs from "node:fs";
import { google } from "googleapis";
import { db } from "../core/db";
import { decrypt, encrypt } from "../core/crypto";

async function refreshYouTubeAccessToken(userId: string, force = false) {
    const r = await db.query(
        `select access_token_enc, refresh_token_enc, expires_at
from connections where user_id=$1 and provider='youtube'`,
        [userId]
    );
    if (!r.rowCount) throw new Error("YouTube connection not found");

    const row = r.rows[0];
    const accessToken = decrypt(row.access_token_enc);
    const refreshToken = row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null;
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;

    const shouldRefresh = force || (!!refreshToken && Date.now() >= expiresAt - 120000);
    if (!shouldRefresh) return { accessToken, refreshToken };

    if (!refreshToken) {
        throw new Error("YouTube refresh token missing; reconnect required");
    }

    const tokenResp = await axios.post("https://oauth2.googleapis.com/token", null, {
        params: {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        },
    });

    const newAccessToken = tokenResp.data.access_token as string;
    const expiresIn = tokenResp.data.expires_in ?? 3600;

    await db.query(
        `update connections
            set access_token_enc=$2,
            expires_at=now() + ($3 || ' seconds')::interval,
            updated_at=now()
            where user_id=$1 and provider='youtube'`,
        [userId, encrypt(newAccessToken), String(expiresIn)]
    );

    return { accessToken: newAccessToken, refreshToken };
}

function isYouTubeAuthError(e: any): boolean {
    const status = e?.response?.status;
    const message = (e?.response?.data?.error?.message || e?.message || "").toLowerCase();
    const reason = (
        e?.response?.data?.error?.errors?.[0]?.reason ||
        e?.response?.data?.error_description ||
        ""
    ).toLowerCase();

    return (
        status === 401 ||
        message.includes("unauthorized") ||
        message.includes("invalid credentials") ||
        message.includes("login required") ||
        message.includes("invalid_grant") ||
        reason.includes("autherror") ||
        reason.includes("invalidcredentials")
    );
}

export async function uploadToYouTube(input: {
    userId: string;
    filePath: string;
    title: string;
    description: string;
    tags: string[];
    privacyStatus?: "public" | "private" | "unlisted";
}) {
    async function attemptUpload(forceRefresh = false) {
        const { accessToken, refreshToken } = await refreshYouTubeAccessToken(input.userId, forceRefresh);

        const oauth2 = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        oauth2.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken || null,
        });

        const youtube = google.youtube({ version: "v3", auth: oauth2 });
        return youtube.videos.insert({
            part: ["snippet", "status"],
            requestBody: {
                snippet: {
                    title: input.title,
                    description: input.description,
                    tags: input.tags,
                    categoryId: "22",
                },
                status: {
                    privacyStatus: input.privacyStatus || "private",
                    selfDeclaredMadeForKids: false,
                },
            },
            media: {
                body: fs.createReadStream(input.filePath),
            },
        });
    }

    try {
        const resp = await attemptUpload(false);
        return resp.data.id as string;
    } catch (e: any) {
        console.error("YT upload failed", {
            userId: input.userId,
            status: e?.response?.status,
            error: e?.response?.data?.error,
            message: e?.response?.data?.error?.message || e?.message,
            errors: e?.response?.data?.error?.errors,
        });

        if (!isYouTubeAuthError(e)) throw e;

        console.warn("YT auth error detected; forcing access token refresh and retry", {
            userId: input.userId,
        });

        const retryResp = await attemptUpload(true);
        return retryResp.data.id as string;
    }
}