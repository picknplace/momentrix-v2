import { Topbar } from '@/components/topbar';
import { NavTabs } from '@/components/nav-tabs';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TODO Phase 1: Get user from session/cookie
  const userName = 'admin';
  const userRole = 'admin';

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="min-h-screen flex flex-col">
          <Topbar userName={userName} userRole={userRole} />
          <NavTabs userRole={userRole} />
          <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-4">
            {children}
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
