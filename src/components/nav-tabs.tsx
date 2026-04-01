'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  href: string;
  label: string;
  adminOnly?: boolean;
}

const tabs: Tab[] = [
  { href: '/upload', label: '업로드' },
  { href: '/dashboard', label: '대시보드' },
  { href: '/orders', label: '주문/출고' },
  { href: '/shipping', label: '운송장' },
  { href: '/inventory', label: '재고' },
  { href: '/ecount', label: '이카운트' },
  { href: '/invoice-ds', label: 'DS인보이스' },
  { href: '/invoice-kh', label: 'KH인보이스' },
  { href: '/sourcing', label: '소싱' },
  { href: '/marketing', label: '마케팅' },
  { href: '/report', label: '리포트' },
  { href: '/audit', label: '감사로그', adminOnly: true },
  { href: '/users', label: '사용자관리', adminOnly: true },
];

interface NavTabsProps {
  userRole?: string;
}

export function NavTabs({ userRole }: NavTabsProps) {
  const pathname = usePathname();

  const visibleTabs = tabs.filter(t => !t.adminOnly || userRole === 'admin');

  return (
    <nav className="flex gap-1 overflow-x-auto px-4 py-2 bg-mx-topbar border-b border-mx-border">
      {visibleTabs.map(tab => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`
              px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors
              ${active
                ? 'bg-mx-blue text-white'
                : 'text-mx-text-secondary hover:bg-[#1F2D45]'}
            `}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
