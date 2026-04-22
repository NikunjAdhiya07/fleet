import mongoose from "mongoose";
import dns from "dns";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable inside .env.local");
}

// This machine's Node DNS resolver defaults to `127.0.0.1` (usually a
// leftover from a disconnected VPN / DHCP adapter). That breaks SRV lookups
// for `mongodb+srv://` URIs with `ECONNREFUSED` even though the OS resolver
// works fine for everything else.
//
// `dns.setServers(...)` at module load is unreliable here — the Turbopack
// dev runtime spins up multiple workers and re-imports modules in ways that
// sometimes leave the default resolver in its original (loopback-only) state
// by the time the MongoDB driver reaches for `dns.resolveSrv`.
//
// The robust fix is to hijack the two DNS functions the MongoDB driver
// actually calls (`resolveSrv` and `resolveTxt`) and route them through a
// dedicated `dns.Resolver` that always points at public DNS. Anything else
// on this process keeps working against the OS resolver untouched.
const PUBLIC_DNS_SERVERS = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"];

type Patched = typeof dns & { __mongodbSrvPatched?: boolean };
const patchedDns = dns as Patched;
if (!patchedDns.__mongodbSrvPatched) {
  try {
    const publicResolver = new dns.Resolver();
    publicResolver.setServers(PUBLIC_DNS_SERVERS);

    const callbackResolveSrv = dns.resolveSrv.bind(dns) as typeof dns.resolveSrv;
    const callbackResolveTxt = dns.resolveTxt.bind(dns) as typeof dns.resolveTxt;

    (dns as any).resolveSrv = (hostname: string, cb: any) => {
      publicResolver.resolveSrv(hostname, (err, records) => {
        if (err) {
          // Fall back to the default resolver if the public one fails too
          // (e.g. corporate network blocks 1.1.1.1 but DHCP DNS works).
          callbackResolveSrv(hostname, cb);
          return;
        }
        cb(null, records);
      });
    };

    (dns as any).resolveTxt = (hostname: string, cb: any) => {
      publicResolver.resolveTxt(hostname, (err, records) => {
        if (err) {
          callbackResolveTxt(hostname, cb);
          return;
        }
        cb(null, records);
      });
    };

    const promisesResolveSrv = (hostname: string) =>
      new Promise((resolve, reject) => {
        publicResolver.resolveSrv(hostname, (err, records) => {
          if (err) {
            // Fall back to promises default
            dns.promises
              .resolveSrv(hostname)
              .then(resolve, reject);
            return;
          }
          resolve(records);
        });
      });

    const promisesResolveTxt = (hostname: string) =>
      new Promise((resolve, reject) => {
        publicResolver.resolveTxt(hostname, (err, records) => {
          if (err) {
            dns.promises
              .resolveTxt(hostname)
              .then(resolve, reject);
            return;
          }
          resolve(records);
        });
      });

    (dns.promises as any).resolveSrv = promisesResolveSrv;
    (dns.promises as any).resolveTxt = promisesResolveTxt;

    patchedDns.__mongodbSrvPatched = true;
    console.log(
      `[db] MongoDB SRV/TXT DNS routed through public resolvers (${PUBLIC_DNS_SERVERS.join(", ")})`
    );
  } catch (err) {
    console.warn("[db] Could not install DNS override for MongoDB SRV lookups:", err);
  }
}

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
