#!/usr/bin/env python3
import argparse
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from scorers import (
    character_error_rate,
    claim_precision,
    critical_claim_hallucination_rate,
    evidence_quote_validity,
    explicit_field_accuracy,
    word_error_rate,
)


ROOT = Path(__file__).resolve().parent


def load_simple_yaml(path: Path) -> dict:
    """Parse the benchmark's mapping-only YAML without adding a dependency."""
    result = {}
    section = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith(" "):
            key, value = line.split(":", 1)
            if value.strip():
                result[key] = parse_scalar(value.strip())
                section = None
            else:
                section = key
                result[section] = {}
            continue
        key, value = line.strip().split(":", 1)
        result[section][key] = parse_scalar(value.strip())
    return result


def parse_scalar(value: str):
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        return float(value) if "." in value else int(value)
    except ValueError:
        return value.strip("\"'")


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT.parent,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return "unknown"


def mean(values: list[float], default: float = 0.0) -> float:
    return sum(values) / len(values) if values else default


def score_fixture(fixture: dict) -> dict:
    reference = fixture.get("reference", {})
    predicted = fixture.get("predicted", {})
    reference_summary = reference.get("structured", {})
    predicted_summary = predicted.get("structured", {})

    reference_decisions = reference_summary.get("key_decisions", [])
    predicted_decisions = predicted_summary.get("key_decisions", [])
    reference_actions = reference_summary.get("action_items", [])
    predicted_actions = predicted_summary.get("action_items", [])
    predicted_claims = predicted_decisions + predicted_actions

    reference_transcript = reference.get("transcript", "")
    predicted_transcript = predicted.get("transcript", "")
    completion = bool(
        predicted_transcript
        and predicted.get("pipeline_completed", True)
        and predicted_summary
    )

    return {
        "fixture_id": fixture["fixture_id"],
        "wer": word_error_rate(reference_transcript, predicted_transcript),
        "cer": character_error_rate(reference_transcript, predicted_transcript),
        "decision_precision": claim_precision(
            predicted_decisions, reference_decisions, ("decision", "text")
        ),
        "action_item_precision": claim_precision(
            predicted_actions, reference_actions, ("task", "what")
        ),
        "explicit_assignee_accuracy": explicit_field_accuracy(
            predicted_actions,
            reference_actions,
            ("task", "what"),
            "assignee",
        ),
        "evidence_quote_validity": evidence_quote_validity(
            predicted_claims, reference_transcript
        ),
        "critical_claim_hallucination_rate": critical_claim_hallucination_rate(
            predicted_decisions,
            predicted_actions,
            reference_decisions,
            reference_actions,
        ),
        "pipeline_completion_rate": 1.0 if completion else 0.0,
        "speaker_attribution_accuracy": fixture.get("automated_metrics", {}).get(
            "speaker_attribution_accuracy"
        ),
        "human_factuality": fixture.get("human_review", {}).get("factuality"),
        "human_usefulness": fixture.get("human_review", {}).get("usefulness"),
    }


def aggregate(fixtures: list[dict], weights: dict) -> dict:
    def metric(name: str, default=None):
        values = [row[name] for row in fixtures if row.get(name) is not None]
        return mean(values) if values else default

    transcription = max(0.0, 1.0 - metric("wer", 1.0))
    speaker_attribution = metric("speaker_attribution_accuracy")
    human_scores = [
        value / 5.0
        for value in (metric("human_factuality"), metric("human_usefulness"))
        if value is not None
    ]
    summary = mean(
        human_scores,
        default=metric("evidence_quote_validity", 0.0),
    )
    decisions_actions = mean([
        metric("decision_precision"),
        metric("action_item_precision"),
        metric("explicit_assignee_accuracy"),
        metric("evidence_quote_validity"),
    ])
    robustness = metric("pipeline_completion_rate")
    categories = {
        "transcription": transcription,
        "speaker_attribution": speaker_attribution,
        "summary": summary,
        "decisions_actions": decisions_actions,
        "robustness_performance": robustness,
    }
    available_weights = {
        name: float(weight)
        for name, weight in weights.items()
        if categories.get(name) is not None
    }
    weight_total = sum(available_weights.values())
    weighted = (
        sum(categories[name] * weight for name, weight in available_weights.items())
        / weight_total
        if weight_total else 0.0
    )
    return {
        "metrics": {
            name: metric(name) for name in (
                "wer",
                "cer",
                "decision_precision",
                "action_item_precision",
                "explicit_assignee_accuracy",
                "evidence_quote_validity",
                "critical_claim_hallucination_rate",
                "pipeline_completion_rate",
                "speaker_attribution_accuracy",
                "human_factuality",
                "human_usefulness",
            )
        },
        "category_scores": categories,
        "weighted_overall_score": weighted,
    }


def evaluate_thresholds(metrics: dict, thresholds: dict) -> dict:
    results = {}
    for name, expected in thresholds.items():
        if name.endswith("_max"):
            metric_name = name.removesuffix("_max")
            actual = metrics.get(metric_name)
            passed = actual is not None and actual <= expected
        elif name.endswith("_min"):
            metric_name = name.removesuffix("_min")
            actual = metrics.get(metric_name)
            passed = actual is not None and actual >= expected
        else:
            metric_name = name
            actual = metrics.get(metric_name)
            passed = actual is not None and actual >= expected
        results[name] = {"actual": actual, "expected": expected, "passed": passed}
    return results


def write_summary(path: Path, report: dict) -> None:
    lines = [
        "# Benchmark Summary",
        "",
        f"- Run: `{report['run_id']}`",
        f"- Git commit: `{report['git_commit']}`",
        f"- Fixtures: {report['fixture_count']}",
        f"- Weighted score: {report['aggregate']['weighted_overall_score']:.3f}",
        f"- Release gates: {'PASS' if report['release_passed'] else 'FAIL'}",
        "",
        "## Metrics",
        "",
    ]
    lines.extend(
        f"- {name}: {value:.3f}" if value is not None else f"- {name}: not measured"
        for name, value in report["aggregate"]["metrics"].items()
    )
    lines.extend(["", "## Release Gates", ""])
    lines.extend(
        f"- {'PASS' if gate['passed'] else 'FAIL'} {name}: "
        f"{gate['actual']} (target {gate['expected']})"
        for name, gate in report["release_gates"].items()
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Score prepared meeting benchmark fixtures.")
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="JSON file containing a fixtures array with reference and predicted output.",
    )
    parser.add_argument("--output-dir", type=Path, default=ROOT / "reports")
    args = parser.parse_args()

    config = load_simple_yaml(ROOT / "config.yaml")
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    fixtures = payload["fixtures"] if isinstance(payload, dict) else payload
    scored = [score_fixture(fixture) for fixture in fixtures]
    aggregate_result = aggregate(scored, config["weights"])
    gates = evaluate_thresholds(aggregate_result["metrics"], config["thresholds"])

    started_at = datetime.now(timezone.utc)
    run_id = f"{started_at.strftime('%Y-%m-%d_%H%M%S')}_{git_sha()}"
    run_dir = args.output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    report = {
        "run_id": run_id,
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": git_sha(),
        "python": sys.version,
        "platform": platform.platform(),
        "schema_version": payload.get("schema_version", 2) if isinstance(payload, dict) else 2,
        "fixture_count": len(scored),
        "fixtures": scored,
        "aggregate": aggregate_result,
        "release_gates": gates,
        "release_passed": all(gate["passed"] for gate in gates.values()),
    }
    (run_dir / "run.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_summary(run_dir / "summary.md", report)
    print(run_dir)
    return 0 if report["release_passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
