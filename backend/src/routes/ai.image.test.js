/**
 * Tester för bildimportens validering.
 *
 * Storleksgränsen räknas på den AVKODADE bilden, inte på base64-strängen —
 * base64 är ~33 % större, så räknar man fel väg släpper man igenom en bild
 * som är en tredjedel större än taket (eller nekar en som får plats). Den
 * mattan pinnas här, tillsammans med data-URL-strippningen som annars
 * skickar "data:image/jpeg;base64,..." rakt in i Anthropic-anropet.
 *
 * Bara ren logik — ingen DB, inget nätverk, ingen Anthropic-nyckel.
 */

process.env.JWT_SECRET = 'test-secret';

const {
  decodedBase64Bytes,
  stripDataUrlPrefix,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_TYPES,
} = require('./ai');

// base64 av n bytes: 4 tecken per 3 bytes, upprundat till jämn 4:a med '='.
const base64OfBytes = (n) => Buffer.alloc(n).toString('base64');

describe('decodedBase64Bytes', () => {
  test.each([0, 1, 2, 3, 4, 5, 100, 999, 1024])('räknar rätt för %i bytes', (n) => {
    expect(decodedBase64Bytes(base64OfBytes(n))).toBe(n);
  });

  test('padding dras av — annars överskattas storleken', () => {
    // 'AA==' är 1 byte, inte 3. Utan padding-avdraget blir svaret 3.
    expect(decodedBase64Bytes('AA==')).toBe(1);
    expect(decodedBase64Bytes('AAA=')).toBe(2);
    expect(decodedBase64Bytes('AAAA')).toBe(3);
  });

  test('en bild precis på gränsen släpps igenom, en över nekas', () => {
    expect(decodedBase64Bytes(base64OfBytes(MAX_IMAGE_BYTES))).toBe(MAX_IMAGE_BYTES);
    expect(decodedBase64Bytes(base64OfBytes(MAX_IMAGE_BYTES + 1))).toBeGreaterThan(MAX_IMAGE_BYTES);
  });

  test('mäter avkodad storlek, inte stränglängd', () => {
    // Poängen med hela funktionen: base64-strängen är ~33 % längre än
    // bilden. Jämför man stränglängden mot taket blir gränsen fel.
    const b64 = base64OfBytes(1200);
    expect(b64.length).toBeGreaterThan(1200);
    expect(decodedBase64Bytes(b64)).toBe(1200);
  });
});

describe('stripDataUrlPrefix', () => {
  test('plockar ut mediaType och data ur en data-URL', () => {
    expect(stripDataUrlPrefix('data:image/jpeg;base64,AAAA')).toEqual({
      mediaType: 'image/jpeg',
      data: 'AAAA',
    });
  });

  test('lämnar rå base64 orörd och säger att mediaType saknas', () => {
    expect(stripDataUrlPrefix('AAAA')).toEqual({ mediaType: null, data: 'AAAA' });
  });

  test('normaliserar mediaType till gemener', () => {
    expect(stripDataUrlPrefix('data:IMAGE/PNG;base64,AAAA').mediaType).toBe('image/png');
  });

  test('varje tillåten typ känns igen i data-URL-form', () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(stripDataUrlPrefix(`data:${type};base64,AAAA`).mediaType).toBe(type);
    }
  });

  test('en sträng som bara liknar en data-URL behandlas som rådata', () => {
    // Ingen ";base64," — då är det inget vi ska tro oss förstå.
    expect(stripDataUrlPrefix('data:image/jpeg,AAAA')).toEqual({
      mediaType: null,
      data: 'data:image/jpeg,AAAA',
    });
  });
});

describe('ALLOWED_IMAGE_TYPES', () => {
  test('matchar formaten Messages API tar emot', () => {
    expect(ALLOWED_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  });

  test('innehåller inga format vi inte kan skicka vidare', () => {
    expect(ALLOWED_IMAGE_TYPES).not.toContain('image/heic'); // iPhone-format — konverteras i klienten
    expect(ALLOWED_IMAGE_TYPES).not.toContain('application/pdf');
  });
});
