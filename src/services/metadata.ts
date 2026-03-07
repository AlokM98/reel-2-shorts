export function extractHashtags(caption: string): string[] {
const tags = (caption.match(/#([a-zA-Z0-9_]+)/g) || []).map((t) =>
t.replace("#", "").toLowerCase()
);
return Array.from(new Set(tags));
}

const relatedTagMap: Record<string, string[]> = {
makeup: ["beautytips", "makeuphacks", "makeupartist", "shortsvideo"],
skincare: ["skincaretips", "glowingskin", "selfcare", "beautyroutine"],
fitness: ["workout", "fitnesstips", "homeworkout", "shorts"],
fashion: ["style", "outfitideas", "fashiontips", "ootd"],
reels: ["shorts", "youtubeshorts", "viralshorts"],
};

export function buildTagsFromCaption(caption: string): string[] {
const base = extractHashtags(caption);
const out = new Set<string>(base);
for (const t of base) (relatedTagMap[t] || []).forEach((x) => out.add(x));
["shorts", "youtubeshorts", "viralshorts"].forEach((x) => out.add(x));
return Array.from(out).slice(0, 20);
}

export function buildTitle(caption: string): string {
const firstLine = (caption || "").split("\n")[0].trim();
let title = firstLine || "New Short";
if (!/#shorts/i.test(title)) title += " #shorts";
return title.slice(0, 95);
}

export function buildDescription(caption: string, permalink?: string): string {
return [caption?.trim() || "", "", permalink ? `Original post: ${permalink}` : "", "", "#shorts"]
.join("\n")
.trim()
.slice(0, 4900);
}