import { db } from "../core/db";
import { decrypt } from "../core/crypto";
import { getRecentReels } from "../services/instagram";
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
        try {
            const igToken = decrypt(user.ig_token);
            const backfillLimit = Number(process.env.SYNC_BACKFILL_LIMIT || 100);
            const reels = await getRecentReels(igToken, backfillLimit);
            if (!reels.length) continue;

            const jobs = await db.query(
                `select ig_media_id, status from sync_jobs where user_id=$1`,
                [user.id]
            );
            const statusByMediaId = new Map<string, string>(
                jobs.rows.map((j: any) => [j.ig_media_id, j.status])
            );

            const backlog = [...reels]
                .reverse()
                .filter((reel: any) => statusByMediaId.get(reel.id) !== "uploaded");

            if (!backlog.length) {
                console.log("No backlog for user=", user.id);
                continue;
            }

            console.log("Backlog found for user=", user.id, "count=", backlog.length);

            for (const reel of backlog) {
                try {
                    const knownStatus = statusByMediaId.get(reel.id);
                    if (!knownStatus) {
                        await db.query(
                            "insert into sync_jobs(user_id, ig_media_id, status) values($1,$2,'pending')",
                            [user.id, reel.id]
                        );
                    } else if (knownStatus === "failed") {
                        await db.query(
                            `update sync_jobs set status='pending', error=null, updated_at=now()
                            where user_id=$1 and ig_media_id=$2`,
                            [user.id, reel.id]
                        );
                    }

                    console.log("Youtube preprocess started for user=", user.id, "ig=", reel.id);
                    const caption = reel.caption || "";
                    const title = buildTitle(caption);
                    const description = buildDescription(caption, reel.permalink);
                    const tags = buildTagsFromCaption(caption);

                    const tempFile = await downloadVideoToTemp(reel.media_url);
                    let ytVideoId = "";
                    const privacyStatus = "private";
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
                        set status='uploaded', yt_video_id=$3, error=null, updated_at=now()
                        where user_id=$1 and ig_media_id=$2`,
                        [user.id, reel.id, ytVideoId]
                    );

                    const successMsg = `🎉 Done! Your Reel is uploaded to YouTube Shorts.\n 🔗 Watch now: https://youtu.be/${ytVideoId}\n🔒 Visibility: ${privacyStatus}`;
                    await notify.sendTelegram(user.telegram_chat_id, successMsg);
                } catch (e: any) {
                    const reason = getErrorMessage(e);

                    console.error("sync error:", {
                        userId: user.id,
                        igMediaId: reel.id,
                        message: e?.message,
                        status: e?.response?.status,
                        reason,
                        data: e?.response?.data,
                    });

                    await db.query(
                        `update sync_jobs
                        set status='failed', error=$3, updated_at=now()
                        where user_id=$1 and ig_media_id=$2`,
                        [user.id, reel.id, reason]
                    );

                    if (isInstagramAuthExpiredError(e)) {
                        await db.query(
                            `delete from connections
                            where user_id=$1 and provider='instagram'`,
                            [user.id]
                        );

                        await notify.sendTelegram(
                            user.telegram_chat_id,
                            `⚠️ Instagram session expired for security reasons.\n\nPlease reconnect by running /connect_instagram`
                        );
                        break;
                    }

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
                        break;
                    }

                    await notify.sendTelegram(
                        user.telegram_chat_id,
                        `❌ Sync failed for reel ${reel.id}\nReason: ${reason}`
                    );
                }
            }
        } catch (e: any) {
            const reason = getErrorMessage(e);
            console.error("sync user-level error:", {
                userId: user.id,
                message: e?.message,
                status: e?.response?.status,
                reason,
                data: e?.response?.data,
            });

            if (isInstagramAuthExpiredError(e)) {
                await db.query(
                    `delete from connections
                    where user_id=$1 and provider='instagram'`,
                    [user.id]
                );

                await notify.sendTelegram(
                    user.telegram_chat_id,
                    `⚠️ Instagram session expired for security reasons.\n\nPlease reconnect by running /connect_instagram`
                );
                continue;
            }

            await notify.sendTelegram(
                user.telegram_chat_id,
                `❌ Sync failed\nReason: ${reason}`
            );
        }
    }
}