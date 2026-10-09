const path = require('path');
const { connect } = require('./src');

async function main() {
  const dbPath = path.join(__dirname, 'example-db');
  const db = connect(dbPath);

  try {
    const users = await db.createCollection('users');
    const docs = Array.from({ length: 100 }, (_, index) => ({
      name: `User ${index + 1}`,
      email: `user${index + 1}@example.com`,
      active: index % 2 === 0,
      score: index + 1
    }));

    const inserted = await users.insertMany(docs);
    console.log(`Inserted ${inserted.length} documents into the users collection.`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
