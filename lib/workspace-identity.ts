/** Identity headers are supplied and protected by the Sites dispatcher. */
export type WorkspaceIdentity = {
  primaryKey: string;
  lookupKeys: string[];
  actor: string;
  accessMode?: 'shared' | 'password';
};

export async function workspaceIdentity(
  headers: Pick<Headers, 'get'>,
): Promise<WorkspaceIdentity | null> {
  const id = headers.get('oai-authenticated-user-id')?.trim();
  const email = headers.get('oai-authenticated-user-email')?.trim();
  if (!id && !email) return null;

  // The current deployment forwards verified email without a stable ID.
  // Preserve the email's local-part case and never fall back to a display name.
  let emailKey: string | undefined;
  if (email) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
    emailKey = 'verified-email:v1:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  return {
    // Newly created email-backed workspaces remain consistent if an ID starts
    // appearing later. Existing ID-backed rows are still looked up first.
    primaryKey: emailKey ?? id!,
    lookupKeys: [id, emailKey].filter((key): key is string => !!key),
    actor: email ?? 'Workspace owner',
  };
}
