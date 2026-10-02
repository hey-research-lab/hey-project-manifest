/**
 * No test may touch the network.
 *
 * Remote reads take an injected transport and resolver, so any call reaching
 * the real `fetch` is a mistake: fail loudly instead of making a request.
 */
const blocked = async (input: unknown): Promise<never> => {
  const target = typeof input === 'string' ? input : String(input);
  throw new Error(
    `Network access is disabled in tests. Something tried to fetch ${target}. ` +
      'Drive remote reads with a stubbed transport over saved fixtures.',
  );
};

globalThis.fetch = blocked as unknown as typeof fetch;
