"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./pilotage.module.css";

/** Un vrai viewport CSS, sans application cliente, script, formulaire ou stockage. */
export function CadreApercu({ width, children, title }: { width: number; children: ReactNode; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setAvailable(entry.contentRect.width); });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!mount) return;
    const head = mount.ownerDocument.head;
    const sync = () => {
      for (const node of head.querySelectorAll('[data-preview-style]')) node.remove();
      for (const source of document.head.querySelectorAll('style,link[rel="stylesheet"]')) {
        const copy = source.cloneNode(true) as HTMLElement;
        copy.setAttribute('data-preview-style', ''); head.append(copy);
      }
    };
    sync(); const observer = new MutationObserver(sync); observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [mount]);
  const scale = available ? Math.min(1, available / width) : 0;
  const height = width < 768 ? 780 : 740;
  return <div ref={host} className={styles.canvas}>
    <div className={styles.viewport} style={{ width: width * scale, height: height * scale }}>
      <iframe title={title} aria-hidden tabIndex={-1} sandbox="allow-same-origin" className={styles.frame}
        style={{ width, height, transform: `scale(${scale})` }}
        srcDoc={'<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="preview"></div></body></html>'}
        onLoad={event => { setMount(event.currentTarget.contentDocument?.getElementById('preview') ?? null); }} />
    </div>
    {mount && createPortal(children, mount)}
  </div>;
}
