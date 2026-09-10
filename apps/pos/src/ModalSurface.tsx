import type { ReactNode } from 'react';
import { Modal } from 'react-native';

export interface ModalSurfaceProps {
  compact: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Le plein écran natif échappe aux limites du catalogue et au dock compact. */
export function ModalSurface({ compact, onClose, children }: ModalSurfaceProps) {
  return compact
    ? <Modal transparent visible animationType="none" onRequestClose={onClose}>{children}</Modal>
    : children;
}
