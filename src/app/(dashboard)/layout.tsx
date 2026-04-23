import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Navbar } from "@/components/layout/Navbar";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { NavbarCountProvider } from "@/components/layout/NavbarCountContext";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  // Drivers shouldn't access the web dashboard, route them to their mobile portal
  if (session.user.role === "driver") {
    redirect("/driver/dashboard");
  }

  return (
    <SidebarProvider>
      <NavbarCountProvider>
        <div className="flex h-screen bg-slate-950 overflow-hidden font-sans text-slate-300">
          <Sidebar />
          <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
            <Navbar />
            <main id="dashboard-scroll-container" className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 relative">
              {children}
            </main>
          </div>
        </div>
      </NavbarCountProvider>
    </SidebarProvider>
  );
}
