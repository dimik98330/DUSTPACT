import {
  createSignerFromKeyPair,
  generateKeyPairSigner,
  type KeyPairSigner,
} from "@solana/kit";
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("dustpact-local-test-identities", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
/** Only generated local-validator identities. Never imports or reads a user's wallet secrets. */
const flights = new Map<string, Promise<KeyPairSigner>>();
export function localIdentity(label = "player"): Promise<KeyPairSigner> {
  const previous = flights.get(label);
  if (previous) return previous;
  const task = obtain(label).finally(() => flights.delete(label));
  flights.set(label, task);
  return task;
}
async function obtain(label: string) {
  const candidate = await generateKeyPairSigner(),
    db = await database();
  try {
    const pair = await new Promise<CryptoKeyPair>((resolve, reject) => {
      let selected: CryptoKeyPair;
      const tx = db.transaction("keys", "readwrite"),
        store = tx.objectStore("keys"),
        request = store.get(label);
      request.onsuccess = () => {
        if (request.result) selected = request.result;
        else {
          selected = candidate.keyPair;
          store.add(selected, label);
        }
      };
      tx.oncomplete = () => resolve(selected);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? Error("Не удалось сохранить тестовый профиль"));
    });
    return createSignerFromKeyPair(pair);
  } finally {
    db.close();
  }
}
