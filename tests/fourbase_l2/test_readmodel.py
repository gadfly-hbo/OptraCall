"""D12 behavior tests against native Semantica persistence and mutable authority."""
import copy
import hashlib
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from scripts.fourbase_l2.identity import canonical, claim_id, edge_id, ref_identity, stable_id
from scripts.fourbase_l2.readmodel import SnapshotError, SnapshotStore

METRICS = ("terminal_sales_amount", "retail_refund_amount", "net_retail_sales")


class Authority:
    def __init__(self):
        self.states = {}
        self.calls = 0

    def check_many(self, refs):
        self.calls += 1
        result = []
        for ref in refs:
            state = self.states.get(canonical(ref_identity(ref)), "available")
            result.append({"state": state, "gaps": [] if ref.get("publishedHash") else ["hash-not-declared"]})
        return result


def metadata(refs=None, locator="/definition", **extra):
    return {"sourceRefs": refs or [], "buildSources": [{"inputKey": "design", "locator": locator}],
            "claimKind": "source-projection", "conditions": [], "limitations": [],
            "businessTime": [], **extra}


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="core-readmodel-")
        self.addCleanup(self.tmp.cleanup)
        self.run = Path(self.tmp.name)
        (self.run / "inputs").mkdir()
        data = b'{"definition":"synthetic definition","other":"synthetic alternative"}\n'
        (self.run / "inputs/design.json").write_bytes(data)
        self.inputs = [{"inputKey": "design", "relativePath": "inputs/design.json",
                        "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                        "nature": "engineering-design"}]
        self.authority = Authority()
        self.store = SnapshotStore(self.run, self.authority)
        self.refs = [{"kind": "sap", "packageId": "optracall-sc01s-retail", "version": "0.1.0",
                      "metricName": metric, "publishedHash": "a" * 64} for metric in METRICS]
        self.method = {"kind": "sap-method", "methodId": "d2b38008-b764-4b62-9933-ad7f2d72ec88", "version": 1, "publishedHash": "b" * 64}
        self.nodes = []
        self.edges = []
        for ref in self.refs:
            concept = stable_id("MetricConcept", ["metric-concept", ref["packageId"], ref["metricName"]])
            version = stable_id("MetricVersion", ref_identity(ref))
            self.nodes.extend([
                {"id": concept, "type": "MetricConcept", "content": "Synthetic concept " + ref["metricName"], "metadata": metadata([ref])},
                {"id": version, "type": "MetricVersion", "content": "Synthetic definition " + ref["metricName"], "metadata": metadata([ref])}])
            self.edges.append(self.edge(version, concept, "version_of", metadata([ref])))
        self.method_id = stable_id("MethodVersion", ref_identity(self.method))
        self.nodes.append({"id": self.method_id, "type": "MethodVersion", "content": "Synthetic comparison method", "metadata": metadata([self.method])})
        self.metric_ids = [stable_id("MetricVersion", ref_identity(ref)) for ref in self.refs]
        for target, role, ref in zip(self.metric_ids[:2], ("minuend", "subtrahend"), self.refs[:2]):
            self.edges.append(self.edge(self.metric_ids[2], target, "depends_on", metadata([self.refs[2], ref], operandRole=role)))
        # The approved SC-01S method requires all three exact metric versions,
        # including both inputs as well as the derived net amount.
        for target, ref in zip(self.metric_ids, self.refs):
            self.edges.append(self.edge(self.method_id, target, "depends_on", metadata([self.method, ref])))
        self.ontology = {"name": "S3 synthetic candidate", "classes": [{"name": t} for t in ("MetricConcept", "MetricVersion", "MethodVersion", "Statement")], "properties": [{"name": "depends_on"}]}

    def edge(self, source, target, kind, meta):
        return {"id": edge_id(source, target, kind, meta, self.inputs), "source": source,
                "target": target, "type": kind, "metadata": meta}

    def write(self, **kwargs):
        return self.store.write(kwargs.pop("entities", self.nodes), kwargs.pop("relationships", self.edges),
                                kwargs.pop("ontology", self.ontology), kwargs.pop("inputs", self.inputs), **kwargs)

    def snapshot(self, snapshot_id):
        return self.run / "snapshots" / snapshot_id

    def mutate(self, sid, name, transform, rehash=True):
        root = self.snapshot(sid)
        value = json.loads((root / name).read_text())
        transform(value)
        data = (json.dumps(value, ensure_ascii=False) + "\n").encode()
        (root / name).write_bytes(data)
        if name != "receipt.json" and rehash:
            receipt = json.loads((root / "receipt.json").read_text())
            receipt["files"][name.removesuffix(".json")].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
            (root / "receipt.json").write_text(json.dumps(receipt))

    def test_nullable_hash_does_not_split_identity_or_edge_or_claim(self):
        bare = {k: v for k, v in self.refs[0].items() if k != "publishedHash"}
        nullable = {**bare, "publishedHash": None}
        self.assertEqual(ref_identity(bare), ref_identity(nullable))
        self.assertEqual(ref_identity(bare), ref_identity(self.refs[0]))
        self.assertEqual(claim_id("Statement", [bare], [], self.inputs, "source-projection", "abc"),
                         claim_id("Statement", [self.refs[0]], [], self.inputs, "source-projection", "abc"))
        a = metadata([bare]); b = metadata([self.refs[0]])
        self.assertEqual(edge_id("a", "b", "has_source", a, self.inputs), edge_id("a", "b", "has_source", b, self.inputs))

    def test_missing_receipt_is_explicit_failure_and_keeps_previous_bytes(self):
        sid = self.write()
        before = {p.name: p.read_bytes() for p in self.snapshot(sid).iterdir()}
        other = str(uuid.uuid4()); root = self.snapshot(other); root.mkdir()
        (root / "graph.json").write_bytes(before["graph.json"])
        with self.assertRaises(SnapshotError):
            self.store.load(other)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.snapshot(sid).iterdir()})

    def test_each_query_rechecks_all_necessary_sources_and_edge_endpoints(self):
        secret_ref = {"kind": "enterprise", "storeId": "synthetic", "materialId": "source", "revisionId": "r1", "location": {"start": 0, "end": 10}}
        private_meta = metadata([self.refs[0], secret_ref])
        private_id = claim_id("Statement", private_meta["sourceRefs"], private_meta["buildSources"], self.inputs, private_meta["claimKind"], "PRIVATE BODY")
        public_meta = metadata([self.refs[0]])
        public_id = claim_id("Statement", public_meta["sourceRefs"], public_meta["buildSources"], self.inputs, public_meta["claimKind"], "public statement")
        self.nodes.append({"id": private_id, "type": "Statement", "content": "PRIVATE BODY", "metadata": private_meta})
        special = self.edge(self.metric_ids[0], self.metric_ids[1], "depends_on", metadata([secret_ref]))
        self.edges.append(special)
        endpoint_edge = self.edge(private_id, self.metric_ids[0], "has_source", metadata([self.refs[0]]))
        # A Statement-to-MetricVersion edge would violate the type contract. Use a
        # same-domain statement relationship for the endpoint visibility check.
        endpoint_edge["type"] = "potential_conflict"
        endpoint_edge["target"] = public_id
        endpoint_edge["id"] = edge_id(endpoint_edge["source"], endpoint_edge["target"], endpoint_edge["type"], endpoint_edge["metadata"], self.inputs)
        self.nodes.append({"id": public_id, "type": "Statement", "content": "public statement", "metadata": public_meta})
        self.edges.append(endpoint_edge)
        sid = self.write(); view = self.store.load(sid)
        self.assertIn(private_id, {n["id"] for n in view.query()["nodes"]})
        self.authority.states[canonical(ref_identity(secret_ref))] = "disabled"
        result = view.query()
        self.assertEqual(result["state"], "partial")
        self.assertNotIn(private_id, {n["id"] for n in result["nodes"]})
        self.assertNotIn(special["id"], {e["id"] for e in result["edges"]})
        self.assertNotIn(endpoint_edge["id"], {e["id"] for e in result["edges"]})
        self.assertNotIn("PRIVATE BODY", json.dumps(result))
        self.assertNotIn('"materialId"', json.dumps(result))
        self.assertTrue(result["gaps"])
        self.authority.states.clear()
        self.assertIn(private_id, {n["id"] for n in view.query()["nodes"]})

    def test_native_roundtrip_preserves_metadata_and_parallel_edges(self):
        parallel = copy.deepcopy(self.edges[-1]); parallel["metadata"]["limitations"] = ["parallel source interpretation"]
        parallel["id"] = edge_id(parallel["source"], parallel["target"], parallel["type"], parallel["metadata"], self.inputs)
        self.edges.append(parallel)
        sid = self.write(); result = self.store.load(sid).query()
        self.assertEqual(result["state"], "available")
        self.assertEqual({n["id"]: n for n in result["nodes"]}, {n["id"]: n for n in self.nodes})
        self.assertEqual({e["id"]: e for e in result["edges"]}, {e["id"]: e for e in self.edges})
        disk = json.loads((self.snapshot(sid) / "graph.json").read_text())
        self.assertEqual(disk["graph_id"], sid)
        self.assertIn("properties", disk["nodes"][0]); self.assertNotIn("metadata", disk["nodes"][0])
        self.assertIn("source_id", disk["edges"][0])

    def test_hash_conflict_and_authority_failure_are_rejected(self):
        self.nodes[0]["metadata"]["sourceRefs"].append({**self.refs[0], "publishedHash": "c" * 64})
        with self.assertRaises(SnapshotError): self.write()
        self.nodes[0]["metadata"]["sourceRefs"].pop()
        self.authority.states[canonical(ref_identity(self.refs[0]))] = "hash-conflict"
        with self.assertRaises(SnapshotError): self.write()

    def test_method_known_error_is_not_query_eligible(self):
        sid = self.write(); view = self.store.load(sid)
        self.authority.states[canonical(ref_identity(self.method))] = "known-error"
        result = view.query()
        self.assertNotIn(self.method_id, {n["id"] for n in result["nodes"]})
        self.assertEqual(result["state"], "partial")

    def test_loading_method_missing_any_declared_core_dependency_fails_closed(self):
        for removed in ((0,), (1,), (2,), (0, 1)):
            with self.subTest(removed=[METRICS[index] for index in removed]):
                sid = self.write()
                removed_ids = {self.metric_ids[index] for index in removed}
                self.mutate(sid, "graph.json", lambda graph: graph.update(edges=[
                    edge for edge in graph["edges"]
                    if not (edge["type"] == "depends_on" and edge["source_id"] == self.method_id
                            and edge["target_id"] in removed_ids)]))
                # Integrity is valid: rejection must concern incomplete method
                # semantics, rather than a stale graph-file checksum.
                before = {p.name: p.read_bytes() for p in self.snapshot(sid).iterdir()}
                with self.assertRaises(SnapshotError) as failure:
                    self.store.load(sid)
                self.assertEqual(failure.exception.code, "missing_method_dependency")
                self.assertEqual(before, {p.name: p.read_bytes() for p in self.snapshot(sid).iterdir()})

    def test_missing_corrupt_hash_and_snapshot_id_fail_closed(self):
        for mutation in ("missing", "corrupt", "hash", "id", "schema", "component", "empty", "direction", "ontology", "bytes"):
            with self.subTest(mutation=mutation):
                sid = self.write(); root = self.snapshot(sid)
                if mutation == "missing": (root / "ontology.json").unlink()
                elif mutation == "corrupt": (root / "receipt.json").write_text("{broken")
                elif mutation == "hash": (root / "graph.json").write_text("{}")
                elif mutation == "id": self.mutate(sid, "receipt.json", lambda r: r.update(snapshotId=str(uuid.uuid4())))
                elif mutation == "schema": self.mutate(sid, "receipt.json", lambda r: r.update(formatVersion=2))
                elif mutation == "component": self.mutate(sid, "receipt.json", lambda r: r["component"].update(version="0.8.0"))
                elif mutation == "empty": self.mutate(sid, "graph.json", lambda g: g.update(nodes=[], edges=[]))
                elif mutation == "direction": self.mutate(sid, "graph.json", lambda g: g["edges"][3].update(source_id=self.metric_ids[0], target_id=self.metric_ids[2]))
                elif mutation == "ontology": self.mutate(sid, "ontology.json", lambda o: o.update(classes=[]))
                elif mutation == "bytes": self.mutate(sid, "receipt.json", lambda r: r["files"]["graph"].update(bytes=0))
                with self.assertRaises(SnapshotError): self.store.load(sid)

    def test_path_and_link_and_input_tampering_fail_closed(self):
        for kind in ("symlink", "hardlink", "input", "escape", "directory-link"):
            with self.subTest(kind=kind):
                sid = self.write(); root = self.snapshot(sid)
                if kind in ("symlink", "hardlink"):
                    original = root / "ontology.json"; held = self.run / (sid + "-held.json")
                    original.rename(held)
                    if kind == "symlink": original.symlink_to(held)
                    else: os.link(held, original)
                elif kind == "input": (self.run / "inputs/design.json").write_text("changed")
                elif kind == "escape": self.mutate(sid, "receipt.json", lambda r: r["inputs"][0].update(relativePath="../design.json"))
                else:
                    alternate = self.run / (sid + "-held-dir"); root.rename(alternate); root.symlink_to(alternate, target_is_directory=True)
                with self.assertRaises(SnapshotError): self.store.load(sid)
                # Restore the shared input fixture for the next subtest only.
                if kind == "input":
                    data = b'{"definition":"synthetic definition","other":"synthetic alternative"}\n'
                    (self.run / "inputs/design.json").write_bytes(data)
        for selected in ("latest", "../escape", "/tmp/example"):
            with self.assertRaises(SnapshotError): self.store.load(selected)

    def test_duplicate_and_reserved_metadata_and_missing_core_rejected(self):
        variants = [self.nodes + [copy.deepcopy(self.nodes[0])], self.nodes[:-1]]
        collision = copy.deepcopy(self.nodes); collision[0]["metadata"]["content"] = "override"
        variants.append(collision)
        for nodes in variants:
            with self.assertRaises(SnapshotError): self.write(entities=nodes)
        with self.assertRaises(SnapshotError): self.write(relationships=self.edges + [copy.deepcopy(self.edges[0])])

    def test_new_generations_are_explicit_and_old_snapshot_is_immutable(self):
        sid = self.write(); root = self.snapshot(sid)
        before = {p.name: p.read_bytes() for p in root.iterdir()}
        old = self.store.load(sid)
        changed = copy.deepcopy(self.nodes); changed[-1]["content"] = "Synthetic revised method"
        fresh = self.write(entities=changed)
        self.assertNotEqual(sid, fresh)
        self.assertEqual(old.query()["nodes"][-1]["content"], "Synthetic comparison method")
        self.assertEqual(self.store.load(fresh).query()["nodes"][-1]["content"], "Synthetic revised method")
        with self.assertRaises(SnapshotError): self.write(snapshot_id=sid)
        self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})

    def test_null_hash_keeps_original_ref_and_limitations(self):
        for node in self.nodes:
            for ref in node["metadata"]["sourceRefs"]: ref["publishedHash"] = None
        for edge in self.edges:
            for ref in edge["metadata"]["sourceRefs"]: ref["publishedHash"] = None
        # IDs intentionally remain identities of the exact same business versions.
        result = self.store.load(self.write()).query()
        self.assertTrue(all(ref.get("publishedHash") is None for n in result["nodes"] for ref in n["metadata"]["sourceRefs"]))
        self.assertIn("source-validation-gap", result["gaps"])

    def test_validation_finishes_before_native_load_and_halfwrite_stays(self):
        sid = self.write()
        original = {p.name: p.read_bytes() for p in self.snapshot(sid).iterdir()}
        (self.snapshot(sid) / "receipt.json").write_text("{broken")
        with patch("scripts.fourbase_l2.readmodel._new_graph", side_effect=AssertionError("must not instantiate")):
            with self.assertRaises(SnapshotError): self.store.load(sid)
        self.assertEqual((self.snapshot(sid) / "graph.json").read_bytes(), original["graph.json"])
        fresh = str(uuid.uuid4())
        with patch("scripts.fourbase_l2.readmodel._new_graph", side_effect=OSError("synthetic failure")):
            with self.assertRaises(SnapshotError): self.write(snapshot_id=fresh)
        self.assertTrue(self.snapshot(fresh).is_dir())
        self.assertFalse((self.snapshot(fresh) / "receipt.json").exists())
        with self.assertRaises(SnapshotError): self.store.load(fresh)

    def test_old_snapshot_reopens_with_current_disabled_source_but_cannot_return_it(self):
        sid = self.write()
        self.authority.states[canonical(ref_identity(self.method))] = "known-error"
        result = self.store.load(sid).query()
        self.assertNotIn(self.method_id, {n["id"] for n in result["nodes"]})
        self.assertEqual(result["state"], "partial")
        self.assertEqual(self.store.load(sid).query([self.metric_ids[0]])["state"], "available")
        self.assertEqual(self.store.load(sid).query(["unseen-id"])["state"], "partial")

    def test_source_identity_mismatch_and_authority_outage_do_not_create_ready_graph(self):
        sid = self.write()
        self.authority.states[canonical(ref_identity(self.refs[0]))] = "missing"
        with self.assertRaises(SnapshotError): self.store.load(sid)
        self.authority.states.clear()
        view = self.store.load(sid)
        with patch.object(self.authority, "check_many", side_effect=RuntimeError("private locator /secret")):
            result = view.query()
        self.assertEqual(result, {"state": "partial", "nodes": [], "edges": [], "gaps": ["authority-unavailable"]})
        for selected in ("", "latest", "../escape"):
            with self.assertRaises(SnapshotError): self.write(snapshot_id=selected)

    def test_current_input_integrity_and_query_results_cannot_mutate_fixed_view(self):
        sid = self.write(); view = self.store.load(sid)
        first = view.query(); first["nodes"][0]["content"] = "caller changed output"
        self.assertNotEqual(view.query()["nodes"][0]["content"], "caller changed output")
        (self.run / "inputs/design.json").write_text("tampered after load")
        with self.assertRaises(SnapshotError): view.query()

    def test_empty_method_hash_is_rejected_by_original_ref_contract(self):
        self.method["publishedHash"] = ""
        with self.assertRaises(SnapshotError): self.write()

    def test_source_revision_owns_one_ref_and_retains_all_necessary_other_sources(self):
        enterprise = {"kind": "enterprise", "storeId": "synthetic", "materialId": "source", "revisionId": "r1"}
        description = {"kind": "data-description", "projectId": "synthetic", "datasetId": "dataset", "inputVersionId": "i1", "descriptionRevisionId": "d1"}
        source_id = stable_id("SourceRevision", ref_identity(description))
        node = {"id": source_id, "type": "SourceRevision", "content": "Synthetic source description", "metadata": metadata([enterprise, description])}
        self.nodes.append(node)
        self.ontology["classes"].append({"name": "SourceRevision"})
        edge = self.edge(self.metric_ids[0], source_id, "has_source", metadata([enterprise, description]))
        self.edges.append(edge)
        sid = self.write(); view = self.store.load(sid)
        actual = next(n for n in view.query()["nodes"] if n["id"] == source_id)
        self.assertEqual(actual["metadata"]["sourceRefs"], [enterprise, description])
        self.authority.states[canonical(ref_identity(enterprise))] = "disabled"
        result = view.query()
        self.assertNotIn(source_id, {n["id"] for n in result["nodes"]})
        self.assertNotIn(edge["id"], {e["id"] for e in result["edges"]})
        self.assertEqual(result["state"], "partial")

    def test_run_root_cannot_be_replaced_by_a_link_after_opening(self):
        sid = self.write()
        held = self.run.with_name(self.run.name + "-held")
        self.run.rename(held)
        self.run.symlink_to(held, target_is_directory=True)
        try:
            with self.assertRaises(SnapshotError): self.store.load(sid)
        finally:
            self.run.unlink()
            held.rename(self.run)


class IdentityTests(unittest.TestCase):
    def test_utf16_keys_without_unicode_normalization(self):
        self.assertEqual(canonical({"\ue000": 1, "\U00010000": 2}), '{"\U00010000":2,"\ue000":1}')
        self.assertNotEqual(stable_id("Statement", "é"), stable_id("Statement", "e\u0301"))
        self.assertEqual(canonical({"x": -0.0, "y": 1.0}), '{"x":0,"y":1}')

    def test_ref_grains_and_hash_validation(self):
        enterprise = {"kind": "enterprise", "storeId": "s", "materialId": "m", "revisionId": "r"}
        self.assertEqual(ref_identity(enterprise), ref_identity({**enterprise, "location": {"start": 0, "end": 1}}))
        with self.assertRaises(ValueError): ref_identity({"kind": "sap", "packageId": "p", "version": "1"})
        with self.assertRaises(ValueError): ref_identity({"kind": "sap-method", "methodId": "m", "version": True})
        with self.assertRaises(ValueError): ref_identity({"kind": "data-citation", "projectId": "p", "citationId": "c"})
        with self.assertRaises(ValueError): ref_identity({"kind": "sap", "packageId": "p", "version": "1", "metricName": "metric", "publishedHash": ""})

    def test_locality_and_relationship_semantics_remain_distinct(self):
        source = {"kind": "enterprise", "storeId": "s", "materialId": "m", "revisionId": "r"}
        a = {**source, "location": {"start": 0, "end": 1}}
        b = {**source, "location": {"start": 1, "end": 2}}
        self.assertNotEqual(claim_id("Statement", [a], [], {}, "source-projection", "same"),
                            claim_id("Statement", [b], [], {}, "source-projection", "same"))
        self.assertNotEqual(claim_id("Statement", [a], [], {}, "source-projection", "same"),
                            claim_id("Statement", [a], [], {}, "engineering-interpretation", "same"))
        self.assertNotEqual(edge_id("a", "b", "depends_on", metadata([a], operandRole="minuend"), {"design": "d" * 64}),
                            edge_id("a", "b", "depends_on", metadata([a], operandRole="subtrahend"), {"design": "d" * 64}))


if __name__ == "__main__": unittest.main()
