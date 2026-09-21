/** Name of the "hold to select multiple" modifier for this platform, for
 * on-screen hints. Ctrl-click on a Mac is a right-click (no `click` event
 * fires), so Cmd is the documented key there; the click handler itself
 * accepts either key on every platform. */
export const MULTI_SELECT_KEY: 'Cmd' | 'Ctrl' = (() => {
  if (typeof navigator === 'undefined') return 'Ctrl'
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  return /mac|iphone|ipad/i.test(platform) ? 'Cmd' : 'Ctrl'
})()
