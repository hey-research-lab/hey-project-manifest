import { isAddress } from './evm.js';
import { issue, type ManifestIssue } from './issues.js';
import { checkRepositoryUrl } from './url.js';

const entries = (value: unknown, key: string): unknown[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list) ? list : [];
};

/**
 * Duplicate contracts (by lowercase address) and duplicate repositories (by
 * canonical URL). Reads any value defensively, so it reports duplicates even
 * when other fields are invalid; entries that are themselves invalid are
 * skipped (they already carry their own issue).
 */
export function findDuplicates(manifest: unknown): ManifestIssue[] {
  const found: ManifestIssue[] = [];

  const seenContracts = new Map<string, number>();
  entries(manifest, 'contracts').forEach((contract, index) => {
    if (contract === null || typeof contract !== 'object') return;
    const address = (contract as Record<string, unknown>).address;
    if (!isAddress(address)) return;
    const key = address.toLowerCase();
    const first = seenContracts.get(key);
    if (first === undefined) {
      seenContracts.set(key, index);
      return;
    }
    found.push(
      issue(
        'duplicate_contract',
        ['contracts', index, 'address'],
        `Contract ${key} is already declared at contracts[${first}]; declare each address once.`,
      ),
    );
  });

  const seenRepositories = new Map<string, number>();
  entries(manifest, 'repositories').forEach((repository, index) => {
    if (typeof repository !== 'string') return;
    const checked = checkRepositoryUrl(repository);
    if (!checked.ok) return;
    const first = seenRepositories.get(checked.key);
    if (first === undefined) {
      seenRepositories.set(checked.key, index);
      return;
    }
    found.push(
      issue(
        'duplicate_repository',
        ['repositories', index],
        `${checked.url} is already declared at repositories[${first}].`,
      ),
    );
  });

  return found;
}
