// ========================================
// SHIPPING ADDRESS
// Riusabile in deviceRequests, shipmentRequests, ecc.
// ========================================

export interface ShippingAddress {
  fullName: string;
  street: string;
  city: string;
  province: string;       // es. "RM", "MI" — sigla provincia italiana
  postalCode: string;     // es. "00100"
  country: string;        // es. "IT" — codice ISO 3166-1 alpha-2
  phone?: string;         // opzionale: numero per il corriere
  notes?: string;         // opzionale: istruzioni di consegna
}

/**
 * Formats a ShippingAddress into a single human-readable string.
 *
 * Example output:
 *   "Mario Rossi — Via Roma 1, 00100 Roma (RM), IT"
 */
export function formatShippingAddress(addr: ShippingAddress): string {
  const lines = [
    addr.fullName,
    `${addr.street}, ${addr.postalCode} ${addr.city} (${addr.province}), ${addr.country}`,
  ];
  if (addr.phone) lines.push(`Tel: ${addr.phone}`);
  if (addr.notes) lines.push(addr.notes);
  return lines.join(" — ");
}
