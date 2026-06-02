function getFastIntentResponse(text, memory = {}) {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '');

  const greetings = [
    'hi',
    'hello',
    'hey',
    'good morning',
    'morning',
    'good evening',
    'bonjour',
    'salut',
    'مرحبا',
    'اهلا',
    'أهلا',
    'السلام عليكم',
  ];

  if (
    greetings.some(
      g => normalized === g || normalized.startsWith(g + ' ')
    )
  ) {
    const name = memory.callerName
      ? ` ${memory.callerName}`
      : '';

    return `Hello${name}. How can I help you today?`;
  }

  return null;
}

module.exports = {
  getFastIntentResponse,
};
