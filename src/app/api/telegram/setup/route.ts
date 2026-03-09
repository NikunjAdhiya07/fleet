import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setWebhook } from "@/lib/telegram";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { webhookUrl } = await req.json();
  if (!webhookUrl) {
    return NextResponse.json({ error: "webhookUrl is required" }, { status: 400 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const result = await setWebhook(webhookUrl, secret);

  if (!result?.ok) {
    return NextResponse.json(
      { error: "Failed to set webhook", details: result },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, result });
}
