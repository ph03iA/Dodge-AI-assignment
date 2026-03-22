# Context Graph System — Task Breakdown

> Stack: Next.js · PostgreSQL (Neon) · react-force-graph · Google Gemini API  
> Dataset: `sap-order-to-cash-dataset/sap-o2c-data/` (JSONL, multiple `part-*.jsonl` per entity)  
> Deadline: 26 March, 11:59 PM IST

---

## Phase 0 — Project Setup

- [ ] `npx create-next-app@latest context-graph --tailwind --app --no-src-dir`
- [ ] Install dependencies: `npm i react-force-graph-2d @neondatabase/serverless @google/genai`
- [ ] Create `.env.local` with `DATABASE_URL`, `GEMINI_API_KEY`, and optional `GEMINI_MODEL` (see Phase 5)
- [ ] Create Neon project → copy pooled connection string into `.env.local`
- [ ] Google AI Studio (`aistudio.google.com`) → API key → `.env.local`
- [ ] Push repo to GitHub (public)

---

## Phase 1 — Understand the Dataset

**Layout:** Each entity lives in its own folder under `sap-order-to-cash-dataset/sap-o2c-data/<entity_name>/`.  
**Files:** One or more `part-*.jsonl` files per folder — **ingest every part**, not a single file.

- [ ] List all entity folders and keep a one-page **source → table** map (which folder loads into which SQL table)
- [ ] For each core entity, print 2–3 sample rows and note primary keys and join keys
- [ ] Draw the **Order-to-cash chain** as understood from the data (adjust field names after you inspect rows):
  - Sales order (header / items) ↔ outbound delivery (header / items) ↔ billing document (header / items)
  - Billing header ↔ **journal entry** (e.g. via `accountingDocument` / company code / fiscal year — confirm in data)
  - Customer: `soldToParty` / business partner IDs ↔ `business_partners` (+ addresses)
  - Payments: `payments_accounts_receivable` ↔ billing / customer (confirm link fields)
- [ ] List **nested or non-scalar JSON** (e.g. objects like `creationTime`, arrays) and decide: `JSONB` column, flatten, or omit for v1
- [ ] Note optional folders for a richer graph later: `plants`, `product_plants`, `product_descriptions`, `sales_order_schedule_lines`, `billing_document_cancellations`, `customer_*_assignments`
- [ ] **Important:** Include `product_descriptions/` and `plants/` in your source → table map — add them as optional Phase 2 tables even for v1; they add graph richness for products and deliveries

---

## Phase 2 — Database Schema

Design tables that match **your** graph and SQL needs; names can be domain-friendly (`sales_orders`) as long as ingestion is documented.

**Minimum core tables (assignment + example queries):**

- [ ] **Customers / partners:** from `business_partners` (and optionally role fields)
- [ ] **Addresses:** from `business_partner_addresses` (FK to partner)
- [ ] **Products:** from `products` (join descriptions in queries or optional table)
- [ ] **Sales orders:** from `sales_order_headers`
- [ ] **Sales order items:** from `sales_order_items` (FK to header, product, schedule line if needed)
- [ ] **Deliveries:** from `outbound_delivery_headers` + `outbound_delivery_items` (links to order / order item — confirm keys in Phase 1)
- [ ] **Billing documents:** from `billing_document_headers` + `billing_document_items`
- [ ] **Journal entry (AR) lines:** from `journal_entry_items_accounts_receivable` (needed for **Sales Order → Delivery → Billing → Journal Entry** trace)
- [ ] **Payments (AR):** from `payments_accounts_receivable`

**Schema quality:**

- [ ] `CREATE TABLE IF NOT EXISTS` in `lib/schema.sql` (or split files if large)
- [ ] Foreign keys where relationships are stable; use `ON DELETE` / `ON UPDATE` appropriately (often `NO ACTION` for snapshots)
- [ ] Indexes on **every column** used in joins or filters (sales order id, delivery id, billing document id, product id, sold-to party, accounting document keys, etc.)
- [ ] Primary keys / `UNIQUE` constraints that support `ON CONFLICT` during ingest
- [ ] Run full script on Neon SQL editor and fix errors before wiring the app

---

## Phase 3 — Data Ingestion Script

- [ ] Create `scripts/ingest.js` and add `"ingest": "node scripts/ingest.js"` to `package.json`
- [ ] Implement **`readJSONLParts(dir)`** (or equivalent): for a given entity folder, read **all** `part-*.jsonl` files and yield/concatenate rows in deterministic order
- [ ] Implement **`cleanRow(row)`**: empty string → `NULL`; handle nested values (e.g. stringify into `JSONB`, or extract scalars only)
- [ ] One ingest function per **destination table** (or per source folder with clear mapping); map JSON field names → SQL columns
- [ ] Use **`INSERT ... ON CONFLICT ... DO UPDATE` or `DO NOTHING`** so re-runs are safe; log row counts per table
- [ ] Ingest in **dependency order** (partners → addresses → products → order headers → **`sales_order_schedule_lines` if items FK to it** → order items → deliveries → billing → journal → payments) where FKs require it
- [ ] Run `npm run ingest`, verify counts in Neon, fix mapping mismatches

---

## Phase 4 — API Routes

### `/api/graph` (GET)

- [ ] Create `app/api/graph/route.js` → call `buildGraph()` with rows from Neon
- [ ] **Avoid misleading graphs:** independent `LIMIT` per table often breaks joins. Prefer one of:
  - **A)** Global cap: sample or limit **total** nodes/edges while preserving referential subgraphs, **or**
  - **B)** Query params: `?seed=<billing_or_order_id>&depth=<n>` to load a neighborhood, **or**
  - **C)** Initial light payload + rely on **`/api/node/[id]`** expand for detail  
  Document the choice in README.
  - **Recommended:** Pick **one** strategy (B or C preferred over A). Global LIMIT destroys join relationships. B (`?seed=&depth=`) or C (light initial + expand) scales better.
- [ ] Return JSON `{ nodes, links }` compatible with `react-force-graph`
- [ ] Smoke-test: `GET /api/graph` returns valid structure

### `/api/chat` (POST)

- [ ] Create `app/api/chat/route.js`; body `{ message }`
- [ ] **Guardrail** first → if off-domain, return fixed copy: *"This system is designed to answer questions related to the provided dataset only."* (or your variant) with `blocked: true`
- [ ] **Generate SQL** (LLM) → **sanitize** before execution:
  - Must be a single statement starting with `SELECT` (case-insensitive, allow leading whitespace)
  - Reject `;` that could start a second statement; reject obvious non-query keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, etc.)
  - Optional: block `information_schema`, `pg_catalog`, etc., if you want stricter sandboxing
- [ ] Execute against Neon; on error return user-safe message + optional `sql` for debugging
- [ ] **Synthesize** answer from **result rows only** (no invented facts)
- [ ] Response shape e.g. `{ answer, sql, results, blocked }`
- [ ] Test with curl / Thunder Client

### `/api/node/[id]` (GET)

- [ ] Parse stable node id convention (e.g. `sales_order:740506`, `billing:90504248`, `customer:310000108`)
- [ ] `switch` (or strategy map) by type: fetch related rows for **that** entity only (orders ↔ items ↔ deliveries ↔ billing ↔ journal ↔ payments ↔ customer/product as needed)
- [ ] Return `{ nodes, links }` via `buildGraph()` for merge on the client

---

## Phase 5 — LLM Pipeline (`lib/llm.js`)

- [ ] Create `lib/llm.js` using `@google/genai` (`GoogleGenAI`, `apiKey: process.env.GEMINI_API_KEY`)
- [ ] **Model ID:** use `process.env.GEMINI_MODEL` with a sensible default; if a preview model is unavailable, switch to a current fast model from AI Studio (e.g. `gemini-2.0-flash` or latest free-tier flash) — **verify the string works** before demo day
- [ ] `DB_SCHEMA` constant: compact table/column list the model may use (matches Neon exactly)
- [ ] **`checkGuardrail(message)`:** system prompt → answer **only** `YES` or `NO` (in-domain question about this SAP O2C dataset / sales, billing, delivery, payment, customers, products). `temperature: 0`, very low `maxOutputTokens`
  - **Optional fast path (reject-only):** if the message is **clearly** off-topic with **no** plausible O2C terms (e.g. capital cities, poems, recipes, generic trivia), block immediately **without** calling the LLM. Otherwise **always** call `checkGuardrail` (LLM). Do **not** auto-allow just because a keyword appears — that lets prompts like *"Write a story about billing"* through.
- [ ] **`generateSQL(message)`:** schema + rules: `SELECT` only, always reasonable `LIMIT` (e.g. 50–100), use only listed tables/columns, no markdown fences, no commentary
- [ ] **`synthesizeAnswer(message, results)`:** answer strictly from `results`; if empty, say no matching data; cap length
- [ ] Smoke-test each function in isolation before API wiring

---

## Phase 6 — Graph Builder (`lib/graphBuilder.js`)

- [ ] `NODE_COLORS` map: one color per entity type (sales order, delivery, billing, journal, payment, customer, product, etc.)
- [ ] `buildGraph(data)` accepts structured row bundles; outputs `{ nodes, links }`
- [ ] Node shape: `{ id, type, label, color, ...metadata }` with **stable `id`** strings used by expand + optional chat highlight
- [ ] Links: `{ source, target, label }` (directional semantics in the UI)
- [ ] Deduplicate nodes with a `Map` keyed by `id`
- [ ] Export `buildGraph`, `NODE_COLORS`
- [ ] **`getNodeNeighbors(id, type)`** helper: returns rows for the local neighborhood of a given node (used by `/api/node/[id]`). Keeps payloads small by fetching only relevant subgraph on expansion.

---

## Phase 7 — Frontend Components

### `GraphView.jsx`

- [ ] Client component; dynamic import `react-force-graph-2d` (`ssr: false` via parent if needed)
- [ ] Fetch initial graph from `/api/graph`; loading + error states
- [ ] `ForceGraph2D`: dark background, `nodeColor` from type, directional arrows, click → inspect, **right-click or button** → expand via `/api/node/[id]` and merge graph
- [ ] Panel: selected node metadata; legend; counts
- [ ] `highlightIds` prop to emphasize nodes referenced from chat results

### `ChatPanel.jsx`

- [ ] Messages state, input, loading indicator, auto-scroll
- [ ] Example **chips** matching required queries (wording below)
- [ ] Toggle to show generated SQL per assistant message
- [ ] Parse primary keys from tabular `results` where possible → `onHighlightNodes`
- [ ] Distinct style for guardrail-blocked replies

### `app/page.js`

- [ ] Layout: header, graph (flex) + chat (~420px), optional hide-graph toggle
- [ ] Lift `highlightIds` / setter shared between `GraphView` and `ChatPanel`

---

## Phase 8 — Verify Required Queries & Guardrails

Assignment-aligned checks:

- [ ] **(a)** *Which products are associated with the highest number of billing documents?*  
  → Ranked list with counts, grounded in query results
- [ ] **(b)** *Trace the full flow of a given billing document:* **Sales Order → Delivery → Billing → Journal Entry**  
  → Use actual billing document id from the dataset; answer must reflect joined rows (payments optional extra)
- [ ] **(c)** *Incomplete / broken flows:*  
  - [ ] "Delivered but not billed" — outbound delivery exists with no billing document
  - [ ] "Billed without delivery" — billing document exists with no delivery  
  Test both sub-branches as separate queries
- [ ] **Guardrail:** *"What is the capital of France?"* → rejection message, no SQL
- [ ] **Guardrail:** *"Write me a poem"* → rejection message, no SQL

---

## Phase 9 — Deploy

- [ ] Push to GitHub; import on Vercel
- [ ] Set `DATABASE_URL`, `GEMINI_API_KEY`, and `GEMINI_MODEL` if non-default
- [ ] Run migration/schema on Neon **production** branch; run ingest against production if needed (or document one-time seed)
- [ ] Open live URL: graph loads, chat runs, three query types + guardrails work

---

## Phase 10 — README + Submission

- [ ] **README.md** (required for submission): architecture (text diagram OK), **why PostgreSQL** (relational O2C, LLM-friendly SQL, Neon serverless), **graph model** (entities + edges), **ingestion** (multi-part JSONL), **LLM pipeline** (guardrail → SQL → execute → synthesize), **SQL safety / guardrails**, **graph loading strategy** (seed vs limit — tradeoffs), how to run locally (`npm i`, `.env`, `schema`, `npm run ingest`, `npm run dev`)
- [ ] Note **which Gemini model** you used and how to change it
- [ ] Export **AI session logs** (Cursor / Composer / other) into the repo or a zip per submission instructions
- [ ] Submit demo URL + repo: https://forms.gle/sPDBUvA45cUM3dyc8

---

## Bonus (only after Phase 1–9)

- [ ] Streaming assistant text (`generateContentStream` or equivalent in current SDK)
- [ ] Conversation memory (last *N* turns passed into guardrail / SQL / answer prompts)
- [ ] Stronger **chat → graph**: highlight nodes/edges from parsed ids in answers or result columns
- [ ] Semantic / hybrid search over entity text fields (only if time; keep one feature deep)

---

## Definition of Done

- [ ] Public demo URL, **no authentication**
- [ ] Graph: expand, inspect metadata, see relationships
- [ ] Chat: NL → validated **SELECT** → Neon → data-backed natural language answer
- [ ] Queries **(a), (b), (c)** both branches where applicable + guardrail tests pass
- [ ] GitHub public + README + AI logs packaged as required