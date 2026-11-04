import { CaseStoreError } from './case-store.ts';
import type { CaseSourcesService } from './case-sources-service.ts';

type Request = { pathname: string; method: string; input?: unknown; searchParams?: URLSearchParams };
export function createCaseSourcesRoutes(service: CaseSourcesService) {
  return async ({ pathname, method, input, searchParams = new URLSearchParams() }: Request) => {
    if (pathname === '/api/case-sources/read' && method === 'POST') return { body: await service.read(input) };
    if (pathname !== '/api/case-sources' || method !== 'GET') return null;
    const pageSize = searchParams.get('pageSize');
    if (pageSize !== null && !/^\d+$/.test(pageSize)) throw new CaseStoreError('invalid_case_sources_page');
    return { body: await service.find({ query: searchParams.get('query') ?? '', ...(searchParams.has('caseId') ? { caseId: searchParams.get('caseId') } : {}),
      includeArchived: searchParams.get('includeArchived') === 'true', ...(pageSize === null ? {} : { pageSize: Number(pageSize) }), continuation: searchParams.get('continuation') }) };
  };
}
