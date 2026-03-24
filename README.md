# Context Graph 📊 (DODGE AI Assignment)

![Dodge AI](context-graph/pngs/dodge%20ai.png)

A full-stack, graph-based data modeling and conversational query system designed around an SAP Order-to-Cash (O2C) dataset. 

This project solves the challenge of structuring complex business entities (Customers, Orders, Deliveries, Invoices) into an interactive graph relationship model, while simultaneously providing a powerful, grounded AI assistant capable of answering deep analytical questions about the supply chain flow.

## 🚀 Live Demo
**[View the Deployed Application](https://dodge-ai-assignment.vercel.app/)**

---

## 🏛️ Architecture & Technical Decisions

### 1. Application Architecture
The application is built on **Next.js 14 (App Router)**. This decision was made to leverage a tightly integrated full-stack environment. By combining serverless API routes (`/api/chat`, `/api/graph`) with React client components, the system minimizes latency, guarantees secure execution of LLM API keys on the backend, and easily hosts the highly interactive canvas element alongside a chat interface.

### 2. Database Choice (Neon Serverless Postgres)
For the supply chain data model, **Neon (Serverless PostgreSQL)** was chosen over a strict native graph database (like Neo4j) for several critical reasons:
- **Query Generation Reliability:** Large Language Models (LLMs) are significantly better trained at generating completely accurate standard `SQL` than complex `Cypher` or native graph queries. 
- **O2C Structure:** SAP Order-to-Cash data is inherently highly relational. Customers map to Sales Orders, which map to Deliveries. By utilizing foreign keys and SQL `JOIN`s, the database perfectly models the "Edges" of the graph without risking data fragmentation.
- **Edge Compatibility:** Neon's serverless Postgres scales instantly and connects flawlessly from Next.js Edge APIs without cold-start connection pooling limits.

### 3. LLM Prompting Strategy
The Conversational Query Interface operates on a carefully orchestrated, multi-step prompting pipeline designed to strictly eliminate hallucinations:

**Multi-AI Brainstorming & Cross-Checking:**
Before committing to any architectural or prompting decision, every plan was brainstormed across multiple AI models — **Claude, Gemini, GLM-5, MiniMax M2.7, and GPT** — to gather diverse perspectives. Each model's suggestions were cross-checked against one another to identify the most robust, reliable approach. Only after consensus across models was a plan finalized and implemented. This ensured that schema design, prompt engineering, and query pipeline decisions were thoroughly vetted from multiple angles before any code was written.

**Runtime Query Pipeline:**
1. **Schema Injection:** The LLM is provided with the exact, deterministic SQL schema of the O2C dataset in the system prompt. It is prohibited from guessing table names.
2. **Text-to-SQL Generation:** The user's natural language query is passed to the LLM to generate an optimized Postgres SQL query.
3. **Execution & Contextualization:** The SQL query is executed securely on the backend. The raw data rows (ground truth) are then returned to a *second* LLM call—the "Synthesizer."
4. **Data-Grounded Synthesis:** The Synthesizer is strictly instructed: *"Format the following database rows into a human readable answer. Do not add outside knowledge."* This guarantees the final answer directly mirrors the database.

### 4. System Guardrails
A mandatory safety layer intercepts user input *before* the SQL generation pipeline begins.
- **Domain Restriction:** The `checkGuardrail` agent evaluates the prompt. If a user asks general knowledge questions (e.g., "What is the capital of France?"), creative writing prompts, or anything unrelated to SAP supply chains, the system cleanly rejects it.
- **Fallback Response:**
  > *"This system is designed to answer questions related to the provided SAP Order-to-Cash dataset only. Please ask a question about sales orders, deliveries, billing documents, payments, customers, or products."*
- **Query Sanitization:** Before executing LLM-generated SQL, a sanitizer drops any destructive commands (`DELETE`, `DROP`, `UPDATE`, `INSERT`) ensuring read-only safety.

---

## ✨ Features

### 1. Graph Construction (Data Modeling)
The application ingests the raw O2C dataset and structures it into relational **Nodes** (e.g., `Sales Order`, `Delivery`, `Product`, `Customer`) and **Edges**. The system explicitly maps over **1,700 nodes and 5,600 relationships**.

### 2. Interactive Graph Visualization
Powered by `react-force-graph-2d` and HTML5 Canvas, the visual interface allows users to physically interact with the data:
- **Explore & Pan/Zoom:** Fluid navigation through dense node clusters.
- **Node Expansion:** Dynamically fetch and reveal adjacent neighbors linked to a specific entity.
- **Metadata Inspection:** Click any node to open a detailed side panel containing its unique attributes (ID, Type, routing data, pricing, etc.).

### 3. Built-in Example Tracking
The UI provides immediate access to core analytical questions as defined by the assignment:
- Identifying products with the highest billing volume.
- Tracing end-to-end flows (`Sales Order → Delivery → Billing → Journal Entry`).
- Highlighting broken flows (e.g., Delivered products without matching billing invoices).

---

## 💻 Local Development Setup

First, clone the repository and navigate to the project directory:

```bash
git clone <repository-url>
cd dodge-ai-assignment/context-graph
```

Install the dependencies:

```bash
npm install
```

Set up your environment variables. Create a `.env.local` file in the root:
```env
# Example environment variables
DATABASE_URL="postgres://..."
OPENAI_API_KEY="sk-..."
```

*(If the data is not yet initialized)* Run the data ingestion script to populate your database with nodes and edges:
```bash
npm run ingest
```

Start the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to explore the Context Graph.
