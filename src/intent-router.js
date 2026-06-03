import OpenAI from 'openai';
import { config } from './config.js';

const openai = new OpenAI({
  apiKey:
    config.openai?.apiKey ||
    process.env.OPENAI_API_KEY,
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

  const ruleIntent = classifyWithRules(text);
  if (ruleIntent !== INTENTS.UNKNOWN) {
    return ruleIntent;
  }

  return classifyWithLLM(transcript);
}

function classifyWithRules(text) {
  if (
    hasAny(text, [
      'where are you',
      'where you are',
      'where are u',
      'location',
      'address',
      'office',
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
    ])
  ) {
    return INTENTS.GENERAL_SERVICES;
  }

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
    ])
  ) {
    return INTENTS.NETWORK_EQUIPMENT_REQUIREMENTS;
  }

  if (
    hasAny(text, [
      'firewall',
      'cybersecurity',
      'cyber security',
      'security',
      'secure',
      'utm',
    ])
  ) {
    return INTENTS.CYBERSECURITY;
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
      'router',
      'switch',
      'fiber',
      'cabling',
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
      'router',
      'switch',
      'firewall',
      'wifi',
      'wi fi',
      'ip telephony',
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
    ])
  ) {
    return INTENTS.SYSTEM_INTEGRATION;
  }

  if (
    hasAny(text, [
      'access control',
      'surveillance',
      'camera',
      'video surveillance',
      'entry management',
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
