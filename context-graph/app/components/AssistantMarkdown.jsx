'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];

export default function AssistantMarkdown({ children }) {
  return <ReactMarkdown remarkPlugins={plugins}>{children}</ReactMarkdown>;
}
