import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { prospectingAgent } from "@/inngest/functions/prospecting-agent";
import { intelDistributor } from "@/inngest/functions/intel-distributor";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [prospectingAgent, intelDistributor],
});
