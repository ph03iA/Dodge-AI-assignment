const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const DATA_DIR = path.resolve(__dirname, '..', '..', 'sap-order-to-cash-dataset', 'sap-o2c-data');

// ── Helpers ────────────────────────────────────────────────────

/** Read all part-*.jsonl files from a folder, return parsed rows */
function readJSONLParts(entityFolder) {
  const dir = path.join(DATA_DIR, entityFolder);
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .sort();

  const rows = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8').trim();
    for (const line of content.split('\n')) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

/** Clean a value: empty string → null, nested time objects → HH:MM:SS */
function cleanVal(val, key) {
  if (val === '' || val === undefined) return null;
  if (key === 'creationTime' || key === 'actualGoodsMovementTime') {
    if (typeof val === 'object' && val !== null) {
      const h = String(val.hours ?? 0).padStart(2, '0');
      const m = String(val.minutes ?? 0).padStart(2, '0');
      const s = String(val.seconds ?? 0).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
  }
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  return val;
}

/** Clean an entire row */
function cleanRow(row) {
  const cleaned = {};
  for (const [k, v] of Object.entries(row)) {
    cleaned[k] = cleanVal(v, k);
  }
  return cleaned;
}

/** Batch insert helper — builds parameterized query with ON CONFLICT */
async function batchUpsert(tableName, columns, jsonKeys, conflictKeys, rows) {
  if (rows.length === 0) return 0;

  let inserted = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const row of batch) {
      const cleaned = cleanRow(row);
      const rowParams = [];
      for (const jk of jsonKeys) {
        params.push(cleaned[jk] ?? null);
        rowParams.push(`$${paramIdx++}`);
      }
      values.push(`(${rowParams.join(', ')})`);
    }

    const conflictCols = conflictKeys.join(', ');
    const updateCols = columns
      .filter(c => !conflictKeys.includes(c))
      .map(c => `${c} = EXCLUDED.${c}`)
      .join(', ');

    const conflictClause = updateCols
      ? `ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`
      : `ON CONFLICT (${conflictCols}) DO NOTHING`;

    const query = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${values.join(', ')} ${conflictClause}`;

    // Neon serverless: use sql.query() for parameterized queries
    await sql.query(query, params);
    inserted += batch.length;
  }
  return inserted;
}

// ── Table Ingest Functions ─────────────────────────────────────

async function ingestCustomers() {
  const rows = readJSONLParts('business_partners');
  const columns = [
    'business_partner', 'customer', 'category', 'full_name', 'grouping', 'name',
    'correspondence_lang', 'created_by', 'creation_date', 'creation_time',
    'first_name', 'form_of_address', 'industry', 'last_change_date', 'last_name',
    'org_name1', 'org_name2', 'is_blocked', 'is_marked_for_archiving'
  ];
  const jsonKeys = [
    'businessPartner', 'customer', 'businessPartnerCategory', 'businessPartnerFullName',
    'businessPartnerGrouping', 'businessPartnerName', 'correspondenceLanguage',
    'createdByUser', 'creationDate', 'creationTime', 'firstName', 'formOfAddress',
    'industry', 'lastChangeDate', 'lastName', 'organizationBpName1', 'organizationBpName2',
    'businessPartnerIsBlocked', 'isMarkedForArchiving'
  ];
  return batchUpsert('customers', columns, jsonKeys, ['business_partner'], rows);
}

async function ingestAddresses() {
  const rows = readJSONLParts('business_partner_addresses');
  const columns = [
    'business_partner', 'address_id', 'validity_start', 'validity_end', 'address_uuid',
    'time_zone', 'city', 'country', 'po_box', 'po_box_city', 'po_box_country',
    'po_box_region', 'po_box_no_number', 'po_box_lobby', 'po_box_postal_code',
    'postal_code', 'region', 'street', 'tax_jurisdiction', 'transport_zone'
  ];
  const jsonKeys = [
    'businessPartner', 'addressId', 'validityStartDate', 'validityEndDate', 'addressUuid',
    'addressTimeZone', 'cityName', 'country', 'poBox', 'poBoxDeviatingCityName',
    'poBoxDeviatingCountry', 'poBoxDeviatingRegion', 'poBoxIsWithoutNumber', 'poBoxLobbyName',
    'poBoxPostalCode', 'postalCode', 'region', 'streetName', 'taxJurisdiction', 'transportZone'
  ];
  return batchUpsert('addresses', columns, jsonKeys, ['business_partner', 'address_id'], rows);
}

async function ingestProducts() {
  const rows = readJSONLParts('products');
  const columns = [
    'product', 'product_type', 'cross_plant_status', 'cross_plant_status_date',
    'creation_date', 'created_by', 'last_change_date', 'last_change_datetime',
    'is_marked_for_deletion', 'product_old_id', 'gross_weight', 'weight_unit',
    'net_weight', 'product_group', 'base_unit', 'division', 'industry_sector'
  ];
  const jsonKeys = [
    'product', 'productType', 'crossPlantStatus', 'crossPlantStatusValidityDate',
    'creationDate', 'createdByUser', 'lastChangeDate', 'lastChangeDateTime',
    'isMarkedForDeletion', 'productOldId', 'grossWeight', 'weightUnit',
    'netWeight', 'productGroup', 'baseUnit', 'division', 'industrySector'
  ];
  return batchUpsert('products', columns, jsonKeys, ['product'], rows);
}

async function ingestProductDescriptions() {
  const rows = readJSONLParts('product_descriptions');
  const columns = ['product', 'language', 'description'];
  const jsonKeys = ['product', 'language', 'productDescription'];
  return batchUpsert('product_descriptions', columns, jsonKeys, ['product', 'language'], rows);
}

async function ingestPlants() {
  const rows = readJSONLParts('plants');
  const columns = [
    'plant', 'plant_name', 'valuation_area', 'plant_customer', 'plant_supplier',
    'factory_calendar', 'default_purchasing_org', 'sales_organization', 'address_id',
    'plant_category', 'distribution_channel', 'division', 'language', 'is_marked_for_archiving'
  ];
  const jsonKeys = [
    'plant', 'plantName', 'valuationArea', 'plantCustomer', 'plantSupplier',
    'factoryCalendar', 'defaultPurchasingOrganization', 'salesOrganization', 'addressId',
    'plantCategory', 'distributionChannel', 'division', 'language', 'isMarkedForArchiving'
  ];
  return batchUpsert('plants', columns, jsonKeys, ['plant'], rows);
}

async function ingestSalesOrders() {
  const rows = readJSONLParts('sales_order_headers');
  const columns = [
    'sales_order', 'order_type', 'sales_organization', 'distribution_channel', 'division',
    'sales_group', 'sales_office', 'sold_to_party', 'creation_date', 'created_by',
    'last_change_datetime', 'total_net_amount', 'overall_delivery_status',
    'overall_billing_status', 'overall_ref_status', 'transaction_currency',
    'pricing_date', 'requested_delivery_date', 'billing_block', 'delivery_block',
    'incoterms', 'incoterms_location', 'payment_terms', 'credit_check_status'
  ];
  const jsonKeys = [
    'salesOrder', 'salesOrderType', 'salesOrganization', 'distributionChannel',
    'organizationDivision', 'salesGroup', 'salesOffice', 'soldToParty', 'creationDate',
    'createdByUser', 'lastChangeDateTime', 'totalNetAmount', 'overallDeliveryStatus',
    'overallOrdReltdBillgStatus', 'overallSdDocReferenceStatus', 'transactionCurrency',
    'pricingDate', 'requestedDeliveryDate', 'headerBillingBlockReason', 'deliveryBlockReason',
    'incotermsClassification', 'incotermsLocation1', 'customerPaymentTerms', 'totalCreditCheckStatus'
  ];
  return batchUpsert('sales_orders', columns, jsonKeys, ['sales_order'], rows);
}

async function ingestSalesOrderItems() {
  const rows = readJSONLParts('sales_order_items');
  const columns = [
    'sales_order', 'sales_order_item', 'item_category', 'material', 'requested_quantity',
    'quantity_unit', 'transaction_currency', 'net_amount', 'material_group',
    'production_plant', 'storage_location', 'rejection_reason', 'billing_block'
  ];
  const jsonKeys = [
    'salesOrder', 'salesOrderItem', 'salesOrderItemCategory', 'material', 'requestedQuantity',
    'requestedQuantityUnit', 'transactionCurrency', 'netAmount', 'materialGroup',
    'productionPlant', 'storageLocation', 'salesDocumentRjcnReason', 'itemBillingBlockReason'
  ];
  return batchUpsert('sales_order_items', columns, jsonKeys, ['sales_order', 'sales_order_item'], rows);
}

async function ingestDeliveries() {
  const rows = readJSONLParts('outbound_delivery_headers');
  const columns = [
    'delivery_document', 'actual_goods_movement_date', 'actual_goods_movement_time',
    'creation_date', 'creation_time', 'delivery_block', 'general_incompletion_status',
    'billing_block', 'last_change_date', 'goods_movement_status', 'picking_status',
    'proof_of_delivery_status', 'shipping_point'
  ];
  const jsonKeys = [
    'deliveryDocument', 'actualGoodsMovementDate', 'actualGoodsMovementTime',
    'creationDate', 'creationTime', 'deliveryBlockReason', 'hdrGeneralIncompletionStatus',
    'headerBillingBlockReason', 'lastChangeDate', 'overallGoodsMovementStatus',
    'overallPickingStatus', 'overallProofOfDeliveryStatus', 'shippingPoint'
  ];
  return batchUpsert('deliveries', columns, jsonKeys, ['delivery_document'], rows);
}

async function ingestDeliveryItems() {
  const rows = readJSONLParts('outbound_delivery_items');
  const columns = [
    'delivery_document', 'delivery_document_item', 'actual_delivery_quantity', 'batch',
    'quantity_unit', 'billing_block', 'last_change_date', 'plant',
    'reference_sd_document', 'reference_sd_document_item', 'storage_location'
  ];
  const jsonKeys = [
    'deliveryDocument', 'deliveryDocumentItem', 'actualDeliveryQuantity', 'batch',
    'deliveryQuantityUnit', 'itemBillingBlockReason', 'lastChangeDate', 'plant',
    'referenceSdDocument', 'referenceSdDocumentItem', 'storageLocation'
  ];
  return batchUpsert('delivery_items', columns, jsonKeys, ['delivery_document', 'delivery_document_item'], rows);
}

async function ingestBillingDocuments() {
  const rows = readJSONLParts('billing_document_headers');
  const columns = [
    'billing_document', 'billing_type', 'creation_date', 'creation_time',
    'last_change_datetime', 'billing_date', 'is_cancelled', 'cancelled_billing_doc',
    'total_net_amount', 'transaction_currency', 'company_code', 'fiscal_year',
    'accounting_document', 'sold_to_party'
  ];
  const jsonKeys = [
    'billingDocument', 'billingDocumentType', 'creationDate', 'creationTime',
    'lastChangeDateTime', 'billingDocumentDate', 'billingDocumentIsCancelled',
    'cancelledBillingDocument', 'totalNetAmount', 'transactionCurrency',
    'companyCode', 'fiscalYear', 'accountingDocument', 'soldToParty'
  ];
  return batchUpsert('billing_documents', columns, jsonKeys, ['billing_document'], rows);
}

async function ingestBillingDocumentItems() {
  const rows = readJSONLParts('billing_document_items');
  const columns = [
    'billing_document', 'billing_document_item', 'material', 'billing_quantity',
    'quantity_unit', 'net_amount', 'transaction_currency',
    'reference_sd_document', 'reference_sd_document_item'
  ];
  const jsonKeys = [
    'billingDocument', 'billingDocumentItem', 'material', 'billingQuantity',
    'billingQuantityUnit', 'netAmount', 'transactionCurrency',
    'referenceSdDocument', 'referenceSdDocumentItem'
  ];
  return batchUpsert('billing_document_items', columns, jsonKeys, ['billing_document', 'billing_document_item'], rows);
}

async function ingestJournalEntries() {
  const rows = readJSONLParts('journal_entry_items_accounts_receivable');
  const columns = [
    'company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item',
    'gl_account', 'reference_document', 'cost_center', 'profit_center',
    'transaction_currency', 'amount_in_trans_currency', 'company_code_currency',
    'amount_in_cc_currency', 'posting_date', 'document_date', 'document_type',
    'assignment_reference', 'last_change_datetime', 'customer',
    'financial_account_type', 'clearing_date', 'clearing_document', 'clearing_doc_fiscal_year'
  ];
  const jsonKeys = [
    'companyCode', 'fiscalYear', 'accountingDocument', 'accountingDocumentItem',
    'glAccount', 'referenceDocument', 'costCenter', 'profitCenter',
    'transactionCurrency', 'amountInTransactionCurrency', 'companyCodeCurrency',
    'amountInCompanyCodeCurrency', 'postingDate', 'documentDate', 'accountingDocumentType',
    'assignmentReference', 'lastChangeDateTime', 'customer',
    'financialAccountType', 'clearingDate', 'clearingAccountingDocument', 'clearingDocFiscalYear'
  ];
  return batchUpsert('journal_entries', columns, jsonKeys,
    ['company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item'], rows);
}

async function ingestPayments() {
  const rows = readJSONLParts('payments_accounts_receivable');
  const columns = [
    'company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item',
    'clearing_date', 'clearing_document', 'clearing_doc_fiscal_year',
    'amount_in_trans_currency', 'transaction_currency',
    'amount_in_cc_currency', 'company_code_currency', 'customer',
    'invoice_reference', 'invoice_ref_fiscal_year', 'sales_document', 'sales_document_item',
    'posting_date', 'document_date', 'assignment_reference', 'gl_account',
    'financial_account_type', 'profit_center', 'cost_center'
  ];
  const jsonKeys = [
    'companyCode', 'fiscalYear', 'accountingDocument', 'accountingDocumentItem',
    'clearingDate', 'clearingAccountingDocument', 'clearingDocFiscalYear',
    'amountInTransactionCurrency', 'transactionCurrency',
    'amountInCompanyCodeCurrency', 'companyCodeCurrency', 'customer',
    'invoiceReference', 'invoiceReferenceFiscalYear', 'salesDocument', 'salesDocumentItem',
    'postingDate', 'documentDate', 'assignmentReference', 'glAccount',
    'financialAccountType', 'profitCenter', 'costCenter'
  ];
  return batchUpsert('payments', columns, jsonKeys,
    ['company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item'], rows);
}

async function ingestBillingDocumentCancellations() {
  const rows = readJSONLParts('billing_document_cancellations');
  const columns = [
    'billing_document', 'billing_type', 'creation_date', 'creation_time',
    'last_change_datetime', 'billing_date', 'billing_is_cancelled', 'cancelled_billing_doc',
    'total_net_amount', 'transaction_currency', 'company_code', 'fiscal_year',
    'accounting_document', 'sold_to_party',
  ];
  const jsonKeys = [
    'billingDocument', 'billingDocumentType', 'creationDate', 'creationTime',
    'lastChangeDateTime', 'billingDocumentDate', 'billingDocumentIsCancelled',
    'cancelledBillingDocument', 'totalNetAmount', 'transactionCurrency',
    'companyCode', 'fiscalYear', 'accountingDocument', 'soldToParty',
  ];
  return batchUpsert('billing_document_cancellations', columns, jsonKeys, ['billing_document'], rows);
}

async function ingestCustomerCompanyAssignments() {
  const rows = readJSONLParts('customer_company_assignments');
  const columns = [
    'customer', 'company_code', 'accounting_clerk', 'accounting_clerk_fax',
    'accounting_clerk_email', 'accounting_clerk_phone', 'alternative_payer_account',
    'payment_blocking_reason', 'payment_methods_list', 'payment_terms',
    'reconciliation_account', 'deletion_indicator', 'customer_account_group',
  ];
  const jsonKeys = [
    'customer', 'companyCode', 'accountingClerk', 'accountingClerkFaxNumber',
    'accountingClerkInternetAddress', 'accountingClerkPhoneNumber', 'alternativePayerAccount',
    'paymentBlockingReason', 'paymentMethodsList', 'paymentTerms',
    'reconciliationAccount', 'deletionIndicator', 'customerAccountGroup',
  ];
  return batchUpsert('customer_company_assignments', columns, jsonKeys, ['customer', 'company_code'], rows);
}

async function ingestCustomerSalesAreaAssignments() {
  const rows = readJSONLParts('customer_sales_area_assignments');
  const columns = [
    'customer', 'sales_organization', 'distribution_channel', 'division',
    'billing_blocked', 'complete_delivery_defined', 'credit_control_area', 'currency',
    'customer_payment_terms', 'delivery_priority', 'incoterms', 'incoterms_location',
    'sales_group', 'sales_office', 'shipping_condition', 'sls_unlimited_overdelivery',
    'supplying_plant', 'sales_district', 'exchange_rate_type',
  ];
  const jsonKeys = [
    'customer', 'salesOrganization', 'distributionChannel', 'division',
    'billingIsBlockedForCustomer', 'completeDeliveryIsDefined', 'creditControlArea', 'currency',
    'customerPaymentTerms', 'deliveryPriority', 'incotermsClassification', 'incotermsLocation1',
    'salesGroup', 'salesOffice', 'shippingCondition', 'slsUnlmtdOvrdelivIsAllwd',
    'supplyingPlant', 'salesDistrict', 'exchangeRateType',
  ];
  return batchUpsert(
    'customer_sales_area_assignments',
    columns,
    jsonKeys,
    ['customer', 'sales_organization', 'distribution_channel', 'division'],
    rows
  );
}

async function ingestSalesOrderScheduleLines() {
  const rows = readJSONLParts('sales_order_schedule_lines');
  const columns = [
    'sales_order', 'sales_order_item', 'schedule_line',
    'confirmed_delivery_date', 'order_quantity_unit', 'confirmed_order_qty',
  ];
  const jsonKeys = [
    'salesOrder', 'salesOrderItem', 'scheduleLine',
    'confirmedDeliveryDate', 'orderQuantityUnit', 'confdOrderQtyByMatlAvailCheck',
  ];
  return batchUpsert(
    'sales_order_schedule_lines',
    columns,
    jsonKeys,
    ['sales_order', 'sales_order_item', 'schedule_line'],
    rows
  );
}

async function ingestProductPlants() {
  const rows = readJSONLParts('product_plants');
  const columns = [
    'product', 'plant', 'country_of_origin', 'region_of_origin',
    'production_invtry_managed_loc', 'availability_check_type', 'fiscal_year_variant',
    'profit_center', 'mrp_type',
  ];
  const jsonKeys = [
    'product', 'plant', 'countryOfOrigin', 'regionOfOrigin',
    'productionInvtryManagedLoc', 'availabilityCheckType', 'fiscalYearVariant',
    'profitCenter', 'mrpType',
  ];
  return batchUpsert('product_plants', columns, jsonKeys, ['product', 'plant'], rows);
}

async function ingestProductStorageLocations() {
  const rows = readJSONLParts('product_storage_locations');
  const columns = [
    'product', 'plant', 'storage_location', 'physical_inventory_block',
    'date_last_posted_count_unrestricted',
  ];
  const jsonKeys = [
    'product', 'plant', 'storageLocation', 'physicalInventoryBlockInd',
    'dateOfLastPostedCntUnRstrcdStk',
  ];
  return batchUpsert(
    'product_storage_locations',
    columns,
    jsonKeys,
    ['product', 'plant', 'storage_location'],
    rows
  );
}

// ── Main ───────────────────────────────────────────────────────

/** Split schema.sql into executable statements (naive `;` split breaks `DO $$ ... $$;` blocks). */
function splitSchemaStatements(sql) {
  const statements = [];
  let i = 0;

  const skipWsAndComments = () => {
    while (i < sql.length) {
      if (/\s/.test(sql[i])) {
        i++;
        continue;
      }
      if (sql[i] === '-' && sql[i + 1] === '-') {
        i += 2;
        while (i < sql.length && sql[i] !== '\n') i++;
        continue;
      }
      break;
    }
  };

  while (i < sql.length) {
    skipWsAndComments();
    if (i >= sql.length) break;

    const rest = sql.slice(i);
    const doMatch = rest.match(/^\s*DO\s+\$\$/i);
    if (doMatch) {
      const bodyStart = i + doMatch[0].length;
      let pos = bodyStart;
      let close = -1;
      while (pos < sql.length) {
        const d = sql.indexOf('$$', pos);
        if (d === -1) throw new Error('schema.sql: unclosed DO $$ block');
        const after = sql.slice(d + 2).match(/^\s*;/);
        if (after) {
          close = d + 2 + after[0].length;
          break;
        }
        pos = d + 2;
      }
      if (close === -1) throw new Error('schema.sql: DO $$ block has no closing $$;');
      statements.push(sql.slice(i, close).trim());
      i = close;
      continue;
    }

    const semi = sql.indexOf(';', i);
    if (semi === -1) {
      const tail = sql.slice(i).trim();
      if (tail) statements.push(tail);
      break;
    }
    const stmt = sql.slice(i, semi).trim();
    if (stmt) statements.push(stmt);
    i = semi + 1;
  }

  return statements.filter(s => s.length > 0);
}

async function main() {
  console.log('Starting data ingestion...\n');

  // Run schema first
  const schemaSQL = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'schema.sql'), 'utf8');
  const statements = splitSchemaStatements(schemaSQL);

  console.log(`Running schema (${statements.length} statements)...`);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  console.log('Schema applied\n');

  // Ingest in dependency order
  const steps = [
    ['customers', ingestCustomers],
    ['addresses', ingestAddresses],
    ['products', ingestProducts],
    ['product_descriptions', ingestProductDescriptions],
    ['plants', ingestPlants],
    ['customer_company_assignments', ingestCustomerCompanyAssignments],
    ['customer_sales_area_assignments', ingestCustomerSalesAreaAssignments],
    ['sales_orders', ingestSalesOrders],
    ['sales_order_items', ingestSalesOrderItems],
    ['sales_order_schedule_lines', ingestSalesOrderScheduleLines],
    ['deliveries', ingestDeliveries],
    ['delivery_items', ingestDeliveryItems],
    ['billing_documents', ingestBillingDocuments],
    ['billing_document_items', ingestBillingDocumentItems],
    ['billing_document_cancellations', ingestBillingDocumentCancellations],
    ['journal_entries', ingestJournalEntries],
    ['payments', ingestPayments],
    ['product_plants', ingestProductPlants],
    ['product_storage_locations', ingestProductStorageLocations],
  ];

  const results = {};
  for (const [name, fn] of steps) {
    try {
      const count = await fn();
      results[name] = count;
      console.log(`${name}: ${count} rows`);
    } catch (err) {
      console.error(`${name}: ${err.message}`);
      results[name] = `ERROR: ${err.message}`;
    }
  }

  console.log('\nSummary:');
  console.table(results);
  console.log('\nIngestion complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
