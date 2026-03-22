export type ProspectingAgentEvent = {
  name: "app/prospecting-agent.run";
  data: {
    org_id: string;
    triggered_by?: string;
    sources?: string[];
  };
};
