export function getFAQResponse(transcript) {
  const text = normalize(transcript);

  if (matchAny(text, [
    'what is the company name',
    'company name',
    'who are you',
    'what is axion',
  ])) {
    return 'The company is Axion, part of the Techrise Group. Axion provides hardware solutions and IT services.';
  }

  if (matchAny(text, [
    'what do you provide',
    'what services do you provide',
    'what services do you have',
    'services',
  ])) {
    return 'Axion provides IT consultation, data services, enterprise networking, hardware supply, system integration, cybersecurity, managed IT support, and IT project services.';
  }

  if (matchAny(text, [
    'firewall',
    'cybersecurity',
    'cyber security',
    'security service',
    'utm',
  ])) {
    return 'Yes. Axion provides cybersecurity solutions, including next-generation firewalls and Unified Threat Management appliances.';
  }

  if (matchAny(text, [
    'server',
    'servers',
    'storage',
    'hardware',
    'hardware services',
  ])) {
    return 'Yes. Axion supplies enterprise-grade servers, storage solutions, routers, switches, firewalls, enterprise Wi-Fi systems, and IP telephony systems.';
  }

  if (matchAny(text, [
    'network',
    'networking',
    'internet',
    'wifi',
    'wi fi',
    'router',
    'switch',
    'fiber',
    'cabling',
  ])) {
    return 'Yes. Axion provides secure enterprise networking, wireless infrastructure, switching and routing, VLANs, QoS, redundancy, backbone infrastructure, structured cabling, and fiber splicing.';
  }

  if (matchAny(text, [
    'data migration',
    'migration',
    'database',
    'cloud',
    'disaster recovery',
    'data recovery',
    'backup',
  ])) {
    return 'Yes. Axion provides disaster recovery and secure data migration across servers, applications, databases, and cloud platforms.';
  }

  if (matchAny(text, [
    'system integration',
    'infrastructure',
    'data center',
    'virtualization',
    'server setup',
  ])) {
    return 'Axion provides end-to-end network deployment, data center integration, virtualization, server setup, and high-availability infrastructure architecture.';
  }

  if (matchAny(text, [
    'access control',
    'surveillance',
    'camera',
    'video surveillance',
    'entry management',
  ])) {
    return 'Yes. Axion provides video surveillance systems, access control, and entry-management solutions.';
  }

  if (matchAny(text, [
    'support',
    'maintenance',
    'managed it',
    'technical support',
    'sla',
  ])) {
    return 'Yes. Axion provides remote support, SLA-based technical support, maintenance contracts, and preventive maintenance services.';
  }

  if (matchAny(text, [
    'where are you',
    'where are you located',
    'location',
    'address',
  ])) {
    return 'Axion is located at G20 Tower, Ashrafieh, Lebanon.';
  }

  if (matchAny(text, [
    'phone',
    'number',
    'contact',
    'reach you',
    'sales',
    'email',
  ])) {
    return 'You can reach Axion by phone at +961 4 535 556 or +961 81 554 003. You can also email sales@techrise.com.lb.';
  }

  if (matchAny(text, [
    'price',
    'pricing',
    'cost',
    'how much',
    'quote',
  ])) {
    return 'Pricing depends on the required solution. I can connect you with the team for a detailed quote.';
  }

  return null;
}

function normalize(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
}

function matchAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}
