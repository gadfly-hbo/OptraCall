"""Engineering contract tests; these synthetic fixtures are not business facts."""

import copy
import unittest

from rdflib import Graph, Literal, Namespace, RDF

from scripts.fourbase_l2.graph_constraints import validate_graph


NS = Namespace("https://example.invalid/optracall/s3/constraints/")


def synthetic_graph():
    """Fixed engineering examples; authority lookup is deliberately separate."""
    def metadata(refs=None, **extra):
        return {
            "sourceRefs": refs or [],
            "buildSources": [{"inputKey": "engineering-test", "locator": "/contract"}],
            "claimKind": "synthetic-assumption", "conditions": [],
            "limitations": ["Engineering fixture; not business truth"],
            "businessTime": [], **extra,
        }

    names = ("terminal_sales_amount", "retail_refund_amount", "net_retail_sales")
    nodes = [
        {"id": "metric-" + name, "type": "MetricVersion", "content": "Synthetic " + name,
         "metadata": metadata([{"kind": "sap", "packageId": "optracall-sc01s-retail",
                                "version": "0.1.0", "metricName": name,
                                "publishedHash": None}])}
        for name in names
    ]
    nodes.extend([
        {"id": "method", "type": "MethodVersion", "content": "Synthetic method",
         "metadata": metadata([{"kind": "sap-method", "methodId": "9e8cc37d-46ba-4e63-b14f-d617f82af3cf",
                                "version": 1, "publishedHash": None}])},
        {"id": "unknown-condition", "type": "Condition", "content": "Applicability remains unknown",
         "metadata": metadata(conditionState="unknown")},
        {"id": "statement", "type": "Statement", "content": "Synthetic scope declaration",
         "metadata": metadata()},
    ])
    edges = [
        {"id": "positive", "source": "metric-net_retail_sales", "target": "metric-terminal_sales_amount",
         "type": "depends_on", "metadata": metadata(operandRole="minuend")},
        {"id": "negative", "source": "metric-net_retail_sales", "target": "metric-retail_refund_amount",
         "type": "depends_on", "metadata": metadata(operandRole="subtrahend")},
        {"id": "parallel-source", "source": "method", "target": "unknown-condition",
         "type": "requires", "metadata": metadata(claimKind="source-projection")},
        {"id": "parallel-interpretation", "source": "method", "target": "unknown-condition",
         "type": "requires", "metadata": metadata(claimKind="engineering-interpretation")},
    ]
    # Reflect the approved method's three required exact versions, rather than
    # using a positive fixture with no declared method dependencies.
    edges.extend({"id": "method-" + name, "source": "method", "target": "metric-" + name,
                  "type": "depends_on", "metadata": metadata()} for name in names)
    return nodes, edges


class GraphConstraintTests(unittest.TestCase):
    def test_statement_without_any_source_is_rejected(self):
        nodes, edges = synthetic_graph()
        nodes[-1]["metadata"]["buildSources"] = []
        result = validate_graph(nodes, edges)
        self.assertFalse(result["conforms"], "A declaration without either source must fail")
        self.assertTrue(any("Every node and edge" in (v["message"] or "") for v in result["violations"]))

    def test_complete_graph_preserves_unknown_sources_and_parallel_edges(self):
        nodes, edges = synthetic_graph()
        before = copy.deepcopy((nodes, edges))
        result = validate_graph(nodes, edges)
        self.assertTrue(result["conforms"], result["violations"])
        self.assertEqual((nodes, edges), before, "Validation must not mutate input or establish a condition")
        self.assertEqual(result["projection_counts"]["projected_nodes"], 6)
        self.assertEqual(result["projection_counts"]["projected_edges"], 7)
        self.assertGreater(result["projection_counts"]["shape_triples"], 0)
        self.assertEqual(result["target_hits"][str(NS.EvidenceShape)], 13)
        graph = Graph().parse(data=result["rdf_turtle"], format="turtle")
        condition = next(graph.subjects(NS.logicalId, Literal("unknown-condition")))
        self.assertEqual(list(graph.objects(condition, NS.conditionState)), [Literal("unknown")])
        self.assertEqual(len(set(graph.subjects(RDF.type, NS.Edge))), 7)
        # Original ref JSON preserves explicit null hash, rather than inventing one.
        self.assertTrue(any('"publishedHash":null' in str(value) for value in graph.objects(None, NS.refJson)))

    def test_condition_cannot_be_promoted_to_an_uncontracted_satisfied_state(self):
        nodes, edges = synthetic_graph()
        nodes[4]["metadata"]["conditionState"] = "satisfied"
        result = validate_graph(nodes, edges)
        self.assertFalse(result["conforms"])
        self.assertTrue(any(v["constraint"] == "InConstraintComponent" for v in result["violations"]))

    def test_source_removal_from_edge_is_rejected(self):
        nodes, edges = synthetic_graph()
        edges[-1]["metadata"]["buildSources"] = []
        result = validate_graph(nodes, edges)
        self.assertFalse(result["conforms"])
        self.assertTrue(any("Every node and edge" in (v["message"] or "") for v in result["violations"]))

    def test_empty_content_and_dangling_endpoint_are_rejected(self):
        for mutation in ("empty-content", "missing-endpoint"):
            with self.subTest(mutation=mutation):
                nodes, edges = synthetic_graph()
                if mutation == "empty-content":
                    nodes[-1]["content"] = "  \n\t"
                else:
                    edges[-1]["target"] = "absent-node"
                result = validate_graph(nodes, edges)
                self.assertFalse(result["conforms"])
                self.assertTrue(result["violations"])

    def test_core_nodes_and_original_refs_are_required(self):
        for mutation in ("missing-core", "missing-sap-ref", "missing-method-ref"):
            with self.subTest(mutation=mutation):
                nodes, edges = synthetic_graph()
                if mutation == "missing-core":
                    nodes = nodes[1:]
                    edges = [edge for edge in edges if edge["target"] != "metric-terminal_sales_amount"]
                elif mutation == "missing-sap-ref":
                    nodes[0]["metadata"]["sourceRefs"] = []
                else:
                    nodes[3]["metadata"]["sourceRefs"] = []
                result = validate_graph(nodes, edges)
                self.assertFalse(result["conforms"])
                self.assertTrue(result["violations"])

    def test_subtract_dependency_and_both_operand_directions_are_required(self):
        for mutation in ("missing-subtrahend", "swapped-roles", "reversed-edge"):
            with self.subTest(mutation=mutation):
                nodes, edges = synthetic_graph()
                if mutation == "missing-subtrahend":
                    edges = [edge for edge in edges if edge["id"] != "negative"]
                elif mutation == "swapped-roles":
                    edges[0]["metadata"]["operandRole"] = "subtrahend"
                    edges[1]["metadata"]["operandRole"] = "minuend"
                else:
                    edges[1]["source"], edges[1]["target"] = edges[1]["target"], edges[1]["source"]
                result = validate_graph(nodes, edges)
                self.assertFalse(result["conforms"])
                self.assertTrue(any(v["constraint"] == "SPARQLConstraintComponent" for v in result["violations"]))

    def test_method_requires_each_declared_core_version_as_an_outgoing_dependency(self):
        for removed in (("terminal_sales_amount",), ("retail_refund_amount",),
                        ("net_retail_sales",), ("terminal_sales_amount", "retail_refund_amount")):
            with self.subTest(removed=removed):
                nodes, edges = synthetic_graph()
                removed_targets = {"metric-" + name for name in removed}
                edges = [edge for edge in edges if not (
                    edge["source"] == "method" and edge["type"] == "depends_on"
                    and edge["target"] in removed_targets)]
                result = validate_graph(nodes, edges)
                self.assertFalse(result["conforms"], "A method retaining other dependencies is still incomplete")
                self.assertTrue(any(v["constraint"] == "SPARQLConstraintComponent"
                                    and "MethodVersion requires" in (v["message"] or "")
                                    for v in result["violations"]))

    def test_core_projection_has_exactly_one_method_version(self):
        nodes, edges = synthetic_graph()
        second = copy.deepcopy(nodes[3])
        second["id"] = "second-method"
        second["metadata"]["sourceRefs"][0]["methodId"] = "9c53bc55-64de-48d3-8f14-5845861b9bb6"
        nodes.append(second)
        for edge in list(edges):
            if edge["source"] == "method" and edge["type"] == "depends_on":
                edges.append({**copy.deepcopy(edge), "id": "second-" + edge["id"], "source": second["id"]})
        result = validate_graph(nodes, edges)
        self.assertFalse(result["conforms"], "The scenario has one declared method version")
        self.assertTrue(any(v["constraint"] == "QualifiedMaxCountConstraintComponent"
                            for v in result["violations"]))


if __name__ == "__main__":
    unittest.main()
