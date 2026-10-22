// Demo sheets created on first load so the app isn't empty.
import { uid, isoDate, nextDow, addDays } from './util.js';

function signup(slotId, name, contact, note, minsAgo, status = 'confirmed') {
  const t = Date.now() - minsAgo * 60000;
  return { id: uid(8), slotId, name, contact, note, status, createdAt: t, queuedAt: t, token: uid(24) };
}

export function buildSeeds() {
  const fri = isoDate(nextDow(5));
  const sat = isoDate(nextDow(6));
  const now = Date.now();

  const potluck = {
    id: 'room12-potluck',
    adminToken: uid(24),
    title: 'Room 12 Fall Potluck',
    emoji: '🥧',
    templateId: 'potluck',
    description: "Families of Room 12: let's eat! Claim a category so we get a balanced spread.\nPlease label anything with nuts. Kids eat first, grown-ups fight over the brisket after.",
    location: 'Maple Street Elementary, Cafeteria',
    date: fri, start: '17:30', end: '19:30',
    waitlist: true,
    organizer: { name: 'Jordan Whitaker', email: 'jordan.w@example.com' },
    createdAt: now - 3 * 86400000,
    slots: [
      { id: 'mains', type: 'item', label: 'Mains', note: 'Feeds 8 or more', capacity: 4 },
      { id: 'sides', type: 'item', label: 'Sides & salads', note: '', capacity: 4 },
      { id: 'desserts', type: 'item', label: 'Desserts', note: '', capacity: 3 },
      { id: 'drinks', type: 'item', label: 'Drinks', note: 'Juice boxes count', capacity: 3 },
      { id: 'plates', type: 'item', label: 'Plates, cups & napkins', note: '', capacity: 1 },
    ],
    signups: [],
  };
  potluck.signups = [
    signup('mains', 'Dana Rodriguez', 'dana.r@example.com', 'Baked mac & cheese, big tray', 2900),
    signup('mains', 'Mike Thompson', '(555) 201-3344', 'Smoked brisket. Yes, I am bringing the smoker.', 2400),
    signup('sides', 'Priya Natarajan', 'priya.n@example.com', 'Chana masala + rice', 2200),
    signup('sides', 'Chris Okafor', 'chris.okafor@example.com', 'Caesar salad', 1500),
    signup('sides', 'Lena Park', '555-889-1200', 'Corn on the cob', 900),
    signup('sides', 'Tom Becker', 'tbecker@example.com', 'Potato salad (the good kind)', 400),
    signup('sides', 'Sam Whitfield', 'sam.whitfield@example.com', 'Fruit salad', 120, 'waitlist'),
    signup('desserts', 'Aisha Grant', 'aisha.g@example.com', 'Brownies, nut-free', 600),
    signup('plates', 'Greg Molina', '(555) 410-7788', '', 300),
  ];

  const fest = {
    id: 'fall-fest',
    adminToken: uid(24),
    title: 'Maple Street Fall Festival Volunteers',
    emoji: '🎃',
    templateId: 'volunteer',
    description: 'Our biggest fundraiser of the year! Grab a shift. Volunteers get a free hot dog and our eternal gratitude.',
    location: 'Maple Street Elementary, Back Field',
    date: sat, start: '', end: '',
    waitlist: true,
    organizer: { name: 'Maple Street PTA', email: 'pta@example.com' },
    createdAt: now - 5 * 86400000,
    slots: [
      { id: 'setup', type: 'time', label: 'Setup crew', note: 'Tables, tents, lots of zip ties', capacity: 4, date: sat, start: '08:00', end: '10:00' },
      { id: 'tickets', type: 'time', label: 'Ticket table', note: 'Cash box + Venmo QR', capacity: 2, date: sat, start: '10:00', end: '12:00' },
      { id: 'grill', type: 'time', label: 'Grill master', note: 'Tongs provided. Apron optional but encouraged.', capacity: 2, date: sat, start: '11:00', end: '13:00' },
      { id: 'games', type: 'time', label: 'Games booth', note: '', capacity: 3, date: sat, start: '12:00', end: '14:00' },
      { id: 'cleanup', type: 'time', label: 'Cleanup crew', note: '', capacity: 5, date: sat, start: '14:00', end: '15:30' },
    ],
    signups: [],
  };
  fest.signups = [
    signup('setup', 'Rob Delaney', 'rob.d@example.com', 'Bringing my truck', 5000),
    signup('setup', 'Kim Tran', 'kim.tran@example.com', '', 4100),
    signup('setup', 'Marcus Bell', '555-300-1122', '', 2000),
    signup('tickets', 'Jen Alvarez', 'jen.alvarez@example.com', '', 3000),
    signup('grill', 'Mike Thompson', '(555) 201-3344', 'Born for this', 2800),
    signup('grill', 'Dave Kowalski', 'dave.k@example.com', 'I own three aprons', 1900),
    signup('grill', 'Carlos Mendes', 'carlos.m@example.com', '', 700, 'waitlist'),
    signup('games', 'Beth Larson', 'beth.l@example.com', '', 1000),
    signup('cleanup', 'Nora Fitzgerald', '555-777-3030', '', 500),
  ];

  /* ---------- Demo group: Saturday Trail Dads ---------- */
  const satD = nextDow(6);
  const sats = [0, 1, 2, 3].map((i) => isoDate(addDays(satD, i * 7)));
  const snacks = {
    id: 'trail-snacks',
    adminToken: uid(24),
    title: 'Trail snacks & coffee',
    emoji: '🥨',
    templateId: 'snacks',
    description: 'One thermos of coffee and a few snack bringers each Saturday. Trail mix is a food group.',
    location: 'Eagle Creek Trailhead',
    date: '', start: '', end: '',
    waitlist: true,
    organizer: { name: 'Rob Delaney', email: 'rob.d@example.com' },
    groupId: 'trail-dads',
    eventId: 'sat-hike',
    createdAt: now - 20 * 86400000,
    slots: sats.flatMap((d, i) => [
      { id: `snack${i}`, type: 'time', label: 'Trail snacks', note: 'Enough for ~10 hungry dads', capacity: 3, date: d, start: '07:30', end: '09:30' },
      { id: `coffee${i}`, type: 'time', label: 'Coffee thermos', note: 'The big one', capacity: 1, date: d, start: '07:30', end: '09:30' },
    ]),
    signups: [],
  };
  snacks.signups = [
    signup('snack0', 'Kim Tran', 'kim.tran@example.com', 'Homemade granola bars', 3000),
    signup('snack0', 'Dave Kowalski', 'dave.k@example.com', 'Beef jerky (3 kinds)', 1400),
    signup('coffee0', 'Mike Thompson', '(555) 201-3344', 'Dark roast, obviously', 2000),
    signup('snack1', 'Marcus Bell', '555-300-1122', 'Clementines', 600),
  ];

  const m = (name, contact, role, daysAgo) => ({ id: uid(8), name, contact, role, joinedAt: now - daysAgo * 86400000, token: uid(24) });
  const members = [
    m('Rob Delaney', 'rob.d@example.com', 'organizer', 60),
    m('Mike Thompson', 'mike.t@example.com', 'co', 58),
    m('Kim Tran', 'kim.tran@example.com', 'member', 50),
    m('Dave Kowalski', 'dave.k@example.com', 'member', 44),
    m('Marcus Bell', 'marcus.b@example.com', 'member', 40),
    m('Carlos Mendes', 'carlos.m@example.com', 'member', 31),
    m('Andre Williams', 'andre.w@example.com', 'member', 22),
    m('Jeff Nakamura', 'jeff.n@example.com', 'member', 15),
    m('Luis Ortega', 'luis.o@example.com', 'member', 9),
    m('Ben Fischer', 'ben.f@example.com', 'member', 2),
  ];
  const rs = (i, status, minsAgo, occ = sats[0], eventId = 'sat-hike') => {
    const t = now - minsAgo * 60000;
    return { id: uid(8), eventId, occurrence: occ, memberId: members[i].id, name: members[i].name, contact: members[i].contact, status, createdAt: t, queuedAt: t };
  };
  const group = {
    id: 'trail-dads',
    adminToken: uid(24),
    name: 'Saturday Trail Dads',
    emoji: '🥾',
    color: 'relish',
    description: "A low-key crew of dads who hike Saturday mornings before the soccer games start. All paces welcome. We stop for every 'cool rock' and we're not sorry.",
    location: 'Eagle Creek Trailhead, north lot',
    visibility: 'public',
    createdAt: now - 60 * 86400000,
    members,
    announcements: [
      { id: uid(8), text: 'Welcome to the crew! We meet every Saturday at 7:30 sharp (ish). Bring water, wear real shoes, and claim a snack slot when you RSVP.', author: 'Rob Delaney', createdAt: now - 59 * 86400000, pinned: true },
      { id: uid(8), text: "Heads up: the creek crossing is muddy after this week's rain. Boots > sneakers this Saturday.", author: 'Mike Thompson', createdAt: now - 2 * 86400000, pinned: false },
      { id: uid(8), text: 'Pancake breakfast + trail cleanup is on the calendar. Rob is bringing the griddle. Nobody tell his wife.', author: 'Rob Delaney', createdAt: now - 6 * 86400000, pinned: false },
    ],
    events: [
      {
        id: 'sat-hike', title: 'Saturday morning hike', description: '4–5 miles on the Ridge Loop, back by 9:30 for soccer drop-off.',
        location: 'Eagle Creek Trailhead, north lot', date: isoDate(addDays(satD, -21)), start: '07:30', end: '09:30',
        recurrence: 'weekly', capacity: 10, sheetIds: ['trail-snacks'], createdAt: now - 60 * 86400000,
      },
      {
        id: 'pancakes', title: 'Pancake breakfast + trail cleanup', description: 'Griddle at the pavilion, then an hour of picking up litter. Kids welcome.',
        location: 'Eagle Creek Pavilion', date: isoDate(addDays(satD, 14)), start: '08:00', end: '11:00',
        recurrence: 'monthly', capacity: 0, sheetIds: [], createdAt: now - 6 * 86400000,
      },
    ],
    rsvps: [],
  };
  group.rsvps = [
    rs(0, 'going', 3000), rs(1, 'going', 2900), rs(2, 'going', 2500), rs(3, 'going', 1800),
    rs(4, 'going', 1200), rs(5, 'maybe', 800), rs(6, 'going', 400), rs(7, 'no', 300),
    rs(0, 'going', 1000, sats[1]), rs(4, 'going', 500, sats[1]),
    rs(0, 'going', 5000, isoDate(addDays(satD, 14)), 'pancakes'), rs(1, 'going', 4000, isoDate(addDays(satD, 14)), 'pancakes'),
  ];

  return { sheets: [potluck, fest, snacks], groups: [group] };
}
