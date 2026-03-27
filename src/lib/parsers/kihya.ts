/**
 * Kihya parser — ported from Code.gs parseKihya
 */
import type { ParsedOrderItem } from './dailyshot';
import { findHeader, str, num, int } from './utils';

export function parseKihya(
  rows: unknown[][],
  salesDate: string,
  importId: string,
): ParsedOrderItem[] {
  const headers = rows[0].map(h => String(h ?? '').trim());

  const idx = {
    orderId:       findHeader(headers, ['주문 번호', '주문번호', 'order_id']),
    subOrderId:    findHeader(headers, ['상품주문번호', '상품 주문번호']),
    productKey:    findHeader(headers, ['상품 코드', '자체상품코드', '상품번호', 'product_id']),
    productName:   findHeader(headers, ['상품명', 'product_name']),
    optionName:    findHeader(headers, ['모델명', '옵션명', '옵션', 'option_name']),
    qty:           findHeader(headers, ['상품수량', '수량', 'qty', 'quantity']),
    purchasePrice: findHeader(headers, ['매입가', '매입금액', 'purchase_price']),
    trackingNo:    findHeader(headers, ['송장번호', '송장 번호', 'tracking']),
    recipientName: findHeader(headers, ['수취인 이름', '수취인이름', '수취인', '주문자명', 'recipient']),
    customsId:     findHeader(headers, ['통관고유부호', '통관부호', 'customs']),
    phone:         findHeader(headers, ['수취인 전화번호', '전화번호', 'phone']),
    mobile:        findHeader(headers, ['수취인 핸드폰 번호', '수취인 핸드폰번호', '핸드폰', 'mobile']),
    postalCode:    findHeader(headers, ['수취인 우편번호', '우편번호', 'postal']),
    address:       findHeader(headers, ['수취인 전체주소', '수취인주소', '주소', 'address']),
    orderNote:     findHeader(headers, ['주문시 남기는 글', '주문메모', '배송메시지', 'order_note']),
    remark:        findHeader(headers, ['비고', 'remark']),
    supplierName:  findHeader(headers, ['공급사명', '공급사', 'supplier']),
  };

  const items: ParsedOrderItem[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const orderId = str(row, idx.orderId);
    if (!orderId) continue;

    const qty = int(row, idx.qty) || 1;
    const purchasePrice = num(row, idx.purchasePrice);
    const productKey = str(row, idx.productKey);

    items.push({
      import_id: importId,
      market_id: 'kihya',
      sales_date: salesDate,
      order_id: orderId,
      sub_order_id: str(row, idx.subOrderId),
      market_product_key: productKey,
      product_name_raw: str(row, idx.productName),
      option_name_raw: str(row, idx.optionName),
      qty,
      sales_amount: 0, // kihya: sales_amount is null/0
      settlement_amount: purchasePrice * qty,
      master_sku: productKey, // kihya uses productKey as master_sku
      internal_sku: '',
      order_status: 'normal',
      refund_amount: 0,
      tracking_no: str(row, idx.trackingNo),
      recipient_name: str(row, idx.recipientName),
      customs_id: str(row, idx.customsId),
      phone: str(row, idx.phone),
      mobile: str(row, idx.mobile),
      postal_code: str(row, idx.postalCode),
      address: str(row, idx.address),
      order_note: str(row, idx.orderNote),
      remark: str(row, idx.remark),
      supplier_name: str(row, idx.supplierName),
    });
  }

  return items;
}
