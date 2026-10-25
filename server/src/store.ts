// Where the server keeps what must outlive it: player progress and accounts.
//
// With MONGODB_URI set (a free MongoDB Atlas database works), each record set lives in one document
// of the "store" collection, so nothing is lost when a free host restarts or sleeps with an empty
// disk. The JSON file beside the server is still written as a local copy. Without MONGODB_URI the
// file is all there is, as on a computer at home.
//
// One document holds at most 16 MB: some thousands of players. Past that, give each player a
// document of their own.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Collection, MongoClient } from "mongodb";

type Stored = { _id: string; data: Record<string, unknown>; savedAt: Date };

const uri = process.env.MONGODB_URI?.trim();
let collection: Collection<Stored> | undefined;
/** Writes to the database go one after another, newest last, so an older one never wins. */
let writes: Promise<void> = Promise.resolve();

if (uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  // Without the database every player would start over and then overwrite the saved records:
  // better not to start at all, so the host keeps retrying.
  await client.connect();
  collection = client.db(process.env.MONGODB_DB || "mu_sky").collection<Stored>("store");
  console.log("Saving progress and accounts in MongoDB.");
}

/** The records saved under `name`: from the database when there is one, else from `file`. */
export async function loadRecords<T>(name: string, file: string): Promise<Map<string, T>> {
  if (collection) {
    const stored = await collection.findOne({ _id: name });
    if (stored) {
      return new Map(Object.entries(stored.data) as [string, T][]);
    }
    // First run with a database: carry over what the file already has.
  }
  if (!existsSync(file)) {
    return new Map();
  }
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(file, "utf8"))));
  } catch (error) {
    console.error(`Could not read ${file}; starting with no ${name}.`, error);
    return new Map();
  }
}

/** Saves the records: the file at once (beside it first, so a crash never leaves half a file), the database in turn. */
export function saveRecords(name: string, file: string, records: Map<string, unknown>) {
  const data = Object.fromEntries(records);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(data));
    renameSync(`${file}.tmp`, file);
  } catch (error) {
    // With a database the file is only a copy; without one this is worth knowing.
    console.error(`Could not write ${file}.`, error);
  }
  if (collection) {
    const target = collection;
    writes = writes.then(() =>
      target
        .replaceOne({ _id: name }, { data, savedAt: new Date() }, { upsert: true })
        .then(() => undefined)
        .catch((error) => console.error(`Could not save ${name} in MongoDB.`, error)),
    );
  }
}

/** Resolves once every save sent to the database so far has landed. */
export function flushed() {
  return writes;
}
