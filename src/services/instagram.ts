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

export async function getLatestReel(accessToken: string) {
const { igUserId } = await resolveInstagramBusinessId(accessToken);

const mediaData = await graphGet(`/${igUserId}/media`, accessToken, {
fields: "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url",
limit: 20,
});

const items: any[] = mediaData?.data ?? [];
const reel = items.find((m) => m.media_type === "VIDEO" && m.media_url);

console.log(`[IG] media fetched from ig=${igUserId}. items=${items.length}, selected=${reel?.id ?? "none"}`);
return reel ?? null;
}
