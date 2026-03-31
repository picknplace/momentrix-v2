/**
 * GAS → D1 데이터 이관 스크립트
 *
 * 사용법:
 * 1. 이 파일 내용을 GAS 프로젝트의 새 파일에 붙여넣기
 * 2. MIGRATE_URL과 CRON_SECRET을 설정
 * 3. migrateAll() 실행
 */

var MIGRATE_URL = 'https://momentrix.co.kr/api/migrate';
var CRON_SECRET = ''; // Cloudflare Pages의 CRON_SECRET 값 입력

// 이관할 시트 목록과 D1 테이블명 매핑
var MIGRATION_MAP = [
  { sheet: 'IMPORT_LOG', table: 'import_log' },
  { sheet: 'ORDER_ITEMS', table: 'order_items' },
  { sheet: 'ORDER_EVENTS', table: 'order_events' },
  { sheet: 'SKU_MAP', table: 'sku_map' },
  { sheet: 'SKU_MASTER', table: 'sku_master' },
  { sheet: 'COST_MASTER', table: 'cost_master' },
  { sheet: 'USERS', table: 'users' },
  { sheet: 'AUDIT_LOG', table: 'audit_log' },
  { sheet: 'DAILY_SUMMARY', table: 'daily_summary' },
  { sheet: 'MARKET_SUMMARY', table: 'market_summary' },
  { sheet: 'SKU_SUMMARY', table: 'sku_summary' },
  { sheet: 'INVENTORY', table: 'inventory' },
  { sheet: 'SUPPLIERS', table: 'suppliers' },
  { sheet: 'SUPPLIER_PRODUCTS', table: 'supplier_products' },
  { sheet: 'PURCHASE_ORDERS', table: 'purchase_orders' },
  { sheet: 'PO_ITEMS', table: 'po_items' },
  { sheet: 'PRICE_HISTORY', table: 'price_history' },
];

// D1 테이블별 컬럼 매핑 (시트 헤더 → D1 컬럼)
var COLUMN_MAP = {
  import_log: {
    'import_id': 'import_id', 'market_id': 'market_id', 'file_name': 'file_name',
    'sales_date': 'sales_date', 'upload_status': 'upload_status', 'created_at': 'created_at',
    'cancelled_at': 'cancelled_at', 'cancel_reason': 'cancel_reason',
  },
  order_items: {
    'import_id': 'import_id', 'market_id': 'market_id', 'sales_date': 'sales_date',
    'order_id': 'order_id', 'market_product_key': 'market_product_key',
    'product_name_raw': 'product_name_raw', 'option_name_raw': 'option_name_raw',
    'qty': 'qty', 'sales_amount': 'sales_amount', 'settlement_amount': 'settlement_amount',
    'master_sku': 'master_sku', 'internal_sku': 'internal_sku',
    'order_status': 'order_status', 'refund_amount': 'refund_amount',
    'cancelled_at': 'cancelled_at', 'cancel_reason': 'cancel_reason',
    'refund_reason': 'refund_reason', 'sub_order_id': 'sub_order_id',
    'tracking_no': 'tracking_no', 'recipient_name': 'recipient_name',
    'ship_date': 'ship_date', 'created_at': 'created_at', 'updated_at': 'updated_at',
    'customs_id': 'customs_id', 'phone': 'phone', 'mobile': 'mobile',
    'postal_code': 'postal_code', 'address': 'address', 'order_note': 'order_note',
    'remark': 'remark', 'supplier_name': 'supplier_name', 'ec_status': 'ec_status',
  },
  order_events: {
    'event_id': 'event_id', 'occurred_at': 'occurred_at', 'event_type': 'event_type',
    'market_id': 'market_id', 'order_id': 'order_id', 'market_product_key': 'market_product_key',
    'amount': 'amount', 'reason': 'reason', 'ref_import_id': 'ref_import_id', 'operator': 'operator',
  },
  sku_map: {
    'dailyshot_product_key': 'dailyshot_product_key', 'product_name_raw': 'product_name_raw',
    'master_sku': 'master_sku',
  },
  sku_master: {
    'master_sku': 'master_sku', 'internal_sku': 'internal_sku', 'product_name': 'product_name',
    'market_id': 'market_id', 'created_at': 'created_at', 'search_keyword_ja': 'search_keyword_ja',
  },
  cost_master: {
    'master_sku': 'master_sku', 'product_name': 'product_name',
    'purchase_cost': 'purchase_cost', 'shipping_cost': 'shipping_cost',
    'packaging_cost': 'packaging_cost', 'tariff_cost': 'tariff_cost',
    'other_cost': 'other_cost', 'total_cost': 'total_cost', 'updated_at': 'updated_at',
  },
  users: {
    'user_id': 'user_id', 'password_hash': 'password_hash', 'email': 'email',
    'name': 'name', 'role': 'role', 'status': 'status',
    'created_at': 'created_at', 'last_login': 'last_login',
  },
  audit_log: {
    'log_id': 'log_id', 'timestamp': 'timestamp', 'user_id': 'user_id',
    'action_type': 'action_type', 'target_sheet': 'target_sheet', 'target_id': 'target_id',
    'before_data': 'before_data', 'after_data': 'after_data',
    'session_id': 'session_id', 'result': 'result', 'detail': 'detail',
  },
  daily_summary: {
    'sales_date': 'sales_date', 'order_count': 'order_count', 'qty_total': 'qty_total',
    'sales_amount_total': 'sales_amount_total', 'settlement_amount_total': 'settlement_amount_total',
    'generated_at': 'generated_at',
  },
  market_summary: {
    'market_id': 'market_id', 'order_count': 'order_count', 'qty_total': 'qty_total',
    'sales_amount_total': 'sales_amount_total', 'settlement_amount_total': 'settlement_amount_total',
    'generated_at': 'generated_at',
  },
  sku_summary: {
    'master_sku': 'master_sku', 'product_name_raw': 'product_name_raw',
    'order_count': 'order_count', 'qty_total': 'qty_total',
    'sales_amount_total': 'sales_amount_total', 'settlement_amount_total': 'settlement_amount_total',
    'generated_at': 'generated_at',
  },
  inventory: {
    'master_sku': 'master_sku', 'product_name': 'product_name', 'stock': 'stock',
    'allocated': 'allocated', 'available': 'available', 'safety_stock': 'safety_stock',
    'search_keyword': 'search_keyword', 'last_sync': 'last_sync', 'updated_at': 'updated_at',
  },
  suppliers: {
    'supplier_id': 'supplier_id', 'name': 'name', 'type': 'type', 'url': 'url',
    'category': 'category', 'contact': 'contact', 'shipping_threshold': 'shipping_threshold',
    'shipping_cost': 'shipping_cost', 'notes': 'notes', 'created_at': 'created_at',
  },
  supplier_products: {
    'supplier_id': 'supplier_id', 'master_sku': 'master_sku', 'product_name': 'product_name',
    'product_name_kr': 'product_name_kr', 'category': 'category', 'category_kr': 'category_kr',
    'purchase_price': 'purchase_price', 'currency': 'currency',
    'min_order_qty': 'min_order_qty', 'max_order_qty': 'max_order_qty',
    'unit': 'unit', 'price_date': 'price_date', 'product_url': 'product_url', 'notes': 'notes',
  },
  purchase_orders: {
    'po_id': 'po_id', 'status': 'status', 'supplier_id': 'supplier_id',
    'supplier_name': 'supplier_name', 'requested_by': 'requested_by',
    'requested_at': 'requested_at', 'ordered_at': 'ordered_at', 'order_memo': 'order_memo',
    'expected_arrival': 'expected_arrival', 'received_at': 'received_at',
    'received_by': 'received_by', 'receive_memo': 'receive_memo', 'total_amount': 'total_amount',
  },
  po_items: {
    'po_id': 'po_id', 'master_sku': 'master_sku', 'product_name': 'product_name',
    'qty': 'qty', 'unit_price': 'unit_price', 'subtotal': 'subtotal',
  },
  price_history: {
    'supplier_id': 'supplier_id', 'master_sku': 'master_sku', 'product_name': 'product_name',
    'original_name': 'original_name', 'qty': 'qty', 'unit_price': 'unit_price',
    'total_price': 'total_price', 'currency': 'currency', 'purchase_date': 'purchase_date',
    'source': 'source', 'source_ref': 'source_ref', 'notes': 'notes', 'created_at': 'created_at',
  },
};

/**
 * 메인: 모든 시트 이관
 */
function migrateAll() {
  if (!CRON_SECRET) {
    Logger.log('❌ CRON_SECRET을 설정하세요!');
    return;
  }

  var results = [];
  for (var i = 0; i < MIGRATION_MAP.length; i++) {
    var m = MIGRATION_MAP[i];
    try {
      var count = migrateSheet(m.sheet, m.table);
      results.push(m.sheet + ': ' + count + '건 ✅');
      Logger.log(m.sheet + ': ' + count + '건 이관 완료');
    } catch (e) {
      results.push(m.sheet + ': ❌ ' + e.message);
      Logger.log(m.sheet + ' 실패: ' + e.message);
    }
    // API rate limit 방지
    Utilities.sleep(1000);
  }

  Logger.log('\n=== 이관 결과 ===');
  results.forEach(function(r) { Logger.log(r); });
}

/**
 * 개별 시트 이관
 */
function migrateSheet(sheetName, tableName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    Logger.log(sheetName + ' 시트가 없습니다. 건너뜁니다.');
    return 0;
  }

  var data = sh.getDataRange().getValues();
  if (data.length < 2) return 0; // 헤더만 있으면 건너뜀

  var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var colMap = COLUMN_MAP[tableName];
  if (!colMap) {
    throw new Error('컬럼 매핑 없음: ' + tableName);
  }

  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var row = {};
    var hasData = false;
    for (var sheetCol in colMap) {
      var d1Col = colMap[sheetCol];
      var idx = headers.indexOf(sheetCol.toLowerCase());
      if (idx >= 0) {
        var val = data[r][idx];
        // 날짜 형식 변환
        if (val instanceof Date) {
          val = Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
        }
        row[d1Col] = val === '' ? null : val;
        if (val !== '' && val !== null) hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }

  if (rows.length === 0) return 0;

  // 500건씩 나눠서 전송 (HTTP payload 제한)
  var CHUNK = 500;
  var total = 0;
  for (var i = 0; i < rows.length; i += CHUNK) {
    var chunk = rows.slice(i, i + CHUNK);
    var payload = {
      table: tableName,
      rows: chunk,
      clear: (i === 0), // 첫 번째 청크에서만 기존 데이터 삭제
    };

    var res = UrlFetchApp.fetch(MIGRATE_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-cron-secret': CRON_SECRET },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = res.getResponseCode();
    var body = JSON.parse(res.getContentText());

    if (code !== 200 || !body.ok) {
      throw new Error('API 오류 (' + code + '): ' + (body.message || JSON.stringify(body)));
    }

    total += body.inserted;
    Logger.log('  ' + tableName + ' chunk ' + Math.floor(i/CHUNK+1) + ': ' + body.inserted + '건');
    Utilities.sleep(500);
  }

  return total;
}

/**
 * 테스트: ORDER_ITEMS만 이관
 */
function migrateOrderItemsOnly() {
  if (!CRON_SECRET) {
    Logger.log('❌ CRON_SECRET을 설정하세요!');
    return;
  }
  var count = migrateSheet('ORDER_ITEMS', 'order_items');
  Logger.log('ORDER_ITEMS: ' + count + '건 이관 완료');
}

/**
 * 테스트: IMPORT_LOG만 이관 (ORDER_ITEMS 외래키 의존)
 */
function migrateImportLogOnly() {
  if (!CRON_SECRET) {
    Logger.log('❌ CRON_SECRET을 설정하세요!');
    return;
  }
  var count = migrateSheet('IMPORT_LOG', 'import_log');
  Logger.log('IMPORT_LOG: ' + count + '건 이관 완료');
}
