import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Cat, Check, ChevronRight, Maximize2, Minimize2, Pencil, Plus, Send, Settings2, Sparkles, WifiOff, X,
} from 'lucide-react';
import { getSyncStatus } from '../../lib/queries';
import {
  fetchCompanionSoul, postCompanionFeedback, postLoopAsk, postProjectClaim, postProjectConfirm,
} from '../../lib/loop-api';
import {
  ChatMessage, LearningTarget, STARTER_PROMPTS, clearThread, formatTime, loadThread, newMessage, saveThread, syncNudge,
} from './companionChatModel';
import SoulStudio from './SoulStudio';
import type { CompanionFeedbackSignal, CompanionSoulProfile } from '../../lib/loop-api';
import './CompanionChat.css';

type Props = { pageLabel?: string };
type TeachingDraft = LearningTarget & { project_name: string; value: string; supersedes?: string };

const PROJECT_FIELDS = [
  ['alias', 'Alias / folder name'],
  ['vision', 'Vision'],
  ['mission', 'Mission'],
  ['outcome', 'Current outcome'],
  ['current_phase', 'Current phase'],
  ['priority', 'Priority'],
  ['constraint', 'Constraint'],
  ['non_goal', 'Non-goal'],
] as const;

const GATE_LABELS = {
  known_known: 'Verified',
  known_unknown: 'Needs teaching',
  unknown_known: 'Hypothesis',
  unknown_unknown: 'Blind spot',
} as const;

const FEEDBACK_OPTIONS: Array<{ signal: CompanionFeedbackSignal; label: string }> = [
  { signal: 'too_verbose', label: 'Too long' },
  { signal: 'too_brief', label: 'Needs more depth' },
  { signal: 'too_soft', label: 'Challenge me more' },
  { signal: 'too_harsh', label: 'Too harsh' },
  { signal: 'too_speculative', label: 'Too speculative' },
  { signal: 'missed_possibilities', label: 'Explore more' },
];

export default function CompanionChat({ pageLabel = 'Meow Ops' }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadThread(pageLabel));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<'ready' | 'offline'>('ready');
  const [nudge, setNudge] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const [teaching, setTeaching] = useState<TeachingDraft | null>(null);
  const [teachBusy, setTeachBusy] = useState(false);
  const [soulOpen, setSoulOpen] = useState(false);
  const [soulName, setSoulName] = useState('Companion');
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveThread(messages); }, [messages]);
  useEffect(() => {
    let mounted = true;
    fetchCompanionSoul().then((result) => {
      if (mounted && result?.profile?.name) setSoulName(result.profile.name);
    });
    return () => { mounted = false; };
  }, []);
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

  const handleSoulProfile = useCallback((profile: CompanionSoulProfile) => {
    setSoulName(profile.name || 'Companion');
  }, []);

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
    if (result.soul?.name) setSoulName(result.soul.name);
    const metadata = {
      ...(result.gate ? { gate: result.gate } : {}),
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      ...(result.evidence ? { evidence: result.evidence } : {}),
      ...(result.unknowns ? { unknowns: result.unknowns } : {}),
      ...(result.next_question ? { nextQuestion: result.next_question } : {}),
      ...(result.learning ? { learning: result.learning } : {}),
      ...(result.claim_id ? { claimId: result.claim_id } : {}),
      ...(result.claim_status ? { claimStatus: result.claim_status } : {}),
      feedbackEligible: true,
      soulRevision: result.soul?.revision || 0,
      ...(result.soul?.project_overlay ? { projectSoul: result.soul.project_overlay } : {}),
    };
    setMessages((current) => [...current, newMessage(
      'assistant',
      result.answer || 'No answer was returned.',
      result.source === 'llm'
        ? 'deepseek'
        : (result.gate === 'known_unknown' || result.gate === 'unknown_unknown' ? 'unknown' : 'local'),
      metadata,
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

  function openTeaching(message?: ChatMessage) {
    const target = message?.learning;
    setTeaching({
      project_name: target?.project_name || '',
      field: target?.field || 'vision',
      value: '',
      ...(target?.project_id ? { project_id: target.project_id } : {}),
      ...(message?.claimId ? { supersedes: message.claimId } : {}),
    });
  }

  async function saveTeaching(event: FormEvent) {
    event.preventDefault();
    if (!teaching?.project_name.trim() || !teaching.value.trim() || teachBusy) return;
    setTeachBusy(true);
    const result = await postProjectClaim({
      project_name: teaching.project_name.trim(),
      field: teaching.field,
      value: teaching.value.trim(),
      ...(teaching.project_id ? { project_id: teaching.project_id } : {}),
      ...(teaching.supersedes ? { supersedes: teaching.supersedes } : {}),
    });
    if (result?.ok && result.claim) {
      const claim = result.claim;
      setMessages((current) => [...current, newMessage(
        'assistant',
        `Learned and owner-confirmed: ${claim.project_name} ${claim.field.replaceAll('_', ' ')} — ${claim.value}`,
        'local',
        {
          gate: 'known_known',
          confidence: 1,
          evidence: [{ kind: 'owner_confirmation', ref: claim.claim_id, detail: 'Saved in the private project ledger' }],
          learning: { project_id: claim.project_id, project_name: claim.project_name, field: claim.field },
          claimId: claim.claim_id,
          claimStatus: 'owner_confirmed',
        },
      )]);
      setTeaching(null);
    } else {
      setMessages((current) => [...current, newMessage(
        'assistant',
        result?.error || 'I could not save that project fact. Check the local helper and try again.',
        'local',
        { gate: 'known_unknown' },
      )]);
    }
    setTeachBusy(false);
  }

  async function confirmClaim(message: ChatMessage) {
    if (!message.claimId || teachBusy) return;
    setTeachBusy(true);
    const result = await postProjectConfirm(message.claimId);
    setMessages((current) => [...current, newMessage(
      'assistant',
      result?.ok
        ? 'Confirmed. I will now treat that project fact as owner-verified.'
        : (result?.error || 'I could not confirm that claim.'),
      'local',
      result?.ok ? { gate: 'known_known', confidence: 1 } : { gate: 'known_unknown' },
    )]);
    setTeachBusy(false);
  }

  async function recordFeedback(message: ChatMessage, signal: CompanionFeedbackSignal) {
    if (!message.feedbackEligible || message.feedbackRecorded || feedbackBusy) return;
    setFeedbackBusy(message.id);
    const result = await postCompanionFeedback({
      signal,
      response_ref: message.id,
      soul_revision: message.soulRevision || 0,
      ...(message.gate ? { gate: message.gate } : {}),
      ...(message.projectSoul?.project_id ? { project_id: message.projectSoul.project_id } : {}),
    });
    setMessages((current) => current.map((candidate) => (
      candidate.id === message.id
        ? {
          ...candidate,
          ...(result?.ok ? { feedbackRecorded: true, feedbackStatus: 'saved' as const } : { feedbackStatus: 'error' as const }),
        }
        : candidate
    )));
    setFeedbackBusy(null);
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
                <strong>{soulName}</strong>
                <span className={connection === 'ready' ? '' : 'is-offline'}>
                  {connection === 'ready' ? <><i /> Local-first copilot</> : <><WifiOff size={10} /> Helper offline</>}
                </span>
              </div>
            </div>
            <div className="companion-chat__actions">
              <button type="button" onClick={() => { setSoulOpen(true); setExpanded(true); setTeaching(null); }} title="Soul Studio" aria-label="Open Soul Studio"><Settings2 size={14} /></button>
              <button type="button" onClick={() => setMessages(clearThread(pageLabel))} title="New chat" aria-label="New chat"><Plus size={15} /></button>
              <button type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? 'Compact chat' : 'Expand chat'} aria-label={expanded ? 'Compact chat' : 'Expand chat'}>
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button type="button" onClick={() => setOpen(false)} title="Close chat" aria-label="Close chat"><X size={16} /></button>
            </div>
          </header>

          <div className="companion-chat__context">
            {soulOpen ? <Settings2 size={11} /> : <Sparkles size={11} />}
            <span>{soulOpen ? 'Private soul profile · evidence gates stay locked' : `Reading local Meow Ops evidence · viewing ${pageLabel}`}</span>
            {!soulOpen && <button type="button" onClick={() => openTeaching()}><BookOpen size={10} /> Teach</button>}
          </div>

          {soulOpen ? (
            <SoulStudio onClose={() => setSoulOpen(false)} onProfile={handleSoulProfile} />
          ) : <>
          <div className="companion-chat__transcript" aria-live="polite">
            {teaching && (
              <form className="companion-chat__teach" onSubmit={saveTeaching}>
                <header><strong>Teach Companion one project fact</strong><button type="button" onClick={() => setTeaching(null)} aria-label="Close teaching form"><X size={12} /></button></header>
                <label>Project<input value={teaching.project_name} maxLength={100} onChange={(event) => setTeaching({ ...teaching, project_name: event.target.value })} placeholder="e.g. BergLabs" /></label>
                <label>What are you teaching?<select value={teaching.field} onChange={(event) => setTeaching({ ...teaching, field: event.target.value })}>{PROJECT_FIELDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>{`What is the current ${teaching.field.replaceAll('_', ' ')}?`}<textarea value={teaching.value} maxLength={4000} rows={3} onChange={(event) => setTeaching({ ...teaching, value: event.target.value })} /></label>
                <button type="submit" disabled={teachBusy || !teaching.project_name.trim() || !teaching.value.trim()}><Check size={11} /> Save confirmed fact</button>
              </form>
            )}
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
                  {message.role === 'assistant' && message.gate && (
                    <span className={`companion-chat__gate companion-chat__gate--${message.gate}`}>{GATE_LABELS[message.gate]}</span>
                  )}
                  <p>{message.text}</p>
                  {message.role === 'assistant' && ((message.evidence?.length || 0) > 0 || (message.unknowns?.length || 0) > 0) && (
                    <details className="companion-chat__evidence">
                      <summary>Why I answered this way</summary>
                      {message.evidence?.map((item) => <p key={`${item.kind}:${item.ref}`}><strong>{item.kind.replaceAll('_', ' ')}</strong> · {item.detail}</p>)}
                      {message.unknowns?.map((item) => <p key={item}><strong>Unknown</strong> · {item}</p>)}
                    </details>
                  )}
                  {message.role === 'assistant' && (message.learning || message.claimStatus === 'inferred') && (
                    <div className="companion-chat__learning-actions">
                      {message.claimStatus === 'inferred' && <button type="button" disabled={teachBusy} onClick={() => void confirmClaim(message)}><Check size={10} /> Confirm</button>}
                      {message.learning && <button type="button" onClick={() => openTeaching(message)}><Pencil size={10} /> {message.claimId ? 'Correct' : 'Teach Companion'}</button>}
                    </div>
                  )}
                  {message.role === 'assistant' && message.feedbackEligible && (
                    <details className="companion-chat__feedback" open={message.feedbackStatus === 'error' ? true : undefined}>
                      <summary>{message.feedbackRecorded ? 'Response tuned' : 'Tune this response'}</summary>
                      {!message.feedbackRecorded && (
                        <div>
                          {FEEDBACK_OPTIONS.map((option) => (
                            <button
                              key={option.signal}
                              type="button"
                              disabled={Boolean(feedbackBusy)}
                              onClick={() => void recordFeedback(message, option.signal)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {message.feedbackStatus === 'saved' && <p>Saved as metadata only. Any soul change still needs your approval.</p>}
                      {message.feedbackStatus === 'error' && <p>I could not save this signal. Check the local helper and retry.</p>}
                    </details>
                  )}
                  <footer>
                    <span>{formatTime(message.createdAt)}</span>
                    {message.role === 'assistant' && (
                      <span>{message.source === 'deepseek' ? 'Model-assisted' : message.source === 'unknown' ? 'Unknown' : 'Local reasoning'}</span>
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
          </>}
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
        <span className="companion-chat-dock__label"><strong>{soulName}</strong><small>{nudge ? 'Has an ops nudge' : 'Ask Meow Ops'}</small></span>
        {unread && <i className="companion-chat-dock__unread" />}
      </button>
    </>
  );
}
