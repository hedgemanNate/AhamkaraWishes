const fs = require('fs');
const path = require('path');
const assert = require('assert');

const modulePath = path.resolve(__dirname, '..', 'bungie-auth.js');
const code = fs.readFileSync(modulePath, 'utf8');

global.window = global;
global.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    }
  },
  runtime: {}
};
global.fetch = async () => ({ ok: true, json: async () => ({}) });
global.API_KEY = 'test-key';

try {
  eval(code);
} catch (e) {
  console.error('Failed to evaluate bungie-auth.js:', e);
  process.exit(2);
}

if (!global.window?.bungieAuth?.buildTransferItemPayload) {
  console.error('bungieAuth.buildTransferItemPayload not found');
  process.exit(2);
}

const payload = global.window.bungieAuth.buildTransferItemPayload('inst-1', 12345, 'char-1', 3, true);
assert.deepStrictEqual(payload, {
  itemReferenceHash: 12345,
  stackSize: 1,
  transferToVault: true,
  itemId: 'inst-1',
  characterId: 'char-1',
  membershipType: 3
});

const toCharacter = global.window.bungieAuth.buildTransferItemPayload(777, '99', 'char-2', '2', false, 5);
assert.deepStrictEqual(toCharacter, {
  itemReferenceHash: 99,
  stackSize: 5,
  transferToVault: false,
  itemId: '777',
  characterId: 'char-2',
  membershipType: 2
});

console.log('bungie-auth transfer payload test passed');
process.exit(0);
