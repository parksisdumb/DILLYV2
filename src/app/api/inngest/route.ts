import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

// Intel pipeline agents (external data discovery/enrichment)
import { edgarIntelligenceAgent } from "@/inngest/agents/edgar-intelligence-agent";
import { prospectDiscoveryAgent } from "@/inngest/agents/prospect-discovery-agent";
import { intelDistributor } from "@/inngest/agents/intel-distributor";
import { enrichmentAgent } from "@/inngest/agents/enrichment-agent";

// Email tracking (phase 1)
import { gmailSyncScheduler, gmailSyncUser } from "@/inngest/email/gmail-sync";

// Follow-up alerting (phase 1 — email digests)
import { followUpDigestScheduler } from "@/inngest/notifications/follow-up-digest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Intel pipeline
    edgarIntelligenceAgent,
    prospectDiscoveryAgent,
    intelDistributor,
    enrichmentAgent,
    // Email tracking
    gmailSyncScheduler,
    gmailSyncUser,
    // Follow-up alerting
    followUpDigestScheduler,
  ],
});
