from pydantic import BaseModel, Field
from typing import List

class MLIssue(BaseModel):
    component: str = Field(description="Impacted component (e.g., 'Feature Store', 'Prompt Design', 'CT Pipeline').")
    severity: str = Field(description="Severity classification: 'LOW', 'MEDIUM', 'HIGH', or 'BLOCKER'.")
    description: str = Field(description="Detailed explanation of the reproducibility risk or operational failure.")
    mitigation: str = Field(description="Recommended corrective action to secure the pipeline.")

class MLInnovation(BaseModel):
    title: str = Field(description="Title of the alternative modeling approach (e.g., 'Temporal Convolutional Autoencoders for Sound Anomaly').")
    rationale: str = Field(description="Strategic justification explaining performance, cost, or precision gains.")
    proposed_stack: str = Field(description="Recommended toolset or framework ecosystem (e.g., MLflow, DVC, LangGraph Tracing).")

class MLOpsReport(BaseModel):
    agent_name: str = "ML Guardian"
    ready_for_production: bool = Field(description="Boolean indicating if the artifact clears all MLOps deployment guardrails.")
    issues: List[MLIssue] = Field(default=[], description="List of identified operational or statistical risks.")
    innovations: List[MLInnovation] = Field(default=[], description="Disruptive ideas targeting optimization, agent design, or modeling.")