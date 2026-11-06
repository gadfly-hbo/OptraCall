"""Validate an ephemeral RDF view of the complete logical S3 graph.

This checks structural evidence, not business truth, source authority or OWL
entailments. The native ContextGraph remains the snapshot representation.
"""

import json
from urllib.parse import quote

from rdflib import Graph, Literal, Namespace, RDF, URIRef
from semantica.ontology.engine import OntologyEngine

from .identity import ref_identity


NS = Namespace("https://example.invalid/optracall/s3/constraints/")
SH = Namespace("http://www.w3.org/ns/shacl#")


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _uri(kind, identifier):
    return URIRef(str(NS) + kind + "/" + quote(identifier, safe=""))


def _project_metadata(graph, owner, metadata):
    graph.add((owner, NS.metadataJson, Literal(_json(metadata), datatype=RDF.JSON)))
    for field in ("claimKind", "candidateLocator", "conditionState", "operandRole", "roleText"):
        if field in metadata:
            graph.add((owner, NS[field], Literal(metadata[field])))
    for field in ("conditions", "limitations", "businessTime"):
        for value in metadata.get(field, []):
            graph.add((owner, NS[field], Literal(_json(value), datatype=RDF.JSON)))
    for index, ref in enumerate(metadata.get("sourceRefs", [])):
        resource = URIRef(str(owner) + "/source-ref/" + str(index))
        graph.add((owner, NS.sourceRef, resource))
        graph.add((resource, RDF.type, NS.SourceRef))
        graph.add((resource, NS.refJson, Literal(_json(ref), datatype=RDF.JSON)))
        for key, value in ref.items():
            if value is not None and isinstance(value, (str, int, float, bool)):
                graph.add((resource, NS["refKind" if key == "kind" else key], Literal(value)))
    for index, source in enumerate(metadata.get("buildSources", [])):
        resource = URIRef(str(owner) + "/build-source/" + str(index))
        graph.add((owner, NS.buildSource, resource))
        graph.add((resource, RDF.type, NS.BuildSource))
        graph.add((resource, NS.buildSourceJson, Literal(_json(source), datatype=RDF.JSON)))
        for key in ("inputKey", "locator"):
            if key in source:
                graph.add((resource, NS[key], Literal(source[key])))


def _project(nodes, edges):
    graph = Graph()
    graph.bind("s3", NS)
    graph.bind("sh", SH)
    projection = NS.projection
    graph.add((projection, RDF.type, NS.Projection))
    for kind, records in (("node", nodes), ("edge", edges)):
        identifiers = [item["id"] for item in records]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Duplicate " + kind + " IDs cannot be faithfully projected")
    for node in nodes:
        resource = _uri("node", node["id"])
        graph.add((projection, NS.node, resource))
        graph.add((resource, RDF.type, NS.Node))
        graph.add((resource, RDF.type, NS[node["type"]]))
        graph.add((resource, NS.logicalId, Literal(node["id"])))
        graph.add((resource, NS.nodeType, Literal(node["type"])))
        graph.add((resource, NS.content, Literal(node["content"])))
        _project_metadata(graph, resource, node["metadata"])
    for edge in edges:
        resource = _uri("edge", edge["id"])
        graph.add((projection, NS.edge, resource))
        graph.add((resource, RDF.type, NS.Edge))
        graph.add((resource, NS.logicalId, Literal(edge["id"])))
        graph.add((resource, NS.relationType, Literal(edge["type"])))
        graph.add((resource, NS.source, _uri("node", edge["source"])))
        graph.add((resource, NS.target, _uri("node", edge["target"])))
        _project_metadata(graph, resource, edge["metadata"])
    return graph


SHAPES = r"""
@prefix s3: <https://example.invalid/optracall/s3/constraints/> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

s3:EvidenceShape a sh:NodeShape ;
    sh:targetClass s3:Node, s3:Edge ;
    sh:property [
        sh:path [ sh:alternativePath (s3:sourceRef s3:buildSource) ] ;
        sh:minCount 1 ;
        sh:message "Every node and edge needs a sourceRef or buildSource."
    ] .

s3:NodeShape a sh:NodeShape ;
    sh:targetClass s3:Node ;
    sh:property [ sh:path s3:content ; sh:datatype xsd:string ;
                  sh:minCount 1 ; sh:maxCount 1 ; sh:pattern "\\S" ;
                  sh:message "Every node needs nonblank semantic content." ] .

s3:EdgeShape a sh:NodeShape ;
    sh:targetClass s3:Edge ;
    sh:property [ sh:path s3:source ; sh:minCount 1 ; sh:maxCount 1 ; sh:class s3:Node ;
                  sh:message "Edge source must exist in the projected input nodes." ] ;
    sh:property [ sh:path s3:target ; sh:minCount 1 ; sh:maxCount 1 ; sh:class s3:Node ;
                  sh:message "Edge target must exist in the projected input nodes." ] .

s3:BuildSourceShape a sh:NodeShape ;
    sh:targetClass s3:BuildSource ;
    sh:property [ sh:path s3:inputKey ; sh:datatype xsd:string ; sh:minCount 1 ; sh:pattern "\\S" ] ;
    sh:property [ sh:path s3:locator ; sh:datatype xsd:string ; sh:minCount 1 ; sh:pattern "\\S" ] .

s3:MetricRefShape a sh:NodeShape ;
    sh:property [ sh:path s3:refKind ; sh:hasValue "sap" ] ;
    sh:property [ sh:path s3:packageId ; sh:datatype xsd:string ; sh:minCount 1 ; sh:pattern "\\S" ] ;
    sh:property [ sh:path s3:version ; sh:datatype xsd:string ; sh:minCount 1 ; sh:pattern "\\S" ] ;
    sh:property [ sh:path s3:metricName ; sh:datatype xsd:string ; sh:minCount 1 ; sh:pattern "\\S" ] .

s3:MethodRefShape a sh:NodeShape ;
    sh:property [ sh:path s3:refKind ; sh:hasValue "sap-method" ] ;
    sh:property [ sh:path s3:methodId ; sh:datatype xsd:string ; sh:minCount 1 ; sh:pattern "\\S" ] ;
    sh:property [ sh:path s3:version ; sh:datatype xsd:integer ; sh:minCount 1 ; sh:minInclusive 1 ] .

s3:MetricVersionShape a sh:NodeShape ;
    sh:targetClass s3:MetricVersion ;
    sh:property [ sh:path s3:sourceRef ; sh:qualifiedValueShape s3:MetricRefShape ;
                  sh:qualifiedMinCount 1 ; sh:message "MetricVersion needs its original SAP metric Ref." ] .

s3:MethodVersionShape a sh:NodeShape ;
    sh:targetClass s3:MethodVersion ;
    sh:property [ sh:path s3:sourceRef ; sh:qualifiedValueShape s3:MethodRefShape ;
                  sh:qualifiedMinCount 1 ; sh:message "MethodVersion needs its original sap-method Ref." ] .

s3:ConditionShape a sh:NodeShape ;
    sh:targetClass s3:Condition ;
    sh:property [ sh:path s3:conditionState ; sh:minCount 1 ; sh:maxCount 1 ;
                  sh:in ("stated" "required-not-established" "unknown" "disputed") ] .

s3:CoreProjectionShape a sh:NodeShape ;
    sh:targetClass s3:Projection ;
    sh:property [ sh:path s3:node ; sh:qualifiedMinCount 1 ; sh:qualifiedMaxCount 1 ;
        sh:qualifiedValueShape [ sh:class s3:MethodVersion ;
            sh:property [ sh:path s3:sourceRef ; sh:qualifiedValueShape s3:MethodRefShape ;
                          sh:qualifiedMinCount 1 ] ] ;
        sh:message "SC-01S needs exactly one method with an original version Ref." ] .
"""

# Scenario-local constraints for the approved three core assets. These are not
# new SAP fields, an ontology registry, a formula engine or Agent instructions.
for _metric_name in ("terminal_sales_amount", "retail_refund_amount", "net_retail_sales"):
    SHAPES += """
s3:CoreProjectionShape sh:property [
    sh:path s3:node ; sh:qualifiedMinCount 1 ; sh:qualifiedMaxCount 1 ;
    sh:qualifiedValueShape [
        sh:class s3:MetricVersion ;
        sh:property [ sh:path s3:sourceRef ; sh:qualifiedMinCount 1 ;
            sh:qualifiedValueShape [
                sh:property [ sh:path s3:refKind ; sh:hasValue "sap" ] ;
                sh:property [ sh:path s3:packageId ; sh:hasValue "optracall-sc01s-retail" ] ;
                sh:property [ sh:path s3:version ; sh:hasValue "0.1.0" ] ;
                sh:property [ sh:path s3:metricName ; sh:hasValue "%s" ]
            ] ] ] ;
    sh:message "SC-01S needs exactly one original core version: %s."
] .
""" % (_metric_name, _metric_name)
    SHAPES += '''
s3:MethodDependencyShape a sh:NodeShape ; sh:targetClass s3:MethodVersion ;
    sh:sparql [
        sh:message "MethodVersion requires the outgoing dependency to %s@0.1.0." ;
        sh:select """
            PREFIX s3: <https://example.invalid/optracall/s3/constraints/>
            SELECT $this WHERE {
                FILTER NOT EXISTS {
                    ?edge a s3:Edge ; s3:source $this ; s3:target ?metric ;
                        s3:relationType "depends_on" .
                    ?metric a s3:MetricVersion ; s3:sourceRef ?metricRef .
                    ?metricRef s3:refKind "sap" ; s3:packageId "optracall-sc01s-retail" ;
                        s3:version "0.1.0" ; s3:metricName "%s" .
                }
            }
        """
    ] .
''' % (_metric_name, _metric_name)

for _role, _metric_name in (("minuend", "terminal_sales_amount"), ("subtrahend", "retail_refund_amount")):
    SHAPES += '''
s3:NetDependencyShape a sh:NodeShape ; sh:targetClass s3:MetricVersion ;
    sh:sparql [
        sh:message "C04 requires the outgoing %s dependency to %s." ;
        sh:select """
            PREFIX s3: <https://example.invalid/optracall/s3/constraints/>
            SELECT $this WHERE {
                $this s3:sourceRef ?netRef .
                ?netRef s3:refKind "sap" ; s3:packageId "optracall-sc01s-retail" ;
                    s3:version ?version ; s3:metricName "net_retail_sales" .
                FILTER NOT EXISTS {
                    ?edge a s3:Edge ; s3:source $this ; s3:target ?operand ;
                        s3:relationType "depends_on" ; s3:operandRole "%s" .
                    ?operand a s3:MetricVersion ; s3:sourceRef ?operandRef .
                    ?operandRef s3:refKind "sap" ; s3:packageId "optracall-sc01s-retail" ;
                        s3:version ?version ; s3:metricName "%s" .
                }
            }
        """
    ] .
''' % (_role, _metric_name, _role, _metric_name)

SHAPES += '''
s3:NetDependencyShape sh:sparql [
    sh:message "Every outgoing C04 dependency must preserve its declared operand direction." ;
    sh:select """
        PREFIX s3: <https://example.invalid/optracall/s3/constraints/>
        SELECT $this ?value WHERE {
            $this s3:sourceRef ?netRef .
            ?netRef s3:refKind "sap" ; s3:packageId "optracall-sc01s-retail" ;
                s3:version ?version ; s3:metricName "net_retail_sales" .
            ?edge a s3:Edge ; s3:source $this ; s3:target ?value ; s3:relationType "depends_on" .
            FILTER NOT EXISTS {
                ?edge s3:operandRole ?role .
                ?value a s3:MetricVersion ; s3:sourceRef ?operandRef .
                ?operandRef s3:refKind "sap" ; s3:packageId "optracall-sc01s-retail" ;
                    s3:version ?version ; s3:metricName ?name .
                FILTER ((?role = "minuend" && ?name = "terminal_sales_amount") ||
                        (?role = "subtrahend" && ?name = "retail_refund_amount"))
            }
        }
    """
] .
'''


def _publication_shapes(metric_refs):
    """Bind the same finite SHACL constraints to the selected publication.

    Omission retains the original S3 fixture contract. This is exact selection,
    never a wildcard over packages or versions, and does not select latest.
    """
    if metric_refs is None:
        return SHAPES
    names={"terminal_sales_amount", "retail_refund_amount", "net_retail_sales"}
    if (not isinstance(metric_refs,list) or len(metric_refs)!=3
            or any(not isinstance(ref,dict) or ref.get('kind')!='sap' for ref in metric_refs)
            or {ref.get('metricName') for ref in metric_refs}!=names):
        raise ValueError('invalid_core_publication')
    for ref in metric_refs:
        ref_identity(ref)
    publications={(ref['packageId'],ref['version']) for ref in metric_refs}
    if len(publications)!=1:
        raise ValueError('inconsistent_core_publication')
    package,version=next(iter(publications))
    return (SHAPES.replace('"optracall-sc01s-retail"',Literal(package).n3())
            .replace('"0.1.0"',Literal(version).n3()).replace('@0.1.0.', '@'+version+'.'))


def validate_graph(nodes: list, edges: list, *, metric_refs=None) -> dict:
    """Project every node/edge and run fixed Semantica's actual SHACL path.

    RDF/SHACL strings are evidence views only. Source refs and complete metadata
    retain their original JSON, including omitted versus null published hashes.
    The authority module must separately verify exact refs and current eligibility.
    """
    graph = _project(nodes, edges)
    shape_text = _publication_shapes(metric_refs)
    shapes = Graph().parse(data=shape_text, format="turtle")
    engine = OntologyEngine(base_uri=str(NS), min_occurrences=1)
    report = engine.validate_graph(graph, shacl=shape_text, explain=True)
    target_hits = {}
    for shape in shapes.subjects(RDF.type, SH.NodeShape):
        targets = set()
        for target_class in shapes.objects(shape, SH.targetClass):
            targets.update(graph.subjects(RDF.type, target_class))
        targets.update(shapes.objects(shape, SH.targetNode))
        target_hits[str(shape)] = len(targets)
    return {
        "conforms": bool(report.conforms),
        "violations": [item.to_dict() for item in report.violations],
        "target_hits": target_hits,
        "projection_counts": {
            "input_nodes": len(nodes), "input_edges": len(edges),
            "projected_nodes": len(set(graph.subjects(RDF.type, NS.Node))),
            "projected_edges": len(set(graph.subjects(RDF.type, NS.Edge))),
            "source_refs": len(set(graph.subjects(RDF.type, NS.SourceRef))),
            "build_sources": len(set(graph.subjects(RDF.type, NS.BuildSource))),
            "condition_states": len(list(graph.triples((None, NS.conditionState, None)))),
            "rdf_triples": len(graph), "shape_triples": len(shapes),
        },
        "rdf_turtle": graph.serialize(format="turtle"),
        "shacl_turtle": shape_text,
        "execution": "OntologyEngine.validate_graph -> pyshacl; inference=none",
        "scope": "Structural source/dependency completeness only; not authority, business truth or OWL reasoning",
    }
