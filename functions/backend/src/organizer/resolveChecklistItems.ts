import type { Firestore } from "firebase-admin/firestore";

/**
 * Risolve gli itemId referenziati in `checklists/{id}.items` (EA-137: da
 * quando gli item non sono più un array embedded, `items` è un array di
 * soli `itemId`) leggendo i documenti reali corrispondenti nella
 * collection `checklistItems`.
 *
 * Usa `db.getAll` sui `DocumentReference` diretti, non una query `in`:
 * quest'ultima ha un limite di 30 valori in Firestore, che una checklist
 * con più item supererebbe (EA-138).
 *
 * Condivisa da `getChecklist` (restituisce gli item completi al consumer)
 * e `getChecklistCompleteness` (applica il gate di completezza sugli
 * stessi item risolti) — entrambi devono risolvere lo stesso riferimento
 * prima di poterlo usare.
 */
export async function resolveChecklistItems(
  db: Firestore,
  itemIds: string[]
): Promise<Record<string, unknown>[]> {
  if (itemIds.length === 0) {
    return [];
  }

  const itemRefs = itemIds.map((itemId) => db.collection("checklistItems").doc(itemId));
  const itemSnaps = await db.getAll(...itemRefs);

  return itemSnaps
    .filter((snap) => snap.exists)
    .map((snap) => snap.data() as Record<string, unknown>);
}
