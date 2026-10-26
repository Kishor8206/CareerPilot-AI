"""Training pipeline for the placement-readiness classifier (§7).

Run it:
    python -m app.ml.train                      # synthetic data (default)
    python -m app.ml.train --data path/to.csv   # real labelled outcomes
    python -m app.ml.train --model gradient_boosting --samples 5000

Pipeline
--------
load -> validate -> stratified split -> preprocess -> fit -> evaluate ->
cross-validate -> persist model + metrics

Honesty guarantees (§7, §42)
----------------------------
* The dataset's provenance travels with the model and into every metrics
  payload the API returns.
* Metrics are computed on a held-out test set the model never saw. Reporting
  training accuracy would be meaningless, so it is never reported alone.
* Nothing here fabricates a number. If the model is not trained, the API says
  so rather than returning an invented score.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.core.config import settings
from app.core.logging import get_logger
from app.ml.features import CLASS_LABELS, FEATURE_NAMES
from app.ml.synthetic_data import DISCLAIMER as SYNTHETIC_DISCLAIMER
from app.ml.synthetic_data import generate_dataset

log = get_logger(__name__)

MODEL_FILENAME = "readiness_model.joblib"
METRICS_FILENAME = "readiness_metrics.json"

SUPPORTED_MODELS = {
    "random_forest": lambda seed: RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=4,
        # Cohorts are imbalanced; without this the minority bands are ignored.
        class_weight="balanced",
        random_state=seed,
        n_jobs=-1,
    ),
    "gradient_boosting": lambda seed: GradientBoostingClassifier(
        n_estimators=250,
        learning_rate=0.08,
        max_depth=4,
        subsample=0.9,
        random_state=seed,
    ),
}


def load_dataset(path: str | None, samples: int, seed: int) -> tuple[pd.DataFrame, str]:
    """Loads real data if a path is given, otherwise generates synthetic data."""
    if path:
        file = Path(path)
        if not file.exists():
            raise FileNotFoundError(f"Dataset not found: {file}")
        frame = pd.read_csv(file)

        missing = [c for c in (*FEATURE_NAMES, "readinessBand") if c not in frame.columns]
        if missing:
            raise ValueError(
                f"The dataset is missing required column(s): {', '.join(missing)}. "
                f"Expected columns: {', '.join((*FEATURE_NAMES, 'readinessBand'))}"
            )

        # Provenance comes from the file itself; it is never assumed to be REAL.
        provenance = str(frame["provenance"].iloc[0]) if "provenance" in frame.columns else "REAL"
        log.info("Loaded dataset from file", extra={"rows": len(frame), "provenance": provenance})
        return frame, provenance

    log.info("No dataset supplied; generating a synthetic dataset", extra={"rows": samples})
    return generate_dataset(n=samples, seed=seed), "SYNTHETIC"


def build_pipeline(model_name: str, seed: int) -> Pipeline:
    if model_name not in SUPPORTED_MODELS:
        raise ValueError(f"Unknown model '{model_name}'. Choose from: {', '.join(SUPPORTED_MODELS)}")
    return Pipeline(
        steps=[
            # Median imputation: a student with no coding attempts yet has a
            # genuinely missing value, not a zero.
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("classifier", SUPPORTED_MODELS[model_name](seed)),
        ]
    )


def _feature_importance(pipeline: Pipeline) -> list[dict[str, Any]]:
    classifier = pipeline.named_steps["classifier"]
    importances = getattr(classifier, "feature_importances_", None)
    if importances is None:
        return []
    pairs = sorted(
        ({"feature": name, "importance": round(float(value), 5)}
         for name, value in zip(FEATURE_NAMES, importances)),
        key=lambda item: -item["importance"],
    )
    return pairs


def train(
    *,
    data_path: str | None = None,
    model_name: str = "random_forest",
    samples: int = 3000,
    test_size: float = 0.2,
    seed: int | None = None,
    cv_folds: int = 5,
) -> dict[str, Any]:
    seed = settings.ml_random_state if seed is None else seed
    frame, provenance = load_dataset(data_path, samples, seed)

    X = frame[list(FEATURE_NAMES)].to_numpy(dtype=np.float64)
    y = frame["readinessBand"].astype(str).to_numpy()

    present_labels = sorted(set(y))
    unknown = [label for label in present_labels if label not in CLASS_LABELS]
    if unknown:
        raise ValueError(
            f"The dataset contains unknown readiness label(s): {', '.join(unknown)}. "
            f"Valid labels: {', '.join(CLASS_LABELS)}"
        )
    if len(present_labels) < 2:
        raise ValueError("The dataset must contain at least two distinct readiness classes to train a classifier.")

    # Stratified split preserves class balance in both halves.
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=seed, stratify=y
    )

    pipeline = build_pipeline(model_name, seed)
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    labels = [label for label in CLASS_LABELS if label in present_labels]

    report = classification_report(y_test, y_pred, labels=labels, output_dict=True, zero_division=0)
    matrix = confusion_matrix(y_test, y_pred, labels=labels).tolist()

    # Cross-validation on the training split gives a variance estimate that a
    # single train/test split cannot.
    cross_validation: dict[str, Any] | None = None
    min_class_count = int(pd.Series(y_train).value_counts().min())
    folds = min(cv_folds, min_class_count)
    if folds >= 2:
        scores = cross_val_score(
            build_pipeline(model_name, seed),
            X_train,
            y_train,
            cv=StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed),
            scoring="accuracy",
            n_jobs=-1,
        )
        cross_validation = {
            "folds": folds,
            "meanAccuracy": round(float(scores.mean()), 4),
            "stdAccuracy": round(float(scores.std()), 4),
        }

    metrics: dict[str, Any] = {
        "modelVersion": settings.ml_model_version,
        "algorithm": model_name,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "datasetProvenance": provenance,
        "datasetSize": int(len(frame)),
        "trainSize": int(len(X_train)),
        "testSize": int(len(X_test)),
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precisionMacro": round(float(precision_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "recallMacro": round(float(recall_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "f1Macro": round(float(f1_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "perClass": [
            {
                "label": label,
                "precision": round(float(report[label]["precision"]), 4),
                "recall": round(float(report[label]["recall"]), 4),
                "f1": round(float(report[label]["f1-score"]), 4),
                "support": int(report[label]["support"]),
            }
            for label in labels
            if label in report
        ],
        "confusionMatrix": matrix,
        "labels": labels,
        "featureImportance": _feature_importance(pipeline),
        "crossValidation": cross_validation,
        "featureNames": list(FEATURE_NAMES),
        "disclaimer": (
            SYNTHETIC_DISCLAIMER
            if provenance == "SYNTHETIC"
            else "Metrics computed on a held-out test set from the supplied dataset."
        ),
        "evaluationLabel": (
            "Prototype Evaluation - Synthetic Dataset"
            if provenance == "SYNTHETIC"
            else f"Evaluation - {provenance} Dataset"
        ),
    }

    artifacts = settings.artifacts_path
    model_path = artifacts / MODEL_FILENAME
    metrics_path = artifacts / METRICS_FILENAME

    joblib.dump(
        {"pipeline": pipeline, "featureNames": list(FEATURE_NAMES), "labels": labels, "metrics": metrics},
        model_path,
    )
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    log.info(
        "Model trained and persisted",
        extra={
            "accuracy": metrics["accuracy"],
            "f1Macro": metrics["f1Macro"],
            "provenance": provenance,
            "path": str(model_path),
        },
    )
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the CareerPilot AI placement-readiness model.")
    parser.add_argument("--data", default=None, help="Path to a labelled CSV. Omit to use synthetic data.")
    parser.add_argument("--model", default="random_forest", choices=sorted(SUPPORTED_MODELS))
    parser.add_argument("--samples", type=int, default=3000, help="Synthetic sample count (ignored with --data).")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--cv-folds", type=int, default=5)
    args = parser.parse_args()

    from app.core.logging import configure_logging

    configure_logging()

    metrics = train(
        data_path=args.data,
        model_name=args.model,
        samples=args.samples,
        test_size=args.test_size,
        seed=args.seed,
        cv_folds=args.cv_folds,
    )

    print("\n" + "=" * 72)
    print(f"  {metrics['evaluationLabel']}")
    print("=" * 72)
    print(f"  Algorithm     : {metrics['algorithm']}")
    print(f"  Dataset       : {metrics['datasetSize']} rows ({metrics['datasetProvenance']})")
    print(f"  Train / Test  : {metrics['trainSize']} / {metrics['testSize']}")
    print(f"  Accuracy      : {metrics['accuracy']:.4f}")
    print(f"  Precision (M) : {metrics['precisionMacro']:.4f}")
    print(f"  Recall (M)    : {metrics['recallMacro']:.4f}")
    print(f"  F1 (macro)    : {metrics['f1Macro']:.4f}")
    if metrics["crossValidation"]:
        cv = metrics["crossValidation"]
        print(f"  {cv['folds']}-fold CV     : {cv['meanAccuracy']:.4f} (+/- {cv['stdAccuracy']:.4f})")
    print("\n  Top features:")
    for item in metrics["featureImportance"][:6]:
        print(f"    {item['feature']:<24} {item['importance']:.4f}")
    print("\n  Confusion matrix (rows = actual, columns = predicted):")
    print(f"    {'':<22}" + "".join(f"{label[:10]:>12}" for label in metrics["labels"]))
    for label, row in zip(metrics["labels"], metrics["confusionMatrix"]):
        print(f"    {label:<22}" + "".join(f"{value:>12}" for value in row))
    print("\n  " + metrics["disclaimer"])
    print("=" * 72 + "\n")


if __name__ == "__main__":
    main()
