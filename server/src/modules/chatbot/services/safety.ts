import type { EscalationCategory } from '../models/conversation.model.js';

export interface SafetyMatch {
  category: EscalationCategory;
  priority: 'urgent' | 'high';
  reason: string;
}

interface Rule {
  category: EscalationCategory;
  priority: 'urgent' | 'high';
  label: string;
  patterns: RegExp[];
}

/**
 * Deterministic first line of defence, evaluated BEFORE any LLM call so sensitive messages reach staff
 * instantly even if the AI is slow or down. Covers English plus common Hinglish (Roman-script Hindi)
 * phrasing seen in Indian guest chats. Ordered by severity: the first match wins.
 *
 * It's intentionally conservative — a false positive costs a staff glance; a false negative costs a guest.
 */
const RULES: Rule[] = [
  {
    category: 'medical',
    priority: 'urgent',
    label: 'Possible medical emergency',
    patterns: [
      /\b(doctor|ambulance|hospital|medical emergency|first aid|chest pain|heart attack|unconscious|faint(ed|ing)?|not breathing|breathless|bleeding|seizure|allerg(y|ic) reaction|food poisoning|injur(ed|y)|fell down|vomit(ing)?)\b/i,
      /\b(dawai|dawa|tabiyat\s+(bahut\s+)?kharab|bimar|behosh|chot\s+lag)/i,
    ],
  },
  {
    category: 'safety',
    priority: 'urgent',
    label: 'Safety or security concern',
    patterns: [
      /\b(fire|smoke in|gas leak|short circuit|electric shock|stolen|theft|thief|robbed|break[- ]?in|someone (is )?(in|entered) my room|harass(ed|ing|ment)?|molest|assault|unsafe|threaten(ed|ing)?|police|emergency)\b/i,
      /\b(aag\s+lag|chori|chor\b|ched(chaad|khani)|darr?\s+lag\s+raha|police\s+bulao)/i,
    ],
  },
  {
    category: 'payment_dispute',
    priority: 'high',
    label: 'Payment dispute',
    patterns: [
      /\b(charged (twice|double|extra|more)|double[- ]charged|overcharg(ed|ing)|wrong (amount|bill|charge)|extra charge|hidden charge|chargeback|deducted (twice|but)|payment (failed|deducted) but|money (got )?deducted)\b/i,
      /\b(paise\s+(do\s+baar\s+)?kat\s+gaye|do\s+baar\s+(paise|payment)|zyada\s+paise|galat\s+bill)/i,
    ],
  },
  {
    category: 'refund',
    priority: 'high',
    label: 'Refund request',
    patterns: [/\b(refund|money back|reimburse|cancel and refund|return (my|the) (money|payment))\b/i, /\b(paisa|paise)\s+(wapas|vapas|lautao)/i],
  },
  {
    category: 'complaint',
    priority: 'high',
    label: 'Guest complaint',
    patterns: [
      /\b(complain(t|ing)?|not (working|cooling|clean)|(ac|a\/c|air ?con\w*|geyser|tv|wi-?fi|lift|shower|toilet|flush|tap|heater) (is )?(not|isn'?t|stopped|broken|leaking)|dirty|filthy|smell(s|y)?|stink|cockroach|bed ?bugs?|rats?|mosquito(es)?|noisy|too loud|rude|misbehav\w*|worst|terrible|horrible|disgusting|unacceptable|disappoint(ed|ing)|broken|leak(ing|age)?|no (hot )?water)\b/i,
      /\b(bakwas|ganda|gandagi|kaam\s+nahi\s+kar\s+raha|nahi\s+chal\s+raha|band\s+ho\s+gaya|thanda\s+nahi|garam\s+pani\s+nahi|shikayat)/i,
    ],
  },
  {
    category: 'negative_sentiment',
    priority: 'high',
    label: 'Very unhappy guest',
    patterns: [
      /\b(angry|furious|fed up|pathetic|cheat(ed|ing)?|fraud|scam|never (coming|come) back|bad review|one[- ]star|consumer (court|forum)|legal action|lawyer)\b/i,
      /\b(dhoka|bekaar|faltu|bahut\s+bura)/i,
      /!!!+/,
    ],
  },
];

export function detectSensitive(text: string): SafetyMatch | null {
  const normalized = text.normalize('NFKC');
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(normalized))) {
      return { category: rule.category, priority: rule.priority, reason: rule.label };
    }
  }
  return null;
}

export const PRIORITY_FOR: Record<EscalationCategory, 'urgent' | 'high' | 'normal'> = {
  medical: 'urgent',
  safety: 'urgent',
  payment_dispute: 'high',
  refund: 'high',
  complaint: 'high',
  negative_sentiment: 'high',
  unknown_fact: 'normal',
  guest_request: 'normal',
  ai_unavailable: 'normal',
};
