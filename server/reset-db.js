import { closeDatabase, databasePath, initializeDatabase } from "./db.js";

initializeDatabase({ reset: true });
closeDatabase();

console.log(`SQLite database has been reset: ${databasePath}`);
