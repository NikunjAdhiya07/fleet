import { NextResponse } from "next/server";
import { runDailyPendingReminders } from "@/lib/contactIntelligence";

/**
 * GET/POST /api/cron/daily-pending-reminders
 *
 * Re-sends Telegram messages for all pending items (no reply yet):
 * - Category not chosen → send category keyboard again
 * - Name not submitted (Scenario B) → send name request again
 * - Save not confirmed → send "confirm you've saved" again
 *
 * Called daily at 8 AM by Vercel Cron. Secure with CRON_SECRET.
 * Single daily run keeps within Vercel Hobby cron limits (1 run/day min interval).
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const headerSecret = bearer ?? req.headers.get("x-cron-secret") ?? urlSecret;

  if (cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const counts = await runDailyPendingReminders();
    return NextResponse.json({
      success: true,
      sent: counts,
      message: `Sent ${counts.category} category requests, ${counts.nameRequest} name requests, ${counts.saveReminder} save reminders.`,
    });
  } catch (error) {
    console.error("[daily-pending-reminders]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// Vercel Cron sends GET requests by default
export async function POST(req: Request) {
  return GET(req);
}
