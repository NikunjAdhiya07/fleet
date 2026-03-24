import { GoogleAuth, type JWTInput } from "google-auth-library";
import connectToDatabase from "@/lib/db";
import mongoose from "mongoose";

/** Parse service account JSON from env (handles over-escaped quotes from .env files). */
function parseFirebaseServiceAccountJson(raw: string): JWTInput & { project_id?: string } {
  const s = raw.trim();
  const asAccount = (input: string) => JSON.parse(input) as JWTInput & { project_id?: string };

  try {
    return asAccount(s);
  } catch {
    try {
      return asAccount(s.replace(/\\"/g, '"'));
    } catch {
      try {
        return asAccount(JSON.parse(s) as string);
      } catch (e) {
        throw new Error(
          `Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }
}

export type FcmWakeResult = {
  success: true;
  mode?: "stale" | "all";
  message?: string;
  registeredTokens?: number;
  staleDevices: number;
  tokensFound: number;
  sent: number;
  errors: { deviceId?: string; status?: number; body?: string; error?: string }[];
};

/**
 * Sends high-priority FCM data messages to devices whose last CallLog is older than `hours`.
 * Uses the same MongoDB as the Android sync pipeline (`calllogs`, `fcmtokens`).
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON (full service account JSON string).
 */
export async function runFcmWakeForStaleDevices(hours: number): Promise<FcmWakeResult> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  }

  const serviceAccount = parseFirebaseServiceAccountJson(raw);
  const projectId = serviceAccount.project_id;
  if (!projectId) {
    throw new Error("Invalid service account: missing project_id");
  }

  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB not connected");
  }

  const staleHours = Number.isFinite(hours) && hours > 0 ? hours : 12;
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);

  const staleDevices = await db
    .collection("calllogs")
    .aggregate([
      { $group: { _id: "$deviceId", lastCall: { $max: "$timestamp" } } },
      { $match: { lastCall: { $lt: cutoff } } },
    ])
    .toArray();

  if (staleDevices.length === 0) {
    const registeredTokens = await db.collection("fcmtokens").countDocuments();
    return {
      success: true,
      mode: "stale",
      message: `No stale devices — every device has a call log within the last ${staleHours}h. ${registeredTokens} FCM token(s) on file. Use ?all=1 to ping all registered devices (testing).`,
      registeredTokens,
      staleDevices: 0,
      tokensFound: 0,
      sent: 0,
      errors: [],
    };
  }

  const deviceIds = staleDevices.map((d) => d._id);
  const tokens = await db
    .collection("fcmtokens")
    .find({ deviceId: { $in: deviceIds } })
    .toArray();

  if (tokens.length === 0) {
    return {
      success: true,
      mode: "stale",
      message: `${deviceIds.length} device(s) are stale but none have an FCM token. Open the Android app with monitoring on.`,
      staleDevices: deviceIds.length,
      tokensFound: 0,
      sent: 0,
      errors: [],
    };
  }

  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const client = await auth.getClient();
  const accessTokenRes = await client.getAccessToken();
  const accessToken = accessTokenRes.token;
  if (!accessToken) {
    throw new Error("Could not obtain OAuth access token for FCM");
  }

  let sent = 0;
  const errors: FcmWakeResult["errors"] = [];

  for (const tokenDoc of tokens) {
    const deviceId = tokenDoc.deviceId as string;
    const token = tokenDoc.token as string;
    try {
      const fcmRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              data: { action: "sync_now" },
              android: {
                priority: "high",
                ttl: "0s",
              },
            },
          }),
        }
      );

      if (fcmRes.ok) {
        sent++;
      } else {
        const errBody = await fcmRes.text();
        errors.push({ deviceId, status: fcmRes.status, body: errBody });
      }
    } catch (sendErr: unknown) {
      errors.push({
        deviceId,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }
  }

  return {
    success: true,
    mode: "stale",
    staleDevices: deviceIds.length,
    tokensFound: tokens.length,
    sent,
    errors,
  };
}

/**
 * Sends sync_now to every document in `fcmtokens` (for testing / manual nudge).
 */
export async function runFcmWakeForAllDevices(): Promise<FcmWakeResult> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  }

  const serviceAccount = parseFirebaseServiceAccountJson(raw);
  const projectId = serviceAccount.project_id;
  if (!projectId) {
    throw new Error("Invalid service account: missing project_id");
  }

  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB not connected");
  }

  const tokens = await db.collection("fcmtokens").find({}).toArray();
  if (tokens.length === 0) {
    return {
      success: true,
      mode: "all",
      message: "No FCM tokens registered in the database.",
      staleDevices: 0,
      tokensFound: 0,
      sent: 0,
      errors: [],
    };
  }

  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const client = await auth.getClient();
  const accessTokenRes = await client.getAccessToken();
  const accessToken = accessTokenRes.token;
  if (!accessToken) {
    throw new Error("Could not obtain OAuth access token for FCM");
  }

  let sent = 0;
  const errors: FcmWakeResult["errors"] = [];

  for (const tokenDoc of tokens) {
    const deviceId = tokenDoc.deviceId as string;
    const token = tokenDoc.token as string;
    try {
      const fcmRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              data: { action: "sync_now" },
              android: {
                priority: "high",
                ttl: "0s",
              },
            },
          }),
        }
      );

      if (fcmRes.ok) {
        sent++;
      } else {
        const errBody = await fcmRes.text();
        errors.push({ deviceId, status: fcmRes.status, body: errBody });
      }
    } catch (sendErr: unknown) {
      errors.push({
        deviceId,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }
  }

  return {
    success: true,
    mode: "all",
    staleDevices: 0,
    tokensFound: tokens.length,
    sent,
    errors,
  };
}
