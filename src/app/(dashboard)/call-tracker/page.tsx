import { CallTrackerClient } from "./CallTrackerClient";

export default function CallTrackerPage() {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-semibold text-slate-100">Call Tracking</div>
        <div className="text-sm text-slate-400">
          Log calls by mobile number, then capture category (and name only after 5+ calls).
        </div>
      </div>
      <CallTrackerClient />
    </div>
  );
}

