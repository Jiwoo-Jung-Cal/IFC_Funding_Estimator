"""Exercise the review workflow using temporary local state, never real records."""

import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings

import numpy as np
from sklearn.exceptions import InconsistentVersionWarning

import app as estimator


class FundingWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        patches = [
            patch.object(estimator, "LOG_PATH", str(directory / "log.csv")),
            patch.object(estimator, "BUDGETS_PATH", str(directory / "budgets.json")),
            patch.object(estimator, "investment_log", []),
        ]
        for replacement in patches:
            replacement.start()
            self.addCleanup(replacement.stop)
        self.client = estimator.app.test_client()
        estimator.app.config["TESTING"] = True

    def set_budget(self, amount):
        response = self.client.post("/set_budgets", data={"budget_1": amount})
        self.assertEqual(response.status_code, 302)

    def confirm(self, amount):
        return self.client.post("/confirm", data={
            "region": "1", "quarter": "Q1", "project_type": "DEMO",
            "invested": amount, "climate": "No", "gender": "No",
        })

    def test_real_model_estimate_leaves_log_unchanged_until_confirmation(self):
        # The existing pickle references a function in the training entry point.
        # Direct `python app.py` defines it there; unittest needs the same alias.
        with patch.object(sys.modules["__main__"], "densify_if_sparse",
                          estimator.densify_if_sparse, create=True):
            with warnings.catch_warnings():
                warnings.simplefilter("error", InconsistentVersionWarning)
                estimator.load_model()
        self.set_budget("100000")
        self.assertEqual(self.client.get("/").status_code, 200)
        project_type = estimator._ba_display_list[0]
        response = self.client.post("/estimate", data={
            "region": "1", "quarter": "Q1", "project_type": project_type,
            "climate_yn": "No", "gender_yn": "No",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(estimator.investment_log, [])
        self.assertEqual(self.confirm("1000").status_code, 302)
        self.assertEqual(estimator.compute_remaining(
            estimator.load_budgets(), estimator.investment_log)["1"], 99000)

    def test_confirm_and_edit_cannot_exceed_remaining_regional_budget(self):
        self.set_budget("100")
        self.confirm("30")
        self.confirm("1000")
        self.assertEqual([r["Invested"] for r in estimator.investment_log], [30, 70])
        response = self.client.post("/update_entry", data={
            "id": estimator.investment_log[0]["id"], "invested": "500",
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(sum(r["Invested"] for r in estimator.investment_log), 100)

    def test_nonfinite_money_cannot_poison_budget_or_log(self):
        for invalid in ["nan", "NaN", "inf", "-inf", "1e309"]:
            with self.subTest(value=invalid):
                self.set_budget(invalid)
                self.assertEqual(estimator.load_budgets()["1"], 0)
                self.set_budget("100")
                self.confirm(invalid)
                self.assertTrue(all(math.isfinite(r["Invested"])
                                    for r in estimator.investment_log))
                self.assertEqual(estimator.investment_log[-1]["Invested"], 0)

    def test_distribution_preserves_cents_and_requires_confirmation(self):
        self.set_budget("100")
        self.confirm("10")
        self.confirm("20")
        data = {"dist_region": "1", "dist_quarter": "Q1",
                "dist_amount_mode": "custom", "dist_custom_amount": "0.01"}
        self.assertEqual(self.client.post("/distribute_preview", data=data).status_code, 200)
        self.assertEqual(sum(r["Invested"] for r in estimator.investment_log), 30)
        self.assertEqual(self.client.post("/distribute_confirm", data=data).status_code, 302)
        self.assertEqual(sum(round(r["Invested"] * 100)
                             for r in estimator.investment_log), 3001)
        parts = estimator.distribute_amount_cents(0.02, np.array([1/3, 1/3, 1/3]))
        self.assertEqual(sum(round(part * 100) for part in parts), 2)

    def test_state_roundtrip_and_csv_export(self):
        self.set_budget("100")
        self.confirm("12.34")
        expected_id = estimator.investment_log[0]["id"]
        estimator.investment_log.clear()
        estimator.load_log()
        self.assertEqual(estimator.investment_log[0]["id"], expected_id)
        self.assertEqual(estimator.investment_log[0]["Invested"], 12.34)
        response = self.client.get("/download")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"12.34", response.data)
        self.assertIn("attachment", response.headers["Content-Disposition"])


if __name__ == "__main__":
    unittest.main()
