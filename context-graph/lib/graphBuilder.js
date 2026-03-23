import sql from './db.js';
import { NODE_COLORS } from './nodeColors.js';
import { NEIGHBOR_MAX_PRODUCT_STORAGE_LOCS } from './graphLimits.js';

export { NODE_COLORS };

// Convert snake_case keys to camelCase and flatten top-level row data for node metadata
function rowToMeta(row) {
  if (!row || typeof row !== 'object') return {};
  const meta = {};
  for (const [key, val] of Object.entries(row)) {
    if (key === 'id' || key === 'type' || key === 'label' || key === 'color') continue;
    // Convert snake_case to camelCase
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    meta[camelKey] = val;
  }
  return meta;
}

// ── Build graph from structured row bundles ────────────────────
export function buildGraph(data) {
  const nodeMap = new Map();
  const links = [];

  function addNode(id, type, label, metadata = {}) {
    if (!id || nodeMap.has(id)) return;
    nodeMap.set(id, {
      id,
      type,
      label,
      color: NODE_COLORS[type] || '#9ca3af',
      ...rowToMeta(metadata),
    });
  }

  function addLink(source, target, label) {
    if (source && target && nodeMap.has(source) && nodeMap.has(target)) {
      links.push({ source, target, label });
    }
  }

  function ensurePlant(plantId) {
    if (!plantId) return;
    const id = `plant:${plantId}`;
    if (!nodeMap.has(id)) {
      addNode(id, 'plant', String(plantId), { plant: plantId });
    }
  }

  // Customers
  if (data.customers) {
    for (const c of data.customers) {
      addNode(
        `customer:${c.business_partner}`,
        'customer',
        c.name || c.full_name || c.business_partner,
        c
      );
    }
  }

  // Addresses
  if (data.addresses) {
    for (const a of data.addresses) {
      addNode(
        `address:${a.business_partner}:${a.address_id}`,
        'address',
        `${a.city || 'Address'} (${a.country || '?'})`,
        a
      );
      addLink(`customer:${a.business_partner}`, `address:${a.business_partner}:${a.address_id}`, 'has_address');
    }
  }

  if (data.customerCompanyAssignments) {
    for (const row of data.customerCompanyAssignments) {
      addNode(`company:${row.company_code}`, 'company', `Co ${row.company_code}`, row);
      addLink(`customer:${row.customer}`, `company:${row.company_code}`, 'assigned_company');
    }
  }

  if (data.customerSalesAreaAssignments) {
    for (const row of data.customerSalesAreaAssignments) {
      const saId = `sales_area:${row.customer}:${row.sales_organization}:${row.distribution_channel}:${row.division}`;
      addNode(saId, 'sales_area', `SA ${row.sales_organization}/${row.distribution_channel}`, row);
      addLink(`customer:${row.customer}`, saId, 'sold_in_area');
    }
  }

  // Products
  if (data.products) {
    for (const p of data.products) {
      addNode(
        `product:${p.product}`,
        'product',
        p.description || p.product,
        p
      );
    }
  }

  if (data.plants) {
    for (const pl of data.plants) {
      addNode(
        `plant:${pl.plant}`,
        'plant',
        pl.plant_name || pl.plant,
        pl
      );
    }
  }

  // Sales Orders
  if (data.salesOrders) {
    for (const so of data.salesOrders) {
      addNode(
        `sales_order:${so.sales_order}`,
        'sales_order',
        `SO ${so.sales_order}`,
        so
      );
      addLink(`customer:${so.sold_to_party}`, `sales_order:${so.sales_order}`, 'placed_order');
    }
  }

  // Sales Order Items
  if (data.salesOrderItems) {
    for (const soi of data.salesOrderItems) {
      addNode(
        `sales_order_item:${soi.sales_order}:${soi.sales_order_item}`,
        'sales_order_item',
        `SOI ${soi.sales_order}/${soi.sales_order_item}`,
        soi
      );
      addLink(`sales_order:${soi.sales_order}`, `sales_order_item:${soi.sales_order}:${soi.sales_order_item}`, 'has_item');
      if (soi.material) {
        addLink(`sales_order_item:${soi.sales_order}:${soi.sales_order_item}`, `product:${soi.material}`, 'for_product');
      }
    }
  }

  if (data.salesOrderScheduleLines) {
    for (const sl of data.salesOrderScheduleLines) {
      const slId = `schedule_line:${sl.sales_order}:${sl.sales_order_item}:${sl.schedule_line}`;
      addNode(slId, 'schedule_line', `Sch ${sl.sales_order}/${sl.sales_order_item}/${sl.schedule_line}`, sl);
      addLink(
        `sales_order_item:${sl.sales_order}:${sl.sales_order_item}`,
        slId,
        'schedule'
      );
    }
  }

  // Deliveries
  if (data.deliveries) {
    for (const d of data.deliveries) {
      addNode(
        `delivery:${d.delivery_document}`,
        'delivery',
        `DLV ${d.delivery_document}`,
        d
      );
    }
  }

  // Delivery Items — link delivery to sales order
  if (data.deliveryItems) {
    for (const di of data.deliveryItems) {
      addNode(
        `delivery_item:${di.delivery_document}:${di.delivery_document_item}`,
        'delivery_item',
        `DLI ${di.delivery_document}/${di.delivery_document_item}`,
        di
      );
      addLink(`delivery:${di.delivery_document}`, `delivery_item:${di.delivery_document}:${di.delivery_document_item}`, 'has_item');
      if (di.reference_sd_document) {
        addLink(`sales_order:${di.reference_sd_document}`, `delivery:${di.delivery_document}`, 'fulfilled_by');
      }
      if (di.plant) {
        ensurePlant(di.plant);
        addLink(`delivery_item:${di.delivery_document}:${di.delivery_document_item}`, `plant:${di.plant}`, 'issued_from');
      }
    }
  }

  // Billing Documents
  if (data.billingDocuments) {
    for (const bd of data.billingDocuments) {
      addNode(
        `billing:${bd.billing_document}`,
        'billing',
        `BILL ${bd.billing_document}`,
        bd
      );
      if (bd.sold_to_party) {
        addLink(`customer:${bd.sold_to_party}`, `billing:${bd.billing_document}`, 'billed_to');
      }
    }
  }

  // Billing Document Items — link billing to delivery (billing_item.reference_sd_document = delivery_document)
  if (data.billingItems) {
    for (const bi of data.billingItems) {
      addNode(
        `billing_item:${bi.billing_document}:${bi.billing_document_item}`,
        'billing_item',
        `BLI ${bi.billing_document}/${bi.billing_document_item}`,
        bi
      );
      addLink(`billing:${bi.billing_document}`, `billing_item:${bi.billing_document}:${bi.billing_document_item}`, 'has_item');
      if (bi.reference_sd_document) {
        // billing_item.reference_sd_document = delivery_document (not sales_order)
        addLink(`delivery:${bi.reference_sd_document}`, `billing:${bi.billing_document}`, 'invoiced_as');
      }
      if (bi.material) {
        addLink(`billing_item:${bi.billing_document}:${bi.billing_document_item}`, `product:${bi.material}`, 'for_product');
      }
    }
  }

  if (data.billingDocumentCancellations) {
    for (const bc of data.billingDocumentCancellations) {
      const cid = `billing_cancel:${bc.billing_document}`;
      addNode(cid, 'billing_cancellation', `Cancel ${bc.billing_document}`, bc);
      if (bc.sold_to_party) {
        addLink(`customer:${bc.sold_to_party}`, cid, 'cancellation_for');
      }
      if (bc.cancelled_billing_doc) {
        addLink(cid, `billing:${bc.cancelled_billing_doc}`, 'cancels');
      }
    }
  }

  if (data.productPlants) {
    for (const pp of data.productPlants) {
      ensurePlant(pp.plant);
      addLink(`product:${pp.product}`, `plant:${pp.plant}`, 'stocked_at');
    }
  }

  if (data.productStorageLocations) {
    for (const ps of data.productStorageLocations) {
      ensurePlant(ps.plant);
      const sid = `storage_loc:${ps.product}:${ps.plant}:${ps.storage_location}`;
      addNode(sid, 'storage_location', `Bin ${ps.storage_location}`, ps);
      addLink(`product:${ps.product}`, sid, 'in_bin');
      addLink(`plant:${ps.plant}`, sid, 'has_bin');
    }
  }

  // Journal Entries — link to billing via accounting document
  if (data.journalEntries) {
    for (const je of data.journalEntries) {
      const jeId = `journal_entry:${je.company_code}:${je.fiscal_year}:${je.accounting_document}:${je.accounting_document_item}`;
      addNode(
        jeId,
        'journal_entry',
        `JE ${je.accounting_document}/${je.accounting_document_item}`,
        je
      );
      if (je.customer) {
        addLink(jeId, `customer:${je.customer}`, 'for_customer');
      }
    }
  }

  // Payments
  if (data.payments) {
    for (const p of data.payments) {
      const payId = `payment:${p.company_code}:${p.fiscal_year}:${p.accounting_document}:${p.accounting_document_item}`;
      addNode(
        payId,
        'payment',
        `PAY ${p.accounting_document}/${p.accounting_document_item}`,
        p
      );
      if (p.customer) {
        addLink(payId, `customer:${p.customer}`, 'paid_by');
      }
    }
  }

  // Cross-link billing → journal via accounting document
  if (data.billingDocuments && data.journalEntries) {
    for (const bd of data.billingDocuments) {
      if (bd.accounting_document && bd.company_code && bd.fiscal_year) {
        for (const je of data.journalEntries) {
          if (je.company_code === bd.company_code && je.fiscal_year === bd.fiscal_year && je.accounting_document === bd.accounting_document) {
            const jeId = `journal_entry:${je.company_code}:${je.fiscal_year}:${je.accounting_document}:${je.accounting_document_item}`;
            addLink(`billing:${bd.billing_document}`, jeId, 'posted_as');
          }
        }
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links,
  };
}

// ── Get neighbors for a single node ────────────────────────────

export async function getNodeNeighbors(id, type) {
  const data = {};

  switch (type) {
    case 'customer': {
      data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${id}`;
      data.addresses = await sql`SELECT * FROM addresses WHERE business_partner = ${id}`;
      data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sold_to_party = ${id} LIMIT 20`;
      data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE sold_to_party = ${id} LIMIT 20`;
      data.payments = await sql`SELECT * FROM payments WHERE customer = ${id} LIMIT 20`;
      data.customerCompanyAssignments =
        await sql`SELECT * FROM customer_company_assignments WHERE customer = ${id}`;
      data.customerSalesAreaAssignments =
        await sql`SELECT * FROM customer_sales_area_assignments WHERE customer = ${id}`;
      break;
    }
    case 'sales_order': {
      data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ${id}`;
      const so = data.salesOrders[0];
      if (so) {
        data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${so.sold_to_party}`;
        data.salesOrderItems = await sql`SELECT * FROM sales_order_items WHERE sales_order = ${id}`;
        data.salesOrderScheduleLines =
          await sql`SELECT * FROM sales_order_schedule_lines WHERE sales_order = ${id}`;
        // Get deliveries linked through delivery items
        data.deliveryItems = await sql`SELECT * FROM delivery_items WHERE reference_sd_document = ${id}`;
        const deliveryIds = [...new Set(data.deliveryItems.map(di => di.delivery_document))];
        if (deliveryIds.length > 0) {
          data.deliveries = await sql`SELECT * FROM deliveries WHERE delivery_document = ANY(${deliveryIds})`;
        }
        // Get billing linked through delivery (billing items reference delivery docs, not SO directly)
        if (deliveryIds.length > 0) {
          data.billingItems = await sql`SELECT * FROM billing_document_items WHERE reference_sd_document = ANY(${deliveryIds})`;
          const billingIds = [...new Set(data.billingItems.map(bi => bi.billing_document))];
          if (billingIds.length > 0) {
            data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE billing_document = ANY(${billingIds})`;
          }
        }
        // Get products
        const materials = [...new Set(data.salesOrderItems.map(i => i.material).filter(Boolean))];
        if (materials.length > 0) {
          data.products = await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ANY(${materials})`;
          data.productPlants = await sql`SELECT * FROM product_plants WHERE product = ANY(${materials})`;
          data.productStorageLocations =
            await sql`SELECT * FROM product_storage_locations WHERE product = ANY(${materials}) LIMIT ${NEIGHBOR_MAX_PRODUCT_STORAGE_LOCS}`;
          const plantIds = [
            ...new Set([
              ...(data.productPlants || []).map((p) => p.plant),
              ...(data.productStorageLocations || []).map((p) => p.plant),
            ]),
          ].filter(Boolean);
          if (plantIds.length > 0) {
            data.plants = await sql`SELECT * FROM plants WHERE plant = ANY(${plantIds})`;
          }
        }
      }
      break;
    }
    case 'delivery': {
      data.deliveries = await sql`SELECT * FROM deliveries WHERE delivery_document = ${id}`;
      data.deliveryItems = await sql`SELECT * FROM delivery_items WHERE delivery_document = ${id}`;
      // Link back to sales orders
      const soIds = [...new Set(data.deliveryItems.map(di => di.reference_sd_document).filter(Boolean))];
      if (soIds.length > 0) {
        data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ANY(${soIds})`;
      }
      break;
    }
    case 'billing': {
      data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE billing_document = ${id}`;
      data.billingItems = await sql`SELECT * FROM billing_document_items WHERE billing_document = ${id}`;
      data.billingDocumentCancellations = await sql`
        SELECT * FROM billing_document_cancellations
        WHERE billing_document = ${id}
           OR cancelled_billing_doc = ${id}
        LIMIT 25`;
      const bd = data.billingDocuments[0];
      if (bd) {
        if (bd.sold_to_party) {
          data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${bd.sold_to_party}`;
        }
        if (bd.accounting_document && bd.company_code && bd.fiscal_year) {
          data.journalEntries = await sql`SELECT * FROM journal_entries WHERE company_code = ${bd.company_code} AND fiscal_year = ${bd.fiscal_year} AND accounting_document = ${bd.accounting_document}`;
}
        // billing_items.reference_sd_document = delivery_document, need to get sales_order via delivery_items
        const deliveryIds = [...new Set(data.billingItems.map(bi => bi.reference_sd_document).filter(Boolean))];
        if (deliveryIds.length > 0) {
          const diRows = await sql`SELECT DISTINCT reference_sd_document FROM delivery_items WHERE delivery_document = ANY(${deliveryIds})`;
          const soIds = [...new Set(diRows.map(r => r.reference_sd_document).filter(Boolean))];
          if (soIds.length > 0) {
            data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ANY(${soIds})`;
          }
        }
      }
      break;
    }
    case 'sales_order_item': {
      const [so, item] = id.split(':');
      data.salesOrderItems =
        await sql`SELECT * FROM sales_order_items WHERE sales_order = ${so} AND sales_order_item = ${item}`;
      if (data.salesOrderItems[0]) {
        data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ${so}`;
        data.salesOrderScheduleLines =
          await sql`SELECT * FROM sales_order_schedule_lines WHERE sales_order = ${so} AND sales_order_item = ${item}`;
        const m = data.salesOrderItems[0].material;
        if (m) {
          data.products =
            await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ${m}`;
          data.productPlants = await sql`SELECT * FROM product_plants WHERE product = ${m}`;
          data.productStorageLocations =
            await sql`SELECT * FROM product_storage_locations WHERE product = ${m} LIMIT ${NEIGHBOR_MAX_PRODUCT_STORAGE_LOCS}`;
          const plantIds = [
            ...new Set([
              ...(data.productPlants || []).map((p) => p.plant),
              ...(data.productStorageLocations || []).map((p) => p.plant),
            ]),
          ].filter(Boolean);
          if (plantIds.length) {
            data.plants = await sql`SELECT * FROM plants WHERE plant = ANY(${plantIds})`;
          }
        }
      }
      break;
    }
    case 'delivery_item': {
      const [dd, ditem] = id.split(':');
      data.deliveryItems =
        await sql`SELECT * FROM delivery_items WHERE delivery_document = ${dd} AND delivery_document_item = ${ditem}`;
      data.deliveries = await sql`SELECT * FROM deliveries WHERE delivery_document = ${dd}`;
      const di = data.deliveryItems[0];
      if (di?.reference_sd_document) {
        data.salesOrders =
          await sql`SELECT * FROM sales_orders WHERE sales_order = ${di.reference_sd_document}`;
      }
      if (di?.plant) {
        data.plants = await sql`SELECT * FROM plants WHERE plant = ${di.plant}`;
      }
      break;
    }
    case 'billing_item': {
      const [bd, bitem] = id.split(':');
      data.billingItems =
        await sql`SELECT * FROM billing_document_items WHERE billing_document = ${bd} AND billing_document_item = ${bitem}`;
      data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE billing_document = ${bd}`;
      const bi = data.billingItems[0];
      // billing_item.reference_sd_document = delivery_document, need to get sales_order via delivery_items
      if (bi?.reference_sd_document) {
        const diRows = await sql`SELECT DISTINCT reference_sd_document FROM delivery_items WHERE delivery_document = ${bi.reference_sd_document}`;
        const soIds = diRows.map(r => r.reference_sd_document).filter(Boolean);
        if (soIds.length > 0) {
          data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ANY(${soIds})`;
        }
      }
      if (bi?.material) {
        data.products =
          await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ${bi.material}`;
      }
      break;
    }
    case 'address': {
      const [bp, addrId] = id.split(':');
      data.addresses =
        await sql`SELECT * FROM addresses WHERE business_partner = ${bp} AND address_id = ${addrId}`;
      data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${bp}`;
      break;
    }
    case 'schedule_line': {
      const [so, sitem, line] = id.split(':');
      data.salesOrderScheduleLines =
        await sql`SELECT * FROM sales_order_schedule_lines WHERE sales_order = ${so} AND sales_order_item = ${sitem} AND schedule_line = ${line}`;
      data.salesOrderItems =
        await sql`SELECT * FROM sales_order_items WHERE sales_order = ${so} AND sales_order_item = ${sitem}`;
      data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ${so}`;
      const soi = data.salesOrderItems[0];
      if (soi?.material) {
        data.products =
          await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ${soi.material}`;
      }
      break;
    }
    case 'company': {
      data.customerCompanyAssignments =
        await sql`SELECT * FROM customer_company_assignments WHERE company_code = ${id} LIMIT 50`;
      const custs = [...new Set((data.customerCompanyAssignments || []).map((r) => r.customer))];
      if (custs.length) {
        data.customers = await sql`SELECT * FROM customers WHERE business_partner = ANY(${custs})`;
      }
      break;
    }
    case 'sales_area': {
      const [cust, sorg, dc, div] = id.split(':');
      data.customerSalesAreaAssignments =
        await sql`SELECT * FROM customer_sales_area_assignments WHERE customer = ${cust} AND sales_organization = ${sorg} AND distribution_channel = ${dc} AND division = ${div}`;
      data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${cust}`;
      break;
    }
    case 'plant': {
      data.plants = await sql`SELECT * FROM plants WHERE plant = ${id}`;
      data.productPlants = await sql`SELECT * FROM product_plants WHERE plant = ${id} LIMIT 30`;
      const prods = [...new Set((data.productPlants || []).map((r) => r.product))];
      if (prods.length) {
        data.products =
          await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ANY(${prods})`;
      }
      break;
    }
    case 'storage_loc': {
      const [prod, pl, sloc] = id.split(':');
      data.productStorageLocations =
        await sql`SELECT * FROM product_storage_locations WHERE product = ${prod} AND plant = ${pl} AND storage_location = ${sloc}`;
      data.products =
        await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ${prod}`;
      data.plants = await sql`SELECT * FROM plants WHERE plant = ${pl}`;
      break;
    }
    case 'billing_cancel': {
      data.billingDocumentCancellations =
        await sql`SELECT * FROM billing_document_cancellations WHERE billing_document = ${id}`;
      const bc = data.billingDocumentCancellations[0];
      if (bc?.sold_to_party) {
        data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${bc.sold_to_party}`;
      }
      if (bc?.cancelled_billing_doc) {
        data.billingDocuments =
          await sql`SELECT * FROM billing_documents WHERE billing_document = ${bc.cancelled_billing_doc}`;
      }
      break;
    }
    case 'product': {
      data.products = await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ${id}`;
      data.salesOrderItems = await sql`SELECT * FROM sales_order_items WHERE material = ${id} LIMIT 20`;
      const soIds = [...new Set(data.salesOrderItems.map(i => i.sales_order))];
      if (soIds.length > 0) {
        data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ANY(${soIds})`;
      }
      data.billingItems = await sql`SELECT * FROM billing_document_items WHERE material = ${id} LIMIT 20`;
      const billIds = [...new Set(data.billingItems.map(i => i.billing_document))];
      if (billIds.length > 0) {
        data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE billing_document = ANY(${billIds})`;
      }
      data.productPlants = await sql`SELECT * FROM product_plants WHERE product = ${id}`;
      data.productStorageLocations =
        await sql`SELECT * FROM product_storage_locations WHERE product = ${id} LIMIT ${NEIGHBOR_MAX_PRODUCT_STORAGE_LOCS}`;
      const pPlants = [...new Set((data.productPlants || []).map((p) => p.plant))];
      if (pPlants.length > 0) {
        data.plants = await sql`SELECT * FROM plants WHERE plant = ANY(${pPlants})`;
      }
      break;
    }
    case 'journal_entry': {
      // id format: companyCode:fiscalYear:accountingDocument:item
      const [cc, fy, ad, item] = id.split(':');
      data.journalEntries = await sql`SELECT * FROM journal_entries WHERE company_code = ${cc} AND fiscal_year = ${fy} AND accounting_document = ${ad} AND accounting_document_item = ${item}`;
      const je = data.journalEntries[0];
      if (je) {
        if (je.customer) {
          data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${je.customer}`;
        }
        // Link to billing
        data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE company_code = ${cc} AND fiscal_year = ${fy} AND accounting_document = ${ad}`;
      }
      break;
    }
    case 'payment': {
      const [cc, fy, ad, item] = id.split(':');
      data.payments = await sql`SELECT * FROM payments WHERE company_code = ${cc} AND fiscal_year = ${fy} AND accounting_document = ${ad} AND accounting_document_item = ${item}`;
      const p = data.payments[0];
      if (p && p.customer) {
        data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${p.customer}`;
      }
      break;
    }
  }

  return buildGraph(data);
}
