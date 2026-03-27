/**
 * Dailyshot parser — ported from Code.gs parseDailyshot
 */
import { findHeader, str, num, int } from './utils';

export interface ParsedOrderItem {
  import_id: string;
  market_id: string;
  sales_date: string;
  order_id: string;
  sub_order_id: string;
  market_product_key: string;
  product_name_raw: string;
  option_name_raw: string;
  qty: number;
  sales_amount: number;
  settlement_amount: number;
  master_sku: string;
  internal_sku: string;
  order_status: string;
  refund_amount: number;
  tracking_no: string;
  recipient_name: string;
  customs_id: string;
  phone: string;
  mobile: string;
  postal_code: string;
  address: string;
  order_note: string;
  remark: string;
  supplier_name: string;
}

export function parseDailyshot(
  rows: unknown[][],
  salesDate: string,
  importId: string,
  feeRate: number,
): ParsedOrderItem[] {
  const headers = rows[0].map(h => String(h ?? '').trim());

  const idx = {
    orderId:       findHeader(headers, ['주문번호', 'order_id', '주문 번호']),
    productKey:    findHeader(headers, ['상품 코드', '상품코드', '상품번호', 'product_id']),
    productName:   findHeader(headers, ['상품 이름', '상품명', '상품이름', 'product_name']),
    optionName:    findHeader(headers, ['옵션명', '옵션', 'option_name']),
    qty:           findHeader(headers, ['주문 개수', '수량', 'qty', 'quantity']),
    price:         findHeader(headers, ['주문 금액(택배비 제외)', '주문금액', '판매가', '상품금액', 'price', 'amount']),
    recipientName: findHeader(headers, ['수령인 이름', '수령인이름', '수령인', '수취인 이름', '수취인이름', '수취인', '주문자명', 'C/NAME(KOR)', 'recipient']),
  };

  const items: ParsedOrderItem[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const orderId = str(row, idx.orderId);
    if (!orderId) continue;

    const qty = int(row, idx.qty) || 1;
    const price = num(row, idx.price);
    const salesAmount = price * qty;
    const settlementAmount = Math.round(salesAmount * (1 - feeRate));
    const productKey = str(row, idx.productKey);

    items.push({
      import_id: importId,
      market_id: 'dailyshot',
      sales_date: salesDate,
      order_id: orderId,
      sub_order_id: '',
      market_product_key: productKey,
      product_name_raw: str(row, idx.productName),
      option_name_raw: str(row, idx.optionName),
      qty,
      sales_amount: salesAmount,
      settlement_amount: settlementAmount,
      master_sku: '', // resolved later
      internal_sku: '',
      order_status: 'normal',
      refund_amount: 0,
      tracking_no: '',
      recipient_name: str(row, idx.recipientName),
      customs_id: '',
      phone: '',
      mobile: '',
      postal_code: '',
      address: '',
      order_note: '',
      remark: '',
      supplier_name: '',
    });
  }

  return items;
}
