#!/usr/bin/env node
// Sätt en eller flera användare som admin via email-adress.
//
// Kör inifrån backend-containern på VM:n:
//   docker compose -f docker-compose.prod.yml exec backend \
//     node scripts/setAdmin.js majken.nagy@gmail.com jagduvi79@gmail.com
//
// Skriptet är idempotent — kör det igen och redan-admins rapporteras
// utan att något ändras. Använder samma MONGO_URI som backend.
const mongoose = require('mongoose');
const User = require('../src/models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/glosan';

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.error('Användning: node scripts/setAdmin.js <email> [<email> ...]');
    process.exit(2);
  }

  await mongoose.connect(MONGO_URI);
  console.log(`Ansluten till ${MONGO_URI}\n`);

  let updated = 0;
  let already = 0;
  let missing = 0;

  for (const email of emails) {
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`✗ ${email} — hittades inte`);
      missing += 1;
      continue;
    }
    if (user.roles.includes('admin')) {
      console.log(`= ${email} — redan admin (${user.username})`);
      already += 1;
      continue;
    }
    user.roles.push('admin');
    await user.save();
    console.log(`✓ ${email} — uppgraderad till admin (${user.username})`);
    updated += 1;
  }

  console.log(`\nSammanfattning: ${updated} uppgraderade, ${already} redan admin, ${missing} saknas.`);
  await mongoose.disconnect();
  process.exit(missing > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fel:', err.message);
  process.exit(1);
});
