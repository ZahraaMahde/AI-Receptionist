import OpenAI from 'openai';
import { config } from './config.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

const INTENTS = {
  GENERAL_SERVICES: 'GENERAL_SERVICES',
  NETWORK_EQUIPMENT_REQUIREMENTS: 'NETWORK_EQUIPMENT_REQUIREMENTS',
  NETWORKING_SERVICES: 'NETWORKING_SERVICES',
  CYBERSECURITY: 'CYBERSECURITY',
  HARDWARE_SUPPLY: 'HARDWARE_SUPPLY',
  DATA_MIGRATION_RECOVERY: 'DATA_MIGRATION_RECOVERY',
  SYSTEM_INTEGRATION: 'SYSTEM_INTEGRATION',
  ACCESS_CONTROL: 'ACCESS_CONTROL',
  SUPPORT_MAINTENANCE: 'SUPPORT_MAINTENANCE',
  LOCATION: 'LOCATION',
  CONTACT_SALES: 'CONTACT_SALES',
  PRICING: 'PRICING',
  UNKNOWN: 'UNKNOWN',
};

export { INTENTS };

export async function classifyFAQIntent(transcript) {
  const text = normalize(transcript);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (shouldForceRAG(text)) {
    console.log('[FAQ] Complex question detected — using RAG');
    return INTENTS.UNKNOWN;
  }

  if (wordCount > 18 && !isClearFAQ(text)) {
    console.log('[FAQ] Long/unclear question detected — using RAG');
    return INTENTS.UNKNOWN;
  }

  const ruleIntent = classifyWithRules(text);

  if (ruleIntent !== INTENTS.UNKNOWN) {
    return ruleIntent;
  }

  return classifyWithLLM(transcript);
}

function shouldForceRAG(text) {
  return /\b(?:explain|describe|compare|comparison|difference|different|details|detail|in detail|how does|how do you|which is better|recommend|recommendation|suggest|suggestion|best|choose|help me choose|advise|advice|approach|strategy|plan|design)\b/i.test(text);
}

function isClearFAQ(text) {
  return hasAny(text, [
    'what services',
    'what do you provide',
    'where are you',
    'where you are',
    'where you at',
    'phone',
    'email',
    'contact',
    'sales',
    'price',
    'pricing',
    'cost',
    'do you provide',
    'do you have',
    'one internet line',
    'internet everywhere',
    'move data',
    'data migration',
    'firewall',
    'cybersecurity',
    'cyber security',
  ]);
}

function classifyWithRules(text) {
  // Keep this first. If the user asks for thinking, comparison, explanation,
  // or advice, FAQ should stay quiet and let RAG handle it.
  if (shouldForceRAG(text)) {
    return INTENTS.UNKNOWN;
  }

  // Cybersecurity must come before networking.
  // Otherwise "hackers attacking office network" gets misclassified as networking,
  // because keywords are tiny gremlins with no judgment.
  if (
    hasAny(text, [
      'firewall',
      'cybersecurity',
      'cyber security',
      'security',
      'secure',
      'secure network',
      'utm',
      'hacker',
      'hackers',
      'attack',
      'attacking',
      'ransomware',
      'threat',
      'virus',
      'malware',
    ])
  ) {
    return INTENTS.CYBERSECURITY;
  }

  // Network design / equipment requirement.
  if (
    hasAny(text, [
      'what products do i need',
      'what product do i need',
      'what things do i need',
      'what equipment do i need',
      'equipment needed',
      'products needed',
      'connect one internet line',
      'one internet line',
      'internet line',
      'what i need for network',
      'what do i need for network',
      'internet everywhere',
      'wifi everywhere',
      'internet on every floor',
      'wifi on every floor',
      'three floors',
      '3 floors',
      'five floors',
      '5 floors',
      'office network',
      'company building',
      'building with',
      'employees',
      'users',
    ])
  ) {
    return INTENTS.NETWORK_EQUIPMENT_REQUIREMENTS;
  }

  if (
    hasAny(text, [
      'where are you',
      'where you are',
      'where you at',
      'where are you at',
      'where are u',
      'where are you based',
      'location',
      'address',
      'office location',
      'where is your office',
    ])
  ) {
    return INTENTS.LOCATION;
  }

  if (
    hasAny(text, [
      'phone',
      'number',
      'contact',
      'reach',
      'sales',
      'email',
      'call you',
      'call the team',
      'sales team',
      'how can i reach',
      'how do i reach',
    ])
  ) {
    return INTENTS.CONTACT_SALES;
  }

  if (
    hasAny(text, [
      'price',
      'pricing',
      'cost',
      'how much',
      'quote',
      'budget',
    ])
  ) {
    return INTENTS.PRICING;
  }

  if (
    hasAny(text, [
      'what do you provide',
      'what services',
      'your services',
      'what do you do',
      'services do you have',
      'what can you help with',
    ])
  ) {
    return INTENTS.GENERAL_SERVICES;
  }

  if (
    hasAny(text, [
      'data migration',
      'migration',
      'database',
      'cloud',
      'disaster recovery',
      'data recovery',
      'backup',
      'move data',
      'move my data',
      'move them to cloud',
      'server failure',
      'lost files',
    ])
  ) {
    return INTENTS.DATA_MIGRATION_RECOVERY;
  }

  if (
    hasAny(text, [
      'network',
      'networking',
      'internet',
      'wifi',
      'wi fi',
      'wi-fi',
      'router',
      'switch',
      'fiber',
      'cabling',
      'vlan',
      'qos',
    ])
  ) {
    return INTENTS.NETWORKING_SERVICES;
  }

  if (
    hasAny(text, [
      'server',
      'servers',
      'storage',
      'hardware',
      'ip telephony',
      'call management',
    ])
  ) {
    return INTENTS.HARDWARE_SUPPLY;
  }

  if (
    hasAny(text, [
      'system integration',
      'infrastructure',
      'data center',
      'virtualization',
      'server setup',
      'high availability',
      'deployment',
    ])
  ) {
    return INTENTS.SYSTEM_INTEGRATION;
  }

  if (
    hasAny(text, [
      'access control',
      'surveillance',
      'camera',
      'cameras',
      'video surveillance',
      'entry management',
      'employee cards',
      'cards to enter',
      'building entry',
    ])
  ) {
    return INTENTS.ACCESS_CONTROL;
  }

  if (
    hasAny(text, [
      'support',
      'maintenance',
      'managed it',
      'technical support',
      'sla',
      'remote support',
      'preventive maintenance',
    ])
  ) {
    return INTENTS.SUPPORT_MAINTENANCE;
  }

  return INTENTS.UNKNOWN;
}

async function classifyWithLLM(transcript) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900);

    const response = await openai.chat.completions.create(
      {
        model:
          config.openai?.intentModel ||
          process.env.INTENT_MODEL ||
          'gpt-4o-mini',
        temperature: 0,
        max_tokens: 8,
        messages: [
          {
            role: 'system',
            content: `
Classify the caller message into exactly one label.

Labels:
GENERAL_SERVICES
NETWORK_EQUIPMENT_REQUIREMENTS
NETWORKING_SERVICES
CYBERSECURITY
HARDWARE_SUPPLY
DATA_MIGRATION_RECOVERY
SYSTEM_INTEGRATION
ACCESS_CONTROL
SUPPORT_MAINTENANCE
LOCATION
CONTACT_SALES
PRICING
UNKNOWN

Important:
Return UNKNOWN if the caller asks for:
- explanation
- comparison
- recommendation
- detailed answer
- advice
- "what is the difference"
- "explain in detail"
- "suggest for me"
- "what is best"
- "help me choose"
- "design a solution"

FAQ is only for short factual questions.

Return only the label.
`,
          },
          {
            role: 'user',
            content: transcript,
          },
        ],
      },
      {
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    const intent = response.choices?.[0]?.message?.content
      ?.trim()
      ?.toUpperCase();

    return Object.values(INTENTS).includes(intent)
      ? intent
      : INTENTS.UNKNOWN;
  } catch {
    return INTENTS.UNKNOWN;
  }
}

function normalize(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
}

function hasAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}
