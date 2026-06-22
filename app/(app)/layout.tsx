import Sidebar from "@/components/Sidebar";
import { requireProfile } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm text-slate-500">
            {profile.email}
            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">
              {profile.role}
            </span>
          </div>
          <form action={signOut}>
            <button className="btn-ghost text-sm">Çıkış</button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
