import { db } from "../core/db";
import { decrypt } from "../core/crypto";
import { getLatestReel } from "../services/instagram";
import { downloadVideoToTemp, cleanupTemp } from "../services/media";
import { buildTitle, buildDescription, buildTagsFromCaption } from "../services/metadata";
import { uploadToYouTube } from "../services/youtube";

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
            } catch{
                console.error("Youtube upload failed for user=", user.id, "ig=", reel.id);
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
            const msg = JSON.stringify(e?.response?.data || e?.message || e);
            console.error("sync error:", {
                message: e?.message,
                status: e?.response?.status,
                data: e?.response?.data,
            });

            await db.query(
                `update sync_jobs
set status='failed', error=$2, updated_at=now()
where id = (
select id from sync_jobs
where user_id=$1 and status='pending'
order by created_at desc
limit 1
)`,
                [user.id, msg]
            );
        }
    }
}

// YF_@#s2qVGKEf4J

// postgresql://postgres:YF_@#s2qVGKEf4J@db.pjfhonfpusfmolqqgnip.supabase.co:5432/postgres