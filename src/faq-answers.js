import { INTENTS } from './intent-router.js';

export function getFAQAnswer(intent) {
  switch (intent) {
    case INTENTS.GENERAL_SERVICES:
      return 'Axion provides IT consultation, data services, enterprise networking, hardware supply, system integration, cybersecurity, managed IT support, and IT project services.';

    case INTENTS.NETWORK_EQUIPMENT_REQUIREMENTS:
      return 'For one internet line in a company building, you typically need a router or firewall, network switches, access points for Wi-Fi, structured cabling or fiber cables, patch panels, and proper network configuration with VLANs and security policies.';

    case INTENTS.NETWORKING_SERVICES:
      return 'Yes. Axion provides secure enterprise networking, wireless infrastructure, switching and routing, VLANs, QoS, redundancy, backbone infrastructure, structured cabling, and fiber splicing.';

    case INTENTS.CYBERSECURITY:
      return 'Yes. Axion provides cybersecurity solutions, including next-generation firewalls and Unified Threat Management appliances.';

    case INTENTS.HARDWARE_SUPPLY:
      return 'Yes. Axion supplies enterprise-grade servers, storage solutions, routers, switches, firewalls, enterprise Wi-Fi systems, and IP telephony systems.';

    case INTENTS.DATA_MIGRATION_RECOVERY:
      return 'Yes. Axion provides disaster recovery and secure data migration across servers, applications, databases, and cloud platforms.';

    case INTENTS.SYSTEM_INTEGRATION:
      return 'Axion provides end-to-end network deployment, data center integration, virtualization, server setup, and high-availability infrastructure architecture.';

    case INTENTS.ACCESS_CONTROL:
      return 'Yes. Axion provides video surveillance systems, access control, and entry-management solutions.';

    case INTENTS.SUPPORT_MAINTENANCE:
      return 'Yes. Axion provides remote support, SLA-based technical support, maintenance contracts, and preventive maintenance services.';

    case INTENTS.LOCATION:
      return 'Axion is located at G20 Tower, Ashrafieh, Lebanon.';

    case INTENTS.CONTACT_SALES:
      return 'You can reach Axion by phone at +961 4 535 556 or +961 81 554 003. You can also email sales@techrise.com.lb.';

    case INTENTS.PRICING:
      return 'Pricing depends on the required solution. I can connect you with the team for a detailed quote.';

    default:
      return null;
  }
}
