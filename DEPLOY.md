# Deploying the IFC Funding Estimator to Vercel — instructions for an AI agent

These steps deploy the **web version** (`public/` + `api/index.py`) to Vercel using the
Vercel CLI, non-interactively. Follow them in order and run the checks at the end.
Do not modify the desktop app (`app.py`, `templates/`, `*.spec`, `requirements-*.txt`).

## 0. What you are deploying

| Path | Role on Vercel |
|---|---|
| `public/` | Static frontend (served by the CDN; `outputDirectory` in `vercel.json`) |
| `api/index.py` | Python serverless function exposing a Flask `app` |
| `models/ifc_budget_model_hist_v3_blend.joblib` | Trained model, bundled into the function via `includeFiles` |
| `requirements.txt` | Python dependencies for the function |
| `vercel.json` | Framework = none, output dir, function config, `/api/*` rewrite |
| `.vercelignore` | Keeps desktop-only files (incl. root `app.py`) out of the upload |

The function is stateless. Budgets and the investment log live in the user's browser,
so **no database, environment variables, or storage are needed**.

## 1. Prerequisites

- Node.js 18+ (for `npx vercel`).
- A Vercel access token, created by the human at https://vercel.com/account/tokens.
  Provide it to the agent as the environment variable `VERCEL_TOKEN`.
  **Never print the token, commit it, or put it in a file in the repo.**
- Network access to `vercel.com`, `api.vercel.com` and `*.vercel.app`
  (sandboxed agents often need these hosts allowed explicitly).
- Optional: `VERCEL_SCOPE` = the team slug, if deploying under a team instead of a
  personal account.

If `VERCEL_TOKEN` is missing, stop and ask the human for it. Do not try to run
`vercel login`, because it needs an interactive browser.

## 2. Get the code

```bash
git clone https://github.com/Jiwoo-Jung-Cal/IFC_Funding_Estimator.git
cd IFC_Funding_Estimator
git checkout web-ui-vercel   # or main, once the branch has been merged
```

Confirm these files exist before continuing: `vercel.json`, `requirements.txt`,
`api/index.py`, `public/index.html`, `models/ifc_budget_model_hist_v3_blend.joblib`.

## 3. (Recommended) Smoke-test locally

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python api/index.py &          # serves UI + API on http://127.0.0.1:5001
sleep 5
curl -s http://127.0.0.1:5001/api/health
# expect: {"ok": true, "project_types": 94}
kill %1
```

## 4. Link and deploy

Use `--yes` and `--token` everywhere so nothing prompts. Add `--scope "$VERCEL_SCOPE"`
to every command if a team scope is set.

```bash
# Create/link the project (writes .vercel/, which is git-ignored)
npx --yes vercel@latest link --yes --project ifc-funding-estimator --token "$VERCEL_TOKEN"

# Production deploy; prints the deployment URL on stdout
npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" | tee /tmp/vercel-url.txt
```

Do not pass build or framework overrides on the command line, because `vercel.json`
already sets them. The first build takes a few minutes while it installs
scikit-learn, scipy, pandas and numpy.

To deploy a preview instead of production, omit `--prod`.

### Alternative: Git integration (no CLI token in the agent)

If the human prefers, they can import the repo at https://vercel.com/new, leave all
settings at their defaults, and pick the branch. Every push then redeploys
automatically. In that case the agent's job is only to push commits and run step 5
against the URL the human provides.

## 5. Verify the deployment (required)

```bash
URL="$(tail -n1 /tmp/vercel-url.txt)"   # e.g. https://ifc-funding-estimator.vercel.app

# 1. Static page loads
curl -s -o /dev/null -w "%{http_code}\n" "$URL/"                 # expect 200

# 2. Function boots and loaded the model
curl -s "$URL/api/health"                                        # expect {"ok":true,"project_types":94}

# 3. Autocomplete works
curl -s "$URL/api/project-types?q=mas%20health" | head -c 300    # expect MAS-HEALTH-... matches

# 4. Prediction matches the reference value
curl -s -X POST "$URL/api/predict" -H 'Content-Type: application/json' \
  -d '{"region":2,"quarter":"Q3","project_type":"MAS-Health-Health Other","climate":true,"gender":false}'
# expect "ratio": 0.026833657508... and "known": true
```

All four checks must pass. If check 4 returns a different ratio, the scikit-learn
version is wrong (see Troubleshooting). If preview deployments return 401, Vercel
Deployment Protection is on. Test against the production URL, or ask the human to
disable protection for previews.

Finally, open `$URL` in a headless browser if one is available. Set a budget, run an
estimate, and confirm a recommended amount appears with no console errors.

## 6. Report back

Tell the human:
- The production URL.
- The results of the four checks.
- That user data (budgets and log) is stored per browser, and that **Export** is the
  way to keep or move it.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `AttributeError: Can't get attribute 'densify_if_sparse' on <module '__main__'>` | The model pickle references `__main__.densify_if_sparse`. `api/index.py` registers it before loading. Make sure that code wasn't removed or moved below `joblib.load`. |
| `InconsistentVersionWarning` or different predictions | scikit-learn must be **1.7.2** (the training version). Keep the pin in `requirements.txt`. |
| `FileNotFoundError` for the `.joblib` model | `includeFiles: "models/**"` is missing from `vercel.json`, or `models/` was added to `.vercelignore`. |
| The build uses root `app.py` / Flask "framework" detection | Keep `"framework": null` in `vercel.json` and `app.py` listed in `.vercelignore`. |
| Function exceeds the bundle size limit | Dependencies are about 220 MB unzipped. If Vercel rejects the bundle, don't drop scikit-learn or scipy, because the model needs them. Report the exact error to the human instead. |
| `/api/...` returns 404 | Check that the rewrite `{"source": "/api/(.*)", "destination": "/api/index"}` is still in `vercel.json`. |
| Cold start of about 5–10 s on the first request | Expected, because loading pandas, scikit-learn and the model takes time. Later requests are fast. |
| CLI hangs on a prompt | A `--yes` or `--token` flag was missed. Never run `vercel` without them. |

## Things an agent must not do

- Don't commit `.vercel/`, tokens, or any secrets.
- Don't change model files, the feature-engineering code, or the scikit-learn pin to
  "fix" a build. Report the error to the human instead.
- Don't delete or rewrite the desktop application files.
