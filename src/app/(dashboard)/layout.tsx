import { redirect } from 'next/navigation';
import { Topbar } from '@/components/topbar';
import { NavTabs } from '@/components/nav-tabs';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { getSessionFromCookie } from '@/lib/services/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionFromCookie();
  if (!session) redirect('/login');

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="min-h-screen flex flex-col">
          <Topbar userName={session.name} userRole={session.role} />
          <NavTabs userRole={session.role} />
          <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-4">
            {children}
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
