import { Figtree } from 'next/font/google';
import './globals.css';

const figtree = Figtree({ subsets: ['latin'], display: 'swap' });

export const metadata = {
  title: 'Chat',
  description: 'Group chats with accounts, file sharing and GIFs.',
};

// Applies saved theme, accent and text size before the page paints (no flash).
const initSettings = `try{var s=JSON.parse(localStorage.getItem('chat-settings')||'{}');var d=document.documentElement;d.dataset.theme=s.theme||'system';d.dataset.accent=s.accent||'fjord';d.dataset.size=s.size||'md';}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="system" data-accent="fjord" data-size="md" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initSettings }} />
      </head>
      <body className={figtree.className}>{children}</body>
    </html>
  );
}
