"""Execute the approved finite subset through official Semantica 0.7.0.

Atom checks and the dependency DAG only establish supported input and bounds.
Matching, substitution and forward inference belong exclusively to Reasoner.
No paths, callbacks, graph write-back, model access or persistent fact memory.
"""
import contextlib
import importlib.metadata
import io
import re
import sys
from urllib.parse import quote

from .studio_extract import read_message, send

CONTRACT = 'studio-rule-execution/1'
COMPONENT = {'name': 'semantica', 'version': '0.7.0'}
CAPS = {'maxRules': 32, 'maxFacts': 256, 'maxConclusions': 512, 'maxIterations': 32}
# Internal environment bound. Requests cannot increase it through budget.
MAX_STATIC_WORKING_SET = 8192
NAME = re.compile(r'[A-Za-z][A-Za-z0-9_]{0,79}\Z')
VARIABLE = re.compile(r'\?[A-Za-z][A-Za-z0-9_]{0,79}\Z')
CONSTANT = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_:.@/%+\-]{0,299}\Z')


class Unsupported(ValueError):
    pass


def _object(value, allowed, required=None):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required or allowed) - set(value):
        raise Unsupported('unsupported-request-shape')


def _text(value, limit=2000):
    if not isinstance(value, str) or not value.strip() or len(value.encode('utf-8')) > limit or '\0' in value:
        raise Unsupported('unsupported-text-value')


def _atom(value, predicates, variables=True):
    _text(value, 3000)
    match = re.fullmatch(r'([A-Za-z][A-Za-z0-9_]*)\(([^()]*)\)', value)
    if not match or match[1] not in predicates:
        raise Unsupported('unsupported-official-atom')
    args = match[2].split(', ') if match[2] else []
    if len(args) != len(predicates[match[1]]['arguments']):
        raise Unsupported('predicate-arity-mismatch')
    for arg in args:
        if not CONSTANT.fullmatch(arg) and not (variables and VARIABLE.fullmatch(arg)):
            raise Unsupported('unsupported-atom-argument')
    return match[1], args, {arg for arg in args if VARIABLE.fullmatch(arg)}


def _depth(edges):
    """Static DAG bound, not an inference scheduler."""
    vertices = set(edges)
    for targets in edges.values():
        vertices.update(targets)
    inbound = {vertex: 0 for vertex in vertices}
    for targets in edges.values():
        for target in targets:
            inbound[target] += 1
    queue = [vertex for vertex in vertices if not inbound[vertex]]
    depths = {vertex: 0 for vertex in vertices}
    visited = 0
    while queue:
        vertex = queue.pop()
        visited += 1
        for target in edges.get(vertex, set()):
            depths[target] = max(depths[target], depths[vertex] + 1)
            inbound[target] -= 1
            if not inbound[target]:
                queue.append(target)
    if visited != len(vertices):
        raise Unsupported('recursive-rule-dependency')
    return max(depths.values(), default=0)


def _shapes(constraints):
    from rdflib import BNode, Graph, Literal, RDF, URIRef
    from rdflib.namespace import SH

    _object(constraints, ['format', 'shapes', 'sourceRefs'])
    if constraints['format'] != 'shacl-turtle' or not isinstance(constraints['sourceRefs'], list):
        raise Unsupported('unsupported-constraint-contract')
    _text(constraints['shapes'], 64 * 1024)
    graph = Graph()
    try:
        graph.parse(data=constraints['shapes'], format='turtle')
    except Exception:
        raise Unsupported('unsupported-shacl-turtle') from None
    # Only simple, declarative SHACL Core. No imports, SPARQL, JS, rules,
    # node recursion, functions, expressions or remote dereferencing.
    allowed = {RDF.type, SH.targetClass, SH.targetNode, SH.property, SH.path,
               SH.datatype, SH['class'], SH.nodeKind, SH.minCount, SH.maxCount,
               SH.message, SH.name, SH.description, SH.severity}
    if not graph or len(graph) > 1000 or any(predicate not in allowed for _, predicate, _ in graph):
        raise Unsupported('unsupported-shacl-feature')
    if not any(graph.subjects(RDF.type, SH.NodeShape)):
        raise Unsupported('shacl-node-shape-required')
    for _, predicate, value in graph:
        if predicate == SH.path and not isinstance(value, URIRef):
            raise Unsupported('unsupported-shacl-path')
        if predicate in {SH.minCount, SH.maxCount}:
            if not isinstance(value, Literal) or type(value.toPython()) is not int or not 0 <= value.toPython() <= 256:
                raise Unsupported('unsupported-shacl-cardinality')
        if predicate == RDF.type and value not in {SH.NodeShape, SH.PropertyShape}:
            raise Unsupported('unsupported-shacl-type')
    # Serialize our already-parsed in-memory graph, never pass an incoming
    # string to OntologyEngine's optional path-reading branch.
    return graph.serialize(format='turtle')


def _prepare(command):
    _object(command, ['type', 'execution', 'facts', 'targets', 'budget', 'coverage'], ['type', 'execution', 'facts', 'budget'])
    if command['type'] != 'reason':
        raise Unsupported('unsupported-worker-action')
    execution = command['execution']
    _object(execution, ['contractVersion', 'engine', 'rules', 'predicates', 'factRequirements', 'constraints'],
            ['contractVersion', 'engine', 'rules', 'predicates', 'factRequirements'])
    if execution['contractVersion'] != CONTRACT or execution['engine'] != COMPONENT:
        raise Unsupported('unsupported-component-contract')
    budget = command['budget']
    _object(budget, list(CAPS))
    if any(type(budget[key]) is not int or not 0 <= budget[key] <= limit for key, limit in CAPS.items()):
        raise Unsupported('unsupported-resource-budget')
    if not isinstance(execution['predicates'], list) or not 0 < len(execution['predicates']) <= 128:
        raise Unsupported('unsupported-predicates')
    predicates = {}
    for predicate in execution['predicates']:
        _object(predicate, ['predicate', 'namespace', 'itemId', 'arguments'])
        if not isinstance(predicate['predicate'], str) or not NAME.fullmatch(predicate['predicate']) or predicate['predicate'] in predicates:
            raise Unsupported('unsupported-predicate-identity')
        _text(predicate['namespace'], 1000)
        _text(predicate['itemId'])
        if not re.match(r'(https?://|urn:)', predicate['namespace']) or re.search(r'[\s<>"{}]', predicate['namespace']):
            raise Unsupported('unsupported-predicate-namespace')
        if not isinstance(predicate['arguments'], list) or len(predicate['arguments']) > 8:
            raise Unsupported('unsupported-predicate-arity')
        names = set()
        for argument in predicate['arguments']:
            _object(argument, ['name', 'itemId', 'valueType'])
            if not isinstance(argument['name'], str) or not NAME.fullmatch(argument['name']) or argument['name'] in names:
                raise Unsupported('unsupported-argument-identity')
            _text(argument['itemId']); _text(argument['valueType'])
            names.add(argument['name'])
        predicates[predicate['predicate']] = predicate
    rules, edges, ids, producers, hidden = execution['rules'], {}, set(), {}, False
    if not isinstance(rules, list) or not rules or len(rules) > CAPS['maxRules']:
        raise Unsupported('unsupported-rule-count')
    for rule in rules:
        _object(rule, ['ruleId', 'ruleItemId', 'conditions', 'conclusion'])
        _text(rule['ruleId']); _text(rule['ruleItemId'])
        if rule['ruleId'] in ids or not isinstance(rule['conditions'], list) or not 0 < len(rule['conditions']) <= 8:
            raise Unsupported('unsupported-rule-identity-or-conditions')
        ids.add(rule['ruleId'])
        head, _, bound = _atom(rule['conclusion'], predicates)
        required = set()
        for condition in rule['conditions']:
            predicate, _, variables = _atom(condition, predicates)
            required.update(variables)
            edges.setdefault(predicate, set()).add(head)
        if bound - required:
            raise Unsupported('unbound-conclusion-variable')
        hidden = hidden or bool(required - bound)
        producers[head] = producers.get(head, 0) + 1
    chain_depth = _depth(edges)
    requirements = {}
    if not isinstance(execution['factRequirements'], list) or len(execution['factRequirements']) > 256:
        raise Unsupported('unsupported-fact-requirements')
    for requirement in execution['factRequirements']:
        if (not isinstance(requirement, dict) or not isinstance(requirement.get('requirementId'), str)
                or requirement['requirementId'] in requirements or requirement.get('predicate') not in predicates
                or requirement.get('kind') not in {'observed', 'external-computation'}):
            raise Unsupported('unsupported-fact-requirements')
        requirements[requirement['requirementId']] = requirement
    facts = command['facts']
    if not isinstance(facts, list) or len(facts) > CAPS['maxFacts']:
        raise Unsupported('unsupported-fact-count')
    fact_ids = set()
    for fact in facts:
        _object(fact, ['factId', 'statement', 'sourceRefs', 'locator', 'kind', 'requirementId', 'bindingRef'],
                ['factId', 'statement', 'sourceRefs', 'locator', 'kind', 'requirementId'])
        _text(fact['factId']); _text(fact['locator'])
        if fact['factId'] in fact_ids or fact['kind'] not in {'observed', 'external-computation'} or not isinstance(fact['sourceRefs'], list) or not fact['sourceRefs']:
            raise Unsupported('unsupported-fact-evidence')
        if any(not isinstance(ref, dict) for ref in fact['sourceRefs']):
            raise Unsupported('unsupported-fact-evidence')
        _text(fact['requirementId'])
        fact_ids.add(fact['factId'])
        predicate, _, _ = _atom(fact['statement'], predicates, variables=False)
        if predicate in producers:
            raise Unsupported('external-fact-shadows-rule-conclusion')
        requirement = requirements.get(fact['requirementId'])
        if not requirement or requirement['predicate'] != predicate or requirement['kind'] != fact['kind']:
            raise Unsupported('fact-requirement-predicate-or-kind-mismatch')
    targets = command.get('targets', [])
    if not isinstance(targets, list) or len(targets) > 256:
        raise Unsupported('unsupported-target-count')
    target_ids = set()
    for target in targets:
        _object(target, ['targetId', 'positive', 'negative'], ['targetId', 'positive'])
        _text(target['targetId'])
        if target['targetId'] in target_ids:
            raise Unsupported('duplicate-target-identity')
        target_ids.add(target['targetId'])
        _atom(target['positive'], predicates, variables=False)
        if 'negative' in target:
            _atom(target['negative'], predicates, variables=False)
            if target['negative'] == target['positive']:
                raise Unsupported('target-polarity-must-be-distinct')
    coverage = command.get('coverage', {})
    if not isinstance(coverage, dict) or type(coverage.get('complete')) is not bool or not isinstance(coverage.get('missingRequirementIds'), list):
        raise Unsupported('unsupported-coverage')
    shapes = _shapes(execution['constraints']) if 'constraints' in execution else None
    if shapes and any(arg['valueType'] not in {'text', 'string', 'code', 'ref', 'reference', 'identifier'}
                      for predicate in predicates.values() for arg in predicate['arguments']):
        raise Unsupported('unsupported-shacl-argument-value-type')
    return predicates, chain_depth, hidden or any(count > 1 for count in producers.values()), shapes


def _constraints(command, predicates, shapes):
    from rdflib import Graph, Literal, RDF, URIRef, XSD
    from semantica.ontology.engine import OntologyEngine

    graph = Graph()
    for fact in command['facts']:
        name, args, _ = _atom(fact['statement'], predicates, variables=False)
        predicate = predicates[name]
        resource = URIRef('urn:optracall:rule-fact:' + quote(fact['factId'], safe=''))
        graph.add((resource, RDF.type, URIRef(predicate['namespace'] + name)))
        for argument, value in zip(predicate['arguments'], args):
            graph.add((resource, URIRef(predicate['namespace'] + argument['name']), Literal(value, datatype=XSD.string)))
    return OntologyEngine().validate_graph(graph, shacl=shapes).to_dict()


def _static_resource_bounds(command, predicates):
    """Conservative sizes, without matching, deriving or querying any facts.

    Validated canonical atoms are function-free, ground facts use safe scalar
    tokens, and every conclusion variable is bound by its conditions. Thus
    all inferred terms remain in the input/rule-literal domain D. With the
    SDK's set of canonical facts, each condition has at most one matching
    fact for one variable assignment. Any intermediate conjunction list is
    bounded by D**V (all rule variables); a rule has at most D**H conclusions
    (head variables). Sum those head bounds and the initial set for a bound
    on all working facts, including facts inferred by later chain steps.

    D>=1 and exponent zero=1 conservatively cover empty domains, ground rules
    and zero-arity atoms. This deliberately overestimates sparse joins. It is
    a resource admission bound, not an inference engine or an OS memory cap.
    """
    domain = set()
    variable_counts, head_variable_counts = [], []
    for fact in command['facts']:
        _, args, _ = _atom(fact['statement'], predicates, variables=False)
        domain.update(args)
    for rule in command['execution']['rules']:
        variables = set()
        for statement in [*rule['conditions'], rule['conclusion']]:
            _, args, found = _atom(statement, predicates)
            variables.update(found)
            domain.update(arg for arg in args if arg not in found)
        variable_counts.append(len(variables))
        head_variable_counts.append(len(_atom(rule['conclusion'], predicates)[2]))
    domain_size = max(1, len(domain))
    bindings = max((domain_size ** count for count in variable_counts), default=1)
    new_facts = sum(domain_size ** count for count in head_variable_counts)
    working_facts = len({fact['statement'] for fact in command['facts']}) + new_facts
    return {'domainValues': len(domain), 'domainSizeForBound': domain_size,
            'maxBindings': bindings, 'maxWorkingFacts': working_facts,
            'fixedLimit': MAX_STATIC_WORKING_SET}


def _run(command):
    result = {'completion': 'unsupported', 'component': dict(COMPONENT), 'contractVersion': CONTRACT, 'engineInvoked': False,
              'conclusions': [], 'assessments': [], 'limitations': [], 'provenanceQuality': 'not-executed'}
    try:
        predicates, depth, merged, shapes = _prepare(command)
    except Unsupported as error:
        result['limitations'] = [str(error)]
        return result
    if importlib.metadata.version('semantica') != '0.7.0':
        result['limitations'] = ['unsupported-installed-component-version']
        return result
    budget, rules, facts = command['budget'], command['execution']['rules'], command['facts']
    result['processed'] = {'rules': 0, 'facts': 0, 'chainDepth': depth, 'maxIterations': budget['maxIterations'],
                           'requiredClosureIterations': depth + 1, 'sdkInvoked': False}
    if len(rules) > budget['maxRules'] or len(facts) > budget['maxFacts'] or not budget['maxIterations']:
        result.update(completion='incomplete', limitations=['input-resource-budget-exceeded'])
        return result
    bounds = _static_resource_bounds(command, predicates)
    result['processed']['staticResourceBounds'] = bounds
    if bounds['maxBindings'] > MAX_STATIC_WORKING_SET or bounds['maxWorkingFacts'] > MAX_STATIC_WORKING_SET:
        result.update(completion='incomplete', limitations=['static-inference-resource-bound-exceeded',
                      'conservative-environment-estimate-may-exclude-sparse-joins-not-business-judgment'])
        return result
    from semantica.reasoning.reasoner import Reasoner, Rule

    actual_rules = [Rule(rule_id=rule['ruleId'], name=rule['ruleId'], conditions=rule['conditions'],
                         conclusion=rule['conclusion']) for rule in rules]
    result['engineInvoked'] = True
    result['processed'].update(rules=len(rules), facts=len(facts), sdkInvoked=True)
    try:
        official = Reasoner(max_iterations=budget['maxIterations']).infer_with_results(
            [fact['statement'] for fact in facts], actual_rules)
    except Exception:
        result.update(completion='failed', limitations=['official-reasoner-execution-failed'])
        return result
    result['limitations'].extend(['constant-business-identity-depends-on-binding-and-agent-projection',
                                 'engine-confidence-is-not-business-probability'])
    complete = budget['maxIterations'] >= depth + 1
    if not complete:
        result['limitations'].append('iteration-budget-cannot-guarantee-closure')
    if len(official) > budget['maxConclusions']:
        result['limitations'].append('conclusion-budget-exceeded')
        complete = False
    if not command['coverage']['complete'] or command['coverage']['missingRequirementIds']:
        result['limitations'].append('input-coverage-incomplete')
        complete = False
    quality = 'primary-rule-with-merged-premises' if merged else 'complete'
    if merged:
        result['limitations'].append('official-primary-rule-only-premises-may-merge-alternative-derivations')
    by_id = {rule['ruleId']: rule for rule in rules}
    for conclusion in official[:budget['maxConclusions']]:
        result['conclusions'].append({
            'statement': conclusion.conclusion, 'ruleId': conclusion.rule_used.rule_id,
            'ruleItemId': by_id[conclusion.rule_used.rule_id]['ruleItemId'],
            'premises': list(conclusion.premises), 'confidence': conclusion.confidence,
            'provenanceCompleteness': quality,
            'premisesNature': 'engine-reported-union' if merged else 'engine-reported-premises'})
    # The response page is an output bound, not the set the SDK actually
    # derived. Preserve known target results and conflicts beyond that page.
    derived = {conclusion.conclusion for conclusion in official}
    result['processed'].update(officialConclusions=len(official),
                               returnedConclusions=len(result['conclusions']),
                               conclusionsTruncated=len(official) > len(result['conclusions']),
                               assessmentBasis='all-engine-returned-conclusions')
    observed_predicates = {_atom(fact['statement'], predicates, False)[0] for fact in facts}
    missing = any(_atom(condition, predicates)[0] not in observed_predicates
                  and not any(_atom(rule['conclusion'], predicates)[0] == _atom(condition, predicates)[0] for rule in rules)
                  for rule in rules for condition in rule['conditions'])
    for target in command.get('targets', []):
        positive, negative = target['positive'] in derived, target.get('negative') in derived
        state = ('conflict' if positive and negative else 'derived' if positive else 'explicit-negative' if negative
                 else 'insufficient-facts' if missing or not command['coverage']['complete']
                 or command['coverage']['missingRequirementIds'] else 'not-derived')
        result['assessments'].append({'targetId': target['targetId'], 'state': state})
    if shapes:
        try:
            result['constraints'] = _constraints(command, predicates, shapes)
        except Exception:
            result.update(completion='failed', provenanceQuality=quality)
            result['limitations'].append('official-constraint-validation-failed')
            return result
        if not result['constraints']['conforms']:
            result['limitations'].append('structural-constraint-violations-not-business-policy-judgment')
    result.update(completion='complete' if complete else 'incomplete', provenanceQuality=quality)
    result['processed'].update(rules=len(rules), facts=len(facts), sdkInvoked=True)
    return result


def run_reason(command):
    """Return bounded results; third-party diagnostics never become protocol."""
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return _run(command)


def main():
    incoming, outgoing = sys.stdin, sys.stdout
    try:
        result = run_reason(read_message(incoming))
        send(outgoing, {'type': 'result', 'result': result})
        # Same existing worker lease/finish convention; no new protocol loop.
        incoming.readline(2 * 1024 * 1024 + 1)
        return 0
    except Exception:
        send(outgoing, {'type': 'error', 'code': 'reason_failed'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
