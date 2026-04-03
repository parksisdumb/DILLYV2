import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

// Implemented agents
import { edgarIntelligenceAgent } from "@/inngest/agents/edgar-intelligence-agent";
import { prospectDiscoveryAgent } from "@/inngest/agents/prospect-discovery-agent";
import { intelDistributor } from "@/inngest/agents/intel-distributor";
import { enrichmentAgent } from "@/inngest/agents/enrichment-agent";

// Scaffold agents (enabled=false, not yet implemented)
import { carDealershipAgent } from "@/inngest/agents/car-dealership-agent";
import { selfStorageAgent } from "@/inngest/agents/self-storage-agent";
import { publicBidAgent } from "@/inngest/agents/public-bid-agent";
import { corporateCampusAgent } from "@/inngest/agents/corporate-campus-agent";
import { privateReitAgent } from "@/inngest/agents/private-reit-agent";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Active
    edgarIntelligenceAgent,
    prospectDiscoveryAgent,
    intelDistributor,
    enrichmentAgent,
    // Scaffolded
    carDealershipAgent,
    selfStorageAgent,
    publicBidAgent,
    corporateCampusAgent,
    privateReitAgent,
  ],
});
