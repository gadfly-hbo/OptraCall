#!/usr/bin/env python3
"""Replace one slide of a .pptx with a single-slide replacement deck.

Every other zip entry stays byte-identical. When the replacement slide
references media through slide relationships, the related parts are
copied with new rIds and [Content_Types].xml gains the needed defaults.
The replaced slide keeps its own layout and non-media relationships.
The replacement deck must use the same slide size as the target deck.
No external dependencies.
"""
import argparse
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

R_ID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'


def assert_editable(deck_path, slide):
    """Hard lock gate: deck meta.json lockedPages wins over any prompt."""
    meta_path = os.path.join(os.path.dirname(os.path.abspath(deck_path)), 'meta.json')
    if not os.path.exists(meta_path):
        return
    try:
        with open(meta_path, encoding='utf-8') as f:
            locked = json.load(f).get('lockedPages', [])
    except (OSError, ValueError):
        return
    if slide in locked:
        print(f'PAGE_LOCKED: slide {slide} is locked and must stay byte-identical', file=sys.stderr)
        sys.exit(5)



def slide_size(entries):
    pres = entries['ppt/presentation.xml'].decode('utf-8')
    m = re.search(r'<p:sldSz cx="(\d+)" cy="(\d+)"', pres)
    return (m.group(1), m.group(2)) if m else None


def load_zip(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def write_zip(path, entries, order):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as out:
        seen = set()
        for name in order:
            if name in entries and name not in seen:
                out.writestr(name, entries[name])
                seen.add(name)
        for name, data in entries.items():
            if name not in seen:
                out.writestr(name, data)


def media_content_type(ext):
    return 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'


def part_path(target):
    return ('ppt/' + target[3:]) if target.startswith('../') else ('ppt/slides/' + target)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deck', required=True)
    ap.add_argument('--replacement', required=True)
    ap.add_argument('--slide', type=int, required=True, help='1-based slide index to replace')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    src = load_zip(args.deck)
    rep = load_zip(args.replacement)
    target_part = f'ppt/slides/slide{args.slide}.xml'
    if target_part not in src:
        print(f'ERROR: {target_part} not found in deck', file=sys.stderr)
        return 2
    assert_editable(args.deck, args.slide)
    if slide_size(src) != slide_size(rep):
        print('ERROR: slide size mismatch; regenerate replacement at target deck sldSz', file=sys.stderr)
        return 2

    new_slide = rep['ppt/slides/slide1.xml']
    new_media = {}
    image_rels = []
    chart_rels = []
    new_chart_parts = {}
    rels_name = 'ppt/slides/_rels/slide1.xml.rels'
    if rels_name in rep:
        rels = ET.fromstring(rep[rels_name])
        for rel in rels.findall(f'{{{PKG_REL_NS}}}Relationship'):
            rid = rel.get('Id')
            rtype = rel.get('Type') or ''
            target = rel.get('Target') or ''
            if rtype.endswith('/image'):
                source_name = part_path(target).replace('ppt/slides/ppt/', 'ppt/')
                if source_name not in rep:
                    print(f'ERROR: media part missing in replacement: {source_name}', file=sys.stderr)
                    return 2
                media_name = f'ppt/media/spliced-{args.slide}-{rid}-{target.rsplit("/", 1)[-1]}'
                new_media[media_name] = rep[source_name]
                new_rid = f'rSpliced{args.slide}x{rid}'
                for attr in ('r:id', 'r:embed'):
                    new_slide = new_slide.replace(f'{attr}="{rid}"'.encode(), f'{attr}="{new_rid}"'.encode())
                image_rels.append((new_rid, rtype, media_name.replace('ppt/', '../')))
            elif rtype.endswith('/chart'):
                chart_source = part_path(target).replace('ppt/slides/ppt/', 'ppt/')
                if chart_source not in rep:
                    print(f'ERROR: chart part missing in replacement: {chart_source}', file=sys.stderr)
                    return 2
                chart_name = f'ppt/charts/spliced-{args.slide}-{chart_source.rsplit("/", 1)[-1]}'
                new_rid = f'rSpliced{args.slide}c{rid}'
                for attr in ('r:id', 'r:embed'):
                    new_slide = new_slide.replace(f'{attr}="{rid}"'.encode(), f'{attr}="{new_rid}"'.encode())
                chart_xml = rep[chart_source]
                # chart's own relationships (embedded workbook etc.)
                chart_rels_name = chart_source.replace('charts/', 'charts/_rels/') + '.rels'
                if chart_rels_name in rep:
                    crels = ET.fromstring(rep[chart_rels_name])
                    for crel in crels.findall(f'{{{PKG_REL_NS}}}Relationship'):
                        crid = crel.get('Id')
                        ctype = crel.get('Type') or ''
                        ctarget = crel.get('Target') or ''
                        if not (ctype.endswith('/package') or ctype.endswith('/oleObject')):
                            continue
                        emb_source = ('ppt/' + ctarget[3:]) if ctarget.startswith('../') else ('ppt/charts/' + ctarget)
                        emb_source = emb_source.replace('ppt/charts/ppt/', 'ppt/')
                        if emb_source not in rep:
                            print(f'ERROR: embedded part missing in replacement: {emb_source}', file=sys.stderr)
                            return 2
                        emb_name = f'ppt/embeddings/spliced-{args.slide}-{emb_source.rsplit("/", 1)[-1]}'
                        new_chart_parts[emb_name] = rep[emb_source]
                        new_crid = f'rSpliced{args.slide}w{crid}'
                        for attr in ('r:id', 'r:embed'):
                            chart_xml = chart_xml.replace(f'{attr}="{crid}"'.encode(), f'{attr}="{new_crid}"'.encode())
                        crel.set('Id', new_crid)
                        crel.set('Target', emb_name.replace('ppt/', '../'))
                    ET.register_namespace('', PKG_REL_NS)
                    new_chart_parts[chart_name.replace('charts/', 'charts/_rels/') + '.rels'] = ET.tostring(crels, encoding='utf-8', xml_declaration=True)
                new_chart_parts[chart_name] = chart_xml
                chart_rels.append((new_rid, rtype, chart_name.replace('ppt/', '../')))

    # The replaced slide keeps its own layout and non-media relationships.
    # Its old image/notes relationships are dropped; new media relationships
    # are appended with fresh rIds. Without such changes the original rels
    # bytes are preserved untouched.
    target_rels_name = target_part.replace('slides/', 'slides/_rels/') + '.rels'
    dropped_notes_part = None
    write_rels = bool(new_media) or bool(chart_rels)
    if target_rels_name in src:
        rels = ET.fromstring(src[target_rels_name])
        for rel in list(rels.findall(f'{{{PKG_REL_NS}}}Relationship')):
            rtype = rel.get('Type') or ''
            target = rel.get('Target') or ''
            if rtype.endswith('/image') or rtype.endswith('/chart'):
                rels.remove(rel)
                write_rels = True
            elif rtype.endswith('/notesSlide'):
                rels.remove(rel)
                dropped_notes_part = part_path(target).replace('ppt/slides/ppt/', 'ppt/')
                write_rels = True
        for new_rid, rtype, target in image_rels + chart_rels:
            node = ET.SubElement(rels, f'{{{PKG_REL_NS}}}Relationship')
            node.set('Id', new_rid)
            node.set('Type', rtype)
            node.set('Target', target)
        new_rels = ET.tostring(rels, encoding='utf-8', xml_declaration=True) if write_rels else None
    elif image_rels or chart_rels:
        print('ERROR: target slide has no relationships file to preserve layout', file=sys.stderr)
        return 2
    else:
        new_rels = None

    out_entries = dict(src)
    out_entries[target_part] = new_slide
    out_entries.update(new_media)
    out_entries.update(new_chart_parts)
    if dropped_notes_part:
        out_entries.pop(dropped_notes_part, None)
        out_entries.pop(dropped_notes_part.replace('notesSlides/', 'notesSlides/_rels/') + '.rels', None)
    if new_rels is not None:
        ET.register_namespace('', PKG_REL_NS)
        out_entries[target_rels_name] = new_rels
    if new_media or new_chart_parts:
        ct = ET.fromstring(out_entries['[Content_Types].xml'])
        existing = {d.get('Extension') for d in ct.findall(f'{{{CT_NS}}}Default')}
        existing_overrides = {o.get('PartName') for o in ct.findall(f'{{{CT_NS}}}Override')}
        for name in new_media:
            ext = name.rsplit('.', 1)[-1].lower()
            if ext not in existing:
                node = ET.SubElement(ct, f'{{{CT_NS}}}Default')
                node.set('Extension', ext)
                node.set('ContentType', media_content_type(ext))
        for name in new_chart_parts:
            if name.endswith('.xml') and '/charts/' in name and not name.endswith('.rels'):
                part_name = '/' + name
                if part_name not in existing_overrides:
                    node = ET.SubElement(ct, f'{{{CT_NS}}}Override')
                    node.set('PartName', part_name)
                    node.set('ContentType', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
            else:
                ext = name.rsplit('.', 1)[-1].lower()
                if ext not in existing:
                    node = ET.SubElement(ct, f'{{{CT_NS}}}Default')
                    node.set('Extension', ext)
                    node.set('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' if ext == 'xlsx' else media_content_type(ext))
        ET.register_namespace('', CT_NS)
        out_entries['[Content_Types].xml'] = ET.tostring(ct, encoding='utf-8', xml_declaration=True)

    write_zip(args.out, out_entries, list(src.keys()))
    print(f'OK: replaced slide {args.slide} -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
