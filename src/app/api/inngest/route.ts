import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { prospectingAgent } from "@/inngest/functions/prospecting-agent";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [prospectingAgent],
});
