'use client';

import { useState, useRef, useEffect, memo, useCallback } from 'react';
import dynamic from 'next/dynamic';

const AssistantMarkdown = dynamic(() => import('./AssistantMarkdown'), {
  ssr: false,
  loading: () => <span className="markdown-placeholder">…</span>,
});

function newMsgId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const SUGGESTIONS_EXPANDED_KEY = 'context-graph-suggestions-expanded';

function readSuggestionsExpanded() {
  if (typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(SUGGESTIONS_EXPANDED_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

/** Align with brief §4 example queries (a–c) plus additional analytics. */
const EXAMPLE_CHIPS = [
  'Which products are associated with the highest number of billing documents?',
  'Trace the full flow of billing document 90504248: Sales Order → Delivery → Billing → Journal Entry',
  'Which sales orders were delivered but not billed?',
  'Which sales orders were billed but have no matching delivery?',
  'What is the total revenue by customer?',
  'Top 10 customers by total billing amount',
  'Which customers have overdue or uncleared payments?',
  'How many billing documents were cancelled in the last month?',
  'Show all journal entries for a specific accounting document',
  'Which products have the highest sales order quantity?',
  'List all deliveries pending goods movement (status A)',
  'Which customers have orders but no deliveries yet?',
  'What is the average order value by distribution channel?',
  'Which plants have the most delivery activity?',
  'Find sales orders with rejected items',
];

export default function ChatPanel({ onHighlightNodes }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    setSuggestionsOpen(readSuggestionsExpanded());
  }, []);

  const toggleSuggestions = useCallback(() => {
    setSuggestionsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SUGGESTIONS_EXPANDED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg) return;

    setInput('');
    setMessages(prev => [...prev, { id: newMsgId(), role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });

      const data = await res.json();

      setMessages(prev => [...prev, {
        id: newMsgId(),
        role: 'assistant',
        content: data.answer,
        sql: data.sql,
        results: data.results,
        blocked: data.blocked,
      }]);

      if (data.results && onHighlightNodes) {
        const ids = extractNodeIds(data.results);
        onHighlightNodes(ids);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: newMsgId(),
        role: 'assistant',
        content: 'Connection error. Please try again.',
        blocked: false,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, onHighlightNodes]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Query</h2>
        <p className="chat-subtitle">Natural language over your ingested SAP O2C tables</p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty chat-empty-appear">
            <p>
              Ask about billing lineage, product billing volume, or broken O2C flows (delivered-not-billed,
              billed-no-delivery)—or use a suggestion below.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message msg-appear ${msg.role} ${msg.blocked ? 'blocked' : ''}`}>
            <div className="message-label">{msg.role === 'user' ? 'You' : 'Assistant'}</div>
            <div className="message-content">
              {msg.role === 'assistant' ? (
                <AssistantMarkdown>{msg.content}</AssistantMarkdown>
              ) : (
                msg.content
              )}
            </div>
            {msg.sql && <SQLToggle sql={msg.sql} />}
          </div>
        ))}

        {loading && (
          <div className="message assistant loading-msg msg-appear" key="typing">
            <div className="message-label">Assistant</div>
            <div className="message-content">
              <div className="typing-dots" aria-hidden>
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <section className="chat-suggestions" aria-labelledby="chat-suggestions-heading">
        <button
          type="button"
          id="chat-suggestions-heading"
          className="chat-suggestions-toggle"
          aria-expanded={suggestionsOpen}
          aria-controls="chat-suggestions-chips"
          onClick={toggleSuggestions}
        >
          <span className="chat-suggestions-label">Suggested queries</span>
          <span className="chat-suggestions-chevron" aria-hidden>
            {suggestionsOpen ? '▼' : '▶'}
          </span>
        </button>
        <div
          id="chat-suggestions-chips"
          className={`chat-suggestions-body${suggestionsOpen ? ' is-open' : ''}`}
          aria-hidden={!suggestionsOpen}
        >
          <div className="chat-suggestions-body-inner" inert={!suggestionsOpen ? true : undefined}>
            <div className="chip-container chip-container--suggestions">
              {EXAMPLE_CHIPS.map((chip, i) => (
                <button
                  key={i}
                  type="button"
                  className="chip chip--suggestion"
                  onClick={() => sendMessage(chip)}
                  disabled={loading}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="chat-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about orders, billing, deliveries, customers…"
          rows={2}
          disabled={loading}
          aria-label="Question for the assistant"
        />
        <button
          type="button"
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="send-btn"
        >
          Send
        </button>
      </div>
    </div>
  );
}

const SQLToggle = memo(function SQLToggle({ sql }) {
  const [show, setShow] = useState(false);
  return (
    <div className="sql-toggle">
      <button
        type="button"
        className="sql-toggle-btn"
        onClick={() => setShow(!show)}
        aria-expanded={show}
      >
        {show ? 'Hide SQL' : 'Show SQL'}
      </button>
      <div className={`sql-reveal${show ? ' is-open' : ''}`} aria-hidden={!show}>
        <div className="sql-reveal-inner">
          <pre className="sql-code">{sql}</pre>
        </div>
      </div>
    </div>
  );
});

function extractNodeIds(results) {
  const ids = new Set();
  for (const row of results) {
    if (row.sales_order) ids.add(`sales_order:${row.sales_order}`);
    if (row.billing_document) ids.add(`billing:${row.billing_document}`);
    if (row.delivery_document) ids.add(`delivery:${row.delivery_document}`);
    if (row.business_partner) ids.add(`customer:${row.business_partner}`);
    if (row.customer) ids.add(`customer:${row.customer}`);
    if (row.product) ids.add(`product:${row.product}`);
    if (row.material) ids.add(`product:${row.material}`);
  }
  return Array.from(ids);
}
