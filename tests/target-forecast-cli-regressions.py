"""Independent edge-case regressions; run with Python + openpyxl, outside Node CI."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ASSETS = Path(__file__).resolve().parents[1] / "extensions/analysis-assets"


def load(name, skill, script):
    spec = importlib.util.spec_from_file_location(name, ASSETS / skill / "scripts" / script)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ingest = load("ingest", "target-forecast", "ingest.py")
forecast = load("forecast", "target-forecast", "forecast.py")
template = load("forecast_template", "target-forecast", "template.py")
coupon = load("coupon", "coupon-forecast", "coupon.py")
roi = load("roi", "roi-forecast", "roi.py")
bucket = load("coupon_bucket", "coupon-forecast", "bucket.py")
coupon_template = load("coupon_template", "coupon-forecast", "template.py")


class ForecastRegressions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def cli(self, skill, script, *args, isolated=False):
        return subprocess.run([sys.executable, "-B", *(["-S"] if isolated else []),
                               str(ASSETS / skill / "scripts" / script), *map(str, args)],
                              cwd=self.root, capture_output=True, text=True)

    def test_ingest_digest_changes_with_cells_and_caliber(self):
        from openpyxl import load_workbook
        template.generate(str(self.root))
        source = self.root / "目标测算_订单明细模板.xlsx"
        args = ("detail", "--input", source, "--platform", "测试")
        before = json.loads(self.cli("target-forecast", "ingest.py", *args).stdout)
        self.assertEqual(before, json.loads(self.cli("target-forecast", "ingest.py", *args).stdout))
        wb = load_workbook(source)
        wb.active["G2"] = 999
        wb.save(source)
        after = json.loads(self.cli("target-forecast", "ingest.py", *args).stdout)
        self.assertNotEqual(before["input_digest"], after["input_digest"])
        caliber = self.root / "caliber.json"
        caliber.write_text('{"new_customer_window_days": 30}')
        changed = json.loads(self.cli("target-forecast", "ingest.py", *args, "--caliber", caliber).stdout)
        self.assertNotEqual(after["input_digest"], changed["input_digest"])

    def test_blocker_keeps_physical_excel_row_after_blank(self):
        from openpyxl import load_workbook
        template.generate(str(self.root))
        source = self.root / "目标测算_订单明细模板.xlsx"
        wb = load_workbook(source)
        wb.active.insert_rows(2)
        wb.active["G4"] = -1
        wb.save(source)
        result = self.cli("target-forecast", "ingest.py", "detail", "--input", source)
        self.assertEqual(result.returncode, 1)
        self.assertIn("第 4 行", result.stderr)

    def test_coupon_import_has_content_bound_identity(self):
        from openpyxl import load_workbook
        coupon_template.generate(str(self.root))
        source = self.root / "优惠券测算_订单明细模板.xlsx"
        before = bucket.import_file(str(source))
        self.assertEqual(before["engine_version"], coupon.ENGINE_VERSION)
        wb = load_workbook(source)
        wb.active["B2"] = 12345
        wb.save(source)
        after = bucket.import_file(str(source))
        self.assertNotEqual(before["input_digest"], after["input_digest"])

    def test_months_are_validated_and_normalized(self):
        row = {"月份": "202501", "新客数": 1, "新客客单": 1, "老客数": 0,
               "老客复购频次": 1, "老客客单": 1}
        self.assertEqual(ingest.validate_agg_rows([row], "测试")[0][0]["month"], "2025-01")
        for bad in ("2025-13", "2025-xx"):
            with self.subTest(bad=bad), self.assertRaises(ingest.BlockerError) as error:
                ingest.validate_agg_rows([{**row, "月份": bad}], "测试")
            self.assertIn("第 2 行", str(error.exception))

    def test_partial_uv_cannot_inflate_main_gmv(self):
        monthly = [{"platform": "P", "month": month, "gmv": 10000., "orders": 100.,
                    "units": None, "buyers": 100., "uv": uv, "new_customers": 100.,
                    "new_gmv": 10000., "new_orders": 100., "old_customers": 0.,
                    "old_gmv": 0., "old_orders": 0.}
                   for month, uv in [("2025-01", 1000.), ("2025-02", None)]]
        scenarios = {"基准": {key: 0 for key in ("new_customers_growth", "new_arpu_growth",
                     "old_customers_growth", "old_freq_growth", "old_aov_growth",
                     "uv_growth", "cvr_growth", "aov_growth")}}
        result = forecast.run({"platforms": {"P": {"unified": monthly}}, "scenarios": scenarios})
        platform = result["result"]["platforms"]["P"]
        self.assertEqual(platform["main_view"], "人")
        self.assertIsNone(platform["field"])
        self.assertEqual(platform["coverage"]["uv_missing_months"], ["2025-02"])
        self.assertAlmostEqual(sum(row["GMV_主口径"] for row in result["result"]["consolidated"]), 120000.)

    def test_manual_coupon_candidates_always_include_no_coupon(self):
        data = copy.deepcopy(coupon.SCENARIO_TEMPLATE)
        data["candidates"] = [{"enabled": True, "threshold_cents": 15900,
                               "face_value_cents": 500, "label": "唯一候选"}]
        original = copy.deepcopy(data)
        result = coupon.compare(coupon.load_spec(data))
        self.assertEqual(sum(not row["candidate"]["enabled"] for row in result["rows"]), 1)
        self.assertEqual(data, original)

    def test_stress_digest_binds_scenario_contents(self):
        source, variants = self.root / "scenario.json", self.root / "variants.json"
        variants.write_text('{"same":{}}')
        source.write_text(json.dumps(coupon.SCENARIO_TEMPLATE))
        args = ("stress", "--input", source, "--variants", variants)
        before = self.cli("coupon-forecast", "coupon.py", *args)
        self.assertEqual(before.returncode, 0, before.stderr)
        data = copy.deepcopy(coupon.SCENARIO_TEMPLATE)
        data["baseline"]["visitors"] += 1
        source.write_text(json.dumps(data))
        after = self.cli("coupon-forecast", "coupon.py", *args)
        self.assertEqual(after.returncode, 0, after.stderr)
        self.assertNotEqual(json.loads(before.stdout)["input_digest"], json.loads(after.stdout)["input_digest"])

    def test_roi_stability_uses_unrounded_sign(self):
        plan = {"name": "near", "spend_cny": 100, "cpc_cny": 1, "cvr": .5,
                "aov_cny": 4, "gross_margin": .5, "refund_rate": 0}
        result = roi.evaluate([plan], {"tiny_loss": {"cvr_growth": -.000001},
                                       "tiny_profit": {"cvr_growth": .000001}})
        self.assertFalse(result["stability"]["near"]["stable"])

    def test_roi_invalid_values_name_the_field(self):
        plan = {"name": "near", "spend_cny": 100, "cpc_cny": 1, "cvr": .5,
                "aov_cny": 4, "gross_margin": .5, "refund_rate": 0}
        for field, value in [("spend_cny", "oops"), ("cpc_cny", float('inf'))]:
            with self.subTest(field=field), self.assertRaises(roi.PlanError) as error:
                roi.evaluate([{**plan, field: value}], {"base": {}})
            self.assertIn(field, str(error.exception))
        for field, value in [("aov_growth", -1), ("cvr_growth", -2)]:
            with self.subTest(field=field), self.assertRaises(roi.PlanError) as error:
                roi.evaluate([plan], {"bad": {field: value}})
            self.assertIn(field.split('_')[0], str(error.exception))

    def test_coupon_rejects_impossible_topup_probability(self):
        data = copy.deepcopy(coupon.SCENARIO_TEMPLATE)
        data["behavior"]["q_mode"] = "table"
        data["behavior"]["q_table"] = [{"gap_max": None, "ftr_max": None, "q": 2}]
        with self.assertRaises(coupon.SpecError):
            coupon.compare(coupon.load_spec(data))

    def test_coupon_rejects_negative_new_basket_weights(self):
        data = copy.deepcopy(coupon.SCENARIO_TEMPLATE)
        basket = data["behavior"]["new_basket"][0]
        data["behavior"]["new_basket"] = [{**basket, "weight": -1}, {**basket, "weight": 2}]
        with self.assertRaises(coupon.SpecError):
            coupon.compare(coupon.load_spec(data))

    def test_coupon_sensitivity_groups_actual_parameters(self):
        result = coupon.stress_test(coupon.load_spec(coupon.SCENARIO_TEMPLATE), {
            "low": {"behavior.conversion.k": .3},
            "high": {"behavior.conversion.k": 1.4},
            "joint": {"behavior.conversion.k": .3, "behavior.churn": .1},
        })
        self.assertEqual([row["param"] for row in result["single_factor"]], ["behavior.conversion.k"])
        self.assertEqual(len(result["single_factor"][0]["delta_pi_values_cents"]), 3)

    def test_coupon_distinguishes_all_four_conclusions(self):
        cases = []
        data = copy.deepcopy(coupon.SCENARIO_TEMPLATE)
        cases.append((copy.deepcopy(data), "needs_validation"))
        data["evidence_status"] = "experiment_validated"
        cases.append((copy.deepcopy(data), "feasible"))
        data["constraints"]["merchant_coupon_budget_cents"] = 0
        cases.append((copy.deepcopy(data), "no_feasible_coupon"))
        data["candidates"] = [{"enabled": True, "threshold_cents": 100, "face_value_cents": 200}]
        cases.append((data, "invalid_comparison"))
        for data, expected in cases:
            with self.subTest(expected=expected):
                result = coupon.compare(coupon.load_spec(data))
                self.assertEqual(result["conclusion"]["type"], expected)
                self.assertTrue(any(not row["candidate"]["enabled"] for row in result["rows"]))

    def test_ingest_rejects_missing_identity_and_invalid_numbers(self):
        from openpyxl import load_workbook
        template.generate(str(self.root))
        source = self.root / "目标测算_订单明细模板.xlsx"
        for column in ("B", "C", "D"):
            wb = load_workbook(source)
            old = wb.active[f"{column}2"].value
            wb.active[f"{column}2"] = None
            wb.save(source)
            with self.subTest(column=column), self.assertRaises(ingest.BlockerError):
                ingest.ingest_detail(str(source), "测试", {})
            wb.active[f"{column}2"] = old
            wb.save(source)
        row = {"月份": "2025-01", "新客数": 1, "新客客单": 1, "老客数": 0,
               "老客复购频次": 1, "老客客单": 1}
        for field, value in [("新客数", -1), ("UV", -1), ("转化率", 0), ("新客客单", float('nan'))]:
            with self.subTest(field=field), self.assertRaises(ingest.BlockerError):
                ingest.validate_agg_rows([{**row, field: value}], "测试")

    def test_xlsx_scripts_explain_missing_dependency(self):
        for skill, script, args in [
            ("target-forecast", "ingest.py", ["detail", "--input", "unused.xlsx"]),
            ("target-forecast", "template.py", ["--out-dir", str(self.root)]),
            ("coupon-forecast", "bucket.py", ["--input", "unused.xlsx"]),
            ("coupon-forecast", "template.py", ["--out-dir", str(self.root)]),
        ]:
            with self.subTest(skill=skill, script=script):
                result = self.cli(skill, script, *args, isolated=True)
                self.assertEqual(result.returncode, 1)
                self.assertIn("pip install -r", result.stderr)
                self.assertNotIn("Traceback", result.stderr)

    def test_forecast_is_canonical_for_object_key_order(self):
        data = json.loads((ASSETS / "target-forecast/scripts/golden/engine-expected.json").read_text())["input"]
        shuffled = copy.deepcopy(data)
        for field in ("platforms", "scenarios"):
            shuffled[field] = dict(reversed(list(shuffled[field].items())))
        canonical = lambda result: json.dumps(result, sort_keys=True, ensure_ascii=False)
        self.assertEqual(canonical(forecast.run(data)), canonical(forecast.run(shuffled)))


if __name__ == "__main__":
    unittest.main()
