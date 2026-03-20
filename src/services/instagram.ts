import axios from "axios";

const GRAPH = "https://graph.facebook.com/v19.0";

async function graphGet(pathname: string, accessToken: string, params: Record<string, any> = {}) {
const resp = await axios.get(`${GRAPH}${pathname}`, {
params: { access_token: accessToken, ...params },
});
return resp.data;
}

export async function resolveInstagramBusinessId(accessToken: string): Promise<{ igUserId: string; pageId: string }> {
const targetPageId = process.env.TARGET_FB_PAGE_ID?.trim();

const pagesData = await graphGet("/me/accounts", accessToken, {
fields: "id,name",
limit: 200,
});

const pages: Array<{ id: string; name: string }> = pagesData?.data ?? [];
console.log("[IG] /me/accounts pages:", pages.map((p) => `${p.name} (${p.id})`));

const candidates = targetPageId ? pages.filter((p) => p.id === targetPageId) : pages;

for (const p of candidates) {
try {
const pageData = await graphGet(`/${p.id}`, accessToken, {
fields: "instagram_business_account{id,username}",
});
const ig = pageData?.instagram_business_account;
if (ig?.id) return { igUserId: ig.id, pageId: p.id };
} catch (e: any) {
console.log("[IG] page check error:", p.id, e?.response?.data || e.message);
}
}

throw new Error("No instagram_business_account linked to accessible page");
}

export async function getRecentReels(accessToken: string, limit = 25) {
const { igUserId } = await resolveInstagramBusinessId(accessToken);

const reels: any[] = [];
let after: string | null = null;

while (reels.length < limit) {
const pageSize = Math.min(25, limit - reels.length);
const mediaData = await graphGet(`/${igUserId}/media`, accessToken, {
fields: "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url",
limit: pageSize,
after: after || undefined,
});

const items: any[] = mediaData?.data ?? [];
const pageReels = items
.filter((m) => m.media_type === "VIDEO" && m.media_url)
.map((m) => ({
id: m.id,
caption: m.caption || "",
media_url: m.media_url,
permalink: m.permalink,
timestamp: m.timestamp,
}));

reels.push(...pageReels);

const nextAfter = mediaData?.paging?.cursors?.after;
if (!nextAfter || !items.length) break;
after = nextAfter;
}

console.log(`[IG] media fetched from ig=${igUserId}. reels=${reels.length}, requested=${limit}`);
return reels.slice(0, limit);
}

export async function getLatestReel(accessToken: string) {
const reels = await getRecentReels(accessToken, 20);
return reels[0] ?? null;
}
