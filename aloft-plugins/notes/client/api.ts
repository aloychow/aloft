import { useRpc } from "@getpaseo/plugin/client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { notesIndex, notesLinks, notesSearch, notesStatus } from "../shared/contracts";

const ROOT = ["aloft-notes"] as const;
const STATUS_POLL_MS = 1500;

/**
 * The daemon bumps a revision on every vault change, including edits made in other editors.
 * Polling that number is cheap; the full index is fetched only when it moves.
 */
export function useVault() {
  const status = useRpc(notesStatus);
  const index = useRpc(notesIndex);
  const statusQuery = useQuery({
    queryKey: [...ROOT, "status"],
    queryFn: () => status({}),
    refetchInterval: STATUS_POLL_MS,
  });
  const revision = statusQuery.data?.revision ?? null;
  const indexQuery = useQuery({
    queryKey: [...ROOT, "index", revision],
    queryFn: () => index({}),
    enabled: revision !== null && revision >= 0,
    placeholderData: keepPreviousData,
  });
  return {
    status: statusQuery.data ?? null,
    statusError: statusQuery.error,
    index: indexQuery.data ?? null,
    revision,
  };
}

export function useNoteLinks(path: string | null, revision: number | null) {
  const links = useRpc(notesLinks);
  return useQuery({
    queryKey: [...ROOT, "links", path, revision],
    queryFn: () => links({ path: path ?? "" }),
    enabled: path !== null,
    placeholderData: keepPreviousData,
  });
}

export function useNoteSearch(query: string, revision: number | null) {
  const search = useRpc(notesSearch);
  const trimmed = query.trim();
  return useQuery({
    queryKey: [...ROOT, "search", trimmed, revision],
    queryFn: () => search({ query: trimmed, limit: 100 }),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Refetches status (and with it the index) right after this client changes the vault. */
export function useRefreshVault() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: [...ROOT, "status"] }),
    [queryClient],
  );
}
