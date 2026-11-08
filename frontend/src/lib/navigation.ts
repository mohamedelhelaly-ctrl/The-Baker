/** Leaving the app for an outside page (the card payment page). A function, so tests can replace it. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
