import { invoiceTotal } from '../services/billing';
import { formatDate } from '../utils/helpers';

export function renderSettings(): string {
  return `Total ${invoiceTotal('o1')} on ${formatDate(new Date(0))}`;
}
