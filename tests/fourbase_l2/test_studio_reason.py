"""Actual official SDK behavior on synthetic finite rule/fact projections."""
import json
import subprocess
import sys
import unittest

from scripts.fourbase_l2.studio_reason import run_reason


def fixture():
    ref = {'authority': 'data', 'id': 'synthetic-input', 'version': '1', 'sha256': 'a' * 64}
    return {
        'type': 'reason',
        'execution': {
            'contractVersion': 'studio-rule-execution/1', 'engine': {'name': 'semantica', 'version': '0.7.0'},
            'rules': [
                {'ruleId': 'normal', 'ruleItemId': 'normal-rule', 'conditions': ['Member(?m)', 'Normal(?m)'], 'conclusion': 'Eligible(?m)'},
                {'ruleId': 'expired', 'ruleItemId': 'expired-rule', 'conditions': ['Member(?m)', 'Expired(?m)'], 'conclusion': 'Ineligible(?m)'}],
            'predicates': [{'predicate': name, 'namespace': 'https://example.invalid/rules/', 'itemId': name.lower(),
                            'arguments': [{'name': 'member', 'itemId': 'member', 'valueType': 'code'}]}
                           for name in ['Member', 'Normal', 'Expired', 'Eligible', 'Ineligible']],
            'factRequirements': [{'requirementId': name, 'predicate': name, 'sourceRef': ref, 'bindingRef': ref,
                                  'fields': ['member'], 'grain': 'member', 'unit': 'state', 'timeBasis': 'synthetic',
                                  'coverage': 'synthetic', 'kind': 'observed'}
                                 for name in ['Member', 'Normal', 'Expired']],
        },
        'facts': [{'factId': 'f' + str(index), 'statement': statement, 'sourceRefs': [ref],
                   'locator': '/records/' + str(index), 'kind': 'observed',
                   'requirementId': statement.split('(')[0]}
                  for index, statement in enumerate(['Member(member_1)', 'Normal(member_1)'])],
        'targets': [{'targetId': 'member-1', 'positive': 'Eligible(member_1)', 'negative': 'Ineligible(member_1)'}],
        'budget': {'maxRules': 32, 'maxFacts': 256, 'maxConclusions': 512, 'maxIterations': 32},
        'coverage': {'complete': True, 'detail': 'synthetic finite input', 'cutoffAt': '2026-11-13T00:00:00Z',
                     'businessTime': 'synthetic-period', 'missingRequirementIds': []},
    }


def boundary_fixture():
    command = fixture()
    command['execution']['predicates'] = [
        {**command['execution']['predicates'][0], 'predicate': name, 'itemId': name}
        for name in ['P', 'A', 'B', 'C']]
    command['execution']['rules'] = [
        {'ruleId': name, 'ruleItemId': name, 'conditions': ['P(?m)'], 'conclusion': name + '(?m)'}
        for name in ['A', 'B', 'C']]
    command['execution']['factRequirements'] = [
        {**command['execution']['factRequirements'][0], 'requirementId': 'P', 'predicate': 'P'}]
    command['facts'] = [
        {**command['facts'][0], 'factId': 'f' + str(index), 'statement': 'P(m' + str(index).zfill(3) + ')',
         'requirementId': 'P', 'locator': '/records/' + str(index)}
        for index in range(256)]
    command['targets'] = [{'targetId': 'last', 'positive': 'C(m255)'}]
    return command


def independent_variables_fixture(dense=False):
    command = fixture()
    command['execution']['predicates'] = [
        {**command['execution']['predicates'][0], 'predicate': name, 'itemId': name}
        for name in ['P' + str(index) for index in range(8)] + ['Z']]
    command['execution']['rules'] = [{
        'ruleId': 'independent', 'ruleItemId': 'independent',
        'conditions': ['P' + str(index) + '(?x' + str(index) + ')' for index in range(8)],
        'conclusion': 'Z(?x0)'}]
    command['execution']['factRequirements'] = [
        {**command['execution']['factRequirements'][0], 'requirementId': name, 'predicate': name}
        for name in ['P' + str(index) for index in range(8)]]
    # Sparse mode is safe even before the guard exists: no P1 fact means the
    # official matcher stops after the second condition. The static bound is
    # conservative, so this still exercises the independent-variable refusal.
    command['facts'] = [
        {**command['facts'][0], 'factId': name + '-' + str(index), 'statement': name + '(v' + str(index) + ')',
         'requirementId': name, 'locator': '/records/' + name + '/' + str(index)}
        for name in (['P' + str(index) for index in range(8)] if dense else ['P0'])
        for index in range(4)]
    command['targets'] = [{'targetId': 'z', 'positive': 'Z(v0)'}]
    return command


class StudioReasonTests(unittest.TestCase):
    def test_positive_conjunction_keeps_official_rule_and_source_premises(self):
        result = run_reason(fixture())
        self.assertEqual(result['completion'], 'complete')
        self.assertEqual(result['component'], {'name': 'semantica', 'version': '0.7.0'})
        self.assertEqual(result['conclusions'][0]['statement'], 'Eligible(member_1)')
        self.assertEqual(result['conclusions'][0]['ruleId'], 'normal')
        self.assertEqual(set(result['conclusions'][0]['premises']), {'Member(member_1)', 'Normal(member_1)'})
        self.assertEqual(result['assessments'][0]['state'], 'derived')

    def test_explicit_negative_is_not_missing_fact(self):
        command = fixture()
        command['facts'][1]['statement'] = 'Expired(member_1)'
        command['facts'][1]['requirementId'] = 'Expired'
        self.assertEqual(run_reason(command)['assessments'][0]['state'], 'explicit-negative')
        command['facts'].pop()
        self.assertEqual(run_reason(command)['assessments'][0]['state'], 'insufficient-facts')

    def test_conflict_is_retained(self):
        command = fixture()
        command['facts'].append({**command['facts'][1], 'factId': 'expired', 'statement': 'Expired(member_1)', 'requirementId': 'Expired'})
        self.assertEqual(run_reason(command)['assessments'][0]['state'], 'conflict')

    def test_multiple_rules_preserve_native_union_with_attribution_limit(self):
        command = fixture()
        command['execution']['rules'].append({'ruleId': 'grace', 'ruleItemId': 'grace-rule',
                                              'conditions': ['Member(?m)', 'Expired(?m)'], 'conclusion': 'Eligible(?m)'})
        command['facts'].append({**command['facts'][0], 'factId': 'grace', 'statement': 'Expired(member_1)', 'requirementId': 'Expired'})
        result = run_reason(command)
        self.assertEqual(result['completion'], 'complete')
        conclusion = next(c for c in result['conclusions'] if c['statement'] == 'Eligible(member_1)')
        self.assertEqual(conclusion['ruleId'], 'normal')
        self.assertEqual(set(conclusion['premises']), {'Member(member_1)', 'Normal(member_1)', 'Expired(member_1)'})
        self.assertEqual(conclusion['provenanceCompleteness'], 'primary-rule-with-merged-premises')
        self.assertEqual(conclusion['premisesNature'], 'engine-reported-union')

    def test_reverse_order_chain_is_complete_with_sufficient_budget(self):
        command = fixture()
        for name in ['Ready', 'Accepted']:
            command['execution']['predicates'].append({**command['execution']['predicates'][0], 'predicate': name})
        command['execution']['rules'][0:0] = [
            {'ruleId': 'accept', 'ruleItemId': 'accept', 'conditions': ['Ready(?m)'], 'conclusion': 'Accepted(?m)'},
            {'ruleId': 'ready', 'ruleItemId': 'ready', 'conditions': ['Eligible(?m)'], 'conclusion': 'Ready(?m)'}]
        result = run_reason(command)
        self.assertEqual(result['completion'], 'complete')
        self.assertIn('Accepted(member_1)', [c['statement'] for c in result['conclusions']])
        command['budget']['maxIterations'] = 1
        result = run_reason(command)
        self.assertEqual(result['completion'], 'incomplete')
        self.assertNotIn('Accepted(member_1)', [c['statement'] for c in result['conclusions']])

    def test_cycle_is_unsupported_without_running_a_fallback(self):
        command = fixture()
        command['execution']['rules'].append({'ruleId': 'cycle', 'ruleItemId': 'cycle',
                                              'conditions': ['Eligible(?m)'], 'conclusion': 'Member(?m)'})
        result = run_reason(command)
        self.assertEqual(result['completion'], 'unsupported')
        self.assertEqual(result['conclusions'], [])

    def test_unbound_variable_arity_and_active_expressions_are_unsupported(self):
        for expression in ['Eligible(?unbound)', 'Eligible(?m, ?m)', 'NOT Eligible(?m)',
                           'Eligible(__import__(os))', 'Eligible(?m) OR Ineligible(?m)']:
            with self.subTest(expression=expression):
                command = fixture()
                command['execution']['rules'][0]['conclusion'] = expression
                self.assertEqual(run_reason(command)['completion'], 'unsupported')

    def test_callback_and_action_fields_are_never_accepted(self):
        command = fixture()
        command['execution']['rules'][0]['actions'] = [{'type': 'call', 'name': 'dangerous'}]
        self.assertEqual(run_reason(command)['completion'], 'unsupported')

    def test_fact_predicate_must_match_exact_declared_requirement(self):
        command = fixture()
        command['facts'][0]['requirementId'] = 'Normal'
        result = run_reason(command)
        self.assertEqual(result['completion'], 'unsupported')
        self.assertFalse(result['engineInvoked'])

    def test_requested_budget_cannot_exceed_host_caps(self):
        command = fixture()
        command['budget']['maxIterations'] = 1000
        self.assertEqual(run_reason(command)['completion'], 'unsupported')

    def test_independent_variable_resource_boundary_rejects_before_sdk_dispatch(self):
        result = run_reason(independent_variables_fixture())
        self.assertEqual(result['completion'], 'incomplete')
        self.assertFalse(result['engineInvoked'])
        self.assertFalse(result['processed']['sdkInvoked'])
        self.assertEqual(result['conclusions'], [])
        self.assertIn('static-inference-resource-bound-exceeded', result['limitations'])
        self.assertEqual(result['processed']['staticResourceBounds']['maxBindings'], 65536)
        self.assertEqual(result['processed']['staticResourceBounds']['fixedLimit'], 8192)
        # Only reach the dense shape after the safe sparse refusal proved the
        # guard exists. No high-load SDK experiment is executed in either case.
        dense = run_reason(independent_variables_fixture(dense=True))
        self.assertEqual(dense['completion'], 'incomplete')
        self.assertFalse(dense['engineInvoked'])
        self.assertEqual(dense['processed']['staticResourceBounds']['maxBindings'], 65536)

    def test_zero_arity_and_empty_domain_have_a_finite_resource_bound(self):
        command = fixture()
        command['facts'] = []
        empty = run_reason(command)
        self.assertTrue(empty['engineInvoked'])
        self.assertEqual(empty['processed']['staticResourceBounds']['domainValues'], 0)
        self.assertEqual(empty['processed']['staticResourceBounds']['domainSizeForBound'], 1)
        command['execution']['predicates'] = [
            {**command['execution']['predicates'][0], 'predicate': name, 'arguments': []}
            for name in ['P', 'Z']]
        command['execution']['rules'] = [{'ruleId': 'ground', 'ruleItemId': 'ground', 'conditions': ['P()'], 'conclusion': 'Z()'}]
        command['execution']['factRequirements'] = [{**fixture()['execution']['factRequirements'][0], 'requirementId': 'P', 'predicate': 'P'}]
        command['facts'] = [{**fixture()['facts'][0], 'statement': 'P()', 'requirementId': 'P'}]
        command['targets'] = [{'targetId': 'zero', 'positive': 'Z()'}]
        result = run_reason(command)
        self.assertEqual(result['completion'], 'complete')
        self.assertEqual(result['assessments'][0]['state'], 'derived')
        self.assertEqual(result['processed']['staticResourceBounds']['maxBindings'], 1)
        self.assertEqual(result['processed']['staticResourceBounds']['maxWorkingFacts'], 2)

    def test_rule_literal_constants_are_included_in_the_resource_domain(self):
        command = fixture()
        command['execution']['rules'][0]['conclusion'] = 'Eligible(rule_literal)'
        result = run_reason(command)
        self.assertEqual(result['completion'], 'complete')
        self.assertEqual(result['processed']['staticResourceBounds']['domainValues'], 2)
        self.assertEqual(result['processed']['staticResourceBounds']['maxBindings'], 2)

    def test_total_working_fact_boundary_is_checked_separately_from_bindings(self):
        # Establish refusal on a safe sparse input before attempting this
        # larger static shape; a removed guard cannot run a large inference.
        self.assertFalse(run_reason(independent_variables_fixture())['engineInvoked'])
        command = boundary_fixture()
        command['execution']['predicates'] = [command['execution']['predicates'][0]] + [
            {**command['execution']['predicates'][0], 'predicate': 'A' + str(index)} for index in range(32)]
        command['execution']['rules'] = [
            {'ruleId': 'r' + str(index), 'ruleItemId': 'r' + str(index), 'conditions': ['P(?m)'],
             'conclusion': 'A' + str(index) + '(?m)'} for index in range(32)]
        command['targets'] = [{'targetId': 'last', 'positive': 'A31(m255)'}]
        result = run_reason(command)
        self.assertEqual(result['completion'], 'incomplete')
        self.assertFalse(result['engineInvoked'])
        self.assertEqual(result['processed']['staticResourceBounds']['maxBindings'], 256)
        self.assertEqual(result['processed']['staticResourceBounds']['maxWorkingFacts'], 8448)

    def test_public_worker_refuses_independent_variable_resource_boundary(self):
        process = subprocess.run([sys.executable, '-m', 'scripts.fourbase_l2.studio_reason'],
                                 input=json.dumps(independent_variables_fixture()) + '\n', capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        message = json.loads(process.stdout)
        self.assertEqual(message['type'], 'result')
        self.assertEqual(message['result']['completion'], 'incomplete')
        self.assertFalse(message['result']['engineInvoked'])

    def test_facts_do_not_leak_between_requests(self):
        self.assertTrue(run_reason(fixture())['conclusions'])
        command = fixture()
        command['facts'] = []
        self.assertEqual(run_reason(command)['conclusions'], [])

    def test_coverage_gap_does_not_claim_complete_input(self):
        command = fixture()
        command['coverage']['complete'] = False
        command['coverage']['missingRequirementIds'] = ['source-events']
        result = run_reason(command)
        self.assertEqual(result['completion'], 'incomplete')
        self.assertIn('input-coverage-incomplete', result['limitations'])

    def test_input_and_output_budgets_are_explicit(self):
        command = fixture()
        command['budget']['maxFacts'] = 1
        self.assertEqual(run_reason(command)['completion'], 'incomplete')
        command = fixture()
        command['budget']['maxConclusions'] = 0
        result = run_reason(command)
        self.assertEqual(result['completion'], 'incomplete')
        self.assertEqual(result['conclusions'], [])

    def test_conclusion_boundary_retains_derived_target_outside_returned_page(self):
        result = run_reason(boundary_fixture())
        self.assertEqual(result['completion'], 'incomplete')
        self.assertTrue(result['engineInvoked'])
        self.assertEqual(len(result['conclusions']), 512)
        self.assertNotIn('C(m255)', [conclusion['statement'] for conclusion in result['conclusions']])
        self.assertEqual(result['assessments'], [{'targetId': 'last', 'state': 'derived'}])
        self.assertEqual(result['processed']['officialConclusions'], 768)
        self.assertEqual(result['processed']['returnedConclusions'], 512)
        self.assertTrue(result['processed']['conclusionsTruncated'])

    def test_conclusion_boundary_retains_conflict_when_either_polarity_is_omitted(self):
        command = boundary_fixture()
        command['targets'] = [
            {'targetId': 'negative-omitted', 'positive': 'B(m255)', 'negative': 'C(m255)'},
            {'targetId': 'positive-omitted', 'positive': 'C(m255)', 'negative': 'B(m255)'}]
        result = run_reason(command)
        self.assertEqual(result['completion'], 'incomplete')
        returned = {conclusion['statement'] for conclusion in result['conclusions']}
        self.assertIn('B(m255)', returned)
        self.assertNotIn('C(m255)', returned)
        self.assertEqual(result['assessments'], [
            {'targetId': 'negative-omitted', 'state': 'conflict'},
            {'targetId': 'positive-omitted', 'state': 'conflict'}])

    def test_public_worker_boundary_uses_full_official_results_for_assessment(self):
        command = boundary_fixture()
        command['targets'][0]['negative'] = 'B(m255)'
        process = subprocess.run([sys.executable, '-m', 'scripts.fourbase_l2.studio_reason'],
                                 input=json.dumps(command) + '\n', capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        message = json.loads(process.stdout)
        self.assertEqual(message['type'], 'result')
        self.assertEqual(message['result']['completion'], 'incomplete')
        self.assertEqual(message['result']['assessments'][0]['state'], 'conflict')
        self.assertEqual(message['result']['processed']['officialConclusions'], 768)

    def test_unknown_contract_or_engine_is_unsupported(self):
        for field, value in [('contractVersion', 'studio-rule-execution/999'), ('engine', {'name': 'other', 'version': '1'})]:
            command = fixture()
            command['execution'][field] = value
            self.assertEqual(run_reason(command)['completion'], 'unsupported')

    def test_shacl_checks_declared_fact_projection(self):
        command = fixture()
        command['execution']['constraints'] = {
            'format': 'shacl-turtle', 'sourceRefs': [command['facts'][0]['sourceRefs'][0]],
            'shapes': '''@prefix ex: <https://example.invalid/rules/> .
              @prefix sh: <http://www.w3.org/ns/shacl#> .
              @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
              ex:MemberShape a sh:NodeShape; sh:targetClass ex:Member;
                sh:property [sh:path ex:member; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1] .'''}
        self.assertTrue(run_reason(command)['constraints']['conforms'])
        command['execution']['constraints']['shapes'] = command['execution']['constraints']['shapes'].replace('sh:path ex:member', 'sh:path ex:missing')
        self.assertFalse(run_reason(command)['constraints']['conforms'])

    def test_raw_path_and_sparql_or_js_shapes_are_unsupported(self):
        for shapes in ['/etc/passwd', '@prefix sh: <http://www.w3.org/ns/shacl#> . <urn:s> sh:sparql [sh:select "SELECT * WHERE {?s ?p ?o}"] .',
                       '@prefix owl: <http://www.w3.org/2002/07/owl#> . <urn:s> owl:imports <https://example.invalid/remote> .',
                       '@prefix sh: <http://www.w3.org/ns/shacl#> . <urn:s> sh:js "run" .']:
            with self.subTest(shapes=shapes):
                command = fixture()
                command['execution']['constraints'] = {'format': 'shacl-turtle', 'shapes': shapes, 'sourceRefs': []}
                self.assertEqual(run_reason(command)['completion'], 'unsupported')

    def test_stdout_protocol_contains_only_the_single_result(self):
        result = subprocess.run([sys.executable, '-m', 'scripts.fourbase_l2.studio_reason'],
                                input=json.dumps(fixture()) + '\n', capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])['type'], 'result')
        self.assertEqual(json.loads(lines[0])['result']['completion'], 'complete')

    def test_observed_conclusion_predicate_is_not_silently_swallowed_by_new_only_sdk_results(self):
        command = fixture()
        command['facts'][1]['statement'] = 'Expired(member_1)'
        command['facts'][1]['requirementId'] = 'Expired'
        command['execution']['factRequirements'].append({**command['execution']['factRequirements'][0], 'requirementId': 'Eligible', 'predicate': 'Eligible'})
        command['facts'].append({**command['facts'][0], 'factId': 'observed-eligible', 'statement': 'Eligible(member_1)', 'requirementId': 'Eligible'})
        result = run_reason(command)
        self.assertEqual(result['completion'], 'unsupported')
        self.assertFalse(result['engineInvoked'])
        self.assertIn('external-fact-shadows-rule-conclusion', result['limitations'])


if __name__ == '__main__':
    unittest.main()
