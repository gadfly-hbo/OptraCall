"""Resolve displayed slide numbers through the presentation's OPC relationships."""
import posixpath
import re
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

PRESENTATION_NAMESPACES = (
    'http://schemas.openxmlformats.org/presentationml/2006/main',
    'http://purl.oclc.org/ooxml/presentationml/main',
)
DOCUMENT_REL_NAMESPACES = (
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'http://purl.oclc.org/ooxml/officeDocument/relationships',
)
PACKAGE_REL_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships'


def relationship_part(part):
    return posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')


def resolve_part(source, target):
    """Resolve an internal relationship URI, refusing an escape from the package."""
    if not target or re.search(r'%(?![0-9a-fA-F]{2})', target):
        raise ValueError('missing or invalid package relationship target')
    uri = urlsplit(target)
    if uri.scheme or uri.netloc or uri.query or uri.fragment:
        raise ValueError('relationship target is not an internal package part')
    target = unquote(uri.path, errors='strict')
    if '\\' in target or '\x00' in target:
        raise ValueError('invalid package relationship path')
    part = posixpath.normpath(target[1:] if target.startswith('/') else posixpath.join(posixpath.dirname(source), target))
    if part in ('', '.', '..') or part.startswith(('../', '/')):
        raise ValueError('package relationship escapes root')
    return part


def ordered_slide_parts(entries):
    """Return actual ZIP parts in the order shown by PowerPoint and page rendering."""
    presentation = 'ppt/presentation.xml'
    rels_part = relationship_part(presentation)
    if presentation not in entries or rels_part not in entries:
        raise ValueError('presentation or its relationships are missing')
    root = ET.fromstring(entries[presentation])
    namespace = next((ns for ns in PRESENTATION_NAMESPACES if root.tag == '{' + ns + '}presentation'), None)
    if namespace is None:
        raise ValueError('invalid presentation root')
    slide_list = root.find('{' + namespace + '}sldIdLst')
    if slide_list is None or not len(slide_list):
        raise ValueError('presentation slide order is missing')
    relationships = ET.fromstring(entries[rels_part])
    if relationships.tag != '{' + PACKAGE_REL_NAMESPACE + '}Relationships':
        raise ValueError('invalid presentation relationships root')
    by_id = {}
    for relation in relationships:
        rid = relation.get('Id')
        if relation.tag != '{' + PACKAGE_REL_NAMESPACE + '}Relationship' or not rid or rid in by_id:
            raise ValueError('invalid or duplicate presentation relationship')
        by_id[rid] = relation
    result = []
    used_ids = set()
    for slide in slide_list:
        rid = next((slide.get('{' + ns + '}id') for ns in DOCUMENT_REL_NAMESPACES if slide.get('{' + ns + '}id')), None)
        if slide.tag != '{' + namespace + '}sldId' or not rid or rid in used_ids:
            raise ValueError('invalid or duplicate slide order reference')
        used_ids.add(rid)
        relation = by_id.get(rid)
        if relation is None or not relation.get('Type', '').endswith('/slide'):
            raise ValueError('slide relationship is missing or has the wrong type')
        if relation.get('TargetMode', 'Internal') != 'Internal':
            raise ValueError('slide relationship must be internal')
        part = resolve_part(presentation, relation.get('Target', ''))
        if part not in entries or part in result:
            raise ValueError('slide part is missing or repeated')
        if ET.fromstring(entries[part]).tag != '{' + namespace + '}sld':
            raise ValueError('invalid slide part root')
        result.append(part)
    return result


def slide_part(entries, page):
    parts = ordered_slide_parts(entries)
    if page < 1 or page > len(parts):
        raise ValueError(f'displayed slide {page} is out of range')
    return parts[page - 1]
