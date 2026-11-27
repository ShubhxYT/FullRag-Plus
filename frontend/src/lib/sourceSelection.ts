/**
 * Which documents new questions are limited to (the source picker).
 * An empty list means "all documents". Persisted per browser.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'fullrag.sources.v1';
const listeners = new Set<() => void>();

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

let selected: string[] = load();

export function getSelectedSources(): string[] {
  return selected;
}

export function setSelectedSources(ids: string[]) {
  selected = Array.from(new Set(ids));
  try {
    localStorage.setItem(KEY, JSON.stringify(selected));
  } catch {
    /* storage full / private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSelectedSources(): string[] {
  return useSyncExternalStore(subscribe, getSelectedSources, getSelectedSources);
}
