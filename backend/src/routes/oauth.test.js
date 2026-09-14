/**
 * Tester för Google-SSO:ns kontoupplösning (upsertGoogleUser). Porterade
 * från Cellarions oauth.test.js och anpassade till Glosans fält.
 *
 * upsertGoogleUser är hjärtat i flödet — den avgör, för en inkommande
 * Google-profil, om ett redan länkat konto ska returneras, om Google ska
 * länkas till ett befintligt email-konto, eller om ett nytt konto ska
 * skapas. Fel i grenarna eller i verifierad-email-guarden betyder
 * dubblettkonton eller kontokapning, så kontraktet pinnas här.
 *
 * User-modellen mockas med en liten in-memory-store så grenlogiken testas
 * utan databas (sviten har ingen Mongo).
 */

process.env.JWT_SECRET = 'test-secret';

// In-memory-fejk av Mongoose-User som stödjer exakt de anrop
// upsertGoogleUser / generateUniqueUsername gör: findOne (via $elemMatch,
// email eller username — username-varianten kedjas .select().lean()) och
// doc.save().
jest.mock('../models/User', () => {
  const store = { users: [] };

  function User(doc) {
    Object.assign(this, doc);
    this.authProviders = doc.authProviders || [];
    this._id = doc._id || `id-${store.users.length + 1}`;
  }
  User.prototype.save = async function save() {
    if (!store.users.includes(this)) store.users.push(this);
    return this;
  };

  // Matchningen måste vara lika TILLÅTANDE som MongoDB:s, inte så strikt
  // som man skulle önska: dotted paths in i en array av subdokument matchas
  // oberoende (olika element kan uppfylla varsitt villkor), medan $elemMatch
  // kräver att alla villkor håller inom ett och samma element. Mocken
  // implementerar båda semantikerna så testet nedan fångar en regression
  // från $elemMatch tillbaka till dotted paths.
  const matchesDotted = (u, query) =>
    Object.entries(query)
      .filter(([k]) => k.startsWith('authProviders.'))
      .every(([k, v]) => (u.authProviders || []).some((p) => p[k.slice('authProviders.'.length)] === v));

  const matchesElem = (u, spec) =>
    (u.authProviders || []).some((p) => Object.entries(spec).every(([k, v]) => p[k] === v));

  User.findOne = (query) => {
    let result = null;
    if (query.authProviders && query.authProviders.$elemMatch) {
      result = store.users.find((u) => matchesElem(u, query.authProviders.$elemMatch)) || null;
    } else if (query['authProviders.provider']) {
      result = store.users.find((u) => matchesDotted(u, query)) || null;
    } else if (query.email) {
      result = store.users.find((u) => u.email === query.email) || null;
    } else if (query.username) {
      result = store.users.find((u) => u.username === query.username) || null;
    }
    // Thenable som också stödjer .select().lean()-kedjan från
    // username-unikhetsproben.
    const chain = {
      select: () => chain,
      lean: () => Promise.resolve(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };

  User.__store = store;
  User.__seed = (doc) => {
    const u = new User(doc);
    store.users.push(u);
    return u;
  };
  return User;
});

const User = require('../models/User');
const { upsertSsoUser, upsertGoogleUser, generateUniqueUsername } = require('./oauth');

const googleProfile = (overrides = {}) => ({
  id: 'google-1',
  displayName: 'Jane Doe',
  emails: [{ value: 'jane@example.com', verified: true }],
  _json: { email_verified: true },
  ...overrides,
});

beforeEach(() => {
  User.__store.users.length = 0;
});

describe('upsertGoogleUser', () => {
  test('skapar nytt konto för en förstagångs-Google-användare', async () => {
    const user = await upsertGoogleUser(googleProfile());

    expect(User.__store.users).toHaveLength(1);
    expect(user.email).toBe('jane@example.com');
    expect(user.username).toBe('jane');
    expect(user.roles).toEqual(['user']);
    expect(user.authProviders).toEqual([{ provider: 'google', providerId: 'google-1' }]);
    // Google har intygat adressen — kontot startar verifierat.
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    // Texten under Google-knappen bär 13-årsbekräftelsen.
    expect(user.ageConsent).toBe(true);
  });

  test('returnerar SAMMA konto när provider-id:t redan är länkat (ingen dubblett)', async () => {
    const first = await upsertGoogleUser(googleProfile());
    const second = await upsertGoogleUser(googleProfile());

    expect(second).toBe(first);
    expect(User.__store.users).toHaveLength(1);
  });

  test('länkar Google till befintligt konto med samma verifierade email', async () => {
    const existing = User.__seed({
      username: 'bob',
      email: 'bob@example.com',
      password: 'hashed',
      emailVerified: false,
      ageConsent: false,
      authProviders: [],
    });

    const user = await upsertGoogleUser(
      googleProfile({ id: 'google-99', emails: [{ value: 'bob@example.com', verified: true }] })
    );

    expect(user).toBe(existing); // länkad, inte duplicerad
    expect(User.__store.users).toHaveLength(1);
    expect(user.authProviders).toContainEqual({ provider: 'google', providerId: 'google-99' });
    expect(user.emailVerified).toBe(true); // uppgraderad — Google verifierade
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.password).toBe('hashed'); // lösenordet orört
    // Länkning ändrar INTE befintligt GDPR-samtycke — det stämplas bara på
    // konton som skapas via SSO-flödet.
    expect(user.ageConsent).toBe(false);
  });

  test('matchar email case-okänsligt vid länkning', async () => {
    const existing = User.__seed({ username: 'carol', email: 'carol@example.com', authProviders: [] });

    const user = await upsertGoogleUser(
      googleProfile({ id: 'google-7', emails: [{ value: 'Carol@Example.com', verified: true }] })
    );

    expect(user).toBe(existing);
    expect(User.__store.users).toHaveLength(1);
  });

  test('avvisar overifierad Google-email (varken länkning eller nytt konto)', async () => {
    await expect(
      upsertGoogleUser(googleProfile({ emails: [{ value: 'x@example.com', verified: false }], _json: { email_verified: false } }))
    ).rejects.toMatchObject({ code: 'no_verified_email' });
    expect(User.__store.users).toHaveLength(0);
  });

  test('avvisar profil helt utan email', async () => {
    await expect(
      upsertGoogleUser(googleProfile({ emails: undefined, _json: {} }))
    ).rejects.toMatchObject({ code: 'no_verified_email' });
  });

  test('redan länkat konto returneras även om emailen numera är overifierad uppströms', async () => {
    // Länkade konton kortsluter före verifierad-email-guarden.
    const existing = User.__seed({
      username: 'dave',
      email: 'dave@example.com',
      authProviders: [{ provider: 'google', providerId: 'google-linked' }],
    });
    const user = await upsertGoogleUser(
      googleProfile({ id: 'google-linked', emails: [{ value: 'dave@example.com', verified: false }], _json: { email_verified: false } })
    );
    expect(user).toBe(existing);
  });
});

describe('upsertSsoUser — identiteten är ETT array-element', () => {
  test('samma providerId under en annan provider räknas INTE som länkad', async () => {
    // Kontot håller google/shared-id. Ingen har någonsin länkat
    // other/shared-id, så en inloggning som den identiteten får INTE hitta
    // kontot. Två dotted-villkor hade: MongoDB matchar varje villkor
    // oberoende mot arrayen, så kontot hade kommit tillbaka — före
    // email-kollen — och lämnat över ett befintligt konto till en identitet
    // som aldrig länkats. Mocken återger den semantiken, så det här testet
    // fallerar om queryn regredierar till dotted paths.
    User.__seed({
      username: 'grace',
      email: 'grace@example.com',
      authProviders: [{ provider: 'google', providerId: 'shared-id' }],
    });

    await expect(
      upsertSsoUser('other', { providerId: 'shared-id', email: 'someone-else@example.com', emailVerified: false })
    ).rejects.toMatchObject({ code: 'no_verified_email' });

    // Nådde email-guarden i stället för att kortsluta på en falsk länk,
    // och skapade ingenting.
    expect(User.__store.users).toHaveLength(1);
  });
});

describe('generateUniqueUsername', () => {
  test('härleder ett gement handle ur emailens local-part', async () => {
    expect(await generateUniqueUsername('Majken@Example.se', 'Majken')).toBe('majken');
  });

  test('strippar tecken som inte tillåts i användarnamn', async () => {
    expect(await generateUniqueUsername('a.b+tag@x.com', '')).toBe('a.btag');
  });

  test('fyller ut ett för kort handle till 3-teckensminimum', async () => {
    expect(await generateUniqueUsername('ab@x.com', '')).toBe('abuser');
  });

  test('lägger på suffix när bas-handlet är upptaget', async () => {
    User.__seed({ username: 'jane', email: 'other@example.com' });
    const name = await generateUniqueUsername('jane@example.com', 'Jane');
    expect(name).not.toBe('jane');
    expect(name).toMatch(/^jane-[0-9a-f]{4}$/);
  });

  test('returnerar alltid ett schema-giltigt användarnamn', async () => {
    for (const email of ['日本@x.com', 'X@x.com', 'a_b.c-d@x.com']) {
      const name = await generateUniqueUsername(email, '');
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(30);
      expect(name).toMatch(/^[a-z0-9_.-]+$/);
    }
  });
});
