"""Approved finite queries. Qualification precedes matching and traversal.

This module reads the complete current-qualified native view; it never runs
model code, resolves business roots, calculates metrics or chooses a method.
Pagination and source handles remain Host responsibilities.
"""
import copy

from .readmodel import EDGE_TYPES, NODE_TYPES, SnapshotError

MAX_NODES = 200
MAX_EDGES = 500
OPERATIONS = {'find', 'definition', 'neighbors', 'dependencies', 'impact', 'source'}


def _text(value, maximum):
    return (isinstance(value, str) and bool(value) and '\0' not in value
            and len(value.encode('utf-16-le', errors='surrogatepass')) // 2 <= maximum)


def parse_query(value):
    """Independently validate the narrow trusted transport at the worker edge."""
    def require(condition):
        if not condition:
            raise SnapshotError('invalid_query_request')
    require(isinstance(value, dict) and value.get('action') == 'graph')
    operation = value.get('operation')
    require(isinstance(operation, str) and operation in OPERATIONS)
    allowed = {'action', 'operation', 'pageSize', 'continuation'}
    if operation == 'find':
        allowed |= {'query', 'nodeTypes'}
        require(_text(value.get('query'), 200) and bool(value['query'].strip()))
    elif operation == 'source':
        allowed |= {'sourceHandle'}
        require(_text(value.get('sourceHandle'), 4096))
    else:
        allowed |= {'nodeId'}
        require(_text(value.get('nodeId'), 256))
        if operation == 'neighbors':
            allowed |= {'relationTypes', 'direction'}
        elif operation in {'dependencies', 'impact'}:
            allowed |= {'depth'}
    require(set(value) <= allowed)
    for field, choices in [('nodeTypes', NODE_TYPES), ('relationTypes', EDGE_TYPES)]:
        if field in value:
            entries = value[field]
            require(isinstance(entries, list) and all(isinstance(v, str) and v in choices for v in entries)
                    and len(entries) == len(set(entries)))
    if 'direction' in value:
        require(isinstance(value['direction'], str) and value['direction'] in {'out', 'in', 'both'})
    for field, low, high in [('depth', 1, 4), ('pageSize', 1, 100)]:
        if field in value:
            require(type(value[field]) is int and low <= value[field] <= high)
    require(value.get('continuation') is None or _text(value['continuation'], 4096))
    result = copy.deepcopy(value)
    result.setdefault('pageSize', 20)
    result.setdefault('continuation', None)
    if operation == 'find':
        result['query'] = result['query'].strip().lower()
    if operation == 'neighbors':
        result.setdefault('direction', 'both')
    if operation in {'dependencies', 'impact'}:
        result.setdefault('depth', 2)
    return result


def _logical(item, inputs, node):
    """Only D12 semantic fields cross the query boundary, never file records."""
    original = item['metadata']
    fields = ('sourceRefs', 'claimKind', 'conditions', 'limitations', 'businessTime',
              'candidateLocator', 'conditionState', 'operandRole', 'roleText')
    metadata = {k: copy.deepcopy(original[k]) for k in fields if k in original}
    metadata['buildSources'] = []
    for source in original['buildSources']:
        safe = {k: source[k] for k in ('inputKey', 'locator')}
        identity = inputs.get(source['inputKey'])
        if identity is not None:
            safe.update(sha256=identity['sha256'], nature=identity['nature'])
        metadata['buildSources'].append(safe)
    fields = ('id', 'type', 'content') if node else ('id', 'source', 'target', 'type')
    return {**{k: item[k] for k in fields}, 'metadata': metadata}


def _path_key(path):
    return (tuple(path['nodeIds']), tuple((s['edgeId'], s['direction']) for s in path['steps']))


def query_graph(view, query, inputs=()):
    query = parse_query(query)
    # Crucial: do not pass requested IDs to S3. Every necessary source is
    # qualified before matching, counting, adjacency and path construction.
    graph = view.query()
    node_map = {n['id']: n for n in graph['nodes']}
    edges = sorted(graph['edges'], key=lambda e: e['id'])
    gaps = list(graph['gaps'])
    operation = query['operation']
    selected_nodes, selected_edges, paths = set(), {}, []
    depth_limit = query.get('depth')
    depth_reached, exhausted = 0, True

    if operation == 'find':
        types = query.get('nodeTypes')
        selected_nodes = {n['id'] for n in node_map.values()
                          if (types is None or n['type'] in types)
                          and (query['query'] in n['content'].lower()
                               or query['query'] in n['metadata'].get('candidateLocator', '').lower())}
    elif operation == 'source':
        # Internal only. The Host validates its opaque handle, then reads an
        # approved original fragment. Frozen input bodies never leave here.
        selected_nodes = set(node_map)
        selected_edges = {e['id']: e for e in edges}
    else:
        start = query['nodeId']
        if start not in node_map:
            gaps.append('requested-node-unavailable')
        else:
            selected_nodes.add(start)
            if operation == 'neighbors':
                for edge in edges:
                    direction = query['direction']
                    if ((direction in {'out', 'both'} and edge['source'] == start)
                            or (direction in {'in', 'both'} and edge['target'] == start)):
                        if query.get('relationTypes') is None or edge['type'] in query['relationTypes']:
                            selected_edges[edge['id']] = edge
                            selected_nodes.update((edge['source'], edge['target']))
            elif operation in {'dependencies', 'impact'}:
                adjacency = {}
                for edge in edges:
                    if edge['type'] == 'depends_on':
                        source, target, direction = (edge['source'], edge['target'], 'forward') if operation == 'dependencies' else (edge['target'], edge['source'], 'reverse')
                    elif operation == 'impact' and edge['type'] == 'maps_to':
                        source, target, direction = edge['source'], edge['target'], 'forward'
                    else:
                        continue
                    adjacency.setdefault(source, []).append((target, edge, direction))
                frontier = [{'nodeIds': [start], 'steps': []}]
                processed = 0
                for depth in range(1, depth_limit + 1):
                    following = []
                    for path in frontier:
                        for target, edge, direction in adjacency.get(path['nodeIds'][-1], []):
                            if target in path['nodeIds']:
                                continue  # finite simple paths, no inferred cycle facts
                            if processed >= MAX_EDGES:
                                exhausted = False
                                gaps.append('edge-limit')
                                break
                            processed += 1
                            if target not in selected_nodes and len(selected_nodes) >= MAX_NODES:
                                exhausted = False
                                gaps.append('node-limit')
                                continue
                            extended = {'nodeIds': [*path['nodeIds'], target],
                                        'steps': [*path['steps'], {'edgeId': edge['id'], 'direction': direction}]}
                            selected_nodes.add(target)
                            selected_edges[edge['id']] = edge
                            paths.append(extended)
                            following.append(extended)
                            depth_reached = depth
                    frontier = following
                    if processed >= MAX_EDGES or not frontier:
                        break
                if any(any(target not in p['nodeIds'] for target, _, _ in adjacency.get(p['nodeIds'][-1], [])) for p in frontier):
                    exhausted = False
                    gaps.append('depth-limit' if depth_reached == depth_limit else 'edge-limit')

    identities = {i['inputKey']: i for i in inputs}
    # These are full semantic units. Host pages with their required endpoints,
    # paths, metadata and provenance together under both byte and count limits.
    gaps = sorted(set(gaps))
    return {'state': 'partial' if graph['state'] != 'available' or gaps else 'available',
            'nodes': [_logical(node_map[k], identities, True) for k in sorted(selected_nodes)],
            'edges': [_logical(selected_edges[k], identities, False) for k in sorted(selected_edges)],
            'paths': sorted(paths, key=_path_key), 'gaps': gaps, 'exhausted': exhausted,
            **({'depthLimit': depth_limit, 'depthReached': depth_reached} if depth_limit is not None else {})}
