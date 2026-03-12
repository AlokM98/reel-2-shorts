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
        try {
            const igToken = decrypt(user.ig_token);
            const reel = await getLatestReel(igToken);
            if (!reel) continue;

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
                console.log("Sync job created for user=", user.id, "ig=", reel.id, ytVideoId ? "upload success" : "upload failed");
                await db.query(
                    "insert into sync_jobs(user_id, ig_media_id, status) values($1,$2,'pending')",
                    [user.id, reel.id]
                );

                const successMsg = `🎉 Done! Your Reel is uploaded to YouTube Shorts.\n 🔗 Watch now: https://youtu.be/${ytVideoId}\n🔒 Visibility: ${privacyStatus}`;
                await notify.sendTelegram(user.telegram_chat_id, successMsg);
            } catch (e) {
                console.error("Youtube upload failed for user=", user.id, "ig=", reel.id, "error=", e);
            } finally {
                cleanupTemp(tempFile);
            }

            await db.query(
                `update sync_jobs
                set status='uploaded', yt_video_id=$3, updated_at=now()
                where user_id=$1 and ig_media_id=$2`,
                [user.id, reel.id, ytVideoId]
            );

            console.log(`[SYNC] uploaded user=${user.id} ig=${reel.id} yt=${ytVideoId}`);
        } catch (e: any) {
            const reason = getErrorMessage(e);

            console.error("sync error:", {
                userId: user.id,
                message: e?.message,
                status: e?.response?.status,
                reason,
                data: e?.response?.data,
            });

            // mark latest pending as failed
            await db.query(
                `update sync_jobs
                set status='failed', error=$2, updated_at=now()
                where id = (
                select id from sync_jobs
                where user_id=$1 and status='pending'
                order by created_at desc
                limit 1
                )`,
                [user.id, reason]
            );

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

            // generic failure alert
            await notify.sendTelegram(
                user.telegram_chat_id,
                `❌ Sync failed\nReason: ${reason}`
            );
        }

    }
}