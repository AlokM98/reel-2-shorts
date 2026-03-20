import { db } from "../core/db";
import { decrypt } from "../core/crypto";
import { getLatestReel } from "../services/instagram";
import { downloadVideoToTemp, cleanupTemp } from "../services/media";
import { buildTitle, buildDescription, buildTagsFromCaption } from "../services/metadata";
import { uploadToYouTube } from "../services/youtube";
import notify = require("../services/notify");

function getErrorMessage(e: any): string {
    return (
        e?.response?.data?.error?.message ||
        e?.response?.data?.error_description ||
        e?.message ||
        "Unknown error"
    );
}

function isInstagramAuthExpiredError(e: any): boolean {
    const msg = (getErrorMessage(e) || "").toLowerCase();

    return (
        msg.includes("error validating access token") ||
        msg.includes("session has been invalidated") ||
        msg.includes("user changed their password") ||
        msg.includes("invalid oauth access token") ||
        msg.includes("access token has expired")
    );
}

function isYouTubeAuthExpiredError(e: any): boolean {
    const msg = (getErrorMessage(e) || "").toLowerCase();
    const reason = (e?.response?.data?.error?.errors?.[0]?.reason || "").toLowerCase();
    const status = e?.response?.status;

    return (
        status === 401 ||
        msg.includes("unauthorized") ||
        msg.includes("invalid credentials") ||
        msg.includes("invalid_grant") ||
        msg.includes("token has been expired") ||
        msg.includes("token has been revoked") ||
        msg.includes("youtube refresh token missing") ||
        msg.includes("youtube connection not found") ||
        reason.includes("autherror") ||
        reason.includes("invalidcredentials")
    );
}

export async function runSync() {
    console.log("Worker running sync job at", new Date().toISOString());

    const users = await db.query(`
        select u.id, u.telegram_chat_id,
        max(case when c.provider='instagram' then c.access_token_enc end) as ig_token
        from users u
        join connections c on c.user_id=u.id
        group by u.id, u.telegram_chat_id
        having count(distinct c.provider) = 2
    `);

    for (const user of users.rows) {
        let currentReelId: string | null = null;
        try {
            const igToken = decrypt(user.ig_token);
            const reel = await getLatestReel(igToken);
            if (!reel) continue;
            currentReelId = reel.id;

            const exists = await db.query(
                "select 1 from sync_jobs where user_id=$1 and ig_media_id=$2",
                [user.id, reel.id]
            );
            if (exists.rowCount) {
                console.log("Sync job already exists for user=", user.id, "ig=", reel.id);
                continue;
            }
            console.log("Youtube preprocess started for user=", user.id, "ig=", reel.id);
            const caption = reel.caption || "";
            const title = buildTitle(caption);
            console.log("Youtube title built for user=", user.id, "ig=", reel.id, "title=", title);
            const description = buildDescription(caption, reel.permalink);
            console.log("Youtube description built for user=", user.id, "ig=", reel.id, "description=", description);
            const tags = buildTagsFromCaption(caption);
            console.log("Youtube tags built for user=", user.id, "ig=", reel.id, "tags=", tags);

            await db.query(
                "insert into sync_jobs(user_id, ig_media_id, status) values($1,$2,'pending')",
                [user.id, reel.id]
            );

            const tempFile = await downloadVideoToTemp(reel.media_url);
            let ytVideoId = "";
            let privacyStatus = "private";
            try {
                ytVideoId = await uploadToYouTube({
                    userId: user.id,
                    filePath: tempFile,
                    title,
                    description,
                    tags,
                });
            } finally {
                cleanupTemp(tempFile);
            }

            await db.query(
                `update sync_jobs
                set status='uploaded', yt_video_id=$3, updated_at=now()
                where user_id=$1 and ig_media_id=$2`,
                [user.id, reel.id, ytVideoId]
            );

            console.log("Sync job uploaded for user=", user.id, "ig=", reel.id, "yt=", ytVideoId);
            const successMsg = `🎉 Done! Your Reel is uploaded to YouTube Shorts.\n 🔗 Watch now: https://youtu.be/${ytVideoId}\n🔒 Visibility: ${privacyStatus}`;
            await notify.sendTelegram(user.telegram_chat_id, successMsg);
        } catch (e: any) {
            const reason = getErrorMessage(e);

            console.error("sync error:", {
                userId: user.id,
                message: e?.message,
                status: e?.response?.status,
                reason,
                data: e?.response?.data,
            });

            // mark current reel job as failed (if created)
            if (currentReelId) {
                await db.query(
                    `update sync_jobs
                    set status='failed', error=$3, updated_at=now()
                    where user_id=$1 and ig_media_id=$2 and status='pending'`,
                    [user.id, currentReelId, reason]
                );
            }

            // Special handling for expired/invalid IG token
            if (isInstagramAuthExpiredError(e)) {
                // Option A: hard invalidate by removing instagram connection
                await db.query(
                    `delete from connections
                    where user_id=$1 and provider='instagram'`,
                    [user.id]
                );

                await notify.sendTelegram(
                    user.telegram_chat_id,
                    `⚠️ Instagram session expired for security reasons.\n\nPlease reconnect by running /connect_instagram`
                );

                // skip retries for this case
                continue;
            }

            // Special handling for expired/invalid YouTube token
            if (isYouTubeAuthExpiredError(e)) {
                await db.query(
                    `delete from connections
                    where user_id=$1 and provider='youtube'`,
                    [user.id]
                );

                await notify.sendTelegram(
                    user.telegram_chat_id,
                    `⚠️ YouTube session expired or was revoked.\n\nPlease reconnect by running /connect_youtube`
                );

                // skip retries for this case
                continue;
            }

            // generic failure alert
            await notify.sendTelegram(
                user.telegram_chat_id,
                `❌ Sync failed\nReason: ${reason}`
            );
        }

    }
}