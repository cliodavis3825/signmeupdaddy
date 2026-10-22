// Sheet templates for the builder. Dates are computed relative to today.
import { uid, isoDate, addDays, nextDow, today } from './util.js';

export const timeSlot = (o = {}) => ({ id: uid(6), type: 'time', label: '', note: '', capacity: 1, date: '', start: '', end: '', ...o });
export const itemSlot = (o = {}) => ({ id: uid(6), type: 'item', label: '', note: '', capacity: 1, ...o });

export const TEMPLATES = [
  {
    id: 'potluck',
    name: 'Potluck',
    emoji: '🥗',
    blurb: 'Mains, sides, desserts. Never 9 bags of chips again.',
    build() {
      return {
        title: 'Fall Potluck',
        description: "Bring a dish to share! Claim a category below so we don't end up with nine bags of chips and no mains.",
        location: '',
        date: isoDate(nextDow(6)), start: '17:30', end: '20:00',
        slots: [
          itemSlot({ label: 'Mains', capacity: 4, note: 'Feeds 8 or more' }),
          itemSlot({ label: 'Sides & salads', capacity: 4 }),
          itemSlot({ label: 'Desserts', capacity: 3 }),
          itemSlot({ label: 'Drinks', capacity: 3, note: 'Something for the kids too' }),
          itemSlot({ label: 'Plates, cups & napkins', capacity: 1 }),
        ],
      };
    },
  },
  {
    id: 'volunteer',
    name: 'Volunteer Shifts',
    emoji: '🙋',
    blurb: 'Time shifts with headcounts. Waitlist kicks in when full.',
    build() {
      const d = isoDate(nextDow(6));
      return {
        title: 'Fall Festival Volunteers',
        description: 'Many hands make light work (and shorter lines at the bounce house). Grab a shift!',
        location: '',
        date: d, start: '', end: '',
        slots: [
          timeSlot({ label: 'Setup crew', date: d, start: '08:00', end: '10:00', capacity: 4 }),
          timeSlot({ label: 'Ticket table', date: d, start: '10:00', end: '12:00', capacity: 3 }),
          timeSlot({ label: 'Games booth', date: d, start: '12:00', end: '14:00', capacity: 3 }),
          timeSlot({ label: 'Cleanup crew', date: d, start: '14:00', end: '15:30', capacity: 5 }),
        ],
      };
    },
  },
  {
    id: 'snacks',
    name: 'Snack Rotation',
    emoji: '🍊',
    blurb: 'One family per week. Orange slices optional, but encouraged.',
    build() {
      const first = nextDow(6);
      return {
        title: 'Team Snack Rotation',
        description: 'One family brings post-game snacks each week. Water + something healthy-ish. Nut-free, please.',
        location: '',
        date: '', start: '', end: '',
        slots: Array.from({ length: 6 }, (_, i) =>
          timeSlot({ label: 'Game day snacks', date: isoDate(addDays(first, i * 7)), capacity: 1 })),
      };
    },
  },
  {
    id: 'mealtrain',
    name: 'Meal Train',
    emoji: '🍲',
    blurb: 'Dinners by date, so nobody gets six lasagnas.',
    build() {
      const start = addDays(today(), 1);
      return {
        title: 'Meals for the Parker Family',
        description: "The Parkers just welcomed baby #3! Let's keep them fed for a week. Family of 5, no nuts. Drop-off on the porch cooler; no need to knock.",
        location: '',
        date: '', start: '', end: '',
        slots: Array.from({ length: 7 }, (_, i) =>
          timeSlot({ label: 'Dinner drop-off', date: isoDate(addDays(start, i)), start: '17:00', end: '18:00', capacity: 1 })),
      };
    },
  },
  {
    id: 'carpool',
    name: 'Carpool',
    emoji: '🚐',
    blurb: 'Drop-off and pickup drivers. Minivans assemble.',
    build() {
      const mon = nextDow(1);
      const slots = [];
      for (let i = 0; i < 5; i++) {
        const d = isoDate(addDays(mon, i));
        slots.push(timeSlot({ label: 'Morning drop-off', date: d, start: '07:30', end: '08:00', capacity: 1 }));
        slots.push(timeSlot({ label: 'Afternoon pickup', date: d, start: '15:15', end: '15:45', capacity: 1 }));
      }
      return {
        title: 'Soccer Practice Carpool',
        description: 'Fits 4 kids per car. Booster seats live in the garage bin if you need one.',
        location: '',
        date: '', start: '', end: '',
        slots,
      };
    },
  },
  {
    id: 'blank',
    name: 'Start from scratch',
    emoji: '📋',
    blurb: 'A blank sheet. Add time slots, items, or both.',
    build() {
      return { title: '', description: '', location: '', date: '', start: '', end: '', slots: [itemSlot({ label: '', capacity: 1 })] };
    },
  },
];

export const getTemplate = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
