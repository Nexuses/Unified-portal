import type { CrmContactInput, CrmList, ImportSummary } from "@/lib/crm";

/** Request size for each import POST — total list size is unlimited. */
export const CRM_IMPORT_CHUNK_SIZE = 500;

export type ChunkedImportProgress = {
  phase: "create" | "import";
  done: number;
  total: number;
};

export async function readResponseJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      response.ok
        ? "Server returned an invalid response. Try again — some contacts may already be saved."
        : `Upload failed (${response.status}). The server timed out or returned an error page. Check the list; some contacts may already be saved.`,
    );
  }
}

function emptySummary(): ImportSummary {
  return {
    imported: 0,
    skipped: 0,
    companiesCreated: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
  };
}

function mergeSummaries(a: ImportSummary, b: ImportSummary): ImportSummary {
  return {
    imported: a.imported + b.imported,
    skipped: a.skipped + b.skipped,
    companiesCreated: a.companiesCreated + b.companiesCreated,
    contactsCreated: a.contactsCreated + b.contactsCreated,
    contactsUpdated: a.contactsUpdated + b.contactsUpdated,
  };
}

function chunkContacts(contacts: CrmContactInput[], size = CRM_IMPORT_CHUNK_SIZE) {
  const chunks: CrmContactInput[][] = [];
  for (let index = 0; index < contacts.length; index += size) {
    chunks.push(contacts.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [[]];
}

/**
 * Create a list (empty), then import contacts in chunks so large CSVs
 * of any size do not hit a single long request / proxy timeout.
 */
export async function createListWithChunkedImport(input: {
  name: string;
  contacts: CrmContactInput[];
  importFileName?: string;
  onProgress?: (progress: ChunkedImportProgress) => void;
}): Promise<{ list: CrmList; importSummary: ImportSummary }> {
  const { name, contacts, importFileName, onProgress } = input;
  onProgress?.({ phase: "create", done: 0, total: contacts.length });

  const createResponse = await fetch("/api/crm/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      contacts: [],
      importFileName,
    }),
  });
  const createData = await readResponseJson<{
    error?: string;
    list?: CrmList;
  }>(createResponse);
  if (!createResponse.ok || !createData.list?.id) {
    throw new Error(createData.error || "Failed to create list");
  }

  const list = createData.list;
  if (contacts.length === 0) {
    return { list, importSummary: emptySummary() };
  }

  let importSummary = emptySummary();
  let done = 0;
  for (const chunk of chunkContacts(contacts)) {
    onProgress?.({ phase: "import", done, total: contacts.length });
    const response = await fetch(`/api/crm/lists/${encodeURIComponent(list.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: chunk }),
    });
    const data = await readResponseJson<{
      error?: string;
      list?: CrmList;
      importSummary?: ImportSummary;
    }>(response);
    if (!response.ok) {
      throw new Error(
        data.error ||
          `Failed while importing contacts (${done} of ${contacts.length} already processed). Open the list to review.`,
      );
    }
    if (data.importSummary) {
      importSummary = mergeSummaries(importSummary, data.importSummary);
    }
    if (data.list) {
      Object.assign(list, data.list);
    }
    done += chunk.length;
    onProgress?.({ phase: "import", done, total: contacts.length });
  }

  return { list, importSummary };
}

/** Append contacts to an existing list in chunks. */
export async function appendContactsInChunks(input: {
  listId: string;
  contacts: CrmContactInput[];
  onProgress?: (progress: ChunkedImportProgress) => void;
}): Promise<{ list?: CrmList; importSummary: ImportSummary }> {
  const { listId, contacts, onProgress } = input;
  let importSummary = emptySummary();
  let list: CrmList | undefined;
  let done = 0;

  for (const chunk of chunkContacts(contacts)) {
    onProgress?.({ phase: "import", done, total: contacts.length });
    const response = await fetch(`/api/crm/lists/${encodeURIComponent(listId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: chunk }),
    });
    const data = await readResponseJson<{
      error?: string;
      list?: CrmList;
      importSummary?: ImportSummary;
    }>(response);
    if (!response.ok) {
      throw new Error(
        data.error ||
          `Failed while importing contacts (${done} of ${contacts.length} already processed).`,
      );
    }
    if (data.importSummary) {
      importSummary = mergeSummaries(importSummary, data.importSummary);
    }
    if (data.list) {
      list = data.list;
    }
    done += chunk.length;
    onProgress?.({ phase: "import", done, total: contacts.length });
  }

  return { list, importSummary };
}
