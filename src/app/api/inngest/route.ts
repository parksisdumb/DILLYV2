import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { edgarIntelligenceAgent } from "@/inngest/functions/edgar-intelligence-agent";
import { prospectDiscoveryAgent } from "@/inngest/functions/prospect-discovery-agent";
import { intelDistributor } from "@/inngest/functions/intel-distributor";
import { enrichmentAgent } from "@/inngest/agents/enrichment-agent";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [edgarIntelligenceAgent, prospectDiscoveryAgent, intelDistributor, enrichmentAgent],
});
