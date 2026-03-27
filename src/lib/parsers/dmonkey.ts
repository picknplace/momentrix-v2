/**
 * Drunken Monkey parser — ported from Code.gs parseDmonkey
 */
import type { ParsedOrderItem } from './dailyshot';
import { findHeader, str, num, int } from './utils';

export function parseDmonkey(
  rows: unknown[][],
  salesDate: string,
  importId: string,
): ParsedOrderItem[] {
  const headers = rows[0].map(h => String(h ?? '').trim());

  // 한글 상품명 열: '상품명' 정확 일치 중 마지막 (영문상품명 제외)
  let krNameIdx = -1;
  for (let hi = 0; hi < headers.length; hi++) {
    if (headers[hi] === '상품명') krNameIdx = hi;
  }

  const idx = {
    orderId:       findHeader(headers, ['업체주문번호']),
    productName:   krNameIdx >= 0 ? krNameIdx : findHeader(headers, ['상품명']),
    qty:           findHeader(headers, ['수량']),
    unitPrice:     findHeader(headers, ['해외 단가', '단가']),
    recipientName: findHeader(headers, ['받는사람 이름']),
    mobile:        findHeader(headers, ['휴대폰번호']),
    phone:         findHeader(headers, ['전화번호']),
    postalCode:    findHeader(headers, ['우편번호']),
    address:       findHeader(headers, ['주소']),
    customsId:     findHeader(headers, ['개인통관부호']),
    trackingNo:    findHeader(headers, ['운송장번호']),
    orderNote:     findHeader(headers, ['택배사요청메모']),
    remark:        findHeader(headers, ['입고담당자메모']),
  };

  const items: ParsedOrderItem[] = [];
  let currentOrderId = '';
  let currentRecipient = {
    recipient_name: '', customs_id: '', phone: '', mobile: '',
    postal_code: '', address: '', order_note: '', remark: '', tracking_no: '',
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // 업체주문번호가 있으면 새 주문
    const rowOrderId = str(row, idx.orderId);
    if (rowOrderId) {
      currentOrderId = rowOrderId;
      currentRecipient = {
        recipient_name: str(row, idx.recipientName),
        customs_id:     str(row, idx.customsId),
        phone:          str(row, idx.phone),
        mobile:         str(row, idx.mobile),
        postal_code:    str(row, idx.postalCode),
        address:        str(row, idx.address),
        order_note:     str(row, idx.orderNote),
        remark:         str(row, idx.remark),
        tracking_no:    str(row, idx.trackingNo),
      };
    }
    if (!currentOrderId) continue;

    const productName = str(row, idx.productName);
    if (!productName) continue;

    const qty = int(row, idx.qty) || 1;
    const unitPriceJpy = num(row, idx.unitPrice);
    const salesAmount = unitPriceJpy * qty;

    items.push({
      import_id: importId,
      market_id: 'dmonkey',
      sales_date: salesDate,
      order_id: currentOrderId,
      sub_order_id: '',
      market_product_key: '',
      product_name_raw: productName,
      option_name_raw: '',
      qty,
      sales_amount: salesAmount,
      settlement_amount: salesAmount, // 자사몰 수수료 0%
      master_sku: '', // resolved later via dmonkey product map
      internal_sku: '',
      order_status: 'normal',
      refund_amount: 0,
      tracking_no: currentRecipient.tracking_no,
      recipient_name: currentRecipient.recipient_name,
      customs_id: currentRecipient.customs_id,
      phone: currentRecipient.phone,
      mobile: currentRecipient.mobile,
      postal_code: currentRecipient.postal_code,
      address: currentRecipient.address,
      order_note: currentRecipient.order_note,
      remark: currentRecipient.remark,
      supplier_name: '',
    });
  }

  return items;
}
