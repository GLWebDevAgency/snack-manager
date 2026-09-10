import { createPortal } from 'react-dom';
import type { ModalSurfaceProps } from './ModalSurface';

/** Le portail évite les contextes d'empilement du catalogue et de son dock frère. */
export function ModalSurface({ compact, children }: ModalSurfaceProps) {
  return compact && typeof document !== 'undefined' ? createPortal(children, document.body) : children;
}
