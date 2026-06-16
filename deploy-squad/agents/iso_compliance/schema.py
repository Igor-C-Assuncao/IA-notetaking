from pydantic import BaseModel, Field
from typing import List

class ISOViolation(BaseModel):
    standard: str = Field(description="The specific standard violated (e.g., 'ISO/IEC 25010', 'ISO/IEC 42001').")
    clause_or_category: str = Field(description="Specific clause or category impacted (e.g., 'Maintainability', 'AI Risk Assessment').")
    severity: str = Field(description="Severity classification: 'LOW', 'MEDIUM', 'HIGH', or 'BLOCKER'.")
    description: str = Field(description="Detailed compliance failure explanation.")
    remediation: str = Field(description="Step-by-step corrective action to achieve full compliance.")

class ComplianceInnovation(BaseModel):
    title: str = Field(description="Title of the compliance automation or guardrail improvement idea.")
    standard_alignment: str = Field(description="How this idea helps the enterprise clear official ISO audits smoothly.")
    action_plan: str = Field(description="Technical suggestions for implementing this safeguard.")

class ISOComplianceReport(BaseModel):
    agent_name: str = "ISO Compliance Auditor"
    is_compliant: bool = Field(description="Boolean indicating if the current deployment state clears standard regulatory checks.")
    violations: List[ISOViolation] = Field(default=[], description="List of identified compliance issues.")
    innovations: List[ComplianceInnovation] = Field(default=[], description="Proactive ideas to strengthen enterprise governance and compliance.")