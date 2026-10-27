// Bridges the ES-module WASM build of oracle_engine into the extension's
// plain-script global scope. dynamic import() works from classic scripts,
// so the rest of the codebase doesn't need to become modules.
let _oracleEnginePromise = null;

function loadOracleEngine() {
    if (!_oracleEnginePromise) {
        _oracleEnginePromise = import(chrome.runtime.getURL('oracle-engine/oracle_engine.js'))
            .then(async (mod) => {
                await mod.default({ module_or_path: chrome.runtime.getURL('oracle-engine/oracle_engine_bg.wasm') });
                return mod;
            });
    }
    return _oracleEnginePromise;
}

// Exposed globally so other scripts (e.g. screens/weapon-builder.js) can await the
// initialized D2Calc module without duplicating the loader.
window.oracleEngineReady = loadOracleEngine();

document.addEventListener('DOMContentLoaded', () => {
    loadOracleEngine()
        .then((D2Calc) => {
            const metadata = D2Calc.getMetadata();
            console.log('[ORACLE] Loaded oracle_engine', metadata.toJSON());
        })
        .catch((e) => {
            console.error('[ORACLE] Failed to load oracle_engine WASM module', e);
        });
});
