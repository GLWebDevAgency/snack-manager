/** Static script: executes ahead of hydration, never embeds a request value. */
export const INVITATION_BOOTSTRAP = `(()=>{if(!location.hash)return;let value=location.hash;try{history.replaceState(history.state,"",location.pathname+location.search)}catch{value=null}Object.defineProperty(window,"__smTakeDeliveryInvitation",{configurable:true,value:()=>{const result=value;value=null;delete window.__smTakeDeliveryInvitation;return result}})})();`;

declare global {
  interface Window { __smTakeDeliveryInvitation?: () => string | null }
}

/** The bridge is removed on first read. Only the page closure retains the link. */
export function capturedInvitation(): string {
  const take = window.__smTakeDeliveryInvitation;
  if (!take) return window.location.hash;
  const fragment = take();
  if (fragment === null) throw new Error("Invitation URL could not be cleared");
  return fragment;
}
