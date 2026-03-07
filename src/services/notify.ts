import axios from "axios";
import "dotenv/config";

export async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
  });
}