import axios from "axios";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function downloadVideoToTemp(url: string): Promise<string> {
const filePath = path.join(os.tmpdir(), `reel-${Date.now()}.mp4`);
const resp = await axios.get(url, { responseType: "stream" });
const writer = fs.createWriteStream(filePath);

await new Promise<void>((resolve, reject) => {
resp.data.pipe(writer);
writer.on("finish", () => resolve());
writer.on("error", reject);
});

return filePath;
}

export function cleanupTemp(filePath: string) {
if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}