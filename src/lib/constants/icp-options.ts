/** Criteria options for ICP Profile Builder */

export const ICP_ACCOUNT_TYPES = [
  { value: "owner", label: "Owner" },
  { value: "commercial_property_management", label: "Property Management" },
  { value: "facilities_management", label: "Facilities Management" },
  { value: "asset_management", label: "Asset Management" },
  { value: "general_contractor", label: "General Contractor" },
  { value: "developer", label: "Developer" },
  { value: "broker", label: "Broker" },
  { value: "consultant", label: "Consultant" },
] as const;

export const ICP_VERTICALS = [
  { value: "commercial_office", label: "Commercial Office" },
  { value: "retail", label: "Retail" },
  { value: "industrial_warehouse", label: "Industrial / Warehouse" },
  { value: "healthcare", label: "Healthcare" },
  { value: "education", label: "Education" },
  { value: "hospitality", label: "Hospitality" },
  { value: "multifamily", label: "Multifamily" },
  { value: "government", label: "Government" },
  { value: "religious", label: "Religious" },
  { value: "mixed_use", label: "Mixed Use" },
] as const;

export const ICP_BUILDING_TYPES = [
  { value: "flat_roof", label: "Flat Roof" },
  { value: "low_slope", label: "Low Slope" },
  { value: "steep_slope", label: "Steep Slope" },
  { value: "metal", label: "Metal" },
  { value: "tpo", label: "TPO" },
  { value: "epdm", label: "EPDM" },
  { value: "built_up", label: "Built-Up (BUR)" },
  { value: "modified_bitumen", label: "Modified Bitumen" },
  { value: "pvc", label: "PVC" },
  { value: "shingle", label: "Shingle" },
  { value: "tile", label: "Tile" },
] as const;

export const ICP_DECISION_ROLES = [
  { value: "property_manager", label: "Property Manager" },
  { value: "facility_manager", label: "Facility Manager" },
  { value: "owner_operator", label: "Owner / Operator" },
  { value: "asset_manager", label: "Asset Manager" },
  { value: "maintenance_director", label: "Maintenance Director" },
  { value: "procurement", label: "Procurement" },
  { value: "cfo_finance", label: "CFO / Finance" },
  { value: "general_contractor_pm", label: "GC Project Manager" },
] as const;

export const CRITERIA_TYPE_LABELS: Record<string, string> = {
  account_type: "Account Types",
  vertical: "Verticals",
  property_size_min: "Min Property Size (sq ft)",
  property_size_max: "Max Property Size (sq ft)",
  roof_age_min: "Min Roof Age (years)",
  roof_age_max: "Max Roof Age (years)",
  building_type: "Building / Roof Types",
  decision_role: "Decision Maker Roles",
};
