import mongoose from "mongoose";
import dns from "dns";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable inside .env.local");
}

// Node on some Windows machines picks up a stale `127.0.0.1` DNS server
// (usually from a disconnected VPN / DHCP transition). That breaks the
// SRV lookup required by `mongodb+srv://` URIs with `ECONNREFUSED`, even
// though the system resolver works fine for `nslookup`.
// If we detect that broken state, fall back to public DNS so the Atlas
// cluster can still be reached.
function ensureUsableDnsServers() {
  try {
    const current = dns.getServers();
    const onlyLoopback =
      current.length === 0 ||
      current.every((s) => s === "127.0.0.1" || s === "::1" || s.startsWith("127."));
    if (onlyLoopback) {
      dns.setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1", "8.8.4.4"]);
      console.warn(
        "[db] Node DNS resolver was pointing at loopback only; using public DNS for MongoDB SRV lookups."
      );
    }
  } catch (err) {
    console.warn("[db] Could not inspect/override DNS servers:", err);
  }
}

ensureUsableDnsServers();

let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGODB_URI!, opts).then((mongoose) => {
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectToDatabase;
