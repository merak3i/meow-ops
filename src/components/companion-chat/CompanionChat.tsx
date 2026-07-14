import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cat, ChevronRight, Maximize2, Minimize2, Plus, Send, Sparkles, WifiOff, X,
} from 'lucide-react';
import { getSyncStatus } from '../../lib/queries';
import { postLoopAsk } from '../../lib/loop-api';
import {
  ChatMessage, STARTER_PROMPTS, clearThread, formatTime, loadThread, newMessage, saveThread, syncNudge,
} from './companionChatModel';
import './CompanionChat.css';

type Props = { pageLabel?: string };

export default function CompanionChat({ pageLabel = 'Meow Ops' }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadThread(pageLabel));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<'ready' | 'offline'>('ready');
  const [nudge, setNudge] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveThread(messages); }, [messages]);
  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => textareaRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const show = () => { setOpen(true); setUnread(false); };
    window.addEventListener('meow:open-companion', show);
    return () => window.removeEventListener('meow:open-companion', show);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy, open]);

  useEffect(() => {
    let mounted = true;
    getSyncStatus().then((status) => {
      if (!mounted) return;
      const next = syncNudge(status);
      setNudge(next);
      if (next && !open) setUnread(true);
    });
    return () => { mounted = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant')?.id,
    [messages],
  );

  async function send(question: string) {
    const clean = question.trim();
    if (!clean || busy) return;
    setInput('');
    setBusy(true);
    setMessages((current) => [...current, newMessage('user', clean)]);
    const result = await postLoopAsk(clean);
    if (!result?.ok) {
      setConnection('offline');
      setMessages((current) => [...current, newMessage(
        'assistant',
        result?.error || 'The local copilot helper is offline. Start `node sync/local-api.mjs`, then retry.',
        'local',
      )]);
      setBusy(false);
      setUnread(!open);
      return;
    }
    setConnection('ready');
    setMessages((current) => [...current, newMessage(
      'assistant',
      result.answer || 'No answer was returned.',
      result.source === 'llm' ? 'deepseek' : 'local',
    )]);
    setBusy(false);
    setUnread(!open);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  return (
    <>
      {open && (
        <section
          className={`companion-chat ${expanded ? 'companion-chat--expanded' : ''}`}
          role="dialog"
          aria-label="Companion AI chat"
        >
          <header className="companion-chat__header">
            <div className="companion-chat__identity">
              <span className="companion-chat__avatar"><Cat size={17} /></span>
              <div>
                <strong>Companion</strong>
                <span className={connection === 'ready' ? '' : 'is-offline'}>
                  {connection === 'ready' ? <><i /> Local-first copilot</> : <><WifiOff size={10} /> Helper offline</>}
                </span>
              </div>
            </div>
            <div className="companion-chat__actions">
              <button type="button" onClick={() => setMessages(clearThread(pageLabel))} title="New chat" aria-label="New chat"><Plus size={15} /></button>
              <button type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? 'Compact chat' : 'Expand chat'} aria-label={expanded ? 'Compact chat' : 'Expand chat'}>
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button type="button" onClick={() => setOpen(false)} title="Close chat" aria-label="Close chat"><X size={16} /></button>
            </div>
          </header>

          <div className="companion-chat__context">
            <Sparkles size={11} />
            Reading local Meow Ops evidence · viewing {pageLabel}
          </div>

          <div className="companion-chat__transcript" aria-live="polite">
            {nudge && (
              <article className="companion-chat__insight">
                <div><span>Notice</span><strong>Background work needs a look</strong></div>
                <p>{nudge}</p>
                <button type="button" onClick={() => void send('What should I fix next?')}>
                  Explain the next move <ChevronRight size={12} />
                </button>
              </article>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`companion-chat__message companion-chat__message--${message.role}`}>
                {message.role === 'assistant' && <span className="companion-chat__message-avatar"><Cat size={12} /></span>}
                <div className="companion-chat__bubble">
                  <p>{message.text}</p>
                  <footer>
                    <span>{formatTime(message.createdAt)}</span>
                    {message.role === 'assistant' && (
                      <span>{message.source === 'deepseek' ? 'DeepSeek copilot' : 'Local reasoning'}</span>
                    )}
                  </footer>
                  {message.id === latestAssistant && !busy && (
                    <div className="companion-chat__suggestions">
                      {STARTER_PROMPTS.map((prompt) => (
                        <button key={prompt} type="button" onClick={() => void send(prompt)}>{prompt}</button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
            {busy && (
              <div className="companion-chat__typing" aria-label="Companion is thinking">
                <span /><span /><span />
                <small>Checking local evidence</small>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="companion-chat__composer" onSubmit={onSubmit}>
            <textarea
              ref={textareaRef}
              value={input}
              rows={1}
              maxLength={500}
              placeholder="Ask about changes, sync, spend, or the next fix…"
              aria-label="Message Companion"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onComposerKeyDown}
            />
            <button type="submit" disabled={!input.trim() || busy} aria-label="Send message"><Send size={15} /></button>
            <small>Enter to send · Shift+Enter for a new line</small>
          </form>
        </section>
      )}

      <button
        type="button"
        className={`companion-chat-dock ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((value) => {
          if (!value) setUnread(false);
          return !value;
        })}
        aria-label={open ? 'Close Companion chat' : 'Open Companion chat'}
        aria-expanded={open}
      >
        <span className="companion-chat-dock__avatar"><Cat size={19} /></span>
        <span className="companion-chat-dock__label"><strong>Companion</strong><small>{nudge ? 'Has an ops nudge' : 'Ask Meow Ops'}</small></span>
        {unread && <i className="companion-chat-dock__unread" />}
      </button>
    </>
  );
}
