import LocationCommand from "@/models/LocationCommand";

/**
 * A command that the phone has not finished within this window is treated as
 * dead. The app acknowledges control commands (start/stop/live) in seconds; a
 * fix-and-upload command that is still UPLOADING after this long means the GPS
 * pipeline on the device is stuck (permission revoked, battery restriction, no
 * signal) and will never report back.
 */
export const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/** Statuses that are still waiting on the device. */
export const PENDING_STATUSES = ["REQUESTED", "DELIVERED", "UPLOADING"] as const;

/** Commands whose result depends on an actual GPS fix + upload from the phone. */
export const FIX_COMMAND_TYPES = ["location_latest", "location_upload"] as const;

export const NOT_RESPONDING_ERROR =
  "Device did not respond in time — check location permission, GPS and battery restrictions on the phone.";

interface LeanLocationCommand {
  _id: unknown;
  deviceId: string;
  type: string;
  status: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocationCommandView {
  _id: string;
  deviceId: string;
  type: string;
  status: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Marks pending commands that are past their expiry (or simply older than
 * COMMAND_TIMEOUT_MS — commands created by the Express backend carry a 24h
 * expiresAt, which is far too long to be useful feedback for an admin) as
 * EXPIRED. Returns how many were swept.
 */
export async function expireStaleLocationCommands(deviceIds?: string[]): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - COMMAND_TIMEOUT_MS);

  const filter: Record<string, unknown> = {
    status: { $in: PENDING_STATUSES },
    $or: [{ expiresAt: { $lte: now } }, { createdAt: { $lte: cutoff } }],
  };
  if (deviceIds?.length) filter.deviceId = { $in: deviceIds };

  const result = await LocationCommand.updateMany(filter, {
    $set: { status: "EXPIRED", error: NOT_RESPONDING_ERROR },
  });

  return result.modifiedCount ?? 0;
}

/**
 * Recent commands (newest first) for the fleet map, after sweeping stale ones
 * so the UI never shows a command that is pending forever.
 */
export async function getRecentLocationCommands(
  minutes = 60,
  deviceIds?: string[]
): Promise<LocationCommandView[]> {
  await expireStaleLocationCommands(deviceIds);

  const since = new Date(Date.now() - minutes * 60 * 1000);
  const filter: Record<string, unknown> = { createdAt: { $gte: since } };
  if (deviceIds?.length) filter.deviceId = { $in: deviceIds };

  const commands = await LocationCommand.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean<LeanLocationCommand[]>();

  return commands.map((c) => ({
    _id: String(c._id),
    deviceId: c.deviceId,
    type: c.type,
    status: c.status,
    error: c.error,
    createdAt: new Date(c.createdAt).toISOString(),
    updatedAt: new Date(c.updatedAt).toISOString(),
  }));
}
