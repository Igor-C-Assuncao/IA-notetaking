from pydantic import BaseModel, Field
from typing import List

class ArchitectureIssue(BaseModel):
    file_path: str = Field(description="Path to the audited source file.")
    line_number: int = Field(description="Line number where the violation or anti-pattern was detected.")
    severity: str = Field(description="Severity classification: 'LOW', 'MEDIUM', 'HIGH', or 'BLOCKER'.")
    description: str = Field(description="Detailed explanation of the architectural violation.")
    suggestion: str = Field(description="Actionable mitigation path, complete with code refactoring snippets.")

class ArchitectureInnovation(BaseModel):
    title: str = Field(description="Title of the proposed improvement or design pattern recommendation.")
    concept: str = Field(description="Conceptual rationale explaining how this improves system scalability.")
    implementation_hint: str = Field(description="Technical blueprint or bootstrap guidance for implementation.")

class CodeReviewReport(BaseModel):
    agent_name: str = "Code Reviewer"
    score: int = Field(description="Overall code quality rating graded from 0 to 100.")
    issues: List[ArchitectureIssue] = Field(default=[], description="List of identified architectural issues.")
    innovations: List[ArchitectureInnovation] = Field(default=[], description="List of proactive architectural design ideas.")