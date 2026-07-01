import TrackingDashboard from "@/components/tracking/TrackingDashboard";

export const metadata = { title: "Tracking" };
export const dynamic = "force-dynamic";

export default function TrackingPage() {
  return (
    <main className="p-6">
      <TrackingDashboard />
    </main>
  );
}
