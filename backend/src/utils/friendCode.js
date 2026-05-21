// Friend-code helpers.
// Codes are 6 chars from an unambiguous alphanumeric alphabet — no 0/O, 1/I,
// no lowercase. 32^6 ≈ 1 billion combinations: easy to share, very hard to
// brute-force at our request rate limits.

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 6) {
  let s = '';
  for (let i = 0; i < length; i++) {
    // crypto.randomInt är CSPRNG-säker; Math.random är en förutsägbar PRNG
    // som kan rekonstrueras om processminne läcker.
    s += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return s;
}

// Generate a friend code that doesn't collide with any existing user. Retries
// a few times before bubbling up — collisions are vanishingly rare in our
// codebase, but if the alphabet ever shrinks this guards against infinite loops.
async function generateUniqueFriendCode(UserModel) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await UserModel.findOne({ friendCode: code }).select('_id').lean();
    if (!exists) return code;
  }
  throw new Error('Failed to generate a unique friend code after 5 attempts');
}

module.exports = { randomCode, generateUniqueFriendCode };
