import { curbFeatures, parseCurbSides } from '../scripts/curbs';

describe('parseCurbSides', () => {
  it('reads the current scheme per side', () => {
    const sides = parseCurbSides({ 'parking:left': 'no', 'parking:right': 'lane', 'parking:right:orientation': 'parallel' });
    expect(sides.left.status).toBe('no');
    expect(sides.right.status).toBe('free');
  });

  it('applies both to each side unless a side is tagged on its own', () => {
    const sides = parseCurbSides({ 'parking:both': 'lane', 'parking:left:restriction': 'no_stopping' });
    expect(sides.left.status).toBe('no');
    expect(sides.right.status).toBe('free');
  });

  it('reads the legacy parking:lane scheme', () => {
    const sides = parseCurbSides({ 'parking:lane:both': 'no_parking' });
    expect(sides.left.status).toBe('no');
    expect(sides.right.status).toBe('no');
    expect(parseCurbSides({ 'parking:lane:right': 'parallel' }).right.status).toBe('free');
  });

  it('treats paid, private and resident-only curbs as not free', () => {
    expect(parseCurbSides({ 'parking:both': 'lane', 'parking:both:fee': 'yes' }).left.status).toBe('paid');
    expect(parseCurbSides({ 'parking:lane:both': 'parallel', 'parking:condition:both': 'ticket' }).left.status).toBe('paid');
    expect(parseCurbSides({ 'parking:lane:both': 'parallel', 'parking:condition:both': 'residents' }).left.status).toBe('no');
    expect(parseCurbSides({ 'parking:both': 'lane', 'parking:both:access': 'private' }).left.status).toBe('no');
  });

  it('keeps the mapped time limit', () => {
    const sides = parseCurbSides({ 'parking:both': 'lane', 'parking:both:maxstay': '2 h' });
    expect(sides.right).toEqual({ status: 'free', maxstay: '2 h' });
  });

  it('says nothing for separately mapped or unknown values', () => {
    expect(parseCurbSides({ 'parking:both': 'separate' }).left.status).toBe('unknown');
    expect(parseCurbSides({ 'parking:right': 'weird' }).right.status).toBe('unknown');
    expect(parseCurbSides({}).left.status).toBe('unknown');
  });
});

describe('curbFeatures', () => {
  const geometry = [{ lat: 45.4, lon: -75.7 }, { lat: 45.401, lon: -75.7 }];

  it('draws each answered side on its own curb', () => {
    const features = curbFeatures(
      { id: 1, tags: { name: 'Elgin Street', 'parking:left': 'no', 'parking:right': 'lane' }, geometry },
      'Ottawa',
    );
    expect(features).toHaveLength(2);
    const left = features.find(f => f.properties?.curb === -1)!;
    const right = features.find(f => f.properties?.curb === 1)!;
    expect(left.properties).toMatchObject({ kind: 'noParking', basis: 'osm', city: 'Ottawa', road: 'Elgin Street' });
    expect(right.properties).toMatchObject({ kind: 'street', basis: 'osm' });
  });

  it('leaves paid sides to the city meter layer', () => {
    const features = curbFeatures(
      { id: 2, tags: { 'parking:both': 'lane', 'parking:both:fee': 'yes' }, geometry },
      'Ottawa',
    );
    expect(features).toHaveLength(0);
  });
});
