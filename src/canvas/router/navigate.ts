/** Navigate the explorer by hash. Re-navigating to the current hash re-applies it (e.g. "Show on map" twice). */
export function navigate(hash: string): void {
  if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = hash;
}
