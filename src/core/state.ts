import jwt from "jsonwebtoken";
import "dotenv/config";

export type OAuthState = { uid: string; chatId: string; provider: "instagram" | "youtube" };

export function signState(payload: OAuthState) {
return jwt.sign(payload, process.env.JWT_STATE_SECRET!, { expiresIn: "15m" });
}

export function verifyState(token: string): OAuthState {
return jwt.verify(token, process.env.JWT_STATE_SECRET!) as OAuthState;
}