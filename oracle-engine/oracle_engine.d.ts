/* tslint:disable */
/* eslint-disable */
export function setWeapon(_hash: number, _weapon_type_id: number, _intrinsic_hash: number, _ammo_type_id: number, _damage_type_id: number): void;
export function getMiscData(_dynamic_traits: boolean, _pvp: boolean): any;
export function getWeaponRangeFalloff(_dynamic_traits: boolean, _pvp: boolean): RangeResponse;
export function getTraitOptions(_perks: Uint32Array): any;
export function getTraitHashes(): Uint32Array;
export function getStats(): any;
export function setStats(_stats: any): void;
/**
 * DEPRECATED for now
 */
export function getWeaponFiringData(_dynamic_traits: boolean, _pvp: boolean, _use_rpl: boolean): FiringResponse;
export function getWeaponFlinch(_dynamic_traits: boolean, _pvp: boolean, _resilience: number): number;
export function getMetadata(): MetaData;
export function getWeaponReloadTimes(_dynamic_traits: boolean, _pvp: boolean): ReloadResponse;
export function getWeaponTtk(_overshield: number): any;
export function getWeaponAmmoSizes(_dynamic_traits: boolean, _pvp: boolean): AmmoResponse;
export function addTrait(_stats: any, _value: number, _hash: number): void;
export function getModifierResponseSummary(_dynamic_traits: boolean, _pvp: boolean): any;
export function setEncounter(_recommend_pl: number, _player_pl: number, _weapon_pl: number, _override_cap: number, _difficulty: DifficultyOptions, _enemy_type: EnemyType): void;
export function stringifyWeapon(): any;
export function setTraitValue(perk_hash: number, new_value: number): void;
export function setLoggingLevel(_level: number): void;
export function getScalarResponseSummary(_pvp: boolean): ScalarResponseSummary;
export function resetTraits(): void;
export function start(): void;
export function getWeaponHandlingTimes(_dynamic_traits: boolean, _pvp: boolean): HandlingResponse;
export enum DifficultyOptions {
  NORMAL = 1,
  RAID = 2,
  MASTER = 3,
}
export enum EnemyType {
  MINOR = 0,
  ELITE = 1,
  MINIBOSS = 2,
  BOSS = 3,
  VEHICLE = 4,
  ENCLAVE = 5,
  PLAYER = 6,
  CHAMPION = 7,
}
export class AmmoResponse {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  readonly magSize: number;
  readonly reserveSize: number;
  readonly timestamp: number;
}
export class BodyKillData {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  bodyshots: number;
  timeTaken: number;
}
export class DpsResponse {
  private constructor();
  free(): void;
  toJSON(): string;
  /**
   * Returns a list of dps values for each magazine
   */
  readonly dpsPerMag: any;
  /**
   * Returns a list of tuples of time and damage
   */
  readonly timeDamageData: any;
  readonly totalDamage: number;
  readonly totalTime: number;
  readonly totalShots: number;
}
export class FiringResponse {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  readonly pvpImpactDamage: number;
  readonly pvpExplosionDamage: number;
  readonly pvpCritMult: number;
  readonly pveImpactDamage: number;
  readonly pveExplosionDamage: number;
  readonly pveCritMult: number;
  readonly burstDelay: number;
  readonly innerBurstDelay: number;
  readonly burstSize: number;
  readonly timestamp: number;
  readonly rpm: number;
}
export class HandlingResponse {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  readonly readyTime: number;
  readonly stowTime: number;
  readonly adsTime: number;
  readonly timestamp: number;
}
export class MetaData {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  readonly apiVersion: string;
  readonly apiTimestamp: string;
  readonly apiGitCommit: string;
  readonly apiGitBranch: string;
}
export class OptimalKillData {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  headshots: number;
  bodyshots: number;
  timeTaken: number;
}
export class RangeResponse {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  readonly hipFalloffStart: number;
  readonly hipFalloffEnd: number;
  readonly adsFalloffStart: number;
  readonly adsFalloffEnd: number;
  readonly floorPercent: number;
  readonly timestamp: number;
}
export class ReloadResponse {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  readonly reloadTime: number;
  readonly ammoTime: number;
  readonly timestamp: number;
}
export class ResillienceSummary {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  resillienceValue: number;
  bodyTtk: BodyKillData;
  optimalTtk: OptimalKillData;
}
export class ScalarResponseSummary {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  readonly reloadScalar: number;
  readonly drawScalar: number;
  readonly adsScalar: number;
  readonly stowScalar: number;
  readonly globalRangeScalar: number;
  readonly hipfireRangeScalar: number;
  readonly adsRangeScalar: number;
  readonly magSizeScalar: number;
  readonly reserveSizeScalar: number;
}
export class Stat {
  private constructor();
  free(): void;
  baseValue: number;
  partValue: number;
  traitValue: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_ammoresponse_free: (a: number, b: number) => void;
  readonly __wbg_bodykilldata_free: (a: number, b: number) => void;
  readonly __wbg_dpsresponse_free: (a: number, b: number) => void;
  readonly __wbg_firingresponse_free: (a: number, b: number) => void;
  readonly __wbg_get_ammoresponse_magSize: (a: number) => number;
  readonly __wbg_get_ammoresponse_reserveSize: (a: number) => number;
  readonly __wbg_get_ammoresponse_timestamp: (a: number) => number;
  readonly __wbg_get_bodykilldata_bodyshots: (a: number) => number;
  readonly __wbg_get_bodykilldata_timeTaken: (a: number) => number;
  readonly __wbg_get_dpsresponse_totalShots: (a: number) => number;
  readonly __wbg_get_dpsresponse_totalTime: (a: number) => number;
  readonly __wbg_get_firingresponse_burstDelay: (a: number) => number;
  readonly __wbg_get_firingresponse_burstSize: (a: number) => number;
  readonly __wbg_get_firingresponse_innerBurstDelay: (a: number) => number;
  readonly __wbg_get_firingresponse_pveCritMult: (a: number) => number;
  readonly __wbg_get_firingresponse_pveExplosionDamage: (a: number) => number;
  readonly __wbg_get_firingresponse_pveImpactDamage: (a: number) => number;
  readonly __wbg_get_firingresponse_pvpCritMult: (a: number) => number;
  readonly __wbg_get_firingresponse_rpm: (a: number) => number;
  readonly __wbg_get_firingresponse_timestamp: (a: number) => number;
  readonly __wbg_get_handlingresponse_timestamp: (a: number) => number;
  readonly __wbg_get_metadata_apiGitBranch: (a: number) => [number, number];
  readonly __wbg_get_metadata_apiGitCommit: (a: number) => [number, number];
  readonly __wbg_get_metadata_apiTimestamp: (a: number) => [number, number];
  readonly __wbg_get_metadata_apiVersion: (a: number) => [number, number];
  readonly __wbg_get_optimalkilldata_bodyshots: (a: number) => number;
  readonly __wbg_get_rangeresponse_timestamp: (a: number) => number;
  readonly __wbg_get_resilliencesummary_bodyTtk: (a: number) => number;
  readonly __wbg_get_resilliencesummary_optimalTtk: (a: number) => number;
  readonly __wbg_get_resilliencesummary_resillienceValue: (a: number) => number;
  readonly __wbg_handlingresponse_free: (a: number, b: number) => void;
  readonly __wbg_metadata_free: (a: number, b: number) => void;
  readonly __wbg_optimalkilldata_free: (a: number, b: number) => void;
  readonly __wbg_rangeresponse_free: (a: number, b: number) => void;
  readonly __wbg_reloadresponse_free: (a: number, b: number) => void;
  readonly __wbg_resilliencesummary_free: (a: number, b: number) => void;
  readonly __wbg_scalarresponsesummary_free: (a: number, b: number) => void;
  readonly __wbg_set_bodykilldata_bodyshots: (a: number, b: number) => void;
  readonly __wbg_set_bodykilldata_timeTaken: (a: number, b: number) => void;
  readonly __wbg_set_optimalkilldata_bodyshots: (a: number, b: number) => void;
  readonly __wbg_set_resilliencesummary_bodyTtk: (a: number, b: number) => void;
  readonly __wbg_set_resilliencesummary_optimalTtk: (a: number, b: number) => void;
  readonly __wbg_set_resilliencesummary_resillienceValue: (a: number, b: number) => void;
  readonly __wbg_set_stat_baseValue: (a: number, b: number) => void;
  readonly __wbg_set_stat_partValue: (a: number, b: number) => void;
  readonly __wbg_set_stat_traitValue: (a: number, b: number) => void;
  readonly dpsresponse_dpsPerMag: (a: number) => any;
  readonly dpsresponse_timeDamageData: (a: number) => any;
  readonly dpsresponse_toJSON: (a: number) => [number, number];
  readonly addTrait: (a: any, b: number, c: number) => [number, number];
  readonly getMetadata: () => [number, number, number];
  readonly getMiscData: (a: number, b: number) => [number, number, number];
  readonly getModifierResponseSummary: (a: number, b: number) => [number, number, number];
  readonly getScalarResponseSummary: (a: number) => [number, number, number];
  readonly getStats: () => [number, number, number];
  readonly getTraitHashes: () => [number, number];
  readonly getTraitOptions: (a: number, b: number) => [number, number, number];
  readonly getWeaponAmmoSizes: (a: number, b: number) => [number, number, number];
  readonly getWeaponFiringData: (a: number, b: number, c: number) => [number, number, number];
  readonly getWeaponFlinch: (a: number, b: number, c: number) => [number, number, number];
  readonly getWeaponHandlingTimes: (a: number, b: number) => [number, number, number];
  readonly getWeaponRangeFalloff: (a: number, b: number) => [number, number, number];
  readonly getWeaponReloadTimes: (a: number, b: number) => [number, number, number];
  readonly getWeaponTtk: (a: number) => [number, number, number];
  readonly resetTraits: () => [number, number];
  readonly setEncounter: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly setLoggingLevel: (a: number) => [number, number];
  readonly setStats: (a: any) => [number, number];
  readonly setTraitValue: (a: number, b: number) => void;
  readonly setWeapon: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly start: () => void;
  readonly stringifyWeapon: () => [number, number, number];
  readonly __wbg_get_firingresponse_pvpExplosionDamage: (a: number) => number;
  readonly __wbg_get_handlingresponse_adsTime: (a: number) => number;
  readonly __wbg_get_handlingresponse_stowTime: (a: number) => number;
  readonly __wbg_get_optimalkilldata_headshots: (a: number) => number;
  readonly __wbg_get_rangeresponse_adsFalloffEnd: (a: number) => number;
  readonly __wbg_get_rangeresponse_adsFalloffStart: (a: number) => number;
  readonly __wbg_get_rangeresponse_floorPercent: (a: number) => number;
  readonly __wbg_get_rangeresponse_hipFalloffEnd: (a: number) => number;
  readonly __wbg_get_reloadresponse_ammoTime: (a: number) => number;
  readonly __wbg_get_reloadresponse_timestamp: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_adsRangeScalar: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_adsScalar: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_drawScalar: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_globalRangeScalar: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_hipfireRangeScalar: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_magSizeScalar: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_reserveSizeScalar: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_stowScalar: (a: number) => number;
  readonly __wbg_get_stat_partValue: (a: number) => number;
  readonly __wbg_get_stat_traitValue: (a: number) => number;
  readonly __wbg_set_optimalkilldata_headshots: (a: number, b: number) => void;
  readonly __wbg_set_optimalkilldata_timeTaken: (a: number, b: number) => void;
  readonly __wbg_get_reloadresponse_reloadTime: (a: number) => number;
  readonly __wbg_get_rangeresponse_hipFalloffStart: (a: number) => number;
  readonly __wbg_get_handlingresponse_readyTime: (a: number) => number;
  readonly __wbg_get_firingresponse_pvpImpactDamage: (a: number) => number;
  readonly __wbg_stat_free: (a: number, b: number) => void;
  readonly __wbg_get_stat_baseValue: (a: number) => number;
  readonly __wbg_get_optimalkilldata_timeTaken: (a: number) => number;
  readonly __wbg_get_scalarresponsesummary_reloadScalar: (a: number) => number;
  readonly __wbg_get_dpsresponse_totalDamage: (a: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
