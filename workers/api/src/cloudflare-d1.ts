export type D1Row = Record<string, unknown>;

type CloudflareD1Response<T> = {
  success: boolean;
  result?: Array<{
    success: boolean;
    results?: T[];
    meta?: { changes?: number };
  }>;
};

export class CloudflareD1Error extends Error {
  constructor() {
    super("Cloudflare D1 request failed");
    this.name = "CloudflareD1Error";
  }
}

export async function queryUserD1<T extends D1Row>(
  accountId: string,
  databaseId: string,
  token: string,
  sql: string,
  params: unknown[] = [],
  fetcher: typeof fetch = fetch,
): Promise<{ results: T[]; changes: number }> {
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );

  let result: CloudflareD1Response<T>;
  try {
    result = (await response.json()) as CloudflareD1Response<T>;
  } catch {
    throw new CloudflareD1Error();
  }

  const first = result.result?.[0];
  if (!response.ok || !result.success || !first?.success) {
    throw new CloudflareD1Error();
  }

  return {
    results: first.results ?? [],
    changes: first.meta?.changes ?? 0,
  };
}
