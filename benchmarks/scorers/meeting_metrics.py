from .text_metrics import normalize_text


def _claim_text(claim: dict, keys: tuple[str, ...]) -> str:
    for key in keys:
        if claim.get(key):
            return normalize_text(str(claim[key]))
    return ""


def claim_precision(
    predicted: list[dict],
    reference: list[dict],
    keys: tuple[str, ...],
) -> float:
    if not predicted:
        return 1.0 if not reference else 0.0

    reference_texts = {_claim_text(claim, keys) for claim in reference}
    supported = sum(
        1 for claim in predicted
        if _claim_text(claim, keys) in reference_texts
    )
    return supported / len(predicted)


def explicit_field_accuracy(
    predicted: list[dict],
    reference: list[dict],
    claim_keys: tuple[str, ...],
    field: str,
) -> float:
    reference_by_claim = {
        _claim_text(claim, claim_keys): claim
        for claim in reference
        if claim.get(field)
    }
    if not reference_by_claim:
        return 1.0

    predicted_by_claim = {
        _claim_text(claim, claim_keys): claim
        for claim in predicted
    }
    correct = 0
    for claim_text, reference_claim in reference_by_claim.items():
        predicted_claim = predicted_by_claim.get(claim_text, {})
        if normalize_text(str(predicted_claim.get(field, ""))) == normalize_text(
            str(reference_claim[field])
        ):
            correct += 1
    return correct / len(reference_by_claim)


def evidence_quote_validity(predicted_claims: list[dict], transcript: str) -> float:
    if not predicted_claims:
        return 1.0
    normalized_transcript = normalize_text(transcript)
    valid = sum(
        1 for claim in predicted_claims
        if claim.get("evidence_quote")
        and normalize_text(str(claim["evidence_quote"])) in normalized_transcript
    )
    return valid / len(predicted_claims)


def critical_claim_hallucination_rate(
    predicted_decisions: list[dict],
    predicted_actions: list[dict],
    reference_decisions: list[dict],
    reference_actions: list[dict],
) -> float:
    predicted_count = len(predicted_decisions) + len(predicted_actions)
    if predicted_count == 0:
        return 0.0
    supported = (
        claim_precision(predicted_decisions, reference_decisions, ("decision", "text"))
        * len(predicted_decisions)
        + claim_precision(predicted_actions, reference_actions, ("task", "what"))
        * len(predicted_actions)
    )
    return 1.0 - supported / predicted_count
