"""
Stateless prediction API for the web (Vercel) version of the IFC Funding Estimator.

The desktop app (app.py) keeps budgets and the investment log on disk. Serverless
functions have no persistent disk, so in the web version all of that state lives
in the browser (localStorage) and this API only answers two questions:

  GET  /api/project-types?q=...   -> autocomplete over known business areas
  POST /api/predict               -> predicted quarter ratio for one project

Feature engineering mirrors app.py exactly so predictions match the desktop app.
"""
import os
import re
import sys
import warnings

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from scipy import sparse

warnings.filterwarnings("ignore", category=UserWarning)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL_PATH = os.path.join(ROOT, "models", "ifc_budget_model_hist_v3_blend.joblib")
DEFAULT_FISCAL_YEAR = 2025


def densify_if_sparse(X):
    return X.toarray() if sparse.issparse(X) else X


# The pickled pipeline references __main__.densify_if_sparse (it was trained from a
# script), so it must exist there before unpickling.
setattr(sys.modules["__main__"], "densify_if_sparse", densify_if_sparse)


def normalize_business_area(s) -> str:
    if s is None:
        return ""
    s = str(s).strip().upper()
    s = s.replace("&", " AND ")
    s = re.sub(r"[‐-―]", "-", s)
    s = re.sub(r"[^A-Z0-9\-\/\s:]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s*-\s*", "-", s)
    s = re.sub(r"\s*\/\s*", "/", s)
    s = re.sub(r"\s*:\s*", ":", s)
    return s


def fingerprint(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", normalize_business_area(s))


def yn_to_flag(x) -> int:
    return 1 if str(x).strip().lower() in {"yes", "y", "true", "1"} else 0


def normalize_quarter(q) -> str:
    q = str(q or "Q1").strip().upper()
    return q if q in {"Q1", "Q2", "Q3", "Q4"} else "Q1"


def add_engineered_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["BusinessAreaNorm"] = df["Business Area"].apply(normalize_business_area)
    df["ProjType3"] = df["BusinessAreaNorm"].str.slice(0, 3).fillna("")
    df["ProjType6"] = df["BusinessAreaNorm"].str.slice(0, 6).fillna("")
    df["Sector"] = df["ProjType3"]
    df["ProjRoot"] = df["BusinessAreaNorm"].str.split("-", n=1, expand=True)[0].fillna("")
    df["BA_Text"] = (
        df["BusinessAreaNorm"]
        + " |TYPE3=" + df["ProjType3"]
        + " |TYPE6=" + df["ProjType6"]
        + " |ROOT=" + df["ProjRoot"]
        + " |SECTOR=" + df["Sector"]
    )
    return df


FEATURES = [
    "Quarter", "Region", "Business Area", "ClimateScore", "ClimateFlag", "GenderFlag",
    "BusinessAreaNorm", "ProjType3", "ProjType6", "ProjRoot", "Sector", "BA_Text",
]

_bundle = joblib.load(MODEL_PATH)
PIPELINE = _bundle["pipeline"]
ALPHA = float(_bundle.get("alpha", 1.0))
BA_MEAN = _bundle.get("ba_mean", {}) or {}
GLOBAL_MEAN = float(_bundle.get("global_mean", 0.0))

_rows = {}
for k in BA_MEAN:
    n = normalize_business_area(k)
    if n:
        _rows.setdefault(n, {"display": n, "norm": n, "fp": fingerprint(n)})
BA_ROWS = sorted(_rows.values(), key=lambda r: r["display"])
BA_NORM_SET = {r["norm"] for r in BA_ROWS}
BA_FP_SET = {r["fp"] for r in BA_ROWS}


def is_known(ba_norm: str) -> bool:
    return ba_norm in BA_NORM_SET or fingerprint(ba_norm) in BA_FP_SET


def predict(region: int, quarter: str, business_area: str, climate: bool, gender: bool) -> dict:
    ba = normalize_business_area(business_area)
    climate_score = 1.0 if climate else 0.0
    df = pd.DataFrame([{
        "Fiscal Year": DEFAULT_FISCAL_YEAR,
        "Quarter": normalize_quarter(quarter),
        "Region": int(region),
        "Business Area": ba,
        "ClimateScore": climate_score,
        "ClimateFlag": int(climate),
        "GenderFlag": int(gender),
    }])
    X = add_engineered_features(df)[FEATURES]
    pred_ml = float(np.clip(np.expm1(PIPELINE.predict(X))[0], 0, None))
    pred_ba = float(BA_MEAN.get(ba, GLOBAL_MEAN))
    return {
        "project_type": ba,
        "known": is_known(ba),
        "ratio": float(ALPHA * pred_ml + (1.0 - ALPHA) * pred_ba),
        "ratio_model": pred_ml,
        "ratio_history": pred_ba,
        "alpha": ALPHA,
    }


app = Flask(__name__)


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "project_types": len(BA_ROWS)})


@app.get("/api/project-types")
def project_types():
    q_raw = request.args.get("q", "") or ""
    q_norm, q_fp = normalize_business_area(q_raw), fingerprint(q_raw)
    if not q_norm:
        return jsonify({"query": "", "matches": [r["display"] for r in BA_ROWS], "exact": False})

    buckets = (
        [r for r in BA_ROWS if r["norm"].startswith(q_norm)],
        [r for r in BA_ROWS if q_fp and r["fp"].startswith(q_fp)],
        [r for r in BA_ROWS if q_norm in r["norm"]],
        [r for r in BA_ROWS if q_fp and q_fp in r["fp"]],
    )
    matches, seen = [], set()
    for bucket in buckets:
        for r in bucket:
            if r["display"] not in seen:
                seen.add(r["display"])
                matches.append(r["display"])
    return jsonify({"query": q_norm, "matches": matches[:50], "exact": is_known(q_norm)})


@app.post("/api/predict")
def api_predict():
    body = request.get_json(silent=True) or {}
    project_type = str(body.get("project_type", "")).strip()
    if not project_type:
        return jsonify({"error": "project_type is required"}), 400
    try:
        region = int(body.get("region", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "region must be 1-5"}), 400
    if region not in range(1, 6):
        return jsonify({"error": "region must be 1-5"}), 400

    return jsonify(predict(
        region,
        body.get("quarter", "Q1"),
        project_type,
        yn_to_flag(body.get("climate", False)),
        yn_to_flag(body.get("gender", False)),
    ))


if __name__ == "__main__":
    # Local preview: serve the static frontend and the API from one process.
    #   python api/index.py  ->  http://127.0.0.1:5001
    from flask import send_from_directory

    PUBLIC = os.path.join(ROOT, "public")

    @app.get("/")
    def _index():
        return send_from_directory(PUBLIC, "index.html")

    @app.get("/<path:name>")
    def _static(name):
        return send_from_directory(PUBLIC, name)

    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5001)), debug=True)
