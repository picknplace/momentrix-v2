import { Card } from './card';

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'purple';
}

export function KpiCard({ label, value, sub, accent = 'blue' }: KpiCardProps) {
  return (
    <Card accent={accent} className="p-3">
      <p className="text-xs text-mx-text-muted mb-1">{label}</p>
      <p className="text-lg font-bold font-mono">{value}</p>
      {sub && <p className="text-xs text-mx-text-secondary mt-0.5">{sub}</p>}
    </Card>
  );
}
