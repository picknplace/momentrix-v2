/**
 * CSV → D1 (SQLite) migration script
 * Usage: npm run migrate
 *
 * Prerequisites:
 *   1. Run exportAllSheets() in GAS to get CSV files
 *   2. Download CSV folder from Google Drive to ./scripts/data/
 *   3. Create D1 database: wrangler d1 create momentrix-db
 *   4. Update database_id in wrangler.toml
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, 'data');

const SHEET_TO_TABLE: Record<string, string> = {
  ORDER_ITEMS: 'order_items',
  ORDER_ITEMS_ARCHIVE: 'order_items_archive',
  IMPORT_LOG: 'import_log',
  ORDER_EVENTS: 'order_events',
  DAILY_SUMMARY: 'daily_summary',
  MARKET_SUMMARY: 'market_summary',
  SKU_SUMMARY: 'sku_summary',
  SKU_MAP: 'sku_map',
  SKU_MASTER: 'sku_master',
  CONFIG: 'config',
  COST_MASTER: 'cost_master',
  USERS: 'users',
  AUDIT_LOG: 'audit_log',
  AI_USAGE: 'ai_usage',
  INVENTORY: 'inventory',
  SUPPLIERS: 'suppliers',
  SUPPLIER_PRODUCTS: 'supplier_products',
  PURCHASE_ORDERS: 'purchase_orders',
  PO_ITEMS: 'po_items',
  PRICE_HISTORY: 'price_history',
  MKT_TRENDS: 'mkt_trends',
  MKT_MATCHES: 'mkt_matches',
  MKT_DM_DRAFTS: 'mkt_dm_drafts',
  MKT_PRICE_CHECK: 'mkt_price_check',
  MKT_PRODUCTS: 'mkt_products',
  DMONKEY_CATALOG: 'dmonkey_catalog',
  DMONKEY_PRODUCT_MAP: 'dmonkey_product_map',
};

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\n' || (ch === '\r' && content[i + 1] === '\n')) {
        row.push(current);
        current = '';
        rows.push(row);
        row = [];
        if (ch === '\r') i++;
      } else {
        current += ch;
      }
    }
  }
  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function escapeSQL(val: string): string {
  return val.replace(/'/g, "''");
}

async function migrateTable(csvFile: string, tableName: string) {
  const content = fs.readFileSync(csvFile, 'utf-8');
  const rows = parseCSV(content);
  if (rows.length < 2) {
    console.log(`  Skip ${tableName}: empty`);
    return;
  }

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));

  console.log(`  ${tableName}: ${dataRows.length} rows...`);

  // Build SQL file for batch insert via wrangler
  const sqlFile = path.join(DATA_DIR, `_import_${tableName}.sql`);
  const stmts: string[] = [];

  for (const row of dataRows) {
    const cols: string[] = [];
    const vals: string[] = [];
    headers.forEach((h, idx) => {
      if (row[idx] !== undefined && row[idx] !== '') {
        cols.push(h);
        vals.push(`'${escapeSQL(row[idx])}'`);
      }
    });
    if (cols.length > 0) {
      stmts.push(`INSERT OR IGNORE INTO ${tableName} (${cols.join(',')}) VALUES (${vals.join(',')});`);
    }
  }

  // Write SQL in chunks (D1 has statement limits per batch)
  const CHUNK = 100;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const chunk = stmts.slice(i, i + CHUNK).join('\n');
    fs.writeFileSync(sqlFile, chunk);
    try {
      execSync(`npx wrangler d1 execute momentrix-db --file=${sqlFile} --remote`, { stdio: 'pipe' });
    } catch (e) {
      console.error(`  ERROR ${tableName} batch ${i}: ${(e as Error).message?.substring(0, 200)}`);
    }
  }

  // Cleanup temp file
  if (fs.existsSync(sqlFile)) fs.unlinkSync(sqlFile);
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Data directory not found: ${DATA_DIR}`);
    console.error('Download CSV files from Google Drive first.');
    process.exit(1);
  }

  // First, run the schema migration
  const schemaFile = path.join(__dirname, '..', 'supabase', 'migrations', '00001_initial_schema.sql');
  if (fs.existsSync(schemaFile)) {
    console.log('Running schema migration...');
    try {
      execSync(`npx wrangler d1 execute momentrix-db --file=${schemaFile} --remote`, { stdio: 'inherit' });
      console.log('Schema created.\n');
    } catch (e) {
      console.error('Schema migration error (may already exist):', (e as Error).message?.substring(0, 200));
    }
  }

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));
  console.log(`Found ${files.length} CSV files\n`);

  const ordered = [
    'CONFIG', 'USERS', 'SKU_MASTER', 'SKU_MAP', 'COST_MASTER',
    'IMPORT_LOG', 'ORDER_ITEMS', 'ORDER_ITEMS_ARCHIVE', 'ORDER_EVENTS',
    'DAILY_SUMMARY', 'MARKET_SUMMARY', 'SKU_SUMMARY',
    'AUDIT_LOG', 'AI_USAGE', 'INVENTORY',
    'SUPPLIERS', 'SUPPLIER_PRODUCTS', 'PURCHASE_ORDERS', 'PO_ITEMS',
    'PRICE_HISTORY',
    'MKT_TRENDS', 'MKT_MATCHES', 'MKT_DM_DRAFTS', 'MKT_PRICE_CHECK', 'MKT_PRODUCTS',
    'DMONKEY_CATALOG', 'DMONKEY_PRODUCT_MAP',
  ];

  for (const sheetName of ordered) {
    const tableName = SHEET_TO_TABLE[sheetName];
    const csvFile = path.join(DATA_DIR, `${sheetName}.csv`);
    if (fs.existsSync(csvFile)) {
      await migrateTable(csvFile, tableName);
    } else {
      console.log(`  Skip ${sheetName}: CSV not found`);
    }
  }

  console.log('\nMigration complete!');
}

main().catch(console.error);
