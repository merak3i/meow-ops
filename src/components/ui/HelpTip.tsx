import { GLOSSARY, type GlossaryTerm } from '../../lib/glossary';

// HelpTip — a small "?" that carries a glossary definition. Native title plus
// aria-label rather than a custom popover: it works on keyboard focus, it
// works in the 3D HUD, and it costs no bundle.

export interface HelpTipProps {
  term: GlossaryTerm;
}

export function HelpTip({ term }: HelpTipProps) {
  const entry = GLOSSARY[term];
  const text = `${entry.term} — ${entry.definition}`;
  return (
    <button type="button" className="mo-help" title={text} aria-label={text} tabIndex={0}>
      ?
    </button>
  );
}
