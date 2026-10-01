let wasm;

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_export_2.set(idx, obj);
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_export_2.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}
/**
 * @param {number} _hash
 * @param {number} _weapon_type_id
 * @param {number} _intrinsic_hash
 * @param {number} _ammo_type_id
 * @param {number} _damage_type_id
 */
export function setWeapon(_hash, _weapon_type_id, _intrinsic_hash, _ammo_type_id, _damage_type_id) {
    const ret = wasm.setWeapon(_hash, _weapon_type_id, _intrinsic_hash, _ammo_type_id, _damage_type_id);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @returns {any}
 */
export function getMiscData(_dynamic_traits, _pvp) {
    const ret = wasm.getMiscData(_dynamic_traits, _pvp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @returns {RangeResponse}
 */
export function getWeaponRangeFalloff(_dynamic_traits, _pvp) {
    const ret = wasm.getWeaponRangeFalloff(_dynamic_traits, _pvp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return RangeResponse.__wrap(ret[0]);
}

let cachedUint32ArrayMemory0 = null;

function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
 * @param {Uint32Array} _perks
 * @returns {any}
 */
export function getTraitOptions(_perks) {
    const ptr0 = passArray32ToWasm0(_perks, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.getTraitOptions(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
/**
 * @returns {Uint32Array}
 */
export function getTraitHashes() {
    const ret = wasm.getTraitHashes();
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * @returns {any}
 */
export function getStats() {
    const ret = wasm.getStats();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} _stats
 */
export function setStats(_stats) {
    const ret = wasm.setStats(_stats);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * DEPRECATED for now
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @param {boolean} _use_rpl
 * @returns {FiringResponse}
 */
export function getWeaponFiringData(_dynamic_traits, _pvp, _use_rpl) {
    const ret = wasm.getWeaponFiringData(_dynamic_traits, _pvp, _use_rpl);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return FiringResponse.__wrap(ret[0]);
}

/**
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @param {number} _resilience
 * @returns {number}
 */
export function getWeaponFlinch(_dynamic_traits, _pvp, _resilience) {
    const ret = wasm.getWeaponFlinch(_dynamic_traits, _pvp, _resilience);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @returns {MetaData}
 */
export function getMetadata() {
    const ret = wasm.getMetadata();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return MetaData.__wrap(ret[0]);
}

/**
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @returns {ReloadResponse}
 */
export function getWeaponReloadTimes(_dynamic_traits, _pvp) {
    const ret = wasm.getWeaponReloadTimes(_dynamic_traits, _pvp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ReloadResponse.__wrap(ret[0]);
}

/**
 * @param {number} _overshield
 * @returns {any}
 */
export function getWeaponTtk(_overshield) {
    const ret = wasm.getWeaponTtk(_overshield);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @returns {AmmoResponse}
 */
export function getWeaponAmmoSizes(_dynamic_traits, _pvp) {
    const ret = wasm.getWeaponAmmoSizes(_dynamic_traits, _pvp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return AmmoResponse.__wrap(ret[0]);
}

/**
 * @param {any} _stats
 * @param {number} _value
 * @param {number} _hash
 */
export function addTrait(_stats, _value, _hash) {
    const ret = wasm.addTrait(_stats, _value, _hash);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @returns {any}
 */
export function getModifierResponseSummary(_dynamic_traits, _pvp) {
    const ret = wasm.getModifierResponseSummary(_dynamic_traits, _pvp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} _recommend_pl
 * @param {number} _player_pl
 * @param {number} _weapon_pl
 * @param {number} _override_cap
 * @param {DifficultyOptions} _difficulty
 * @param {EnemyType} _enemy_type
 */
export function setEncounter(_recommend_pl, _player_pl, _weapon_pl, _override_cap, _difficulty, _enemy_type) {
    const ret = wasm.setEncounter(_recommend_pl, _player_pl, _weapon_pl, _override_cap, _difficulty, _enemy_type);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @returns {any}
 */
export function stringifyWeapon() {
    const ret = wasm.stringifyWeapon();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} perk_hash
 * @param {number} new_value
 */
export function setTraitValue(perk_hash, new_value) {
    wasm.setTraitValue(perk_hash, new_value);
}

/**
 * @param {number} _level
 */
export function setLoggingLevel(_level) {
    const ret = wasm.setLoggingLevel(_level);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {boolean} _pvp
 * @returns {ScalarResponseSummary}
 */
export function getScalarResponseSummary(_pvp) {
    const ret = wasm.getScalarResponseSummary(_pvp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ScalarResponseSummary.__wrap(ret[0]);
}

export function resetTraits() {
    const ret = wasm.resetTraits();
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

export function start() {
    wasm.start();
}

/**
 * @param {boolean} _dynamic_traits
 * @param {boolean} _pvp
 * @returns {HandlingResponse}
 */
export function getWeaponHandlingTimes(_dynamic_traits, _pvp) {
    const ret = wasm.getWeaponHandlingTimes(_dynamic_traits, _pvp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return HandlingResponse.__wrap(ret[0]);
}

/**
 * @enum {1 | 2 | 3}
 */
export const DifficultyOptions = Object.freeze({
    NORMAL: 1, "1": "NORMAL",
    RAID: 2, "2": "RAID",
    MASTER: 3, "3": "MASTER",
});
/**
 * @enum {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}
 */
export const EnemyType = Object.freeze({
    MINOR: 0, "0": "MINOR",
    ELITE: 1, "1": "ELITE",
    MINIBOSS: 2, "2": "MINIBOSS",
    BOSS: 3, "3": "BOSS",
    VEHICLE: 4, "4": "VEHICLE",
    ENCLAVE: 5, "5": "ENCLAVE",
    PLAYER: 6, "6": "PLAYER",
    CHAMPION: 7, "7": "CHAMPION",
});

const AmmoResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ammoresponse_free(ptr >>> 0, 1));

export class AmmoResponse {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(AmmoResponse.prototype);
        obj.__wbg_ptr = ptr;
        AmmoResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            magSize: this.magSize,
            reserveSize: this.reserveSize,
            timestamp: this.timestamp,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AmmoResponseFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ammoresponse_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get magSize() {
        const ret = wasm.__wbg_get_ammoresponse_magSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get reserveSize() {
        const ret = wasm.__wbg_get_ammoresponse_reserveSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get timestamp() {
        const ret = wasm.__wbg_get_ammoresponse_timestamp(this.__wbg_ptr);
        return ret >>> 0;
    }
}

const BodyKillDataFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bodykilldata_free(ptr >>> 0, 1));

export class BodyKillData {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(BodyKillData.prototype);
        obj.__wbg_ptr = ptr;
        BodyKillDataFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            bodyshots: this.bodyshots,
            timeTaken: this.timeTaken,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BodyKillDataFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_bodykilldata_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get bodyshots() {
        const ret = wasm.__wbg_get_bodykilldata_bodyshots(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set bodyshots(arg0) {
        wasm.__wbg_set_bodykilldata_bodyshots(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get timeTaken() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set timeTaken(arg0) {
        wasm.__wbg_set_bodykilldata_timeTaken(this.__wbg_ptr, arg0);
    }
}

const DpsResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_dpsresponse_free(ptr >>> 0, 1));

export class DpsResponse {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DpsResponseFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_dpsresponse_free(ptr, 0);
    }
    /**
     * Returns a list of dps values for each magazine
     * @returns {any}
     */
    get dpsPerMag() {
        const ret = wasm.dpsresponse_dpsPerMag(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns a list of tuples of time and damage
     * @returns {any}
     */
    get timeDamageData() {
        const ret = wasm.dpsresponse_timeDamageData(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    toJSON() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ptr = this.__destroy_into_raw();
            const ret = wasm.dpsresponse_toJSON(ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get totalDamage() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get totalTime() {
        const ret = wasm.__wbg_get_dpsresponse_totalTime(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get totalShots() {
        const ret = wasm.__wbg_get_dpsresponse_totalShots(this.__wbg_ptr);
        return ret;
    }
}

const FiringResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_firingresponse_free(ptr >>> 0, 1));

export class FiringResponse {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(FiringResponse.prototype);
        obj.__wbg_ptr = ptr;
        FiringResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            pvpImpactDamage: this.pvpImpactDamage,
            pvpExplosionDamage: this.pvpExplosionDamage,
            pvpCritMult: this.pvpCritMult,
            pveImpactDamage: this.pveImpactDamage,
            pveExplosionDamage: this.pveExplosionDamage,
            pveCritMult: this.pveCritMult,
            burstDelay: this.burstDelay,
            innerBurstDelay: this.innerBurstDelay,
            burstSize: this.burstSize,
            timestamp: this.timestamp,
            rpm: this.rpm,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FiringResponseFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_firingresponse_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get pvpImpactDamage() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pvpExplosionDamage() {
        const ret = wasm.__wbg_get_dpsresponse_totalTime(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pvpCritMult() {
        const ret = wasm.__wbg_get_firingresponse_pvpCritMult(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pveImpactDamage() {
        const ret = wasm.__wbg_get_firingresponse_pveImpactDamage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pveExplosionDamage() {
        const ret = wasm.__wbg_get_firingresponse_pveExplosionDamage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pveCritMult() {
        const ret = wasm.__wbg_get_firingresponse_pveCritMult(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get burstDelay() {
        const ret = wasm.__wbg_get_firingresponse_burstDelay(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get innerBurstDelay() {
        const ret = wasm.__wbg_get_firingresponse_innerBurstDelay(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get burstSize() {
        const ret = wasm.__wbg_get_firingresponse_burstSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get timestamp() {
        const ret = wasm.__wbg_get_firingresponse_timestamp(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get rpm() {
        const ret = wasm.__wbg_get_firingresponse_rpm(this.__wbg_ptr);
        return ret;
    }
}

const HandlingResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_handlingresponse_free(ptr >>> 0, 1));

export class HandlingResponse {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(HandlingResponse.prototype);
        obj.__wbg_ptr = ptr;
        HandlingResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            readyTime: this.readyTime,
            stowTime: this.stowTime,
            adsTime: this.adsTime,
            timestamp: this.timestamp,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HandlingResponseFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_handlingresponse_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get readyTime() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get stowTime() {
        const ret = wasm.__wbg_get_dpsresponse_totalTime(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get adsTime() {
        const ret = wasm.__wbg_get_firingresponse_pvpCritMult(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get timestamp() {
        const ret = wasm.__wbg_get_handlingresponse_timestamp(this.__wbg_ptr);
        return ret >>> 0;
    }
}

const MetaDataFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_metadata_free(ptr >>> 0, 1));

export class MetaData {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MetaData.prototype);
        obj.__wbg_ptr = ptr;
        MetaDataFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            apiVersion: this.apiVersion,
            apiTimestamp: this.apiTimestamp,
            apiGitCommit: this.apiGitCommit,
            apiGitBranch: this.apiGitBranch,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MetaDataFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_metadata_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get apiVersion() {
        const ret = wasm.__wbg_get_metadata_apiVersion(this.__wbg_ptr);
        return getStringFromWasm0(ret[0], ret[1]);
    }
    /**
     * @returns {string}
     */
    get apiTimestamp() {
        const ret = wasm.__wbg_get_metadata_apiTimestamp(this.__wbg_ptr);
        return getStringFromWasm0(ret[0], ret[1]);
    }
    /**
     * @returns {string}
     */
    get apiGitCommit() {
        const ret = wasm.__wbg_get_metadata_apiGitCommit(this.__wbg_ptr);
        return getStringFromWasm0(ret[0], ret[1]);
    }
    /**
     * @returns {string}
     */
    get apiGitBranch() {
        const ret = wasm.__wbg_get_metadata_apiGitBranch(this.__wbg_ptr);
        return getStringFromWasm0(ret[0], ret[1]);
    }
}

const OptimalKillDataFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_optimalkilldata_free(ptr >>> 0, 1));

export class OptimalKillData {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(OptimalKillData.prototype);
        obj.__wbg_ptr = ptr;
        OptimalKillDataFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            headshots: this.headshots,
            bodyshots: this.bodyshots,
            timeTaken: this.timeTaken,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OptimalKillDataFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_optimalkilldata_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get headshots() {
        const ret = wasm.__wbg_get_bodykilldata_bodyshots(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set headshots(arg0) {
        wasm.__wbg_set_bodykilldata_bodyshots(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get bodyshots() {
        const ret = wasm.__wbg_get_optimalkilldata_bodyshots(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set bodyshots(arg0) {
        wasm.__wbg_set_optimalkilldata_bodyshots(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get timeTaken() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set timeTaken(arg0) {
        wasm.__wbg_set_bodykilldata_timeTaken(this.__wbg_ptr, arg0);
    }
}

const RangeResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rangeresponse_free(ptr >>> 0, 1));

export class RangeResponse {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RangeResponse.prototype);
        obj.__wbg_ptr = ptr;
        RangeResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            hipFalloffStart: this.hipFalloffStart,
            hipFalloffEnd: this.hipFalloffEnd,
            adsFalloffStart: this.adsFalloffStart,
            adsFalloffEnd: this.adsFalloffEnd,
            floorPercent: this.floorPercent,
            timestamp: this.timestamp,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RangeResponseFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rangeresponse_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get hipFalloffStart() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get hipFalloffEnd() {
        const ret = wasm.__wbg_get_dpsresponse_totalTime(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get adsFalloffStart() {
        const ret = wasm.__wbg_get_firingresponse_pvpCritMult(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get adsFalloffEnd() {
        const ret = wasm.__wbg_get_firingresponse_pveImpactDamage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get floorPercent() {
        const ret = wasm.__wbg_get_firingresponse_pveExplosionDamage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get timestamp() {
        const ret = wasm.__wbg_get_rangeresponse_timestamp(this.__wbg_ptr);
        return ret >>> 0;
    }
}

const ReloadResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_reloadresponse_free(ptr >>> 0, 1));

export class ReloadResponse {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ReloadResponse.prototype);
        obj.__wbg_ptr = ptr;
        ReloadResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            reloadTime: this.reloadTime,
            ammoTime: this.ammoTime,
            timestamp: this.timestamp,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ReloadResponseFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_reloadresponse_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get reloadTime() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get ammoTime() {
        const ret = wasm.__wbg_get_dpsresponse_totalTime(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get timestamp() {
        const ret = wasm.__wbg_get_dpsresponse_totalShots(this.__wbg_ptr);
        return ret >>> 0;
    }
}

const ResillienceSummaryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_resilliencesummary_free(ptr >>> 0, 1));

export class ResillienceSummary {

    toJSON() {
        return {
            resillienceValue: this.resillienceValue,
            bodyTtk: this.bodyTtk,
            optimalTtk: this.optimalTtk,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ResillienceSummaryFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_resilliencesummary_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get resillienceValue() {
        const ret = wasm.__wbg_get_resilliencesummary_resillienceValue(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set resillienceValue(arg0) {
        wasm.__wbg_set_resilliencesummary_resillienceValue(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {BodyKillData}
     */
    get bodyTtk() {
        const ret = wasm.__wbg_get_resilliencesummary_bodyTtk(this.__wbg_ptr);
        return BodyKillData.__wrap(ret);
    }
    /**
     * @param {BodyKillData} arg0
     */
    set bodyTtk(arg0) {
        _assertClass(arg0, BodyKillData);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_resilliencesummary_bodyTtk(this.__wbg_ptr, ptr0);
    }
    /**
     * @returns {OptimalKillData}
     */
    get optimalTtk() {
        const ret = wasm.__wbg_get_resilliencesummary_optimalTtk(this.__wbg_ptr);
        return OptimalKillData.__wrap(ret);
    }
    /**
     * @param {OptimalKillData} arg0
     */
    set optimalTtk(arg0) {
        _assertClass(arg0, OptimalKillData);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_resilliencesummary_optimalTtk(this.__wbg_ptr, ptr0);
    }
}

const ScalarResponseSummaryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_scalarresponsesummary_free(ptr >>> 0, 1));

export class ScalarResponseSummary {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ScalarResponseSummary.prototype);
        obj.__wbg_ptr = ptr;
        ScalarResponseSummaryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    toJSON() {
        return {
            reloadScalar: this.reloadScalar,
            drawScalar: this.drawScalar,
            adsScalar: this.adsScalar,
            stowScalar: this.stowScalar,
            globalRangeScalar: this.globalRangeScalar,
            hipfireRangeScalar: this.hipfireRangeScalar,
            adsRangeScalar: this.adsRangeScalar,
            magSizeScalar: this.magSizeScalar,
            reserveSizeScalar: this.reserveSizeScalar,
        };
    }

    toString() {
        return JSON.stringify(this);
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ScalarResponseSummaryFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_scalarresponsesummary_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get reloadScalar() {
        const ret = wasm.__wbg_get_bodykilldata_timeTaken(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get drawScalar() {
        const ret = wasm.__wbg_get_dpsresponse_totalTime(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get adsScalar() {
        const ret = wasm.__wbg_get_firingresponse_pvpCritMult(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get stowScalar() {
        const ret = wasm.__wbg_get_firingresponse_pveImpactDamage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get globalRangeScalar() {
        const ret = wasm.__wbg_get_firingresponse_pveExplosionDamage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get hipfireRangeScalar() {
        const ret = wasm.__wbg_get_firingresponse_pveCritMult(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get adsRangeScalar() {
        const ret = wasm.__wbg_get_firingresponse_burstDelay(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get magSizeScalar() {
        const ret = wasm.__wbg_get_firingresponse_innerBurstDelay(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get reserveSizeScalar() {
        const ret = wasm.__wbg_get_firingresponse_rpm(this.__wbg_ptr);
        return ret;
    }
}

const StatFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_stat_free(ptr >>> 0, 1));

export class Stat {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StatFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_stat_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get baseValue() {
        const ret = wasm.__wbg_get_ammoresponse_magSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set baseValue(arg0) {
        wasm.__wbg_set_stat_baseValue(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get partValue() {
        const ret = wasm.__wbg_get_ammoresponse_reserveSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set partValue(arg0) {
        wasm.__wbg_set_stat_partValue(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get traitValue() {
        const ret = wasm.__wbg_get_ammoresponse_timestamp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set traitValue(arg0) {
        wasm.__wbg_set_stat_traitValue(this.__wbg_ptr, arg0);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_buffer_a215fd0f9dbb5414 = function(arg0) {
        const ret = arg0.buffer;
        return ret;
    };
    imports.wbg.__wbg_call_aa20ca83b389253c = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_done_b00ac79b7cf688ec = function(arg0) {
        const ret = arg0.done;
        return ret;
    };
    imports.wbg.__wbg_entries_2aaa882d15c26fd0 = function(arg0) {
        const ret = Object.entries(arg0);
        return ret;
    };
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_get_142c69a0a38ca3a9 = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_get_9528546d1b415178 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_instanceof_ArrayBuffer_b19b33ccadb20395 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof ArrayBuffer;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Uint8Array_ee46a70987a1d66b = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Uint8Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_isSafeInteger_1c660d27c689f62a = function(arg0) {
        const ret = Number.isSafeInteger(arg0);
        return ret;
    };
    imports.wbg.__wbg_iterator_c397425a538e3b86 = function() {
        const ret = Symbol.iterator;
        return ret;
    };
    imports.wbg.__wbg_length_1799fd5bf657c257 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_621925723fc28f40 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_log_ae35330814ae55cc = function(arg0, arg1) {
        console.log(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return ret;
    };
    imports.wbg.__wbg_new_9163745409122fa8 = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_b6f51e9f591d0d1d = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_new_d684b6b3189ca362 = function() {
        const ret = new Object();
        return ret;
    };
    imports.wbg.__wbg_new_f26c4aa30e9f9c0e = function() {
        const ret = new Map();
        return ret;
    };
    imports.wbg.__wbg_next_6a72514087dd23f8 = function(arg0) {
        const ret = arg0.next;
        return ret;
    };
    imports.wbg.__wbg_next_96ab50690a8f6cca = function() { return handleError(function (arg0) {
        const ret = arg0.next();
        return ret;
    }, arguments) };
    imports.wbg.__wbg_set_3807d5f0bfc24aa7 = function(arg0, arg1, arg2) {
        arg0[arg1] = arg2;
    };
    imports.wbg.__wbg_set_61aa9ab41a0fb137 = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
    };
    imports.wbg.__wbg_set_911a2f3ee8dd23b5 = function(arg0, arg1, arg2) {
        arg0.set(arg1, arg2 >>> 0);
    };
    imports.wbg.__wbg_set_b000a869769fbb80 = function(arg0, arg1, arg2) {
        const ret = arg0.set(arg1, arg2);
        return ret;
    };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg_value_5af0abb3b2b9f90b = function(arg0) {
        const ret = arg0.value;
        return ret;
    };
    imports.wbg.__wbindgen_bigint_from_u64 = function(arg0) {
        const ret = BigInt.asUintN(64, arg0);
        return ret;
    };
    imports.wbg.__wbindgen_boolean_get = function(arg0) {
        const v = arg0;
        const ret = typeof(v) === 'boolean' ? (v ? 1 : 0) : 2;
        return ret;
    };
    imports.wbg.__wbindgen_debug_string = function(arg0, arg1) {
        const ret = debugString(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_error_new = function(arg0, arg1) {
        const ret = new Error(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_2;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.__wbindgen_is_function = function(arg0) {
        const ret = typeof(arg0) === 'function';
        return ret;
    };
    imports.wbg.__wbindgen_is_object = function(arg0) {
        const val = arg0;
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbindgen_is_string = function(arg0) {
        const ret = typeof(arg0) === 'string';
        return ret;
    };
    imports.wbg.__wbindgen_jsval_loose_eq = function(arg0, arg1) {
        const ret = arg0 == arg1;
        return ret;
    };
    imports.wbg.__wbindgen_memory = function() {
        const ret = wasm.memory;
        return ret;
    };
    imports.wbg.__wbindgen_number_get = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbindgen_number_new = function(arg0) {
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('oracle_engine_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
