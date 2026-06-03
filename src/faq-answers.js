import { INTENTS } from './intent-router.js';

export function getFAQAnswer(intent) {
  switch (intent) {
    case INTENTS.GENERAL_SERVICES:
      return 'Axion provides IT consulting, networking, hardware supply, cybersecurity, data services, system integration, and managed IT support.';

    case INTENTS.NETWORK_EQUIPMENT_REQUIREMENTS:
      return 'You would typically need a router or firewall, network switches, Wi-Fi access points, cabling or fiber, and proper VLAN and security configuration.';

    case INTENTS.NETWORKING_SERVICES:
      return 'Yes. Axion provides enterprise networking, Wi-Fi, switching, routing, VLANs, fiber infrastructure, and structured cabling.';

    case INTENTS.CYBERSECURITY:
      return 'Yes. Axion provides cybersecurity solutions, including next-generation firewalls and UTM appliances.';

    case INTENTS.HARDWARE_SUPPLY:
      return 'Yes. Axion supplies servers, storage, routers, switches, firewalls, enterprise Wi-Fi, and IP telephony systems.';

    case INTENTS.DATA_MIGRATION_RECOVERY:
      return 'Yes. Axion provides disaster recovery and secure data migration across servers, applications, databases, and cloud platforms.';

    case INTENTS.SYSTEM_INTEGRATION:
      return 'Axion provides network deployment, data center integration, virtualization, server setup, and high-availability infrastructure.';

    case INTENTS.ACCESS_CONTROL:
      return 'Yes. Axion provides video surveillance, access control, and entry-management systems.';

    case INTENTS.SUPPORT_MAINTENANCE:
      return 'Yes. Axion provides remote support, SLA-based technical support, maintenance contracts, and preventive maintenance.';

    case INTENTS.LOCATION:
      return 'Axion is located at G20 Tower, Ashrafieh, Lebanon.';

    case INTENTS.CONTACT_SALES:
      return 'You can reach Axion at +961 4 535 556 or +961 81 554 003, or email sales@techrise.com.lb.';

    case INTENTS.PRICING:
      return 'Pricing depends on the solution. I can connect you with the team for a detailed quote.';

    default:
      return null;
  }
}
