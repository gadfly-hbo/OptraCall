#!/usr/bin/env python3
"""Verify every numeric token in a .pptx appears verbatim in the source report.

Slides and chart caches are read from the OOXML zip (never from PDF text
layers). Exit 0 when all tokens are covered; exit 1 listing uncovered
numbers per slide otherwise. No external dependencies.
"""
import argparse
import json
import re
import sys
import zipfile

NUMBER = re.compile(r'[+\-]?\d[\d,]*(?:\.\d+)?%?')


def slide_numbers(xml_text):
    runs = re.findall(r'<a:t>([^<]*)</a:t>', xml_text)
    tokens = set()
    for run in runs:
        tokens.update(NUMBER.findall(run))
    return tokens


def deck_numbers(pptx_path):
    """Return {part: sorted tokens} for slides and chart caches."""
    out = {}
    with zipfile.ZipFile(pptx_path) as z:
        for name in z.namelist():
            if re.fullmatch(r'ppt/slides/slide\d+\.xml', name):
                tokens = slide_numbers(z.read(name).decode('utf-8'))
                if tokens:
                    out[name] = tokens
            elif re.fullmatch(r'ppt/charts/chart\d+\.xml', name):
                values = set(re.findall(r'<c:v>([^<]*)</c:v>', z.read(name).decode('utf-8')))
                tokens = {v for v in values if NUMBER.fullmatch(v)}
                if tokens:
                    out[name] = tokens
    return out


def report_numbers(report_path):
    with open(report_path, encoding='utf-8') as f:
        return set(NUMBER.findall(f.read()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deck', required=True)
    ap.add_argument('--report', required=True)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    covered = report_numbers(args.report)
    findings = []
    for part, tokens in deck_numbers(args.deck).items():
        missing = sorted(t for t in tokens if t not in covered)
        if missing:
            findings.append({'part': part, 'uncovered': missing})
    if args.json:
        print(json.dumps({'ok': not findings, 'findings': findings}, ensure_ascii=False, indent=2))
    else:
        if findings:
            for item in findings:
                print(f"{item['part']}: uncovered numbers -> {', '.join(item['uncovered'])}")
        else:
            print('OK: every numeric token in the deck is covered verbatim by the report')
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())
