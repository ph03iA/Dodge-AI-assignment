'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import ChatPanel from './components/ChatPanel';

const GraphView = dynamic(() => import('./components/GraphView'), { ssr: false });

const CHAT_WIDTH_STORAGE_KEY = 'context-graph-chat-width';
const DEFAULT_CHAT_WIDTH = 400;
const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 720;

function readStoredChatWidth() {
  if (typeof window === 'undefined') return DEFAULT_CHAT_WIDTH;
  try {
    const raw = localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_WIDTH;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) {
      return Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, n));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CHAT_WIDTH;
}

function setMobileTabWithTransition(next) {
  if (typeof document !== 'undefined' && document.startViewTransition) {
    document.startViewTransition(() => {
      // React 18+ batches setState inside startViewTransition in concurrent mode
      next();
    });
    return;
  }
  next();
}

export default function Home() {
  const [highlightIds, setHighlightIds] = useState([]);
  const [showGraph, setShowGraph] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileTab, setMobileTab] = useState('graph');
  /** Same value on server + first client paint — read localStorage after mount to avoid hydration mismatch. */
  const [chatWidthPx, setChatWidthPx] = useState(DEFAULT_CHAT_WIDTH);
  const resizeRef = useRef({ active: false, startX: 0, startW: 0 });
  const splitResizerElRef = useRef(null);

  useEffect(() => {
    setChatWidthPx(readStoredChatWidth());
  }, []);

  useEffect(() => {
    const q = window.matchMedia('(max-width: 768px)');
    const apply = () => setIsNarrow(q.matches);
    apply();
    q.addEventListener('change', apply);
    return () => q.removeEventListener('change', apply);
  }, []);

  const onResizePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    splitResizerElRef.current = el;
    el.setPointerCapture(e.pointerId);
    resizeRef.current = {
      active: true,
      startX: e.clientX,
      startW: chatWidthPx,
    };
    el.classList.add('is-active');
  }, [chatWidthPx]);

  const onResizePointerMove = useCallback((e) => {
    if (!resizeRef.current.active) return;
    const { startX, startW } = resizeRef.current;
    const delta = startX - e.clientX;
    const next = Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, startW + delta));
    setChatWidthPx(next);
  }, []);

  const endResize = useCallback((e) => {
    const was = resizeRef.current.active;
    resizeRef.current.active = false;
    const el = splitResizerElRef.current;
    if (el) {
      el.classList.remove('is-active');
      try {
        if (e?.pointerId != null) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (was) {
      setChatWidthPx((w) => {
        try {
          localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    }
  }, []);

  const onResizeDoubleClick = useCallback(() => {
    setChatWidthPx(DEFAULT_CHAT_WIDTH);
    try {
      localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(DEFAULT_CHAT_WIDTH));
    } catch {
      /* ignore */
    }
  }, []);

  const chatVisible = !isNarrow || mobileTab === 'chat';
  /** Desktop side-by-side layout when graph + query both shown. */
  const splitDesktop = !isNarrow && showGraph;
  const chatOnlyDesktop = !isNarrow && !showGraph;
  /** Keep graph mounted on mobile so tab switches do not refetch / re-layout the canvas. */
  const graphMounted = showGraph || isNarrow;
  const graphSimulationActive = !isNarrow ? showGraph : mobileTab === 'graph';
  /** Keep chat mounted on mobile so the transcript survives Graph ↔ Query switches. */
  const chatMounted = isNarrow || chatVisible;

  const goMobileTab = useCallback((tab) => {
    setMobileTabWithTransition(() => setMobileTab(tab));
  }, []);

  const onHighlightNodes = useCallback((ids) => {
    setHighlightIds(ids);
    if (isNarrow && ids.length) setMobileTabWithTransition(() => setMobileTab('graph'));
  }, [isNarrow]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">Context Graph</h1>
          <a
            href="https://github.com/ph03iA/Dodge-AI-assignment"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
            title="GitHub Repository"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub Repo
          </a>
        </div>
        <div className="header-right">
          {isNarrow ? (
            <div className="header-segments" role="tablist" aria-label="Main panels">
              <button
                type="button"
                role="tab"
                aria-selected={mobileTab === 'graph'}
                className={`segment-btn${mobileTab === 'graph' ? ' is-active' : ''}`}
                onClick={() => goMobileTab('graph')}
              >
                Graph
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mobileTab === 'chat'}
                className={`segment-btn${mobileTab === 'chat' ? ' is-active' : ''}`}
                onClick={() => goMobileTab('chat')}
              >
                Query
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="toggle-btn"
              onClick={() => setShowGraph(!showGraph)}
            >
              {showGraph ? 'Focus query' : 'Show graph'}
            </button>
          )}
        </div>
      </header>

      <main
        className={`app-main${chatOnlyDesktop ? ' app-main--chat-only' : ''}${splitDesktop && chatVisible ? ' app-main--split' : ''}`}
      >
        {graphMounted && (
          <div
            className={`graph-pane${isNarrow ? ' graph-pane--narrow-vt' : ''}${isNarrow && mobileTab !== 'graph' ? ' graph-pane--stack-hidden' : ''}`}
          >
            <GraphView
              highlightIds={highlightIds}
              simulationActive={graphSimulationActive}
              onNodeSelect={() => {}}
            />
          </div>
        )}
        {splitDesktop && !isNarrow && (
          <div
            ref={splitResizerElRef}
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={chatWidthPx}
            aria-valuemin={MIN_CHAT_WIDTH}
            aria-valuemax={MAX_CHAT_WIDTH}
            aria-label="Resize query panel"
            title="Drag to resize. Double-click to reset."
            className="split-resizer"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            onDoubleClick={onResizeDoubleClick}
          />
        )}
        {chatMounted && (
          <div
            className={`chat-pane${isNarrow ? ' chat-pane--narrow-vt' : ''}${isNarrow && mobileTab !== 'chat' ? ' chat-pane--stack-hidden' : ''}${splitDesktop && !isNarrow ? ' chat-pane--sized' : ''}`}
            style={
              splitDesktop && !isNarrow
                ? { width: chatWidthPx, flexShrink: 0, flexGrow: 0 }
                : undefined
            }
          >
            <ChatPanel onHighlightNodes={onHighlightNodes} />
          </div>
        )}
      </main>
    </div>
  );
}
