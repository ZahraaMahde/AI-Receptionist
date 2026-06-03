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
  const wordCount = getWordCount(text);

  if (isLikelyFragment(text)) {
    console.log('[FAQ] Fragment detected — using RAG');
    return INTENTS.UNKNOWN;
  }

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

function classifyWithRules(text) {
  const matches = [];

  if (matchesCybersecurity(text)) {
    matches.push(INTENTS.CYBERSECURITY);
  }

  if (matchesNetworkEquipment(text)) {
    matches.push(INTENTS.NETWORK_EQUIPMENT_REQUIREMENTS);
  }

  if (matchesLocation(text)) {
    matches.push(INTENTS.LOCATION);
  }

  if (matchesContactSales(text)) {
    matches.push(INTENTS.CONTACT_SALES);
  }

  if (matchesPricing(text)) {
    matches.push(INTENTS.PRICING);
  }

  if (matchesGeneralServices(text)) {
    matches.push(INTENTS.GENERAL_SERVICES);
  }

  if (matchesDataMigrationRecovery(text)) {
    matches.push(INTENTS.DATA_MIGRATION_RECOVERY);
  }

  if (matchesNetworkingServices(text)) {
    matches.push(INTENTS.NETWORKING_SERVICES);
  }

  if (matchesHardwareSupply(text)) {
    matches.push(INTENTS.HARDWARE_SUPPLY);
  }

  if (matchesSystemIntegration(text)) {
    matches.push(INTENTS.SYSTEM_INTEGRATION);
  }

  if (matchesAccessControl(text)) {
    matches.push(INTENTS.ACCESS_CONTROL);
  }

  if (matchesSupportMaintenance(text)) {
    matches.push(INTENTS.SUPPORT_MAINTENANCE);
  }

  const uniqueMatches = [...new Set(matches)];

  if (uniqueMatches.length === 0) {
    return INTENTS.UNKNOWN;
  }

  if (uniqueMatches.length > 1) {
    if (
      uniqueMatches.includes(INTENTS.CYBERSECURITY) &&
      uniqueMatches.includes(INTENTS.NETWORKING_SERVICES)
    ) {
      return INTENTS.CYBERSECURITY;
    }

    console.log(
      `[FAQ] Multiple intents matched (${uniqueMatches.join(', ')}) — using RAG`
    );

    return INTENTS.UNKNOWN;
  }

  return uniqueMatches[0];
}

function shouldForceRAG(text) {
  return /\b(?:explain|describe|compare|comparison|difference|different|details|detail|in detail|how does|how do you|which is better|recommend|recommendation|suggest|suggestion|best|choose|help me choose|advise|advice|approach|strategy|plan|design|setup|home setup|work from home|what things|what products)\b/i.test(
    text
  );
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

function isLikelyFragment(text) {
  const wordCount = getWordCount(text);

  if (!text) {
    return true;
  }

  if (wordCount <= 2) {
    return true;
  }

  if (
    /^(and|or|but|also|then|for|with|about|between|because|to|from)\b/i.test(
      text
    )
  ) {
    return true;
  }

  if (/\b(?:and|or|with|between|for|to|from|about)\s*$/i.test(text)) {
    return true;
  }

  const nounListOnly =
    wordCount <= 8 &&
    /(?:screen|screens|mouse|keyboard|router|routers|switch|switches|cable|cables|fiber|monitor|laptop|pc|computer)/i.test(
      text
    ) &&
    !/\b(?:do you|what|how|where|need|provide|have|sell|cost|price|connect|setup)\b/i.test(
      text
    );

  if (nounListOnly) {
    return true;
  }

  return false;
}

function matchesCybersecurity(text) {
  return hasAny(text, [
    'do you provide firewall',
    'do you have firewall',
    'firewall solution',
    'firewall solutions',
    'cybersecurity',
    'cyber security',
    'security service',
    'security services',
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
  ]);
}

function matchesNetworkEquipment(text) {
  return hasAny(text, [
    'what equipment do i need for one internet line',
    'what do i need for one internet line',
    'what i need for one internet line',
    'connect one internet line',
    'one internet line',
    'internet everywhere',
    'wifi everywhere',
    'internet on every floor',
    'wifi on every floor',
    'three floors internet',
    '3 floors internet',
    'five floors internet',
    '5 floors internet',
    'office network setup',
    'company building internet',
  ]);
}

function matchesLocation(text) {
  return hasAny(text, [
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
  ]);
}

function matchesContactSales(text) {
  return hasAny(text, [
    'phone',
    'phone number',
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
  ]);
}

function matchesPricing(text) {
  return hasAny(text, [
    'price',
    'pricing',
    'cost',
    'how much',
    'quote',
    'budget',
  ]);
}

function matchesGeneralServices(text) {
  return hasAny(text, [
    'what do you provide',
    'what services',
    'your services',
    'what do you do',
    'services do you have',
    'what can you help with',
  ]);
}

function matchesDataMigrationRecovery(text) {
  return hasAny(text, [
    'do you provide data migration',
    'data migration',
    'move data',
    'move my data',
    'move them to cloud',
    'server failure',
    'lost files',
    'disaster recovery',
    'data recovery',
    'backup service',
    'cloud migration',
  ]);
}

function matchesNetworkingServices(text) {
  return hasAny(text, [
    'do you provide networking',
    'do you have networking',
    'networking service',
    'networking services',
    'enterprise networking',
    'wifi service',
    'wi fi service',
    'wi-fi service',
    'structured cabling',
    'fiber splicing',
    'routing and switching',
    'switching and routing',
    'vlan',
    'qos',
  ]);
}

function matchesHardwareSupply(text) {
  return hasAny(text, [
    'do you sell hardware',
    'do you provide hardware',
    'do you have hardware',
    'hardware product',
    'hardware products',
    'servers',
    'storage solutions',
    'ip telephony',
    'call management',
    'enterprise wifi',
    'enterprise wi fi',
    'enterprise wi-fi',
  ]);
}

function matchesSystemIntegration(text) {
  return hasAny(text, [
    'system integration',
    'infrastructure integration',
    'data center',
    'virtualization',
    'server setup',
    'high availability',
    'network deployment',
  ]);
}

function matchesAccessControl(text) {
  return hasAny(text, [
    'access control',
    'surveillance',
    'camera',
    'cameras',
    'video surveillance',
    'entry management',
    'employee cards',
    'cards to enter',
    'building entry',
  ]);
}

function matchesSupportMaintenance(text) {
  return hasAny(text, [
    'managed it',
    'technical support',
    'sla',
    'remote support',
    'preventive maintenance',
    'maintenance contract',
    'maintenance contracts',
  ]);
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
- setup advice
- home setup
- work from home setup
- "what is the difference"
- "explain in detail"
- "suggest for me"
- "what is best"
- "help me choose"
- "design a solution"

Return UNKNOWN if the caller message is incomplete or only a fragment.

FAQ is only for short factual company questions.

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

function getWordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}
