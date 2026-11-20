import { isOverdue } from '@/lib/calc';
import type { InvoiceStatus } from '@/lib/types';

const LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
};

export default function StatusBadge({
  invoice,
}: {
  invoice: { status: InvoiceStatus; dueDate: string };
}) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className={`badge badge-${invoice.status}`}>{LABELS[invoice.status]}</span>
      {isOverdue(invoice) && <span className="badge badge-overdue">Overdue</span>}
    </span>
  );
}
