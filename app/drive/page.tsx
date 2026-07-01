import DriverTracker from "@/components/DriverTracker";

export const metadata = { title: "Sürücü Takip" };
export const dynamic = "force-dynamic";

export default function DrivePage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4">
      <DriverTracker />
    </main>
  );
}
