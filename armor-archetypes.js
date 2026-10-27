// Ahamkara Wishes — the armor archetypes and stats.
//
// An archetype is the two main stats a piece rolls highest; the third is its
// Tertiary. Shared by the inventory matcher (owned-inventory-index.js), the
// Wishes screen and the armor builder.

const ARCHETYPES = [
    { id: 'siege',     name: 'SIEGEBREAKER',  stats: ['Health', 'Grenade'] },
    { id: 'grenadr',   name: 'GRENADIER',     stats: ['Grenade', 'Super'] },
    { id: 'colossus',  name: 'COLOSSUS',      stats: ['Super', 'Health'] },
    { id: 'brawler',   name: 'BRAWLER',       stats: ['Melee', 'Health'] },
    { id: 'paragon',   name: 'PARAGON',       stats: ['Super', 'Melee'] },
    { id: 'powerhs',   name: 'POWERHOUSE',    stats: ['Weapons', 'Super'] },
    { id: 'skirmsh',   name: 'SKIRMISHER',    stats: ['Melee', 'Weapons'] },
    { id: 'reaver',    name: 'REAVER',        stats: ['Class', 'Melee'] },
    { id: 'special',   name: 'SPECIALIST',    stats: ['Class', 'Weapons'] },
    { id: 'gunner',    name: 'GUNNER',        stats: ['Weapons', 'Grenade'] },
    { id: 'demo',      name: 'DEMOLITIONIST', stats: ['Grenade', 'Class'] },
    { id: 'bulwark',   name: 'BULWARK',       stats: ['Health', 'Class'] }
];

// 'Weapons' replaces 'Mobility' in the Renegades expansion meta.
const STATS = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
