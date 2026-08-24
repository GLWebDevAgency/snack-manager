/**
 * Reconnaissance d'image PAR LES OCTETS, jamais par l'extension ni par le
 * Content-Type annoncé : les deux sont déclaratifs, et un fichier quelconque
 * renommé `logo.png` doit être refusé À L'ENTRÉE — pas découvert cassé sur
 * un ticket. La même fonction resert AU SERVICE : le type renvoyé au
 * navigateur vient des octets stockés, pas d'une métadonnée à synchroniser.
 *
 * Trois formats, et pas de SVG : un SVG peut embarquer du script, et un logo
 * servi sur la page de commande publique ne doit pas pouvoir en exécuter.
 */
export type FormatImage = 'image/png' | 'image/jpeg' | 'image/webp';

export function detecterImage(octets: Buffer): FormatImage | null {
  if (octets.length < 12) return null;
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  // JPEG : FF D8 FF
  if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'image/jpeg';
  // WebP : « RIFF » …taille… « WEBP »
  if (
    octets.subarray(0, 4).toString('latin1') === 'RIFF' &&
    octets.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
