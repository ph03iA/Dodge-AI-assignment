/**
 * Map SQL result rows to stable graph node ids (see lib/graphBuilder.js).
 * Heuristics handle common LLM column aliases from trace / analytics queries.
 */

const MAX_IDS = 48;

function scalar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  return null;
}

/** Lowercase keys, skip nullish / empty string values. */
function rowMap(row) {
  if (!row || typeof row !== 'object') return {};
  const m = {};
  for (const [k, v] of Object.entries(row)) {
    const s = scalar(v);
    if (s == null) continue;
    m[String(k).toLowerCase()] = s;
  }
  return m;
}

function addCustomer(ids, v) {
  const s = scalar(v);
  if (s) ids.add(`customer:${s}`);
}

function addProduct(ids, v) {
  const s = scalar(v);
  if (s) ids.add(`product:${s}`);
}

/**
 * Infer reference_sd_document: billing lines → delivery doc; delivery lines → sales order.
 */
function referenceSdDocumentTarget(r) {
  if (r.billing_document || r.billing_document_item) return 'delivery';
  if (r.delivery_document || r.delivery_document_item) return 'sales_order';
  return null;
}

/** Journal vs payment share PK shape; use column hints when present. */
function maybeJournalOrPayment(ids, r) {
  const cc = r.company_code;
  const fy = r.fiscal_year;
  const ad = r.accounting_document;
  const item = r.accounting_document_item;
  if (!(cc && fy && ad && item)) return;

  const hasGl = r.gl_account != null && String(r.gl_account).trim() !== '';
  const payHint =
    r.invoice_reference != null ||
    r.sales_document != null ||
    (r.document_type != null && /payment|clearing/i.test(String(r.document_type)));

  if (payHint && !hasGl) {
    ids.add(`payment:${cc}:${fy}:${ad}:${item}`);
    return;
  }
  ids.add(`journal_entry:${cc}:${fy}:${ad}:${item}`);
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string[]}
 */
export function extractGraphNodeIdsFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const ids = new Set();

  for (const row of rows) {
    const r = rowMap(row);

    if (r.business_partner) addCustomer(ids, r.business_partner);
    if (r.customer) addCustomer(ids, r.customer);
    if (r.sold_to_party) addCustomer(ids, r.sold_to_party);

    if (r.sales_order) ids.add(`sales_order:${r.sales_order}`);
    if (r.delivery_document) ids.add(`delivery:${r.delivery_document}`);
    if (r.billing_document) ids.add(`billing:${r.billing_document}`);

    if (r.product) addProduct(ids, r.product);
    if (r.material) addProduct(ids, r.material);

    if (r.plant) ids.add(`plant:${r.plant}`);

    if (r.company_code && !r.accounting_document) {
      ids.add(`company:${r.company_code}`);
    }

    if (r.address_id && r.business_partner) {
      ids.add(`address:${r.business_partner}:${r.address_id}`);
    }

    if (r.sales_order && r.sales_order_item) {
      ids.add(`sales_order_item:${r.sales_order}:${r.sales_order_item}`);
    }

    if (r.delivery_document && r.delivery_document_item) {
      ids.add(`delivery_item:${r.delivery_document}:${r.delivery_document_item}`);
    }

    if (r.billing_document && r.billing_document_item) {
      ids.add(`billing_item:${r.billing_document}:${r.billing_document_item}`);
    }

    if (r.sales_order && r.sales_order_item && r.schedule_line) {
      ids.add(`schedule_line:${r.sales_order}:${r.sales_order_item}:${r.schedule_line}`);
    }

    const refSd = r.reference_sd_document;
    if (refSd) {
      const kind = referenceSdDocumentTarget(r);
      if (kind === 'delivery') ids.add(`delivery:${refSd}`);
      else if (kind === 'sales_order') ids.add(`sales_order:${refSd}`);
    }

    const deliveryDocAlias =
      r.delivery_doc || r.delivery_doc_id || r.referenced_delivery || r.outbound_delivery;
    if (deliveryDocAlias) ids.add(`delivery:${deliveryDocAlias}`);

    const salesOrderAlias = r.order_id || r.so_number;
    if (salesOrderAlias && !r.sales_order) ids.add(`sales_order:${salesOrderAlias}`);

    maybeJournalOrPayment(ids, r);

    if (ids.size >= MAX_IDS) break;
  }

  return Array.from(ids).slice(0, MAX_IDS);
}
