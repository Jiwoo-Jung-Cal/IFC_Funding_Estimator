# IFC Funding Estimator

A local Python/Flask prototype for estimating project funding from historical investment data, reviewing recommendations against regional budgets, and recording confirmed allocations.

**Project context:** IB Computer Science Internal Assessment product, as documented in the original repository. Predictions support a person's review; they are not approved funding decisions.

## What to review

| Component | Entry point | What it demonstrates |
| --- | --- | --- |
| Application and budget controls | [app.py](app.py) | Estimate → review → confirm, remaining regional budgets, editing, distribution previews and CSV export |
| Model training | [predict_hist_v3.py](predict_hist_v3.py) | Feature engineering, histogram gradient boosting, cross-validation and blending with business-area averages |
| Browser interface | [templates/index.html](templates/index.html) | Local Flask/Jinja workflow and searchable project types |
| Regression checks | [tests/test_workflow.py](tests/test_workflow.py) | Real-model estimation, budget caps, finite monetary inputs and cent-preserving distribution |

## Run from source

Use **Python 3.11 or 3.12**. The commands below assume a terminal in this repository's root. The source runtime uses **scikit-learn 1.7.2**, matching the bundled model. Installing a different version can break model loading or prediction.

### Windows PowerShell

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

If Python 3.11 is installed instead, use `py -3.11` in the first command.

### macOS / Linux

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Open **http://127.0.0.1:5001** if a browser does not open automatically. Stop with Ctrl+C in the terminal or the application's Quit action. Run `app.py` directly: it initializes the model and local log before starting the server; `flask run` does not perform that initialization.

The model is already included at `models/ifc_budget_model_hist_v3_blend.joblib`; retraining is unnecessary for the demo. Only load serialized models from sources you trust.

## Five-minute walkthrough

Use fictional values for this local demonstration:

1. Set Region 1's budget to **100,000** and save it. The other regions can remain zero.
2. Select Region 1, Q1, and a business area from the application's suggestions. Choose the climate and gender flags, then generate an estimate.
3. Inspect the recommendation and remaining budget. Estimating alone does not create an investment record.
4. Confirm an investment of **1,000**. Region 1's remaining budget becomes **99,000**.
5. Edit the investment, inspect a distribution preview, or download the CSV log. Previewing a distribution does not apply it until confirmation.
6. Use **Clear All** only when you want to erase your local demo log and budgets.

## How it works

The training script normalizes business-area text and creates categorical, text and climate/gender features. Its target is a project's share of its fiscal-year/quarter's total requested budget, transformed with `log1p`. A histogram gradient-boosting pipeline is blended with historical business-area mean shares.

The application applies the predicted share to the selected region's remaining budget and caps an individual recommendation at that remaining amount. Confirmation and edit handlers also cap the entered allocation. Distribution uses existing investments as weights and assigns rounding remainders in cents.

Budget state is regional, not a separate ledger for each quarter. The fiscal-year feature defaults to **2025** in the current application. The climate/gender flags are model inputs; the web workflow does **not** enforce the separate minimum climate/gender-share demonstration in the training script.

## Data and local state

- [data.csv](data.csv) is the existing semicolon-delimited training input. Data origin, permission to redistribute and representativeness need to be established separately; inclusion in this repository is not a provenance certificate.
- `investment_log.csv` and `regional_budgets.json` hold mutable local application state. The repository starts with an empty log and budget object. Demo actions change these files; do not commit real investment records or operational budgets.
- Calculations run locally. Dependency installation requires internet; inference uses the included model. There is no external inference API or API-key setup.

## Checks

After installing the runtime dependencies:

```sh
python -m unittest discover -s tests -v
```

Use your virtual environment's Python executable, as in the setup commands. Tests use temporary state files and do not change your investment log or budgets. A model-loading test adapts the bundled artifact's legacy `__main__.densify_if_sparse` reference for the test runner; normal direct application startup already supplies that function.

To retrain, run `python predict_hist_v3.py` from the repository root. This performs 120 tuning configurations and repeated cross-validation, can take substantial time, and **overwrites the bundled model**. Commit or back up the original artifact before intentionally retraining. This cleanup does not retrain the model or introduce new accuracy claims.

## Limits and packaging

This is a single-user local prototype using Flask's development server and CSV/JSON persistence. It has no multi-user authentication, database transactions, or tamper-evident audit history; editing/deleting a log entry replaces its recorded state. Keep it bound to the loopback address. Cross-validation in the training script is not independent evidence of future funding performance; time-aware evaluation, data provenance and outcome validation remain follow-up work.

The repository contains a PyInstaller spec and platform packaging requirements. Ready-made `.exe` and `.dmg` installers are **not included in the source tree**. Use the source instructions above; native installer builds and Windows/macOS runtime behavior require separate verification.
