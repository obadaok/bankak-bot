const { MongoClient } = require('mongodb');

async function reset() {
  const uri = process.env.MONGODB_URI || process.argv[2];
  if (!uri) {
    console.error('Usage: MONGODB_URI=... node reset-auth.js');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const result = await client.db().collection('sessions').deleteOne({ _id: 'baileys-auth' });
  console.log(`Deleted ${result.deletedCount} auth document`);
  await client.close();
}
reset().catch(console.error);
