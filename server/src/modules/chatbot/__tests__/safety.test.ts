import { describe, expect, it } from 'vitest';
import { detectSensitive } from '../services/safety.js';

describe('detectSensitive (English + Hinglish)', () => {
  it.each([
    ['My father has chest pain, please call a doctor', 'medical'],
    ['Bhaiya tabiyat bahut kharab hai, dawai chahiye', 'medical'],
    ['There is smoke in the corridor', 'safety'],
    ['Someone entered my room while I was out', 'safety'],
    ['mere room se chori ho gayi', 'safety'],
    ['I was charged twice for the booking', 'payment_dispute'],
    ['paise do baar kat gaye', 'payment_dispute'],
    ['I want a refund', 'refund'],
    ['mera paisa wapas karo', 'refund'],
    ['AC is not cooling and the room is warm', 'complaint'],
    ['The bathroom is dirty and there is a cockroach', 'complaint'],
    ['geyser kaam nahi kar raha', 'complaint'],
    ['This is pathetic, you cheated us', 'negative_sentiment'],
  ])('%s → %s', (text, category) => {
    expect(detectSensitive(text)?.category).toBe(category);
  });

  it('marks medical and safety as urgent', () => {
    expect(detectSensitive('need an ambulance')?.priority).toBe('urgent');
    expect(detectSensitive('the towels are dirty')?.priority).toBe('high');
  });

  it.each([
    'What time is breakfast?',
    'Can we get 2 extra towels?',
    'Is parking available for an Innova?',
    'Namaste! Late checkout possible?',
    'Any good places for shopping nearby?',
  ])('does not flag routine request: %s', (text) => {
    expect(detectSensitive(text)).toBeNull();
  });
});

import { toChatFormatting } from '../services/gemini.service.js';

describe('toChatFormatting', () => {
  it('turns Markdown into WhatsApp-style text', () => {
    expect(toChatFormatting('## Rates\n• **Deluxe:** ₹9,072\n\n\n\nBook [here](https://x.test/rooms)')).toBe(
      'Rates\n• *Deluxe:* ₹9,072\n\nBook here: https://x.test/rooms',
    );
  });
});
